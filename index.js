require("dotenv").config();
const getPort = require("get-port");
const pptrFirefox = require("puppeteer-firefox");
const webExt = require("web-ext").default;
const util = require("util");

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
            userid: "alice",
            password: "alicesecret"
          },
          bob: {
            userid: "bob",
            password: "bobssecret"
          }
        }
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
