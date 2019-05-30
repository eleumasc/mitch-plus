"use strict";

require("dotenv").config();
const getPort = require("get-port");
const pptrFirefox = require("puppeteer-firefox");
const webExt = require("web-ext").default;
const util = require("util");

const same = require("./same");
const crawler = require("./crawler");

const config = {
  sites: [
    {
      baseUrl: "https://madales.altervista.org/",
      auth: {
        login: async (page, profile) => {
          await page.goto(
            "https://madales.altervista.org/arhunt/public/signin"
          );
          await page.type("#nickname", profile.userid);
          await page.type("#password", profile.password);
          await page.click("#form-signin button");
          await page.waitForNavigation({ waitUntil: "load" });
        },
        logout: async page => {
          await page.goto(
            "https://madales.altervista.org/arhunt/public/signout"
          );
        },
        profiles: {
          alice: {
            userid: "alicehacker",
            password: "password"
          },
          bob: {
            userid: "bobhacker",
            password: "password"
          }
        }
      },
      navigation: {
        homePageUrl: "https://madales.altervista.org/arhunt/public/home",
        includeDomains: [],
        excludeUrls: [
          "https://madales.altervista.org/arhunt/public/signin",
          "https://madales.altervista.org/arhunt/public/signout"
        ]
      }
    }
  ]
};

(async () => {
  const CDPPort = await getPort();
  await webExt.cmd.run(
    {
      sourceDir: process.env.MITCH_EXT,
      firefox: pptrFirefox.executablePath(),
      args: [`-juggler=${CDPPort}` /* "-headless" */] // FIXME: headless mode has been disabled because some links does not trigger a navigation (therefore the user intervention is required)
    },
    {
      // These are non CLI related options for each function.
      // You need to specify this one so that your NodeJS application
      // can continue running after web-ext is finished.
      shouldExitProgram: false
    }
  );
  const browserWSEndpoint = `ws://127.0.0.1:${CDPPort}`;
  const browser = await pptrFirefox.connect({
    browserWSEndpoint
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux i586; rv:63.0) Gecko/20100101 Firefox/63.0"
  );
  await page.setViewport({ width: 1024, height: 768 });

  const site = config.sites[0];

  await page.goto(site.baseUrl);

  console.log("Looking for Mitch...");
  if ("Hello Mitch!" !== (await queryMitch(page, "echo", "Hello Mitch!"))) {
    console.error("Mitch is not available");
    return;
  }
  console.log("Mitch is ready");

  await site.auth.login(page, site.auth.profiles.alice);
  await queryMitch(page, "start_Alice1");
  console.log("start_Alice1");

  await navigate(page, site);

  await queryMitch(page, "finished_Alice1");
  console.log("finished_Alice1");
  await site.auth.logout(page);
  await queryMitch(page, "logged_out_Alice1");
  console.log("logged_out_Alice1");

  await site.auth.login(page, site.auth.profiles.bob);
  await queryMitch(page, "logged_in_Bob");
  console.log("logged_in_Bob");
  await site.auth.logout(page);
  await queryMitch(page, "logged_out_Bob");
  console.log("logged_out_Bob");

  await site.auth.login(page, site.auth.profiles.alice);
  await queryMitch(page, "logged_in_Alice2");
  console.log("logged_in_Alice2");
  await site.auth.logout(page);
  await queryMitch(page, "logged_out_Alice2");
  console.log("logged_out_Alice2");

  console.log("SUCCESS");
  console.log(
    "Collected sensitive requests: " +
      (await queryMitch(page, "collected_sensitive_requests"))
  );
  console.log(
    "Collected total requests: " +
      (await queryMitch(page, "collected_total_requests"))
  );
  console.log(
    util.inspect(await queryMitch(page, "guessCSRFs"), {
      showHidden: false,
      depth: null
    })
  );

  await browser.close();
})();

// TODO: give-up counter for unreachable links
async function navigate(page, site) {
  const crawl = crawler.create();
  do {
    const [links, linkElementsHandle] = await filterLinks(
      page,
      await findLinksInPage(page),
      linkIsAllowed,
      {
        site: async () => site,
        location: async () => await page.evaluate(() => window.location.href)
      }
    );

    const link = crawler.selectNextLink(crawl, links);
    if (!!link) {
      const linkElementHandle = await getLinkElementHandle(
        page,
        link,
        links,
        linkElementsHandle
      );
      await visitLinkInPage(page, link, linkElementHandle);
    } else {
      await page.goto(site.navigation.homePageUrl);
    }
  } while (crawler.thereAreUnvisitedLinks(crawl));
}

async function findLinksInPage(page) {
  const linkElementsHandle = await page.evaluateHandle(() => {
    return Array.from(document.querySelectorAll("a, form"));
  });

  const links = await page.evaluate(linkElements => {
    const links = [];

    for (let linkElement of linkElements) {
      const isForm = linkElement.tagName === "FORM";

      const linkUrlString =
        (isForm ? linkElement.action : linkElement.href) || location.href;

      const linkUrl = new URL(linkUrlString);

      const link = {};

      link.type = isForm ? "FORM" : "A";
      link.method = isForm ? linkElement.method : "GET";
      link.url = linkUrlString;

      link.dompath = (e => {
        const dompath = [];
        while (e !== document.body) {
          dompath.unshift(e.tagName);
          e = e.parentElement;
        }
        return dompath;
      })(linkElement);

      link.action = linkUrl.pathname.split("/").filter(s => s.trim() !== "");

      link.params = {};
      linkUrl.searchParams.forEach((value, key) => {
        link.params[key] = value;
      });
      if (isForm) {
        const formData = new FormData(linkElement);
        Array.from(formData.entries()).forEach(([key, value]) => {
          link.params[key] = value;
        });
      }

      links.push(link);
    }

    return links;
  }, linkElementsHandle);

  return [links, linkElementsHandle];
}

function linkIsAllowed(link, args) {
  return (
    !args.site.navigation.excludeUrls.some(url => same.url(link.url, url)) &&
    (args.site.navigation.includeDomains.some(url =>
      same.domain(link.url, url)
    ) ||
      same.domain(link.url, args.location))
  );
}

async function filterLinks(
  page,
  [links, linkElementsHandle],
  filterFn,
  argsFns
) {
  const args = {};
  for (let key in argsFns) {
    if (argsFns.hasOwnProperty(key)) {
      args[key] = await argsFns[key]();
    }
  }

  const filteredLinks = [];
  const filteredIndexes = [];
  for (let i = 0; i < links.length; i++) {
    if (filterFn(links[i], args)) {
      filteredLinks.push(links[i]);
      filteredIndexes.push(true);
    } else {
      filteredIndexes.push(false);
    }
  }

  const filteredLinkElementsHandle = await page.evaluateHandle(
    (linkElements, filteredIndexes) => {
      return linkElements.filter((_, i) => filteredIndexes[i]);
    },
    linkElementsHandle,
    filteredIndexes
  );

  return [filteredLinks, filteredLinkElementsHandle];
}

async function getLinkElementHandle(page, link, links, linkElementsHandle) {
  const index = links.indexOf(link);
  if (index >= 0) {
    return await page.evaluateHandle(
      (linkElements, index) => linkElements[index],
      linkElementsHandle,
      index
    );
  }
}

async function visitLinkInPage(page, link, linkElementHandle) {
  // TODO: smarter strategy

  if (link.type === "FORM") {
    // fillForm(page, linkElementHandle);
    await Promise.race([
      page.evaluate(formElement => {
        formElement.submit();
      }, linkElementHandle),
      page.waitForNavigation({ timeout: 10000, waitUntil: "load" })
    ]);
  } else {
    try {
      await linkElementHandle.click();
      try {
        await page.waitForNavigation({ timeout: 10000, waitUntil: "load" });
      } catch (e) {}
    } catch (e) {
      console.error("goto");
      await page.goto(link.url);
    }
  }
}

async function fillForm(page, formElementHandle) {
  // TODO: smarter strategy
  /*
  await page.evaluate(formElement => {
    const fieldElements = formElement.querySelectorAll(
      "input, textarea, select"
    );
    // ...
  }, formElementHandle); */
}

async function queryMitch(page, requestType, requestData = null) {
  return JSON.parse(
    await page.evaluate(
      async (requestType, requestDataJson) =>
        await new Promise((resolve, reject) => {
          const mRequestId = "" + performance.now();

          window.addEventListener(
            "mitchreply." + mRequestId,
            e => {
              resolve(JSON.parse(e.detail).dataJson);
            },
            { once: true }
          );

          window.dispatchEvent(
            new CustomEvent("mitchrequest", {
              detail: JSON.stringify({
                id: mRequestId,
                type: requestType,
                dataJson: requestDataJson
              })
            })
          );
        }),
      requestType,
      JSON.stringify(requestData)
    )
  );
}
