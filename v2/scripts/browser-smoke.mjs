import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createBenchmarkServer} from '../server.mjs';
const root=path.resolve('v2'),out=path.join(root,'reports');await fs.mkdir(out,{recursive:true});
const store=path.join(root,'tests/.scratch/browser-'+randomUUID());
let browser,referee,staticServer;const results=[];
try {
  try{browser=await chromium.launch({headless:true});}catch(e){if(process.platform!=='win32')throw e;browser=await chromium.launch({headless:true,channel:'msedge'});}
  referee=await createBenchmarkServer({port:0,store});
  const allowed=new Set(['index.html','app.mjs','style.css','engine.mjs','content.mjs','random.mjs','language.mjs']);
  staticServer=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const file=pathname==='/v2/'?'index.html':pathname.startsWith('/v2/')?pathname.slice(4):'';
    if(!allowed.has(file)){res.writeHead(404);return res.end('Not found');}
    const data=await fs.readFile(path.join(root,file));res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript'});res.end(data);
  });
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
  for(const [mode,port]of [['server',referee.port],['practice',staticServer.address().port]]) {
    const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/v2/`);await page.waitForSelector('body[data-ready="true"]');
    assert.ok((await page.locator('#mode').textContent()).includes(mode==='server'?'服务端裁判':'浏览器练习'));
    await page.locator('#model').fill('Browser regression control');await page.locator('#start').click();
    await page.waitForFunction(()=>!document.getElementById('campaign').hidden&&document.getElementById('caseId').textContent.startsWith('C-'));
    const initial=await page.locator('#caseId').textContent();
    await page.locator('[data-test="registry"]').click();await page.waitForFunction(()=>document.getElementById('budget').textContent.includes('调查点 6'));
    await page.locator('#copyPacket').click();const packet=await page.evaluate(()=>navigator.clipboard.readText());
    assert.ok(packet.includes('玩家可见观察'));assert.ok(!packet.includes('seed_reveal'));assert.ok(!packet.includes('world_truth'));
    await page.locator('#aiReply').fill(JSON.stringify({revision:9999,action:'allow'}));await page.locator('#applyReply').click();
    await page.waitForFunction(()=>document.getElementById('message').textContent.includes('stale revision'));
    assert.equal(await page.locator('#caseId').textContent(),initial);
    await page.locator('#aiReply').fill(JSON.stringify({revision:1,action:'reject',reason:'UI regression decision, not a model result.'}));await page.locator('#applyReply').click();
    await page.waitForFunction(id=>document.getElementById('caseId').textContent!==id,initial);
    await page.locator('#archiveQuery').fill('登记');await page.locator('#recall').click();await page.waitForSelector('#archive .fact');
    const current=await page.locator('#caseId').textContent();await page.reload();await page.waitForSelector('body[data-ready="true"]');await page.locator('#resume').click();
    await page.waitForFunction(id=>document.getElementById('caseId').textContent===id,current);
    for(let i=0;i<12&&!(await page.locator('#council').isVisible());i++) {
      const id=await page.locator('#caseId').textContent();await page.locator('[data-action="reject"]').click();
      await page.waitForFunction(old=>document.getElementById('caseId').textContent!==old,id);
    }
    assert.equal(await page.locator('#council').isVisible(),true);
    await page.locator('#policy').selectOption('trade');await page.locator('#nextDay').click();
    await page.waitForFunction(()=>document.getElementById('dayTitle').textContent.includes('第 2 /'));
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(out,mode+'-desktop.png')});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile horizontal overflow');
    await page.screenshot({path:path.join(out,mode+'-mobile.png')});
    await page.locator('#campaign').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,mode+'-case-mobile.png')});
    if(mode==='server') {
      const session=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('blackgate_v2_server_session')));
      const base=`http://127.0.0.1:${port}/api/v2/sessions/${session.id}`;
      const headers={'authorization':'Bearer '+session.token,'content-type':'application/json'};
      let state=(await (await fetch(base+'/state',{headers})).json()).observation;
      while(!state.finished){const res=await fetch(base+'/action',{method:'POST',headers:{...headers,'x-request-id':'browser-end-'+state.revision},body:JSON.stringify({revision:state.revision,action:state.phase==='council'?'next_day':'reject'})});assert.equal(res.status,200);state=(await res.json()).observation;}
      await page.reload();await page.waitForSelector('body[data-ready="true"]');await page.locator('#resume').click();await page.waitForSelector('#postmortem:not([hidden])');
      assert.ok((await page.locator('#boardRows').textContent()).includes('Browser regression control'));
      const jsonDownload=page.waitForEvent('download');await page.locator('#downloadReport').click();assert.equal((await jsonDownload).suggestedFilename(),'blackgate-v2-report.json');
      const mdDownload=page.waitForEvent('download');await page.locator('#downloadMarkdown').click();assert.equal((await mdDownload).suggestedFilename(),'blackgate-v2-postmortem.md');
    }
    assert.deepEqual(errors,[]);results.push({mode,passed:true,checks:['new campaign','paid investigation','public chat packet','stale JSON rejected','valid chat action','archive search','reload/resume','policy council','day transition','390px overflow','desktop/mobile screenshots',...(mode==='server'?['finished report UI','separate leaderboard','JSON and Markdown export']:[])],page_errors:errors});
    await context.close();console.log(`${mode} browser smoke passed`);
  }
  await fs.writeFile(path.join(out,'browser-smoke.json'),JSON.stringify({generated_at:new Date().toISOString(),browser:await browser.version(),results},null,2)+'\n');
}finally{
  if(browser)await browser.close();if(referee)await referee.close();if(staticServer)await new Promise(resolve=>staticServer.close(resolve));await fs.rm(store,{recursive:true,force:true});
}
