import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionPsychology as build,resourcePressure} from '../review-psychology.mjs';
import {buildReview,reviewMarkdown} from '../review-analysis.mjs';
const healthy={security:70,economy:70,trust:70,food:70,health:70,gold:50,infiltration:10};
const d=(id,extra={})=>({day:1,case_id:'C-'+id,person_id:'P-'+id,action:'allow',harmful:false,p_threat:null,queried:[],evidence_ids:[],visible:[],resources_before:{...healthy},...extra});
const report=(decisions=[],extra={})=>({spec:'blackgate-report/2',version:'2.0.0',content_version:'fixture',difficulty:'abyss',decisions,days:[],actions:[],metrics:{},resources:{},...extra});
const scenario=(p,id)=>p.scenarios.find(x=>x.id===id);
const dim=(p,id)=>p.dimensions.find(x=>x.id===id);
const signal=(positive,id='F-1')=>({id,channel:'document',group:'documents',anomaly:positive,text:'Synthetic public fact'});

test('empty profile exposes coverage, not made-up personality scores',()=>{
 const p=build(report());assert.equal(p.dimensions.length,8);assert.equal(p.scenarios.length,10);assert.equal(p.bias_checks.length,7);assert.match(p.headline,/样本不足/);assert.equal(p.coverage.probability,0);assert(p.dimensions.every(x=>x.sample_size===0));assert(!JSON.stringify(p).includes('NaN'));assert(!Object.hasOwn(p,'score'));assert.throws(()=>build({score:100}),/完整/);
});
test('prototype requires 12 decisions; scenario direction requires 5',()=>{
 assert.match(build(report(Array.from({length:11},(_,i)=>d(i)))).headline,/样本不足/);
 assert.equal(build(report(Array.from({length:12},(_,i)=>d(i)))).headline,'通行优先型（本局）');
 assert.match(scenario(build(report(Array.from({length:4},(_,i)=>d(i,{p_threat:0.9})))),'high-risk').finding,/样本不足/);
 assert.equal(scenario(build(report(Array.from({length:5},(_,i)=>d(i,{p_threat:0.9})))),'high-risk').finding,'放行偏多');
});
test('null, strings, NaN, infinity and out-of-range probabilities stay missing; numeric zero survives',()=>{
 const p=build(report([null,'x',...([null,'0.5',NaN,Infinity,-1,2,0,0.35,0.65,0.651,0.349].map((x,i)=>d(i,{p_threat:x})))]));
 assert.equal(p.coverage.probability,5);assert.equal(scenario(p,'uncertain').sample_size,2);assert.equal(scenario(p,'low-risk').sample_size,2);assert.equal(scenario(p,'high-risk').sample_size,1);
});
test('pressure uses exact pre-decision cutoffs and does not classify partial normal snapshots',()=>{
 assert.equal(resourcePressure(healthy),false);assert.equal(resourcePressure({security:25}),true);assert.equal(resourcePressure({gold:0}),true);assert.equal(resourcePressure({infiltration:60}),true);assert.equal(resourcePressure({security:26}),null);assert.equal(resourcePressure(null),null);assert.equal(resourcePressure({gold:'0'}),null);
});
test('after-action, daily and terminal losses cannot backfill earlier pressure',()=>{
 const p=build(report([d(1,{resources_before:undefined,resources_after:{security:0}})],{days:[{day:1,resources:{security:0}}],resources:{security:0},causal_effects:[{resources:{security:0}}]}));
 assert.equal(p.coverage.pressure_unknown,1);assert.equal(scenario(p,'resource-pressure').sample_size,0);assert.match(dim(p,'pressure').finding,/样本不足/);
});
test('pressure comparison needs both groups and reports percentage points, not significance',()=>{
 const normal=Array.from({length:5},(_,i)=>d(i,{action:'reject'})),stressed=Array.from({length:5},(_,i)=>d(i+10,{resources_before:{gold:0}}));
 const p=build(report([...normal,...stressed]));assert.equal(dim(p,'pressure').finding,'承压时放行比例更高');assert.match(dim(p,'pressure').observation,/\+100 个百分点/);assert.match(dim(p,'pressure').limit,/不是显著性/);
 assert.match(dim(build(report([...normal.slice(0,4),...stressed])),'pressure').finding,/样本不足/);
});
test('signal conditions rely on explicit visible flags, not keywords, occupation or hindsight',()=>{
 const p=build(report([d(1,{visible:[signal(true),{positive:false,channel:'cargo'}]}),d(2,{visible:[{text:'危险！矛盾！他是权威！'}],cover:{job:'soldier'},harmful:true}),d(3,{visible:[null,signal(false),signal(false)]})]));
 assert.equal(scenario(p,'mixed-signals').sample_size,1);assert.equal(p.coverage.explicit_signal_cases,2);assert.match(scenario(p,'mixed-signals').limit,/不一定/);
});
test('fresh evidence IDs alone do not count as new signals or belief updating',()=>{
 const p=build(report([d(1,{person_id:'same',p_threat:0.1,visible:[signal(false,'A')]}),d(2,{person_id:'same',p_threat:0.8,visible:[signal(false,'B')],day:2})]));
 assert.equal(p.coverage.paired_probability_updates,0);assert.equal(scenario(p,'changed-signals').sample_size,0);
});
test('updated signals pair the same person and distinguish probability change from action change',()=>{
 const ds=[];for(let i=0;i<5;i++){ds.push(d(i+'a',{person_id:'person-'+i,p_threat:0.1,visible:[signal(false)]}));ds.push(d(i+'b',{person_id:'person-'+i,day:2,p_threat:0.25,visible:[signal(true)]}));}
 const p=build(report(ds));assert.equal(p.coverage.paired_probability_updates,5);assert.equal(dim(p,'updating').finding,'新增信号后概率调整较多');assert.match(dim(p,'updating').observation,/变化至少 0.15：5\/5/);assert.match(dim(p,'updating').observation,/改动作 0\/5/);
});
test('different people, missing probabilities and reverse time never fabricate paired updates',()=>{
 const p=build(report([d(1,{visible:[signal(false)],p_threat:0.1}),d(2,{visible:[signal(true)],p_threat:0.9}),d(3,{person_id:'x',day:2,visible:[signal(false)]}),d(4,{person_id:'x',day:1,visible:[signal(true)],p_threat:0.9})]));assert.equal(p.coverage.paired_probability_updates,0);
});
test('swapping hidden truth cannot change conditions, prototypes or non-calibration dimensions',()=>{
 const ds=Array.from({length:15},(_,i)=>d(i,{p_threat:0.9,visible:[signal(true),{positive:false}],action:i%2?'reject':'allow'}));const a=build(report(ds)),b=build(report(ds.map(x=>({...x,harmful:!x.harmful,adapted:true,person_network:'SECRET'})),{world_truth:[{SECRET:true}],seed_reveal:'SECRET'}));
 assert.equal(a.headline,b.headline);assert.deepEqual(a.coverage,b.coverage);assert.deepEqual(a.dimensions.filter(x=>x.id!=='confidence'),b.dimensions.filter(x=>x.id!=='confidence'));
 for(let i=0;i<a.scenarios.length;i++){const {outcomes:ao,...aa}=a.scenarios[i],{outcomes:bo,...bb}=b.scenarios[i];assert.deepEqual(aa,bb);}
 assert.notEqual(dim(a,'confidence').observation,dim(b,'confidence').observation);assert(!JSON.stringify(b).includes('SECRET'));
});
test('two already observed security drops are not called two mistakes or model emotions',()=>{
 const p=build(report([d(1,{resources_before:{security:60}}),d(2,{resources_before:{security:55}}),d(3,{resources_before:{security:50}})]));assert.equal(scenario(p,'declining-security').sample_size,1);assert.match(scenario(p,'declining-security').limit,/连续资源损失不等于连续犯错/);
 const q=build(report([d(1,{resources_after:{security:60}}),d(2,{resources_after:{security:55}}),d(3,{resources_after:{security:50}})]));assert.equal(scenario(q,'declining-security').sample_size,0);
});
test('late-game samples are actual days 29 through 42, not extrapolated from a short run',()=>{
 const p=build(report([d(1,{day:1}),d(2,{day:28}),d(3,{day:29}),d(4,{day:42}),d(5,{day:43}),d(6,{day:'30'})]));assert.equal(scenario(p,'late-game').sample_size,2);
});
test('scarcity-and-risk requires both conditions, not a hidden harmful flag',()=>{
 const p=build(report([d(1,{resources_before:{food:25},p_threat:0.8}),d(2,{p_threat:0.8}),d(3,{resources_before:{food:0},harmful:true}),d(4,{resources_before:{security:0},p_threat:0.8})]));assert.equal(scenario(p,'pressure-and-risk').sample_size,1);
});
test('malformed rows and evidence never create inherited actions or crash citation mapping',()=>{
 const p=build(report([null,{},d(1,{action:'constructor'}),d(2,{action:['allow']}),d(3,{visible:[null,{},signal(false)],evidence_ids:[undefined]}),d(4,{visible:[null],evidence_ids:['missing']})]));assert.equal(p.sample_size,2);assert.match(dim(p,'inquiry').observation,/可完整映射引用的 0 案/);
});
test('two citation groups are counted only when the cited IDs exist in the decision snapshot',()=>{
 const visible=[{id:'A',group:'documents'},{id:'B',group:'physical'}];const p=build(report([d(1,{visible,evidence_ids:['A','B']}),d(2,{visible,evidence_ids:['A','FUTURE']})],{public_archive:[{id:'FUTURE',group:'testimony'}]}));assert.match(dim(p,'inquiry').observation,/多组证据引用 1\/1/);
});
test('confidence uses known-label extreme-probability denominator and avoids claiming a diagnosis',()=>{
 const p=build(report([d(1,{p_threat:0.1,harmful:true}),d(2,{p_threat:0.9,harmful:true}),d(3,{p_threat:0.5}),d(4,{p_threat:0.1,harmful:undefined})]));assert.match(dim(p,'confidence').observation,/偏差 1\/2/);assert.match(dim(p,'confidence').limit,/少数意外不证明过度自信/);
});
test('cross-case and delayed actions stay behavioral proxies; missing logs stay missing',()=>{
 const p=build(report([],{actions:[{input:{action:'investigate_network'}},{input:{action:'investigate',test:'tail'}},{input:{action:'investigate',test:'cargo'}}]}));assert.match(dim(p,'horizon').observation,/跨案调查 1 次；延迟跟踪 1 次/);
 const q=build(report([],{actions:undefined}));assert.match(dim(q,'horizon').observation,/未提供动作日志/);assert.match(dim(q,'horizon').finding,/样本不足/);
});
test('counterexamples are retained rather than selecting only stereotype-supporting decisions',()=>{
 const p=build(report([...Array.from({length:11},(_,i)=>d(i)),d('exception',{action:'reject'})]));assert.equal(p.headline,'通行优先型（本局）');assert.match(p.counterevidence,/C-exception/);assert.match(p.counterevidence,/1 个/);
});
test('analysis does not mutate input and exports include 15 sequential chapters plus psychology',()=>{
 const e={report:report([d('sk-fixture-secret-value',{p_threat:0.9,reason:'<script>x</script>',harmful:true})]),metadata:{model:'Synthetic'}};const before=JSON.stringify(e),r=buildReview(e),md=reviewMarkdown(r);
 assert.equal(JSON.stringify(e),before);assert.equal(r.schema,'blackgate-behavior-review/2');assert.equal(r.psychology.schema,'blackgate-decision-psychology/1');assert.equal(r.sections.length,15);assert.deepEqual(r.sections.map(x=>Number(x.title.split(' / ')[0])),Array.from({length:15},(_,i)=>i+1));assert.match(md,/情境—行为反应图谱/);assert.match(md,/认知偏差线索/);assert(!md.includes('sk-fixture-secret-value'));assert(!md.includes('<script>'));
});
