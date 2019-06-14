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
    },
    {
      baseUrl: "http://172.18.0.1:8080/",
      auth: {
        login: async (page, profile) => {
          await page.goto("http://172.18.0.1:8080/login/index.php");
          await page.type("#username", profile.userid);
          await page.type("#password", profile.password);
          await page.click("#loginbtn");
          try {
            await page.waitForNavigation({ timeout: 7500, waitUntil: "load" });
          } catch {}
        },
        logout: async page => {
          await page.goto("http://172.18.0.1:8080/login/logout.php");
          const logoutButton = await page.$("single_button5d01fcf3d72bd14");
          await logoutButton.click();
          try {
            await page.waitForNavigation({ timeout: 7500, waitUntil: "load" });
          } catch {}
        },
        profiles: {
          alice: {
            userid: "alice",
            password: "Passw0rd*"
          },
          bob: {
            userid: "bob",
            password: "Passw0rd*"
          }
        }
      },
      navigation: {
        homePageUrl: "http://172.18.0.1:8080/my/",
        includeDomains: [],
        excludeUrls: [url => url.indexOf("logout") !== -1]
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
      args: [`-juggler=${CDPPort}`, "-headless"]
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
  // await page.setViewport({ width: 1024, height: 768 });

  const site = config.sites[0];

  await page.goto(site.baseUrl);

  /*
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
  /* */

  await site.auth.login(page, site.auth.profiles.alice);
  await navigate(page, site);
  await site.auth.logout(page);

  await browser.close();
})();

async function navigate(page, site) {
  page.on("popup", async popup => {
    await popup.close();
  });

  page.on("dialog", async dialog => {
    await dialog.accept("Lorem ipsum");
  });

  let httpStatusCodeCountStats = {};
  page.on("requestfinished", req => {
    if (req.isNavigationRequest()) {
      console.log("[S] " + req.response().status() + " " + req.url());
    }

    // Update stats
    if (
      typeof httpStatusCodeCountStats[req.response().status()] === "undefined"
    ) {
      httpStatusCodeCountStats[req.response().status()] = 0;
    }
    httpStatusCodeCountStats[req.response().status()]++;
  });

  let crawlStats;
  let linkArray, linkHandleArray;
  await crawler.crawl(
    async req => {
      if (req.request === "page") {
        let attempts = 3;
        while (attempts-- > 0) {
          try {
            [linkArray, linkHandleArray] = await filterLinks(
              await findLinksInPage(page),
              linkIsAllowed,
              {
                site: async () => site,
                location: async () => await page.url()
              }
            );

            return { reply: "page", links: linkArray, url: await page.url() };
          } catch {}
        }
        throw { name: "TerminateRequest" };
      } else if (req.request === "follow") {
        try {
          await visitLinkInPage(
            page,
            req.link,
            linkHandleArray[linkArray.indexOf(req.link)]
          );
          return { reply: "done" };
        } catch (err) {
          console.log("[E]", err);
          if (
            typeof err.message === "string" &&
            err.message.startsWith("Protocol error")
          ) {
            throw { name: "TerminateRequest" };
          } else if (err.name === "LinkNotVisitableError") {
            return { reply: "skip" };
          } else if (err.name === "FormNotFillableError") {
            return { reply: "mark" };
          } else {
            throw err;
          }
        }
      } else if (req.request === "home") {
        await page.goto(site.navigation.homePageUrl);
        return { reply: "done" };
      } else if (req.request === "set-stats") {
        crawlStats = req.stats;
        return { reply: "done" };
      }
    },
    { dynamicLinks: true }
  );

  console.log({
    distinctFollowUrlsCount: crawlStats.distinctFollowUrls.length,
    distinctFollowedUrlsCount: crawlStats.distinctFollowedUrls.length,
    graphNodesCount: crawlStats.graphNodesCount,
    distinctPageUrlsCount: crawlStats.distinctPageUrls.length,
    familiarPagesCount: crawlStats.familiarPagesCount,
    httpStatusCodeCount: httpStatusCodeCountStats
  });
}

async function findLinksInPage(page) {
  const linkHandleArray = await page.$$("a, form");

  const linkArray = await Promise.all(
    linkHandleArray.map(linkHandle =>
      page.evaluate(linkEl => {
        const isForm = linkEl.tagName === "FORM";

        const linkUrlString =
          (isForm ? linkEl.action : linkEl.href) || location.href;

        const linkUrl = new URL(linkUrlString);

        const link = {};

        link.type = isForm ? "FORM" : "A";
        link.method = isForm ? linkEl.method : "GET";
        link.url = linkUrlString;

        link.dompath = (e => {
          const dompath = [];
          while (e !== document.body) {
            dompath.unshift(e.tagName);
            e = e.parentElement;
          }
          return dompath;
        })(linkEl);

        link.action = linkUrl.pathname.split("/").filter(s => s.trim() !== "");

        link.params = {};
        linkUrl.searchParams.forEach((value, key) => {
          link.params[key] = value;
        });
        if (isForm) {
          const formData = new FormData(linkEl);
          Array.from(formData.entries()).forEach(([key, value]) => {
            link.params[key] = value;
          });
        }

        return link;
      }, linkHandle)
    )
  );

  return [linkArray, linkHandleArray];
}

function linkIsAllowed(link, args) {
  return (
    !args.site.navigation.excludeUrls.some(
      urlOrPredicate =>
        (typeof urlOrPredicate === "string" &&
          same.url(link.url, urlOrPredicate)) ||
        (typeof urlOrPredicate === "function" && urlOrPredicate(link.url))
    ) &&
    (args.site.navigation.includeDomains.some(url =>
      same.domain(link.url, url)
    ) ||
      same.domain(link.url, args.location))
  );
}

async function filterLinks([linkArray, linkHandleArray], filterFn, argsFns) {
  const args = {};
  for (let key in argsFns) {
    if (argsFns.hasOwnProperty(key)) {
      args[key] = await argsFns[key]();
    }
  }

  const linkFilteredArray = [];
  const filterMask = [];
  for (let i = 0; i < linkArray.length; i++) {
    if (filterFn(linkArray[i], args)) {
      linkFilteredArray.push(linkArray[i]);
      filterMask.push(true);
    } else {
      filterMask.push(false);
    }
  }

  const linkHandleFilteredArray = linkHandleArray.filter(
    (_, i) => filterMask[i]
  );

  return [linkFilteredArray, linkHandleFilteredArray];
}

async function visitLinkInPage(page, link, linkHandle) {
  if (link.type === "FORM") {
    await fillForm(page, linkHandle);

    const formValid = await page.evaluate(
      formEl => formEl.checkValidity(),
      linkHandle
    );
    if (!formValid) {
      throw { name: "FormNotFillableError" };
    }

    try {
      const submitButton = await linkHandle.$(
        'input[type="submit"], button[type="submit"]'
      );
      await submitButton.focus();
      await submitButton.type("\n");
    } catch (err) {
      throw { name: "LinkNotVisitableError", message: err.message };
    }
    try {
      await page.waitForNavigation({
        timeout: 7500,
        waitUntil: "load"
      });
    } catch {}
  } else {
    const linkWithoutNavigation =
      same.url(await page.url(), link.url) && link.url.indexOf("#") !== -1;

    try {
      linkHandle.focus();
      linkHandle.type("\n");

      if (!linkWithoutNavigation) {
        try {
          await page.waitForNavigation({
            timeout: 7500,
            waitUntil: "load"
          });
        } catch {}
      } else {
        try {
          await page.waitForNavigation({
            timeout: 2000,
            waitUntil: "load"
          });
        } catch {}
      }
    } catch (err) {
      throw { name: "LinkNotVisitableError", message: err.message };
    }
  }
}

async function fillForm(page, formHandle) {
  // I don't manage file uploads at the moment...
  if ((await formHandle.$$('input[type="file"]')).length > 0) {
    throw { name: "FormNotFillableError" };
  }

  const textInputHandleArray = await formHandle.$$(
    'input[type="text"], input[type="search"]'
  );
  for (let textInputHandle of textInputHandleArray) {
    try {
      await textInputHandle.type("Lorem ipsum");
    } catch (err) {
      throw { name: "FormNotFillableError", message: err.message };
    }
  }

  const textareaHandleArray = await formHandle.$$("textarea");
  for (let textareaHandle of textareaHandleArray) {
    try {
      await textareaHandle.type("Lorem ipsum dolor sit amet");
    } catch (err) {
      throw { name: "FormNotFillableError", message: err.message };
    }
  }

  const radioInputHandleArray = await formHandle.$$('input[type="radio"]');
  for (let radioInputHandle of radioInputHandleArray) {
    try {
      await radioInputHandle.click();
    } catch (err) {
      throw { name: "FormNotFillableError", message: err.message };
    }
  }

  const checkboxInputHandleArray = await formHandle.$$(
    'input[type="checkbox"]'
  );
  for (let checkboxInputHandle of checkboxInputHandleArray) {
    try {
      await checkboxInputHandle.click();
    } catch (err) {
      throw { name: "FormNotFillableError", message: err.message };
    }
  }

  // ...
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
