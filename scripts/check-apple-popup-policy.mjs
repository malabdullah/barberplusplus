// Isolated browser transport proof. Every request is synthetic and intercepted;
// no local website, provider, account or production endpoint is contacted.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const results = [];
for (const [name, engine] of [['chrome', chromium], ['safari', webkit]]) {
  const browser = await engine.launch({headless:true});
  try {
    for (const [scenario, parent, callback] of [
      ['old-policy', 'same-origin', 'same-origin'],
      ['scoped-policy', 'unsafe-none', 'unsafe-none'],
    ]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          let body, policy;
          if (url.origin === 'https://app.example.test' && url.pathname === '/book') {
            policy = 'same-origin';
            body = '<button onclick="history.pushState(null,\'\',\'/customer/account\');document.querySelector(\'a\').hidden=false">My account</button><a href="/customer/delete-account" hidden>Delete account</a>';
          } else if (url.origin === 'https://app.example.test' && url.pathname === '/customer/delete-account') {
            policy = parent;
            body = '<button onclick="window.p=window.open(\'about:blank\');setTimeout(()=>p.location.replace(\'https://auth.other.test/auth\'),200)">Connect Apple</button><script>window.result=null;addEventListener("message",e=>{if(e.origin===location.origin&&e.source===p&&e.data==="synthetic")window.result="passed"})</script>';
          } else if (url.origin === 'https://auth.other.test') {
            policy = 'unsafe-none';
            body = '<script>setTimeout(()=>location.replace("https://app.example.test/customer/auth-callback?code=synthetic"),100)</script>';
          } else if (url.origin === 'https://app.example.test' && url.pathname === '/customer/auth-callback') {
            policy = callback;
            body = '<script>history.replaceState(null,"",location.pathname);if(opener)opener.postMessage("synthetic",location.origin);window.close()</script>';
          } else throw Error('Unexpected synthetic browser request');
          await route.fulfill({contentType:'text/html',headers:{'Cross-Origin-Opener-Policy':policy},body});
        });
        await page.goto('https://app.example.test/book');
        await page.getByRole('button', {name:'My account'}).click();
        await page.getByRole('link', {name:'Delete account'}).click();
        await page.getByRole('button', {name:'Connect Apple'}).click();
        try { await page.waitForFunction(() => window.result === 'passed', {}, {timeout:2500}); } catch { /* Old policy is deliberately broken in Chrome. */ }
        const passed = await page.evaluate(() => window.result === 'passed');
        if (scenario === 'scoped-policy') assert.equal(passed, true, name + ': popup must survive SPA account entry and document reload');
        if (name === 'chrome' && scenario === 'old-policy') assert.equal(passed, false, 'negative control must reproduce the isolation failure');
        results.push({browser:name,scenario,callbackReceived:passed});
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
console.log(JSON.stringify({status:'PASS',checks:results.length,realProviderRequests:0,results}));
