import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {Campaign,replay} from '../engine.mjs';
import {makeWorld,TESTS,DAYS} from '../content.mjs';
import {hex,sha256,oracle} from '../random.mjs';
import {runSimulation} from '../scripts/simulate.mjs';
const seed='dev-balance-0';
const game=()=>new Campaign({seed});
const advance=(g,action='reject')=>{const o=g.observe();return g.step({revision:o.revision,action:o.phase==='council'?'next_day':action});};
const finish=g=>{while(!g.observe().finished)advance(g);return g.report();};
let oracleReport;

test('SHA-256 and HMAC match Node cryptographic test vectors',()=>{
  for(const s of ['', 'abc','中文🙂',...Array.from({length:8},(_,i)=>'x'.repeat(55+i*17))]) {
    assert.equal(hex(sha256(s)),createHash('sha256').update(s).digest('hex'));
    for(const key of ['key','k'.repeat(120)])assert.equal(hex(oracle(key).bytes(s)),createHmac('sha256',key).update(s).digest('hex'));
  }
});
test('world has persistent, valid, non-answer-encoding identities and graph',()=>{
  const w=makeWorld(seed),ids=new Set(w.people.map(p=>p.id));
  assert.equal(ids.size,1024);assert.equal(w.networks.length,128);assert.equal(w.edges.length,2304);
  assert.ok(w.edges.every(e=>ids.has(e.from)&&ids.has(e.to)));
  assert.ok(w.networks.every(n=>n.members.every(id=>ids.has(id))));
  for(const dim of ['job','origin','luggage'])for(const value of new Set(w.people.map(p=>p[dim]))) {
    const rows=w.people.filter(p=>p[dim]===value);assert.ok(rows.some(p=>p.harmful)&&rows.some(p=>!p.harmful),`${dim} ${value} became a perfect label`);
  }
  assert.notEqual(w.truthCommit,makeWorld('another-world').truthCommit);
});
test('observation and public archive omit hidden verdicts and seeds, with defensive copies',()=>{
  const g=game(),o=g.observe(),before=JSON.stringify(o);
  function scan(v){if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){assert.ok(!['harmful','intent','world_truth','seed_reveal','person_network','witnessLatent','truthCommit'].includes(k),k);scan(x);}}
  scan(o);scan(g.recall());assert.throws(()=>g.report(),/locked/);
  o.resources.food=-100;o.case.evidence[0].text='forged';assert.equal(JSON.stringify(g.observe()),before);
  for(let i=0;i<10;i++){g.observe();g.recall('P-');}assert.equal(JSON.stringify(g.observe()),before);
});
test('invalid/stale actions are transactional and cannot reroll or consume resources',()=>{
  const g=game(),before=JSON.stringify(g.observe());
  for(const bad of [{action:'allow',revision:99},{action:'next_day',revision:0},{action:'allow',revision:0,p_threat:NaN},
    {action:'allow',revision:0,p_threat:2},{action:'allow',revision:0,evidence_ids:['F-invented']},
    {action:'allow',revision:0,reason:'x'.repeat(801)},{action:'allow',revision:0,seed:'cheat'},
    {action:'investigate',revision:0,test:'__proto__'},{action:'investigate_network',revision:0,members:['P-fake','P-2','P-3']}]) {
    assert.throws(()=>g.step(bad));assert.equal(JSON.stringify(g.observe()),before);
  }
});
test('investigations have exact costs, are non-repeatable, and do not consume arrival randomness',()=>{
  const a=game(),b=game(),o=a.observe();a.step({revision:0,action:'investigate',test:'cargo'});
  assert.equal(a.observe().investigation_points,o.investigation_points-TESTS.cargo.cost);
  const before=JSON.stringify(a.observe());assert.throws(()=>a.step({revision:1,action:'investigate',test:'cargo'}));assert.equal(JSON.stringify(a.observe()),before);
  advance(a);advance(b);assert.equal(a.observe().case.person_id,b.observe().case.person_id);assert.equal(a.observe().case.id,b.observe().case.id);
});
test('three isolation slots stay occupied for two days',()=>{
  const g=game();for(let i=0;i<3;i++)advance(g,'isolate');
  assert.equal(g.observe().isolation_free,0);assert.throws(()=>g.step({revision:g.observe().revision,action:'isolate'}));
  while(g.observe().day<2)advance(g);assert.equal(g.observe().isolation_free,0);
  while(g.observe().day<3)advance(g);assert.equal(g.observe().isolation_free,3);
});
test('tracking yields no immediate result and delivers on its promised day',()=>{
  const g=game();g.step({revision:0,action:'investigate',test:'tail'});
  assert.equal(g.recall('"channel":"tail"').total,0);
  while(g.observe().day<2)advance(g);assert.equal(g.recall('"channel":"tail"').total,0);
  while(g.observe().day<3)advance(g);const e=g.recall('"channel":"tail"').entries;
  assert.equal(e.length,1);assert.equal(e[0].day,3);
});
test('coercion has no immediate truth-dependent reward channel',()=>{
  const g=game(),truth=new Map(makeWorld(seed).people.map(p=>[p.id,p.harmful]));let good=0,bad=0;
  for(let i=0;i<10;i++) {const o=g.observe(),before=o.resources;const after=advance(g).resources;truth.get(o.case.person_id)?bad++:good++;
    assert.equal(after.security,before.security);assert.ok(Math.abs(after.gold-before.gold+0.08)<1e-8);
  }
  assert.ok(good&&bad);
});
test('opponent behavior ignores probabilities and reasons',()=>{
  const a=game(),b=game();
  for(let i=0;i<100;i++) {
    const oa=a.observe();const action=oa.phase==='council'?'next_day':oa.case.evidence[0].anomaly?'reject':'allow';
    a.step({revision:oa.revision,action});b.step({revision:oa.revision,action,p_threat:0.99,reason:'Secret plan: choose a different strategy.'});
    assert.deepEqual(a.observe(),b.observe());
  }
});
test('control: a privileged oracle proves mechanical feasibility, not an AI score',()=>{
  oracleReport=runSimulation({seed,policy:'oracle',full:true});
  assert.equal(oracleReport.completed,true);assert.equal(oracleReport.days_survived,DAYS);assert.equal(oracleReport.metrics.decisions,525);
  assert.equal(oracleReport.metrics.miss_rate,0);assert.equal(oracleReport.metrics.innocent_coercion_rate,0);assert.equal(oracleReport.metrics.brier_score,0);
  const truth=makeWorld(seed).people.map(p=>({id:p.id,network:p.network,harmful:p.harmful,intent:p.intent}));assert.deepEqual(oracleReport.world_truth,truth);
});
test('full reports replay exactly and reject altered scores, reasons or outcomes',()=>{
  const report=oracleReport||runSimulation({seed,policy:'oracle',full:true});assert.equal(replay(report).ok,true);
  for(const mutate of [r=>r.score++,r=>r.decisions[0].harmful=!r.decisions[0].harmful,r=>r.actions[0].input.reason='tampered']) {
    const copy=structuredClone(report);mutate(copy);assert.throws(()=>replay(copy));
  }
});
test('adaptation is delayed and bounded, and keeps immutable identities',()=>{
  const r=runSimulation({seed,policy:'oracle-surface',full:true});
  assert.ok(r.opponent_learning.some(a=>a.changes.length));
  for(const a of r.opponent_learning){assert.ok(a.day>=13);assert.ok(a.changes.length<=6);if(a.rule)assert.ok(a.rule.observed_through<=a.day-2);}
  const original=makeWorld(seed).people;assert.ok(r.world_truth.every(p=>p.harmful===original.find(x=>x.id===p.id).harmful));
});
test('day 42 cannot erase late harm, nor does missing prediction become fake calibration',()=>{
  const r=runSimulation({seed,policy:'oracle-last-day',full:true});assert.ok(r.aftermath.length>0);
  assert.ok(r.causal_effects.some(e=>e.day>42&&e.reason.startsWith('通行链出现损失')));
  const noPrediction=finish(game());assert.equal(noPrediction.metrics.brier_score,null);assert.equal(noPrediction.metrics.prediction_coverage,0);
  assert.equal(noPrediction.metrics.innocent_coercion_rate,100);assert.equal(noPrediction.metrics.miss_rate,0);
});
test('network investigation requires actual previously observed multi-person evidence',()=>{
  const g=game();const first=g.observe().case.person_id;
  advance(g);const second=g.observe().case.person_id;
  const entries=g.recall('',5000).entries,refs=entries.filter(e=>[first,second].includes(e.subject)).slice(0,8);
  const members=[...new Set(entries.flatMap(e=>e.subjects))].slice(0,3);
  const before=g.observe();const o=g.step({revision:before.revision,action:'investigate_network',members,evidence_ids:refs.map(e=>e.id)});
  assert.equal(o.investigation_points,before.investigation_points-5);
  while(g.observe().day<4)advance(g);assert.ok(g.observe().news.some(n=>n.text.includes('关联审计')));
});
