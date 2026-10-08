// Run against the isolated long-list fixture on 127.0.0.1:17001, never production.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.TEST_CHROME_PATH ? {executablePath:process.env.TEST_CHROME_PATH} : {}), args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'});
    const response=await context.request.post('http://127.0.0.1:17001/api/auth/login',{data:{username:'admin',password:'temporary-browser-test-password'}});
    assert(response.ok(),'Isolated fixture login failed');
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:17001/?personal_tool=bookmarks');
    const host=page.locator('#personal-workspace-host');
    await host.getByText('Browser test bookmark 34',{exact:false}).first().waitFor();
    await page.mouse.move(700,450);await page.mouse.wheel(0,900);await page.waitForTimeout(250);
    assert(await host.evaluate(el=>el.scrollTop>0),'Desktop wheel scrolling is blocked');
    await host.evaluate(el=>el.scrollTop=0);await host.focus();await page.keyboard.press('PageDown');await page.waitForTimeout(250);
    assert(await host.evaluate(el=>el.scrollTop>0),'Keyboard scrolling is blocked');
    await page.locator('#personal-workspace-modal nav').getByRole('button',{name:'Quick Launcher',exact:true}).click();
    await host.getByText('Browser test launcher 34',{exact:false}).first().waitFor();
    await host.getByRole('button',{name:/^Add shortcut/}).first().click();
    const dialog=host.getByRole('dialog',{name:'Add shortcut'});const title='Browser interaction '+Date.now();
    await dialog.getByLabel('Shortcut name').fill(title);await dialog.getByLabel('Shortcut URL').fill('https://example.org/new');
    await dialog.getByRole('button',{name:'Add shortcut',exact:true}).click();await host.getByText(title,{exact:false}).first().waitFor();
    await page.setViewportSize({width:390,height:844});
    await page.locator('#personal-workspace-modal nav').getByRole('button',{name:'Bookmarks',exact:true}).click();
    await host.getByText('Browser test bookmark 34',{exact:false}).first().waitFor();await host.evaluate(el=>el.scrollTop=0);
    await page.mouse.move(180,400);await page.mouse.wheel(0,700);await page.waitForTimeout(250);
    assert(await host.evaluate(el=>el.scrollTop>0),'Mobile viewport scrolling is blocked');
    assert.deepEqual(errors,[]);
    console.log('Desktop wheel, keyboard, mobile viewport, form input/save: PASS');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
