import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildReview,reviewMarkdown} from '../review-analysis.mjs';
import {normalizeScores,cohortKey,cohorts,rankModels,rankRuns,scoreEntry,effortName} from '../leaderboard-data.mjs';
import {Campaign,replay} from '../v2/engine.mjs';
const id=n=>n.toString(16).padStart(64,'0');
const run=(n=1,extra={})=>({id:id(n),username:'Synthetic tester',model:'Fixture A',participant_type:'ai',effort:'high',effort_status:'requested-not-attested',protocol:'chat',prompt_profile:'default',prompt_hash:'a'.repeat(64),version:'2.0.0',content_version:'world-2026-09-29.1',difficulty:'abyss',completed:false,days_survived:10,score:50,ended_at:'2026-09-29T00:00:00Z',...extra});
const decision=(n,extra={})=>({day:1,case_id:'C-'+n,person_id:'P-'+n,action:'allow',harmful:false,p_threat:null,reason:'Public evidence only',visible:[{id:'F-1',text:'Visible fact'}],evidence_ids:[],queried:[],...extra});
const envelope=(decisions=[],extra={})=>({metadata:{model:'Fixture A',username:'Synthetic tester',participant_type:'ai',effort:'high',effort_status:'requested-not-attested',prompt_hash:'a'.repeat(64),prompt_profile:'default'},report:{spec:'blackgate-report/2',version:'2.0.0',content_version:'world-2026-09-29.1',difficulty:'abyss',completed:false,days_survived:2,score:42,failure:'fixture-only',final_chain:id(99),decisions,days:[],metrics:{},resources:{},...extra}});
const metric=(r,label)=>r.metrics.find(x=>x.label===label).value;
const normalized=rows=>normalizeScores(rows).rows;

test('score-only envelopes cannot manufacture a behavior profile',()=>assert.throws(()=>buildReview({report:{score:100}}),/完整报告/));
test('empty and short runs do not invent traits, probabilities or later phases',()=>{
 const r=buildReview(envelope());assert.match(r.style,/样本不足/);assert.equal(metric(r,'概率校准 Brier'),'未提供');assert.match(r.sections.find(x=>x.id==='phases').items[2],/不能评价/);assert(!JSON.stringify(r).includes('NaN'));assert.equal(r.sections.length,15);
});
test('miss and coercion rates use their own known-label denominators',()=>{
 const r=buildReview(envelope([decision(1,{harmful:true}),decision(2,{harmful:true,action:'reject'}),decision(3,{action:'isolate'}),decision(4,{harmful:undefined})]));
 assert.equal(metric(r,'危险对象漏放'),'1/2（50%）');assert.equal(metric(r,'无辜对象受强制处置'),'1/1（100%）');assert.equal(r.sample_size,4);
});
test('null and invalid predictions stay missing while a numeric zero is evaluated',()=>{
 const r=buildReview(envelope([decision(1),decision(2,{p_threat:0}),decision(3,{p_threat:0.9,harmful:true}),decision(4,{p_threat:NaN}),decision(5,{p_threat:'0.8'}),decision(6,{p_threat:2})]));
 assert.equal(metric(r,'危险概率覆盖'),'2/6（33.33%）');assert.equal(metric(r,'概率校准 Brier'),'0.005');assert.equal(metric(r,'高置信度预测偏差'),'0/2（0%）');
});
test('style thresholds are explicit and not applied before 12 decisions',()=>{
 assert.match(buildReview(envelope(Array.from({length:11},(_,i)=>decision(i)))).style,/样本不足/);
 assert.equal(buildReview(envelope(Array.from({length:12},(_,i)=>decision(i)))).style,'放行偏多型');
 assert.equal(buildReview(envelope(Array.from({length:12},(_,i)=>decision(i,{action:'reject'})))).style,'拒绝偏多型');
});
test('phase analysis uses fixed days, not three artificial parts of a short run',()=>{
 const r=buildReview(envelope([decision(1,{day:3}),decision(2,{day:20})]));const s=r.sections.find(x=>x.id==='phases');assert.match(s.items[0],/1 个处置/);assert.match(s.items[1],/1 个处置/);assert.match(s.items[2],/未到达/);
});
test('resource jumps are observations, with no invented causal attribution',()=>{
 const r=buildReview(envelope([], {days:[{day:1,resources:{gold:40}},{day:2,resources:{gold:10}}],resources:{gold:5}}));
 assert.match(r.sections.find(x=>x.id==='turning').items[0],/城库 -30/);assert.match(r.sections.find(x=>x.id==='resources').items.join(' '),/最终清算后 5/);assert.match(r.sections.find(x=>x.id==='turning').paragraphs[0],/并非/);
});
test('case selection is bounded, deduplicated and separates visible evidence from hindsight',()=>{
 const r=buildReview(envelope(Array.from({length:30},(_,i)=>decision(i,{harmful:true,p_threat:0.1}))));assert.equal(r.cases.length,12);assert.equal(new Set(r.cases.map(x=>x.title)).size,12);assert.equal(r.cases[0].visible[0],'Visible fact');assert.match(r.case_note,/不是随机抽样/);
});
test('Markdown escapes untrusted markup and removes secret-shaped text',()=>{
 const e=envelope([decision(1,{reason:'<script>alert(1)</script> [click](https://evil.invalid) sk-fixture-secret-value'})]);e.metadata.model='<img onerror=alert(1)>';
 const md=reviewMarkdown(buildReview(e));assert(!md.includes('<script>'));assert(!md.includes('[click](https://evil.invalid)'));assert(!md.includes('sk-fixture-secret-value'));assert.match(md,/REDACTED/);assert.match(md,/下一轮改进建议/);
});
test('a genuine finished referee report stays replayable and unmodified after analysis',()=>{
 const game=new Campaign({seed:'review-regression-not-a-model-result',difficulty:'abyss'});let s=game.observe();for(let i=0;!s.finished&&i<1000;i++)s=game.step({revision:s.revision,action:s.phase==='council'?'next_day':'allow',...(s.phase==='council'?{policy:'balanced'}:{}),reason:'Synthetic regression decision'});
 assert(s.finished);const report=game.report(),before=JSON.stringify(report),r=buildReview({report,metadata:{model:'Synthetic control'}});assert(r.sample_size>0);assert.equal(JSON.stringify(report),before);assert(replay(report).ok);
});
test('public score serialization uses an allowlist, bounded username and no key/url/log/prompt',()=>{
 const e=envelope();e.metadata={...e.metadata,username:'x'.repeat(80),api_key:'do-not-publish',api_url:'https://private.invalid',logs:['private'],custom_prompt:'private prompt',effort_status:'requested-not-attested',protocol:'chat'};
 const s=scoreEntry(e),text=JSON.stringify(s);assert.equal(s.username.length,50);assert.equal(s.effort_status,'requested-not-attested');for(const forbidden of ['do-not-publish','private.invalid','private prompt','logs','api_key'])assert(!text.includes(forbidden));
});
test('AI normalization excludes humans, invalid numerics and inconsistent completion',()=>{
 const out=normalizeScores([run(),run(2,{participant_type:'human'}),run(3,{score:'99'}),run(4,{score:Infinity}),run(5,{completed:true}),run(6,{days_survived:43}),run(7,{model:'<script>'})]);assert.equal(out.rows.length,1);assert.equal(out.human,1);assert.equal(out.invalid,5);
});
test('duplicate run hashes cannot multiply samples, including case variants',()=>{
 const out=normalizeScores([run(10),run(10,{id:id(10).toUpperCase(),score:99})]);assert.equal(out.rows.length,1);assert.equal(out.duplicates,1);assert.equal(out.rows[0].score,50);
});
test('cohorts isolate source, engine, content, difficulty and full prompt hash',()=>{
 const variants=[run(1),run(2,{version:'2.1.0'}),run(3,{content_version:'other'}),run(4,{difficulty:'nightmare'}),run(5,{prompt_hash:'b'.repeat(64)}),run(6,{prompt_profile:'custom'})];
 const rows=normalized(variants);assert.equal(cohorts(rows).length,6);assert.throws(()=>rankModels(rows),/不能混排/);assert.throws(()=>rankRuns(rows),/不能混排/);assert.notEqual(cohortKey(rows[0]),cohortKey(normalizeScores([run()],'local').rows[0]));
});
test('unknown prompt provenance never pretends to be repeat evaluations',()=>{
 const groups=rankModels(normalized([run(1,{prompt_hash:''}),run(2,{prompt_hash:''})]));assert.equal(groups.length,2);assert(groups.every(x=>x.incomplete&&x.count===1));
});
test('model, requested effort, response status and protocol all remain distinct',()=>{
 const groups=rankModels(normalized([run(1),run(2,{effort:'auto'}),run(3,{effort:'none'}),run(4,{model:'Fixture B'}),run(5,{effort_status:undefined}),run(6,{protocol:'responses'})]));assert.equal(groups.length,6);assert.notEqual(effortName('auto'),effortName('none'));
});
test('model summary ranks completion rate and medians rather than cherry-picked best score',()=>{
 const rows=normalized([run(1,{model:'Steady',days_survived:20,score:70}),run(2,{model:'Steady',days_survived:22,score:60}),run(3,{model:'Spiky',days_survived:30,score:99}),run(4,{model:'Spiky',days_survived:1,score:1})]);
 const groups=rankModels(rows);assert.equal(groups[0].model,'Steady');assert.equal(groups[0].median_days,21);assert.equal(groups[0].median_score,65);assert.equal(groups[1].best.score,99);
});
test('finished runs rank ahead of unfinished ones and ties share competition rank',()=>{
 const ranked=rankRuns(normalized([run(1,{completed:true,days_survived:42,score:60}),run(2,{completed:true,days_survived:42,score:60}),run(3,{days_survived:42,score:99})]));assert.deepEqual(ranked.map(x=>x.rank),[1,1,3]);
});
test('self-claimed certification cannot promote community trust',()=>{
 const row=normalized([run(1,{source:'server-verified',github_issue:'javascript:alert(1)'})])[0];assert.equal(row.source,'community-self-reported');assert.equal(row.github_issue,null);assert.throws(()=>normalizeScores({runs:[]}),/数组/);
});
test('ingestion accepts old summaries and preserves optional effort metadata safely',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackgate-review-')),file=path.join(dir,'data','arena-community.json');fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,'{"runs":[]}');
 const ingest=value=>spawnSync(process.execPath,[path.resolve('scripts/ingest-arena-score.mjs')],{cwd:dir,encoding:'utf8',env:{...process.env,ISSUE_BODY:'```blackgate-arena\n'+JSON.stringify(value)+'\n```',ISSUE_NUMBER:'10',ISSUE_USER:'Synthetic tester'}});
 try{const e=scoreEntry(envelope());assert.equal(ingest(e).status,0);assert.equal(JSON.parse(fs.readFileSync(file)).runs[0].effort_status,'requested-not-attested');assert.notEqual(ingest({...e,run_id:id(88),effort_status:'sk-fixture-leaking-value'}).status,0);assert.notEqual(ingest({...e,run_id:id(89),protocol:'<img>'}).status,0);const legacy={...e,run_id:id(87)};delete legacy.effort_status;delete legacy.protocol;assert.equal(ingest(legacy).status,0);assert.equal(JSON.parse(fs.readFileSync(file)).runs.length,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
