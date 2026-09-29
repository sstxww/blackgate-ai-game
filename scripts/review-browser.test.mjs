// Synthetic, loopback-only UI regression. Never submits a score or calls a paid model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
const root=process.cwd(),out=path.join(root,'.scratch-web/review-browser');await fs.mkdir(out,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name.endsWith('/'))name+='index.html';if(name.split('/').some(x=>x.startsWith('.'))||name.startsWith('/api/')||name.startsWith('/scripts/'))throw Error('not public');const f=path.resolve(root,'.'+name);if(!f.startsWith(root+path.sep))throw Error('outside root');const b=await fs.readFile(f);res.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});res.end(b);}catch{res.writeHead(404);res.end('not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser,context;const checks=[],errors=[],blocked=[],secret='fixture-only-private-value-not-a-real-key';let modelCalls=0;
const hash=n=>n.toString(16).padStart(64,'0');
const score=(n,extra={})=>({id:hash(n),participant_type:'ai',username:'合成回归测试员',model:'Fixture Alpha（合成测试）',effort:'high',effort_status:'requested-not-attested',protocol:'chat',version:'2.0.0',content_version:'world-2026-09-29.1',difficulty:'abyss',prompt_profile:'default',prompt_hash:'a'.repeat(64),completed:false,days_survived:20,score:65,ended_at:'2026-09-29T00:00:00Z',github_issue:n,...extra});
const fixtures=[score(1,{days_survived:26,score:70}),score(2),score(3,{model:'Fixture Beta（合成测试）',days_survived:19,score:72}),score(4,{model:'Fixture Beta（合成测试）',days_survived:15,score:60}),score(5,{model:'Fixture Gamma（合成测试）',effort:'low',completed:true,days_survived:42,score:80}),score(6,{participant_type:'human',username:'HUMAN_MUST_NOT_APPEAR'}),score(7,{prompt_profile:'custom',prompt_hash:'b'.repeat(64),model:'CUSTOM_ONLY'}),score(8,{difficulty:'nightmare',model:'OTHER_DIFFICULTY'})];
let dataMode='normal';
const ready=async(p,url)=>{await p.goto(base+url);await p.waitForSelector(url.startsWith('/ai-leaderboard')?'body[data-ranking-ready="true"]':'body[data-arena-ready="true"]');};
const noOverflow=async p=>assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'document horizontal overflow');
const screenshot=async(p,name)=>{await p.screenshot({path:path.join(out,name)});};
try{
  try{browser=await chromium.launch({headless:true});}catch(e){if(process.platform!=='win32')throw e;browser=await chromium.launch({channel:'msedge',headless:true});}
  context=await browser.newContext({viewport:{width:1440,height:1000}});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url===base+'/data/arena-community.json'){
      const mode=dataMode;if(mode==='delayed')await new Promise(r=>setTimeout(r,350));
      try{return await route.fulfill({status:mode==='failure'?503:200,contentType:'application/json',body:mode==='malformed'?'not json':JSON.stringify({updated_at:'2026-09-29T00:00:00Z',runs:mode==='empty'?[]:fixtures})});}catch{return;}
    }
    if(url.startsWith(base+'/'))return route.continue();
    if(url.startsWith('https://relay.example/v1/')){
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(route.request().method()==='GET')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({data:[{id:'Synthetic-review-control'}]})});
      const body=route.request().postDataJSON();assert.equal(body.reasoning_effort,'high');assert.equal(route.request().headers().authorization,'Bearer '+secret);
      const packet=JSON.parse(body.messages.findLast(m=>m.role==='user').content),s=packet.observation;
      for(const k of ['seed','seed_reveal','world_truth','world_networks','harmful','hidden'])assert(!Object.hasOwn(s,k));
      assert(!route.request().postData().includes(secret));modelCalls++;
      const value={revision:s.revision,action:s.phase==='council'?'next_day':'allow',...(s.phase==='council'?{policy:'balanced'}:{}),reason:'合成回归测试：仅基于公开观察。不是模型能力测评。',p_threat:0.4,evidence_ids:s.case?.evidence?.slice(0,1).map(e=>e.id)||[]};
      return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})});
    }
    blocked.push(url);return route.abort();
  });
  const board=await context.newPage();await ready(board,'/ai-leaderboard.html');await noOverflow(board);
  assert.equal(await board.locator('#rankingRunCount').innerText(),'5');assert.equal(await board.locator('#rankingModelCount').innerText(),'3');assert.equal(await board.locator('#rankingCompletedCount').innerText(),'1');assert.equal(await board.locator('#rankingBestDays').innerText(),'42/42');
  assert(!(await board.locator('#rankingResults').innerText()).includes('HUMAN_MUST_NOT_APPEAR'));assert(!(await board.locator('#rankingResults').innerText()).includes('CUSTOM_ONLY'));
  await screenshot(board,'leaderboard-desktop.png');await board.locator('#rankingTitle').scrollIntoViewIfNeeded();await screenshot(board,'leaderboard-desktop-table.png');checks.push('Public AI default, model/effort groups, medians and human/custom/difficulty isolation');
  const original=await board.locator('#cohortSelect').inputValue();const custom=await board.locator('#cohortSelect option').evaluateAll(items=>items.find(x=>x.textContent.includes('自定义提示词')).value);await board.selectOption('#cohortSelect',custom);assert.equal(await board.locator('#rankingRunCount').innerText(),'1');assert((await board.locator('#rankingResults').innerText()).includes('CUSTOM_ONLY'));await board.selectOption('#cohortSelect',original);
  await board.selectOption('#rankingEffort','high');assert.equal(await board.locator('#rankingRunCount').innerText(),'4');await board.fill('#rankingSearch','Fixture Alpha');assert.equal(await board.locator('#rankingRunCount').innerText(),'2');
  await board.click('#runView');assert.equal(await board.locator('.rank-table tbody tr').count(),2);await board.fill('#rankingSearch','');await board.selectOption('#rankingEffort','all');assert.equal(await board.locator('.rank-table tbody tr').count(),5);
  await board.click('#modelView');await board.locator('.rank-details summary').first().click();await board.locator('.rank-details').first().locator('a').first().waitFor({state:'visible'});assert(await board.locator('.rank-details').first().locator('a').count());checks.push('Prompt cohorts, requested-effort filter, search, model/run tabs and submission links');
  await board.setViewportSize({width:390,height:844});await board.evaluate(()=>window.scrollTo(0,0));await noOverflow(board);await screenshot(board,'leaderboard-mobile.png');await board.locator('#rankingTitle').scrollIntoViewIfNeeded();await noOverflow(board);await screenshot(board,'leaderboard-mobile-table.png');checks.push('390px ranking header, filters and responsive result cards');
  await board.evaluate(row=>localStorage.setItem('blackgate_arena_board_v1',JSON.stringify([row])),score(90,{model:'LOCAL_ONLY',github_issue:undefined}));await board.selectOption('#rankingScope','local');await board.waitForFunction(()=>document.getElementById('rankingResults').textContent.includes('LOCAL_ONLY'));
  dataMode='delayed';await board.selectOption('#rankingScope','community');await board.selectOption('#rankingScope','local');await board.waitForTimeout(450);assert((await board.locator('#rankingResults').innerText()).includes('LOCAL_ONLY'));assert.equal(await board.locator('#rankingRunCount').innerText(),'1');checks.push('Late community response cannot overwrite selected local source');
  dataMode='failure';await board.selectOption('#rankingScope','community');await board.waitForFunction(()=>document.getElementById('rankingStatus').textContent.includes('读取失败'));assert.equal(await board.locator('.rank-table').count(),0);
  dataMode='malformed';await board.click('#refreshRanking');await board.waitForFunction(()=>document.getElementById('rankingStatus').textContent.includes('读取失败'));assert.equal(await board.locator('.rank-table').count(),0);
  dataMode='empty';await board.click('#refreshRanking');await board.waitForFunction(()=>document.getElementById('rankingStatus').textContent.includes('已读取 0'));assert.equal(await board.locator('#rankingRunCount').innerText(),'0');checks.push('Network error, malformed JSON and empty public data clear old rankings without fallback');
  await board.evaluate(()=>localStorage.setItem('blackgate_arena_board_v1','{"broken":true}'));await board.selectOption('#rankingScope','local');await board.waitForFunction(()=>document.getElementById('rankingStatus').textContent.includes('读取失败'));checks.push('Corrupt local storage is an error, not a fabricated empty dataset');await board.close();dataMode='normal';
  const page=await context.newPage();await ready(page,'/challenge.html?mode=ai');await page.locator('#connectionHelp summary').click();await page.selectOption('#connectionMode','direct');await page.selectOption('#protocol','chat');await page.locator('#connectionHelp summary').click();
  await page.fill('#username','合成自动挑战回归');await page.fill('#apiUrl','https://relay.example/v1');await page.fill('#apiKey',secret);await page.click('#fetchModels');await page.waitForFunction(()=>document.getElementById('modelSelect').value==='Synthetic-review-control');await page.selectOption('#effort','high');
  await page.click('#startAI');await page.waitForSelector('#reviewReady[open]',{timeout:180000});await page.waitForFunction(()=>document.getElementById('runState').textContent.includes('本局结束'));
  assert.equal(await page.locator('#detailedReview .review-chapter').count(),11);assert.equal(await page.locator('#detailedReview .review-metric').count(),8);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'openDetailedReview');await page.setViewportSize({width:390,height:844});await screenshot(page,'review-ready-mobile.png');await noOverflow(page);await page.keyboard.press('Escape');assert.equal(await page.locator('#reviewReady').getAttribute('open'),null);assert.equal(await page.evaluate(()=>document.activeElement.id),'postmortem');
  await page.locator('#detailedReview').scrollIntoViewIfNeeded();await screenshot(page,'review-mobile.png');await noOverflow(page);
  await page.setViewportSize({width:1440,height:1000});await page.locator('#detailedReview').scrollIntoViewIfNeeded();await screenshot(page,'review-desktop.png');await page.locator('.review-toolbar button').first().click();assert.equal(await page.locator('.review-chapter[open]').count(),11);checks.push('Real referee + synthetic autonomous decisions finish, open review, accessible keyboard dismissal and 11 detailed chapters');
  const jsonDownload=page.waitForEvent('download');await page.click('#downloadReport');const json=JSON.parse(await fs.readFile(await (await jsonDownload).path(),'utf8'));assert.equal(json.report.spec,'blackgate-report/2');assert.equal(json.metadata.effort,'high');assert.equal(json.metadata.effort_status,'requested-not-attested');assert(modelCalls>0);
  const mdDownload=page.waitForEvent('download');await page.click('#downloadMarkdown');const markdown=await fs.readFile(await (await mdDownload).path(),'utf8');assert(markdown.includes('前中后期策略变化'));assert(markdown.includes('下一轮改进建议'));assert(markdown.includes('不能从本报告得出的结论'));assert(!markdown.includes(secret));
  const profileDownload=page.waitForEvent('download');await page.click('#downloadBehavior');const profile=JSON.parse(await fs.readFile(await (await profileDownload).path(),'utf8'));assert.equal(profile.schema,'blackgate-behavior-review/1');
  const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!stored.includes(secret));assert(!stored.includes('https://relay.example'));assert(!stored.includes('custom_prompt'));assert(!JSON.stringify(json).includes(secret));checks.push('JSON/Markdown/profile exports, effort metadata retained and no API key/URL/raw prompt stored');
  await ready(page,'/ai-leaderboard.html');await page.selectOption('#rankingScope','local');await page.waitForFunction(()=>document.getElementById('rankingResults').textContent.includes('Synthetic-review-control'));assert((await page.locator('#rankingResults').innerText()).includes('requested-not-attested'));checks.push('Finished auto-run local score appears in the separate AI leaderboard with requested effort status');
  await ready(page,'/challenge.html?mode=human');await page.click('#start');await page.waitForSelector('#campaign:not([hidden])');await page.click('[data-action="allow"]');const state=await page.evaluate(async()=>{const {publicGame}=await import('./arena-app.mjs');return publicGame.state();});assert.equal(state.revision,1);assert.equal(await page.locator('#reviewReady[open]').count(),0);checks.push('Human start and decisions remain usable and do not open an AI completion dialog');
  assert.deepEqual(errors,[]);
  const result={passed:checks.length,checks,page_errors:errors,synthetic_relay:true,real_vendor_calls:0,model_fixture_requests:modelCalls,production_submissions:0,blocked_external_requests:blocked.length,browser:await browser.version(),checked_at:new Date().toISOString(),screenshots:'Synthetic fixtures only; not real model performance'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(e){process.exitCode=1;console.error(e);console.error('PAGE ERRORS',errors);if(context)for(const [i,p]of context.pages().entries())try{console.error((await p.locator('body').innerText()).slice(-7000));await p.screenshot({path:path.join(out,`failure-${i}.png`)});}catch{}}
finally{if(context)await context.close();if(browser)await browser.close();await new Promise(r=>server.close(r));}
