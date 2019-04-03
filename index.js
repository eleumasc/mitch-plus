const puppeteer = require('puppeteer');

const config = {
  sites: [{
    baseUrl: 'https://www.facebook.com/',
    login: {
      strategy: UseridPasswordLoginStrategy('https://www.facebook.com/', '#email', '#pass', '#loginbutton input'),
      params: {
        userid: '',
        password: ''
      }
    }
  }]
};

(async () => {
  const site = config.sites[0];
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36');
  await page.setViewport({ width: 1024, height: 768 });

  await site.login.strategy(page, site.login.params);

  await page.screenshot({path: 'screenshot.png'});

  await browser.close();
})();

function UseridPasswordLoginStrategy(loginPageUrl, useridInputSelector, passwordInputSelector, submitInputSelector) {
  return async (page, params) => {
    await page.goto(loginPageUrl);
    await page.type(useridInputSelector, params.userid);
    await page.type(passwordInputSelector, params.password);
    await page.click(submitInputSelector);
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
  }
}
