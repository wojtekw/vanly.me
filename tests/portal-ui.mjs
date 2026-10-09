import {chromium} from '/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
for(let attempt=0;attempt<60;attempt++){try{if((await fetch('http://127.0.0.1:8181/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
const portalBase=process.env.VANLY_LIVE==='1'?'https://vanly.me.local':'http://127.0.0.1:8181';
const accounts=JSON.parse(await fs.readFile('.local/accounts.json','utf8'));
const browser=await chromium.launch({headless:true});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(portalBase+'/',{waitUntil:'networkidle'});
 await page.locator('.vehicle-card').first().waitFor();
 assert.ok(await page.locator('.vehicle-card').count()>0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await fs.mkdir('output/verification',{recursive:true});
 await page.screenshot({path:'output/verification/portal-desktop.png',fullPage:true});
 await page.goto(portalBase+'/pojazdy',{waitUntil:'networkidle'});
 await page.locator('.vehicle-card').first().waitFor();
 assert.ok(await page.locator('.vehicle-card').count()>0);
 await page.locator('.vehicle-card h3 a').first().click();await page.waitForLoadState('networkidle');
 assert.ok(await page.locator('h1').innerText());
 await page.setViewportSize({width:390,height:844});
 await page.goto(portalBase+'/',{waitUntil:'networkidle'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'output/verification/portal-mobile.png',fullPage:true});
 console.log('PASS: portal, search, offer, desktop and mobile');
 await context.close();
 for(const [kind,port,email,title,tabs] of [
  ['owner',8182,'baltic@vanly.local','Baltic Camp',[
   ['Kalendarz','/company/calendar'],['Moja flota','/company/fleet'],
   ['Wyposażenie','/company/inventory'],['Wiadomości','/company/messages']
  ]],
  ['admin',8183,'operator@vanly.local','Dobre wyjazdy pod kontrolą.',[
   ['Firmy','/operator/companies'],['Moderacja','/operator/moderation'],
   ['Integracje i zadania','/operator/system']
  ]]
 ]) {
  const c=await browser.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();
  p.on('pageerror',e=>errors.push(e.message));const a=accounts.find(a=>a.email===email);
  const panelBase=process.env.VANLY_LIVE==='1'?`https://${kind==='owner'?'owner':'admin'}.vanly.me.local`:`http://127.0.0.1:${port}`;
  await p.goto(panelBase+'/',{waitUntil:'networkidle'});
  await p.getByLabel('Adres e-mail',{exact:true}).fill(a.email);await p.getByLabel('Hasło',{exact:true}).fill(a.password);
  await p.getByRole('button',{name:'Zaloguj się',exact:true}).click();
  await p.getByRole('heading',{name:title,exact:true}).waitFor();await p.waitForLoadState('networkidle');await p.waitForFunction(()=>!document.querySelector('.loading')); 
  assert.equal(new URL(p.url()).pathname,kind==='owner'?'/company':'/operator');
  await p.screenshot({path:`output/verification/${kind}-desktop.png`,fullPage:true});
  for(const [tab,expectedPath] of tabs){await p.locator('.side-nav').getByRole('link',{name:tab,exact:true}).click();await p.waitForURL(url=>url.pathname===expectedPath);await p.waitForLoadState('networkidle');await p.waitForFunction(()=>!document.querySelector('.loading'));assert.equal(new URL(p.url()).pathname,expectedPath);assert.equal(await p.locator('.app-notice.error').count(),0);}
  if(kind==='owner'){
   const suffix='?vehicle=coast&status=needs_reply#conversation';
   await p.goto(panelBase+'/firma/wiadomosci'+suffix,{waitUntil:'networkidle'});
   await p.waitForURL(url=>url.pathname==='/company/messages');
   await p.getByRole('heading',{name:'Rozmowy w drodze',exact:true}).waitFor();
   assert.equal(new URL(p.url()).pathname+new URL(p.url()).search+new URL(p.url()).hash,'/company/messages'+suffix);
   await p.reload({waitUntil:'networkidle'});
   await p.getByRole('heading',{name:'Rozmowy w drodze',exact:true}).waitFor();
   assert.equal(new URL(p.url()).pathname+new URL(p.url()).search+new URL(p.url()).hash,'/company/messages'+suffix);
   assert.equal(await p.locator('.side-nav a.active').getAttribute('href'),'/company/messages');
  }
  await p.setViewportSize({width:390,height:844});
  await p.locator('.side-nav').getByRole('link',{name:kind==='owner'?'Dzisiaj':'Przegląd',exact:true}).click();await p.waitForLoadState('networkidle');await p.waitForFunction(()=>!document.querySelector('.loading')); 
  assert.equal(new URL(p.url()).pathname,kind==='owner'?'/company/dashboard':'/operator/dashboard');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:`output/verification/${kind}-mobile.png`,fullPage:true});
  await p.getByRole('button',{name:'Wyloguj',exact:true}).click();await p.getByRole('button',{name:'Zaloguj się',exact:true}).waitFor();assert.equal(new URL(p.url()).pathname,'/login');
  await c.close();console.log(`PASS: ${kind} separate bundle, login, navigation, mobile and logout`);
 }
 assert.deepEqual(errors,[]);console.log('PASS: no browser JavaScript errors');
}finally{await browser.close();}
