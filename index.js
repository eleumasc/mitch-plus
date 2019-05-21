require("dotenv").config();
const getPort = require("get-port");
const pptrFirefox = require("puppeteer-firefox");
const webExt = require("web-ext").default;
const util = require("util");

// const apt = require("./apt");

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

  console.log("We're in phase " + (await queryMitch(page, "phase")));
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

function sameURL(urlString1, urlString2) {
  const url1 = new URL(urlString1),
    url2 = new URL(urlString2);
  return (
    url1.protocol === url2.protocol &&
    url1.host === url2.host &&
    url1.pathname === url2.pathname &&
    Array.from(url1.searchParams.entries()).every(
      ([key, value]) =>
        url2.searchParams.has(key) && url2.searchParams.get(key) === value
    )
  );
}

async function navigate(page, site) {
  let ttl = 50; // FIXME: this navigation strategy will be deprecated (the navigation will terminate when every link will be visited)
  const history = [];

  // const abstractPageTree = apt.initAbstractPageTree();

  await page.goto(site.navigation.homePageUrl);

  while (ttl-- > 0) {
    const [links, linkElementsHandle] = await findLinksInPage(page);

    /*
    const pageModel = apt.calcPageModel(links);
    const pageLinkVector = apt.calcPageLinkVector(pageModel);
    const pageNode = apt.storePageLinkVectorInAbstractPageTree(
      abstractPageTree,
      pageLinkVector
    ); */

    const locationHref = await page.evaluate(() => {
      return window.location.href;
    });
    console.log("[VISIT] " + locationHref);

    let historyItem = history.find(historyItem =>
      sameURL(locationHref, historyItem.url)
    );
    if (!historyItem) {
      historyItem = {
        url: locationHref,
        visitCount: 0,
        allLinksVisited: false
      };
      history.push(historyItem);
    }
    historyItem.visitCount++;

    let selectedLink = undefined;
    if (!historyItem.allLinksVisited) {
      selectedLink = links.find(
        link =>
          !site.navigation.excludeUrls.some(url => sameURL(link.url, url)) &&
          !history.some(historyItem => sameURL(link.url, historyItem.url))
      );
    }
    if (!selectedLink) {
      historyItem.allLinksVisited = true;
      selectedLink = links.find(
        link =>
          !site.navigation.excludeUrls.some(url => sameURL(link.url, url)) &&
          history.some(
            historyItem =>
              !historyItem.allLinksVisited && sameURL(link.url, historyItem.url)
          )
      );
    }

    if (!!selectedLink) {
      const selectedLinkIndex = links.indexOf(selectedLink);
      console.log("[LINK] " + util.inspect(selectedLink));
      await visitLinkInPage(page, links, linkElementsHandle, selectedLinkIndex);
    } else {
      await page.goto(site.navigation.homePageUrl);
    }
  }
}

async function findLinksInPage(page) {
  const linkElementsHandle = await page.evaluateHandle(() => {
    return document.querySelectorAll("a, form");
  });
  const links = await page.evaluate(linkElements => {
    const links = [];

    for (let linkElement of linkElements) {
      const isForm = linkElement.tagName === "FORM";

      const linkUrlString =
        (isForm ? linkElement.action : linkElement.href) || location.href;

      const linkUrl = new URL(linkUrlString);

      // Ignore links to external sites...
      if (
        linkUrl.protocol !== location.protocol ||
        linkUrl.host !== location.host
      ) {
        continue;
      }

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

async function visitLinkInPage(page, links, linkElementsHandle, linkIndex) {
  const link = links[linkIndex];
  const linkElement = await page.evaluateHandle(
    (_linkElements, _linkIndex) => _linkElements[_linkIndex],
    linkElementsHandle,
    linkIndex
  );

  if (link.type === "FORM") {
    await linkElement.submit();
  } else {
    try {
      await linkElement.click();
    } catch (e) {
      await page.goto(link.url);
    }
  }
  await page.waitForNavigation({ waitUntil: "load" }); // FIXME: some link could not trigger a navigation
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
