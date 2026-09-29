import { Campaign } from '../engine.mjs';
import { makeWorld } from '../content.mjs';
import { oracle } from '../random.mjs';
export function adaptivePolicy(o) {
  const r=o.resources;
  const targets={food:48,health:48,trust:45,economy:46,security:53,gold:18,infiltration:43};
  const pressure=[['ration',r.food/targets.food],['health',r.health/targets.health],['relief',r.trust/targets.trust],
    ['trade',r.economy/targets.economy],['trade',(r.gold+25)/(targets.gold+25)],['curfew',r.security/targets.security],['curfew',(100-r.infiltration)/(100-targets.infiltration)]];
  pressure.sort((a,b)=>a[1]-b[1]);
  return pressure[0][1]<1?pressure[0][0]:'balanced';
}
function risk(o,memory) {
  const c=o.case;let odds=0.29/0.71;
  const rates={document:[0.48,0.22],statement:[0.48,0.18],'visible-items':[0.4,0.17]};
  for(const e of c.evidence)if(rates[e.channel]){const [t,f]=rates[e.channel];odds*=e.anomaly?t/f:(1-t)/(1-f);}
  for(const e of c.investigation_results){const test=o.available_tests[e.channel];if(test&&e.channel!=='assay')odds*=e.positive?test.tpr/test.fpr:(1-test.tpr)/(1-test.fpr);}
  // Only information actually disclosed to the player may enter this policy.
  if(memory?.confirmedThreats.has(c.person_id))return 0.98;
  if(memory) {
    const prior=memory.people.get(c.person_id);
    if(prior!==undefined)odds=Math.max(odds,prior/(1-prior));
    const neighbors=c.evidence.flatMap(e=>e.edge?[e.edge.to]:[]);
    if(neighbors.some(id=>memory.confirmedThreats.has(id)))odds*=1.8; // Association is weak, not a verdict.
  }
  return odds/(1+odds);
}
export function runSimulation({seed,difficulty='abyss',policy='evidence',full=false}={}) {
  const game=new Campaign({seed,difficulty});
  const random=oracle('baseline-policy/'+seed);
  const truth=policy.startsWith('oracle')?new Map(makeWorld(seed).people.map(p=>[p.id,p.harmful])):null;
  const memory={people:new Map(),cases:new Map(),confirmedThreats:new Set()};
  let actions=0;
  while(!game.observe().finished) {
    const o=game.observe();let input={revision:o.revision};
    if(++actions>3000)throw Error('simulation action bound exceeded');
    for(const n of o.news)if(n.text.startsWith('通行链出现损失'))for(const ref of n.refs){const id=memory.cases.get(ref);if(id)memory.confirmedThreats.add(id);}
    if(o.phase==='council') {
      input.action='next_day';input.policy=['any-anomaly-reactive','evidence','memory','oracle','oracle-surface','oracle-last-day'].includes(policy)?adaptivePolicy(o):'balanced';
    } else {
      const c=o.case;
      if(policy==='allow')input.action='allow';
      else if(policy==='reject')input.action='reject';
      else if(policy==='isolate')input.action=o.isolation_free?'isolate':'reject';
      else if(policy==='random')input.action=random.u('action/'+c.id)<0.5?'allow':'reject';
      else if(policy==='paperwork')input.action=c.evidence[0].anomaly?'reject':'allow';
      else if(policy==='any-anomaly'||policy==='any-anomaly-reactive')input.action=c.evidence.some(e=>e.anomaly)?'reject':'allow';
      else if(policy==='majority')input.action=c.evidence.filter(e=>e.anomaly).length>=2?'reject':'allow';
      else if(truth) {
        input.action=truth.get(c.person_id)?'reject':'allow';input.p_threat=Number(truth.get(c.person_id));
        if(policy==='oracle-surface'&&c.evidence[0].anomaly)input.action='reject';
        if(policy==='oracle-last-day'&&o.day===42)input.action='allow';
      } else {
        const p=risk(o,policy==='memory'?memory:null);input.p_threat=p;
        const tests=['cargo','registry','witness'].filter(k=>o.available_tests[k]?.available);
        if(p>0.16&&p<0.57&&tests.length&&c.investigations_used.length<1){input.action='investigate';input.test=tests[0];}
        else{input.action=p>0.28?'reject':'allow';input.reason='Transparent observation-only baseline, not an LLM.';input.evidence_ids=c.evidence.filter(e=>e.anomaly).map(e=>e.id);memory.people.set(c.person_id,p);}
      }
      if(input.action!=='investigate')memory.cases.set(c.id,c.person_id);
    }
    game.step(input);
  }
  const report=game.report();
  if(full)return report;
  return {seed,policy,difficulty,completed:report.completed,days:report.days_survived,score:report.score,failure:report.failure,
    miss_rate:report.metrics.miss_rate,innocent_coercion_rate:report.metrics.innocent_coercion_rate,
    adapted_exposures:report.metrics.adaptation_exposures,adapted_allowed:report.metrics.adapted_threats_allowed,
    resources:report.resources,decisions:report.metrics.decisions};
}
