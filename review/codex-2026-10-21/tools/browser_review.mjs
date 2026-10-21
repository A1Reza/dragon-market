import { chromium, expect } from '../../../web/node_modules/@playwright/test/index.mjs';
import AxeBuilder from './browser-deps/node_modules/@axe-core/playwright/dist/index.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireFreePorts, ready } from '../../../scripts/processes.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const out=resolve(root,'review/codex-2026-10-21/evidence/browser');mkdirSync(out,{recursive:true});
const record={reviewer:'Codex (AI)',sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),started_at_utc:new Date().toISOString(),checks:[],network:[],page_errors:[],deviations:[]};
const save=()=>writeFileSync(resolve(out,'observations.json'),JSON.stringify(record,null,2));
const check=(id,details,status='PASS')=>{record.checks.push({id,status,utc:new Date().toISOString(),details});save();console.log(status+' '+id)};
function sql(query){
 const lease=JSON.parse(readFileSync(resolve(root,'artifacts/e2e-container.json'),'utf8'));
 if(!/^dragon-research-e2e-[a-f0-9]{8}$/.test(lease.name))throw Error('Invalid lease');
 const label=execFileSync('docker',['inspect','--format','{{index .Config.Labels "dragon-market.disposable"}}',lease.name],{encoding:'utf8'}).trim();
 if(label!=='true')throw Error('Missing disposable label');
 return execFileSync('docker',['exec',lease.name,'psql','-U','research','-d','dragon_research_disposable','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
}
await requireFreePorts([5175,8085,8087]);
const log=createWriteStream(resolve(out,'isolated-stack.log'));
const stack=spawn(process.execPath,['scripts/e2e-stack.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});stack.stdout.pipe(log);stack.stderr.pipe(log);
let browser,context,page;
try {
 await ready('http://127.0.0.1:5175/api/dev/snapshot',180000);
 record.container=JSON.parse(readFileSync(resolve(root,'artifacts/e2e-container.json'),'utf8'));
 record.postgres=sql('SELECT version()');
 browser=await chromium.launch({channel:'chrome'});record.browser_version=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 page=await context.newPage();page.on('pageerror',e=>record.page_errors.push(e.message));
 page.on('response',async response=>{if(!response.url().includes('/api/'))return;const req=response.request();
   try{record.network.push({utc:new Date().toISOString(),method:req.method(),url:response.url(),body:req.postData(),key:req.headers()['idempotency-key']??null,status:response.status(),replayed:response.headers()['idempotency-replayed']??null,response:(await response.text()).slice(0,150000)});save()}catch{}
 });
 const api=async(path,method='GET',body,key)=>{const r=await context.request.fetch('http://127.0.0.1:5175/api'+path,{method,data:body,headers:key?{'Idempotency-Key':key}:{}});const text=await r.text();let data=text;try{data=JSON.parse(text)}catch{};record.network.push({utc:new Date().toISOString(),method,url:path,body,key,status:r.status(),replayed:r.headers()['idempotency-replayed']??null,response:data});save();return {status:r.status(),data,headers:r.headers()}};
 const snap=async()=> (await api('/dev/snapshot')).data;
 const screenshot=async name=>page.screenshot({path:resolve(out,name+'.png'),fullPage:true});
 const nav=async name=>{const toggle=page.getByRole('button',{name:'Toggle navigation'});if(await toggle.isVisible())await toggle.click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name,exact:true}).click()};
 const actor=async id=>page.getByRole('combobox',{name:'Development Guild Switcher'}).selectOption(id);
 const dialog=()=>page.getByRole('dialog');
 const closed=async()=>expect(dialog()).not.toBeVisible();
 async function create(name,type){await nav('Marketplace');await page.getByRole('button',{name:'Create item',exact:true}).click();await dialog().getByLabel('Artifact name').fill(name);await dialog().getByLabel('Item type').selectOption(type);await dialog().getByLabel('Base price').fill('700');await dialog().getByRole('button',{name:'Confirm item'}).click();await closed();return page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})})}
 await page.goto('http://127.0.0.1:5175/');await expect(page.getByRole('heading',{name:'Welcome to the realm.'})).toBeVisible();
 record.initial=await snap();writeFileSync(resolve(out,'initial-snapshot.json'),JSON.stringify(record.initial,null,2));
 check('UI-01-load',{environment:record.initial.environment,database:record.initial.database,backend_commit:record.initial.backend_commit});
 await nav('System Status');await page.getByRole('button',{name:'Check services'}).click();await expect(page.getByText('Healthy · HTTP 200 · empty process response')).toBeVisible();await screenshot('system-status');check('UI-01-health',await page.locator('main').innerText());
 for(const id of ['guild-buyer','guild-bidder','guild-seller']){await actor(id);await nav('Wallet');await expect(page.getByTestId('wallet-total')).toContainText('100.00')};check('UI-02','All three seed identities selected; visible total 100.00 G each; selector clearly labelled Development Guild Switcher');
 const itemName='Codex-R1-2110-Emberglass';const card=await create(itemName,'rare');
 let s=await snap();const created=s.items.find(i=>i.name===itemName);expect(created.owner_id).toBe('guild-seller');expect(created.base_price).toBe(700);check('UI-03',created);
 await card.getByRole('button',{name:'Create listing'}).click();await dialog().getByLabel('Listing price').fill('0');await page.getByRole('button',{name:'Confirm list',exact:true}).click();await expect(dialog()).toBeVisible();expect(await dialog().getByLabel('Listing price').evaluate(e=>e.validity.rangeUnderflow)).toBe(true);
 await dialog().getByLabel('Listing price').fill('700');await page.getByRole('button',{name:'Confirm list',exact:true}).click();await closed();s=await snap();const listing=s.orders.find(o=>o.item_id===created.id);expect(listing.price).toBe(700);check('UI-04',{listing,zero_price:'HTML range validation prevents submission'});
 record.purchase={item_id:created.id,order_id:listing.id,seller:'guild-seller',buyer:'guild-buyer',before:s};
 await actor('guild-buyer');await nav('Orders');await page.getByRole('row').filter({hasText:itemName}).getByRole('button',{name:'Purchase',exact:true}).click();await page.getByRole('button',{name:'Confirm purchase',exact:true}).click();await closed();
 record.purchase.after=await snap();record.purchase.sql_after=sql(`SELECT json_build_object('wallets',(SELECT json_agg(t) FROM (SELECT id,gold,reserved,daily_spent,daily_spent_on FROM guilds ORDER BY id)t),'item',(SELECT row_to_json(i) FROM items i WHERE id='${created.id}'),'audit',(SELECT json_agg(t) FROM (SELECT * FROM wallet_transactions ORDER BY id)t))`);
 expect(sql("SELECT gold FROM guilds WHERE id='guild-buyer'")).toBe('9300');expect(sql("SELECT gold FROM guilds WHERE id='guild-seller'")).toBe('10700');expect(sql(`SELECT owner_id FROM items WHERE id='${created.id}'`)).toBe('guild-buyer');expect(sql('SELECT count(*) FROM wallet_transactions')).toBe('2');check('UI-05',record.purchase.sql_after);
 await nav('Transaction Inspector');await page.getByRole('button',{name:'Repeat exact request with same key'}).first().click();await page.getByRole('button',{name:'Repeat with same key',exact:true}).click();await closed();
 expect(sql('SELECT count(*) FROM wallet_transactions')).toBe('2');expect(sql('SELECT count(*) FROM idempotency_records')).toBe('1');record.purchase.replay=await snap();await screenshot('purchase-replay-inspector');check('UI-10','Replay has no further debit, ownership transfer, ledger entries or idempotency rows; SQL total audits=2 / keys=1');check('UI-11-raw-inspector','Before/after snapshots and raw daily_spent_on retained in evidence; current-day wallet labeling tested separately');
 const soldCancel=await api(`/orders/${listing.id}`,'DELETE',{seller_id:'guild-seller'});expect(soldCancel.status).toBe(400);const rebuy=await api(`/orders/${listing.id}/buy`,'POST',{buyer_id:'guild-bidder'},'codex-new-operation-sold');expect(rebuy.status).toBe(400);check('TX-04',{soldCancel,rebuy});
 await actor('guild-seller');const cancelCard=await create('Codex-R1-2110-Cancel-Flask','common');await cancelCard.getByRole('button',{name:'Create listing'}).click();await page.getByRole('button',{name:'Confirm list',exact:true}).click();await closed();await nav('Orders');await page.getByRole('row').filter({hasText:'Codex-R1-2110-Cancel-Flask'}).getByRole('button',{name:'Cancel listing',exact:true}).click();await page.getByRole('button',{name:'Confirm cancel order'}).click();await closed();expect(sql("SELECT status FROM items WHERE name='Codex-R1-2110-Cancel-Flask'")).toBe('free');check('UI-06',{eligible_cancel:'item free',sold_cancel:soldCancel.status});
 const leg=await create('Codex-R1-2110-Astral-Crown','legendary');await leg.getByRole('button',{name:'Start auction'}).click();await page.getByRole('button',{name:'Confirm auction',exact:true}).click();await closed();s=await snap();const li=s.items.find(i=>i.name==='Codex-R1-2110-Astral-Crown');const auction=s.auctions.find(a=>a.item_id===li.id);expect(auction.status).toBe('active');expect(Date.parse(auction.ends_at)-Date.now()).toBeGreaterThan(23*3600*1000);check('UI-07',{item:li,auction});
 await actor('guild-buyer');await nav('Auctions');async function bid(amount){await page.getByRole('button',{name:'Place bid',exact:true}).click();await dialog().getByLabel('Bid amount').fill(String(amount));await page.getByRole('button',{name:'Confirm bid',exact:true}).click()}
 await bid(500);await closed();expect(sql("SELECT gold||','||reserved FROM guilds WHERE id='guild-buyer'")).toBe('9300,500');check('UI-08','buyer total gold 9300 unchanged; reserved 500; available 8800');
 await bid(525);await closed();expect(sql("SELECT reserved FROM guilds WHERE id='guild-buyer'")).toBe('525');check('TX-08','Same bidder raises from 500 to 525; reservation is 525, delta=25');
 await actor('guild-bidder');await bid(526);await expect(dialog().getByRole('alert')).toContainText('minimum bid');await screenshot('rejected-bid');check('UI-12',await dialog().getByRole('alert').innerText());
 await dialog().getByLabel('Bid amount').fill('552');await page.getByRole('button',{name:'Confirm bid',exact:true}).click();await closed();expect(sql("SELECT reserved FROM guilds WHERE id='guild-buyer'")).toBe('0');expect(sql("SELECT gold||','||reserved FROM guilds WHERE id='guild-bidder'")).toBe('10000,552');
 await page.getByText('Bid history on this page').click();await page.getByRole('button',{name:'Cancel highest bid',exact:true}).click();await page.getByRole('button',{name:'Confirm cancel bid',exact:true}).click();await closed();expect(sql("SELECT reserved FROM guilds WHERE id='guild-bidder'")).toBe('0');await screenshot('auction-history');check('UI-09','Outbid releases old hold; accepted 552 reserves new hold; active highest cancel releases it; completed spend preserved');
 const cancelled=(await snap()).bids.find(b=>b.status==='cancelled');const twice=await api(`/auctions/${cancelled.auction_id}/bids/${cancelled.id}?bidder_id=guild-bidder`,'DELETE');expect(twice.status).toBe(409);
 const invalid=await api('/items','POST',{name:'invalid',type:'rare',owner_id:'guild-seller',base_price:0});expect(invalid.status).toBe(400);check('UI-12-api',invalid);
 await nav('Wallet');await screenshot('wallet-desktop');
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();writeFileSync(resolve(out,'axe-wallet-desktop.json'),JSON.stringify(axe,null,2));check('UI-13-axe-wallet',{violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),passes:axe.passes.length},axe.violations.length?'FAIL':'PASS');
 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5175/#marketplace');await expect(page.getByRole('heading',{name:'Marketplace',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Marketplace',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByRole('main')).toBeFocused();await nav('Wallet');await screenshot('wallet-mobile');check('UI-13-keyboard-mobile','390x844; no horizontal overflow; Tab skip link and Enter focus main; refresh/hash route preserved');
 const mobileAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();writeFileSync(resolve(out,'axe-wallet-mobile.json'),JSON.stringify(mobileAxe,null,2));check('UI-13-axe-mobile',{violations:mobileAxe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))},mobileAxe.violations.length?'FAIL':'PASS');
 // Controlled old-day counter ONLY in this positively identified disposable DB.
 sql("UPDATE guilds SET daily_spent=300,daily_spent_on=(NOW() AT TIME ZONE 'UTC')::date-1 WHERE id='guild-buyer'");
 await actor('guild-buyer');await page.reload();await expect(page.locator('.wallet-foot')).toContainText('Spent today');await expect(page.locator('.wallet-foot')).toContainText('3.00 G');const projected=await api('/guilds/guild-buyer/wallet');record.stale_counter={sql:sql("SELECT id,daily_spent,daily_spent_on FROM guilds WHERE id='guild-buyer'"),api:projected,visible:await page.locator('.wallet-foot').innerText()};await screenshot('finding-stale-spent-today');check('DM-REV-CODEX-001',record.stale_counter,'FAIL');
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5175/#lab');await expect(page.getByRole('button',{name:/Competing buyers/})).toBeVisible();await screenshot('research-lab-local');check('UI-14-local','Local Research Lab uses local isolated harness; hosted controls inspected in source and executed gateway tests; hosted site not used');
 record.final=await snap();writeFileSync(resolve(out,'purchase-example.json'),JSON.stringify(record.purchase,null,2));
 expect(record.page_errors).toEqual([]);record.completed=true;
}catch(e){record.error=String(e.stack||e);record.completed=false;console.error(e);if(page)await page.screenshot({path:resolve(out,'reviewer-script-error.png'),fullPage:true}).catch(()=>{});process.exitCode=1}
finally{
 if(context){await context.tracing.stop({path:resolve(out,'browser-trace.zip')}).catch(()=>{});await context.close()}
 if(browser)await browser.close();
 stack.kill('SIGTERM');await new Promise(r=>setTimeout(r,1500));
 const cleanup=spawn(process.execPath,['scripts/e2e-cleanup.mjs'],{cwd:root,stdio:['ignore','pipe','pipe']});cleanup.stdout.pipe(log);cleanup.stderr.pipe(log);await new Promise(r=>cleanup.on('exit',r));
 record.finished_at_utc=new Date().toISOString();save();log.end();
}
