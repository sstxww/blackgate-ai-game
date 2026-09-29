import { VERSION, CONTENT_VERSION, DAYS, DIFFICULTIES, TESTS, POLICIES, RULES, makeWorld } from './content.mjs';
import { oracle, hex, sha256 } from './random.mjs';
import { LANGUAGE, MOTIVATIONS } from './language.mjs';
const clone = x => structuredClone(x);
const hash = x => hex(sha256(JSON.stringify(x)));
const round = x => Math.round(x*10000)/10000;
const pct = (n,d) => d ? round(n/d*100) : null;
const FINALS = ['allow','reject','isolate'];
const RESOURCE_KEYS = ['security','economy','trust','food','health','gold','infiltration'];
function requireThat(ok, message) { if(!ok) throw new Error(message); }
function probability(p) { return typeof p==='number' && Number.isFinite(p) && p>=0 && p<=1; }

/** A deterministic partially observed world. Hidden fields never leave observe()/recall().
 * Browser execution is practice-only; a server process is required for adversarial isolation.
 */
export class Campaign {
  #seed; #r; #w; #people; #networks; #edges; #difficulty; #schedule=[];
  #day=1; #completed=0; #index=0; #phase='case'; #revision=0; #budget=8;
  #resources; #policy='balanced'; #queue=[]; #custody=[]; #blocked=new Set();
  #evidence=new Map(); #known=new Set(); #current=null; #actions=[]; #decisions=[];
  #news=[]; #effects=[]; #days=[]; #pending=[]; #adaptation=[]; #adaptRule=null;
  #adaptSpent=new Map(); #adaptTotal=0; #networkAudits=[]; #hypotheses=[];
  #failed=null; #aftermath=[]; #commit; #seedCommit; #head='';
  constructor({seed,difficulty='abyss'}={}) {
    requireThat(typeof seed==='string' && seed.length>0 && seed.length<=256,'seed must contain 1–256 characters');
    requireThat(Object.hasOwn(DIFFICULTIES,difficulty),'unknown difficulty');
    this.#seed=seed; this.#difficulty=difficulty; this.#r=oracle(seed); this.#w=makeWorld(seed);
    this.#people=new Map(this.#w.people.map(p=>[p.id,p]));
    this.#networks=new Map(this.#w.networks.map(n=>[n.id,n]));
    this.#edges=new Map(this.#w.people.map(p=>[p.id,this.#w.edges.filter(e=>e.from===p.id)]));
    this.#resources={security:74,economy:65,trust:68,food:73,health:76,gold:56,infiltration:8};
    for(const k of ['security','economy','trust','food','health'])this.#resources[k]+=DIFFICULTIES[difficulty].reserve;
    // Exogenous appointments and identities are committed before the first action.
    for(let d=1;d<=DAYS;d++) {
      const active=this.#w.networks.filter(n=>n.active && n.onset-4<=d && n.deadline+3>=d);
      const row=[],used=new Set();
      for(let i=0;i<10+Math.floor((d-1)/7);i++) {
        let p;
        for(let attempt=0;attempt<1024;attempt++) {
          const key=`arrival/${d}/${i}/${attempt}`;
          p=i<3 && active.length ? this.#people.get(this.#r.pick(key,this.#r.pick(key+'/network',active).members)) : this.#r.pick(key,this.#w.people);
          if(!used.has(p.id))break;
        }
        used.add(p.id); row.push(p.id);
      }
      this.#schedule.push(row);
    }
    this.#seedCommit=hex(sha256(seed));
    this.#commit=hash({content:CONTENT_VERSION,truth:this.#w.truthCommit,schedule:this.#schedule,disasters:this.#w.disasters});
    this.#head=hash({version:VERSION,difficulty,world_commitment:this.#commit,seed_commitment:this.#seedCommit});
    this.#openDay();
  }
  get version(){return VERSION;}
  #effect(delta, reason, refs=[]) {
    const before=clone(this.#resources),actual={};
    for(const [k,v] of Object.entries(delta)) {
      requireThat(RESOURCE_KEYS.includes(k) && Number.isFinite(v),'invalid internal resource delta');
      const next=before[k]+v;
      this.#resources[k]=round(k==='gold'?Math.min(180,next):Math.max(0,Math.min(100,next)));
      actual[k]=round(this.#resources[k]-before[k]);
    }
    this.#effects.push({day:this.#day,revision:this.#revision,reason,refs,delta:actual,resources:clone(this.#resources)});
  }
  #say(text, refs=[]) {
    const subjects=[...new Set(refs.flatMap(ref=>{
      const evidence=this.#evidence.get(ref);if(evidence)return evidence.subjects||[];
      const decision=this.#decisions.find(d=>d.case_id===ref);return decision?[decision.person_id]:[];
    }))];
    const id='F-'+this.#r.id('dispatch/'+this.#news.length);
    this.#putEvidence({id,day:this.#day,subject:subjects[0]||'CITY',subjects,channel:'city_news',text,refs:clone(refs)});
    this.#news.push({id,day:this.#day,text,refs});
  }
  #putEvidence(e) {
    if(!this.#evidence.has(e.id))this.#evidence.set(e.id,clone(e));
    for(const id of e.subjects||[])this.#known.add(id);
    return clone(e);
  }
  #fact(c, channel, text, extra={}) {
    return this.#putEvidence({id:'F-'+this.#r.id(c.id+'/'+channel),day:this.#day,case_id:c.id,
      subject:c.person.id,subjects:[c.person.id],channel,text,...extra});
  }
  #openDay() {
    this.#budget=(this.#day>=13?10:8)+(this.#policy==='intelligence'?3:0);
    this.#index=0;this.#queue=[...this.#schedule[this.#day-1]];
    this.#release(); this.#due();
    if(this.#day>=13 && (this.#day-13)%3===0)this.#adapt();
    for(const d of this.#w.disasters)if(d.day-4===this.#day)
      this.#say(`预警：${d.name}预计第${d.day}天抵达，基础冲击约${Math.round(Math.abs(d.delta[d.kind]||8)*0.8)}～${Math.round(Math.abs(d.delta[d.kind]||8)*1.2)}；储备和政策可缓冲。`);
    for(const n of this.#w.networks.filter(n=>n.active && n.onset===this.#day)) {
      const p=this.#people.get(n.members[0]);
      const e=this.#putEvidence({id:'F-'+this.#r.id('network-news/'+n.id),day:this.#day,subject:p.id,subjects:[p.id],channel:'bulletin',
        text:`${n.motif.name}相关的${n.motif.clue}出现交接延误；${p.name}（${p.id}）是登记联系人。尚未确定是正常周转还是异常活动。`,batch:n.batch});
      this.#say(e.text,[e.id]);
    }
    this.#prepareCase();
  }
  #adapt() {
    const history=this.#decisions.filter(x=>x.day<=this.#day-2 && x.day>=this.#day-10);
    let chosen=null;
    for(const dim of ['job','origin','luggage','paperwork']) {
      const counts=new Map();
      for(const h of history) {const key=h.cover[dim],v=counts.get(key)||{n:0,checked:0};v.n++;v.checked+=(h.queried.length>0||h.action!=='allow')?1:0;counts.set(key,v);}
      const rows=[...counts].filter(([,v])=>v.n>=8).map(([value,v])=>({value,n:v.n,rate:v.checked/v.n})).sort((a,b)=>a.rate-b.rate);
      if(rows.length<2)continue;
      const low=rows[0],high=rows.at(-1),gap=high.rate-low.rate;
      if(gap>=0.22 && (!chosen||gap>chosen.gap))chosen={dim,from:high.value,to:low.value,gap,sample_size:history.length,observed_through:this.#day-2};
    }
    this.#adaptRule=chosen;this.#adaptSpent.clear();this.#adaptTotal=0;
    this.#adaptation.push({day:this.#day,rule:clone(chosen),changes:[]});
    if(chosen)this.#say('边境情报：部分通行申请的外观分布正在变化；这不是任何具体群体有罪的证明。');
  }
  #prepareCase() {
    if(this.#index>=this.#queue.length){this.#current=null;this.#phase='council';return;}
    let p=this.#people.get(this.#queue[this.#index]);
    if(this.#blocked.has(p.id)||this.#custody.some(x=>x.id===p.id)) {
      const alternatives=this.#w.people.filter(x=>!this.#blocked.has(x.id)&&!this.#custody.some(c=>c.id===x.id)&&!this.#queue.includes(x.id));
      p=this.#r.pick(`replacement/${this.#day}/${this.#index}`,alternatives);
    }
    const c={id:'C-'+this.#r.id(`case/${this.#day}/${this.#index}`),person:p,queried:[],results:[],evidence:[],adapted:false,
      cover:{job:p.job,origin:p.origin,luggage:p.luggage,paperwork:this.#r.u('visible-document/'+p.id)<(p.harmful?0.48:0.22)?'登记差异':'登记匹配'}};
    const a=this.#adaptRule,limit=DIFFICULTIES[this.#difficulty].adaptation;
    if(a && p.harmful && c.cover[a.dim]===a.from && (this.#adaptSpent.get(p.network)||0)<limit && this.#adaptTotal<limit*2) {
      c.cover[a.dim]=a.to;c.adapted=true;this.#adaptTotal++;
      this.#adaptSpent.set(p.network,(this.#adaptSpent.get(p.network)||0)+1);
      this.#adaptation.at(-1).changes.push({case_id:c.id,person:p.id,dimension:a.dim,from:a.from,to:a.to});
    }
    const h=p.harmful;
    const anomaly=c.cover.paperwork==='登记差异';
    const statement=p.witnessLatent<(h?0.48:0.18);
    const physical=this.#r.u('visible-items/'+p.id)<(h?0.4:0.17);
    c.evidence.push(this.#fact(c,'document',this.#r.pick('wording/document/'+p.id,LANGUAGE.document[anomaly?'anomaly':'normal']), {group:'documents',anomaly}));
    c.evidence.push(this.#fact(c,'statement',this.#r.pick('wording/statement/'+p.id,LANGUAGE.statement[statement?'anomaly':'normal']), {group:'testimony',anomaly:statement}));
    c.evidence.push(this.#fact(c,'visible-items',this.#r.pick('wording/items/'+p.id,LANGUAGE['visible-items'][physical?'anomaly':'normal']), {group:'physical',anomaly:physical}));
    const edge=this.#edges.get(p.id)[0];
    c.evidence.push(this.#fact(c,'association',`登记关系：${p.name} ${edge.relation} ${this.#people.get(edge.to).name}（${edge.to}）。单一联系不能定罪。`,
      {group:'ledger',subjects:[p.id,edge.to],edge:clone(edge)}));
    c.evidence.push(this.#fact(c,'application','自述目的：'+this.#networks.get(p.network).motif.benign+'。'+this.#r.pick('motivation/'+p.id,MOTIVATIONS),{group:'claim'}));
    this.#known.add(p.id);this.#current=c;this.#phase='case';
  }
  #investigation(c, test) {
    const p=c.person,t=TESTS[test];
    // Stable person-level noise prevents repeated encounters from becoming free rerolls.
    const u=(test==='witness'||test==='tail')?p.witnessLatent:this.#r.u(`test/${test}/${p.id}`);
    const relevant=test==='assay'?p.biological:p.harmful;
    const positive=u<(relevant?t.tpr:t.fpr),n=this.#networks.get(p.network);
    const text={
      registry:positive?'独立户籍副本有不兼容条目；仍可能来自重名或旧档迁移。':'独立副本未见新增冲突，不能排除精心伪造。',
      cargo:positive?'发现未充分申报的受控工具或异常材料；也存在合法用途。':'本次检验范围内未检出异常，非全面无风险证明。',
      witness:positive?'线人指出行程与某次不明交接重叠；尚未独立证实。':'线人确认部分行程，但无法担保完整时间线。',
      records:positive?`${n.motif.clue}中出现重用批次或缺失对手方。`:`${n.motif.clue}暂未发现明显冲突。`,
      assay:positive?'生物样本呈阳性；检测有误报率，应结合暴露和其他证据。':'生物样本呈阴性；无法排除非生物威胁。',
      tail:positive?'跟踪队观察到未申报的交接；线人叙述与此部分吻合。':'跟踪队只确认了日常活动；未覆盖全部时段。'
    }[test];
    return {text,positive,group:t.group,source:test==='witness'?'边境线人':test==='tail'?'跟踪队/同一线人':'独立办事处',
      ...(test==='records'||test==='tail'?{edges:clone(this.#edges.get(p.id)),batch:n.batch,subjects:[p.id,...this.#edges.get(p.id).map(e=>e.to)]}:{})};
  }
  #release() {
    for(const c of this.#custody.filter(c=>c.until<=this.#day)) {
      const p=this.#people.get(c.id);
      if(p.harmful)this.#blocked.add(p.id);
      this.#say(`${p.name}（${p.id}）的两日隔离听证已结束；床位释放。具体责任归档待期末独立审计。`,[c.case_id]);
    }
    this.#custody=this.#custody.filter(c=>c.until>this.#day);
  }
  #due() {
    const due=this.#pending.filter(e=>e.day<=this.#day);this.#pending=this.#pending.filter(e=>e.day>this.#day);
    for(const event of due) {
      if(event.type==='tail') {
        const e=this.#putEvidence({...event.evidence,day:this.#day});this.#say(e.text,[e.id]);continue;
      }
      if(event.type==='network-audit') {
        const n=this.#networks.get(event.network);
        const harmful=!!n?.hostile;
        if(harmful){n.resolved=true;n.members.filter(id=>this.#people.get(id).harmful).forEach(id=>this.#blocked.add(id));}
        this.#networkAudits.push({day:this.#day,submitted_day:event.submitted_day,members:event.members,evidence_ids:event.refs,
          network:n?.id||null,hostile:harmful,before_deadline:!!n&&this.#day<n.deadline});
        this.#effect(harmful?{security:3,infiltration:-4}:{trust:-1.8,gold:-2},harmful?'网络审计中断危险活动':'网络审计未形成指控，支付调查补偿',event.refs);
        this.#say(harmful?`关联审计发现可核实的危险活动：${n.motif.bad}。`:'关联审计没有建立危险网络指控；存在合法往来或证据不足。',event.refs);continue;
      }
      let delta=clone(event.delta);
      if(event.network && this.#networks.get(event.network)?.resolved && event.hostile)
        delta=Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,v*0.2]));
      this.#effect(delta,event.text,event.refs);this.#say(event.text,event.refs);
    }
  }
  #failure() {
    for(const k of ['security','economy','trust','food','health'])if(this.#resources[k]<=0)return `${k}耗尽`;
    if(this.#resources.infiltration>=100)return '渗透失控';
    if(this.#resources.gold < -25)return '城库无法偿付';
    return null;
  }
  #settleDay() {
    const pressure=DIFFICULTIES[this.#difficulty].pressure;
    this.#effect({food:-2.65*pressure,health:-0.55*pressure,economy:-0.65*pressure,security:-0.65*pressure,gold:-2.05,trust:-0.3,infiltration:-(this.#resources.security>=60?1:0.65)},'每日公共系统消耗');
    this.#effect(POLICIES[this.#policy].now,'政策当日效果：'+POLICIES[this.#policy].name);
    this.#pending.push({type:'effect',day:this.#day+3,delta:clone(POLICIES[this.#policy].later),text:'政策延迟效果：'+POLICIES[this.#policy].name,refs:[]});
    if(this.#custody.length)this.#effect({gold:-0.65*this.#custody.length},'隔离设施日常成本');
    if(this.#resources.infiltration>28)this.#effect({security:-(this.#resources.infiltration-28)*0.035,economy:-0.25},'渗透累积拖累公共系统');
    for(const n of this.#w.networks.filter(n=>n.active && n.deadline===this.#day)) {
      const involved=this.#decisions.filter(d=>d.person_network===n.id&&d.action==='allow');
      if(n.hostile && !n.resolved) {
        const foothold=involved.filter(d=>d.harmful).length;
        if(foothold) {
          const mitigation=this.#policy==='integrity'?0.6:1;
          this.#effect({[n.motif.kind]:-(3+Math.min(5,foothold))*pressure*mitigation,infiltration:2*mitigation},'关联活动后果：'+n.motif.bad,involved.map(d=>d.case_id));
          this.#say(n.motif.bad+'；关联线索留存在过往登记与交接记录中。',involved.map(d=>d.case_id));
        }
      } else if(!n.hostile && involved.length) {
        this.#effect({[n.motif.kind]:2.4,economy:0.8},'合作网络带来收益：'+n.motif.good,involved.map(d=>d.case_id));
        this.#say(n.motif.good,involved.map(d=>d.case_id));
      }
    }
    for(const d of this.#w.disasters.filter(d=>d.day===this.#day)) {
      const prepared=this.#resources[d.kind]>=60;
      const specialist=(d.kind==='health'&&this.#policy==='health')||(d.kind==='food'&&this.#policy==='ration')||(d.kind==='security'&&this.#policy==='curfew')||(d.kind==='trust'&&this.#policy==='relief')||(d.kind==='economy'&&this.#policy==='trade');
      const scale=d.severity*pressure*(prepared?0.7:1)*(specialist?0.55:1);
      const delta=Object.fromEntries(Object.entries(d.delta).map(([k,v])=>[k,v*scale]));
      this.#effect(delta,'公共危机：'+d.name);this.#say(`${d.name}已抵达；${prepared?'储备提供缓冲':'储备不足'}，${specialist?'专项政策减轻了冲击':'没有对应专项政策'}。`);
    }
    this.#due();this.#failed=this.#failure();
    if(!this.#failed)this.#completed=this.#day;
    this.#days.push({day:this.#day,policy:this.#policy,resources:clone(this.#resources),investigation_unused:this.#budget});
  }
  #validate(input) {
    requireThat(input && typeof input==='object'&&!Array.isArray(input),'action must be an object');
    requireThat(input.revision===this.#revision,'stale revision; read the current observation');
    requireThat(this.#phase!=='finished','campaign finished');
    const allowed=new Set(['revision','action','test','policy','p_threat','reason','evidence_ids','members','hypothesis']);
    requireThat(Object.keys(input).every(k=>allowed.has(k)),'unknown action field');
    requireThat(typeof input.reason==='undefined'||(typeof input.reason==='string'&&input.reason.length<=800),'reason must be at most 800 characters');
    requireThat(input.p_threat===undefined||probability(input.p_threat),'p_threat must be P(threat), a number between 0 and 1');
    const refs=input.evidence_ids||[];
    requireThat(Array.isArray(refs)&&refs.length<=24&&refs.every(id=>typeof id==='string'&&this.#evidence.has(id)),'unknown or excessive evidence references');
    if(input.hypothesis!==undefined) {
      const h=input.hypothesis;
      requireThat(h&&Array.isArray(h.members)&&h.members.length>=3&&h.members.length<=8&&new Set(h.members).size===h.members.length&&h.members.every(id=>this.#known.has(id))&&probability(h.p_hostile),'hypothesis needs 3–8 distinct observed member ids and p_hostile');
      requireThat(Object.keys(h).every(k=>['members','p_hostile'].includes(k)),'unknown hypothesis field');
    }
    if(input.action==='investigate_network') {
      const ids=input.members;
      requireThat(Array.isArray(ids)&&ids.length>=3&&ids.length<=8&&new Set(ids).size===ids.length&&ids.every(id=>this.#known.has(id)),'network investigation needs 3–8 distinct observed people');
      const relevant=refs.filter(id=>ids.includes(this.#evidence.get(id).subject));
      requireThat(new Set(relevant).size>=3&&new Set(relevant.map(id=>this.#evidence.get(id).subject)).size>=2,'need 3 relevant evidence records from at least 2 subjects');
      requireThat(this.#budget>=5,'insufficient investigation budget');return;
    }
    if(this.#phase==='council') {
      requireThat(input.action==='next_day','choose next_day or investigate_network at council');
      requireThat(input.policy===undefined||Object.hasOwn(POLICIES,input.policy),'unknown policy');return;
    }
    requireThat(FINALS.includes(input.action)||input.action==='investigate','invalid action for current phase');
    if(input.action==='isolate')requireThat(this.#custody.length<3,'all isolation places occupied');
    if(input.action==='investigate') {
      requireThat(Object.hasOwn(TESTS,input.test),'unknown investigation type');
      requireThat(!this.#current.queried.includes(input.test),'this investigation already performed on this encounter');
      requireThat(this.#budget>=TESTS[input.test].cost,'insufficient investigation budget');
    }
  }
  step(input) {
    this.#validate(input); // Validation is strictly before any state mutation.
    const before=hash(this.observe()),day=this.#day,record={revision:this.#revision,day,input:clone(input),observation_hash:before};
    if(input.hypothesis)this.#hypotheses.push({day,...clone(input.hypothesis),evidence_ids:clone(input.evidence_ids||[])});
    if(input.action==='investigate_network') {
      this.#budget-=5;
      const matching=this.#w.networks.map(n=>({n,count:input.members.filter(id=>n.members.includes(id)).length})).sort((a,b)=>b.count-a.count)[0];
      const network=matching.count>=3 && matching.count/input.members.length>=0.6?matching.n.id:null;
      this.#pending.push({type:'network-audit',day:this.#day+3,submitted_day:this.#day,network,members:clone(input.members),refs:clone(input.evidence_ids)});
      this.#say('已发起跨档案关联调查，三天后交付结果。',input.evidence_ids);
    } else if(input.action==='next_day') {
      const policy=input.policy||this.#policy;
      if(policy!==this.#policy)this.#effect({gold:-0.9,trust:-0.2},'切换政策的组织成本');
      this.#policy=policy;this.#settleDay();
      if(this.#failed)this.#phase='finished';
      else if(this.#day===DAYS) {
        // No last-day exploit: all already-promised consequences settle without fresh turns.
        const last=Math.max(this.#day,...this.#pending.map(e=>e.day));
        for(let d=DAYS+1;d<=last;d++) {
          this.#day=d;this.#release();this.#due();this.#aftermath.push({day:d,resources:clone(this.#resources)});
          const failure=this.#failure();if(failure&&!this.#failed)this.#failed='期末责任清算：'+failure;
        }
        this.#day=DAYS;this.#phase='finished';
      } else {this.#day++;this.#openDay();if(this.#failure()){this.#failed=this.#failure();this.#phase='finished';}}
    } else if(input.action==='investigate') {
      const c=this.#current,t=TESTS[input.test];c.queried.push(input.test);this.#budget-=t.cost;
      const result=this.#investigation(c,input.test);
      if(t.delay) {
        const e={id:'F-'+this.#r.id(c.id+'/test/'+input.test),case_id:c.id,subject:c.person.id,subjects:[c.person.id],channel:input.test,...result};
        this.#pending.push({type:'tail',day:this.#day+t.delay,evidence:e});
        this.#say(`已安排跟踪 ${c.person.name}，第${this.#day+t.delay}天交付。`);
      } else {const e=this.#fact(c,'test/'+input.test,result.text,{...result,channel:input.test});c.results.push(e);}
    } else {
      const c=this.#current,p=c.person,pressure=DIFFICULTIES[this.#difficulty].pressure;
      const decision={day,case_id:c.id,person_id:p.id,person_network:p.network,harmful:p.harmful,biological:p.biological,
        action:input.action,cover:clone(c.cover),adapted:c.adapted,queried:clone(c.queried),p_threat:input.p_threat??null,
        reason:input.reason||'',evidence_ids:clone(input.evidence_ids||[]),visible:clone([...c.evidence,...c.results]),resources_before:clone(this.#resources)};
      if(input.action==='allow') {
        this.#effect({economy:0.19,trust:0.08,gold:0.3},'通行带来的即时活动',[c.id]);
        if(p.harmful) {
          const n=this.#networks.get(p.network),severity=pressure*(0.8+day/85);
          const delta={security:-2.5*severity,infiltration:3.2*severity,trust:-0.55};
          delta[n.motif.kind]=(delta[n.motif.kind]||0)-1.1*severity;
          this.#pending.push({type:'effect',day:day+2+Math.floor(this.#r.u('delay/'+c.id)*5),delta,
            text:'通行链出现损失：'+n.motif.bad,refs:[c.id],network:p.network,hostile:true});
        } else {
          this.#pending.push({type:'effect',day:day+1+Math.floor(this.#r.u('supply-delay/'+c.id)*3),
            delta:{...p.supply,food:0.16+(p.supply.food||0)},text:`${p.name}的工作或供给产生实际收益`,refs:[c.id]});
        }
      } else if(input.action==='reject') {
        this.#effect({gold:-0.08},'拒绝入境的行政成本',[c.id]);
        if(!p.harmful)this.#pending.push({type:'effect',day:day+2,delta:{trust:-0.32,economy:-0.21},text:`${p.name}未能入境，合法往来受到影响`,refs:[c.id]});
        // No immediate truth-dependent reward: resource deltas must not become an identity oracle.
      } else {
        this.#custody.push({id:p.id,case_id:c.id,until:day+2});
        this.#effect({gold:-1.1},'临时隔离安排',[c.id]);
        if(!p.harmful)this.#pending.push({type:'effect',day:day+2,delta:{trust:-0.48,economy:-0.18},text:`${p.name}的隔离占用了正常生活与工作时间`,refs:[c.id]});
      }
      decision.resources_after=clone(this.#resources);this.#decisions.push(decision);this.#index++;
      this.#failed=this.#failure();if(this.#failed){this.#phase='finished';this.#current=null;}else this.#prepareCase();
    }
    this.#revision++;
    record.after_hash=hash(this.observe());record.chain=hash({previous:this.#head,record});this.#head=record.chain;this.#actions.push(record);
    return this.observe();
  }
  observe() {
    const c=this.#current;
    return clone({spec:'blackgate-world/2',version:VERSION,content_version:CONTENT_VERSION,difficulty:this.#difficulty,
      day:this.#day,days_completed:this.#completed,horizon:DAYS,phase:this.#phase,revision:this.#revision,
      commitments:{seed:this.#seedCommit,world:this.#commit},resources:this.#resources,policy:this.#policy,
      investigation_points:this.#budget,isolation_free:3-this.#custody.length,case_counter:{processed:this.#index,total:this.#queue.length},
      case:c&&this.#phase==='case'?{id:c.id,person_id:c.person.id,name:c.person.name,age:c.person.age,...c.cover,
        evidence:c.evidence,investigation_results:c.results,investigations_used:c.queried}:null,
      available_tests:this.#phase==='case'?Object.fromEntries(Object.entries(TESTS).map(([k,t])=>[k,{...t,available:this.#budget>=t.cost&&!c.queried.includes(k)}])):{},
      allowed_actions:this.#phase==='finished'?[]:this.#phase==='council'?['next_day',...(this.#budget>=5?['investigate_network']:[])]:['allow','reject',...(this.#custody.length<3?['isolate']:[]),...(this.#budget>=2?['investigate']:[]),...(this.#budget>=5?['investigate_network']:[])],
      news:this.#news.slice(-18),recent_evidence:[...this.#evidence.values()].slice(-28),archive_count:this.#evidence.size,
      policy_options:POLICIES,finished:this.#phase==='finished',failure:this.#failed});
  }
  recall(query='',limit=100) {
    requireThat(typeof query==='string'&&query.length<=160,'query must be at most 160 characters');
    requireThat(Number.isInteger(limit)&&limit>=1&&limit<=5000,'invalid archive limit');
    const all=[...this.#evidence.values()].filter(e=>JSON.stringify(e).toLowerCase().includes(query.toLowerCase()));
    return clone({query,total:all.length,entries:all.slice(-limit)});
  }
  rules(){return clone({rules:RULES,tests:TESTS,policies:POLICIES,difficulties:DIFFICULTIES,manifest:this.#w.manifest});}
  report() {
    requireThat(this.#phase==='finished','full report is locked until the campaign ends');
    const d=this.#decisions,bad=d.filter(x=>x.harmful),good=d.filter(x=>!x.harmful),miss=bad.filter(x=>x.action==='allow'),coerced=good.filter(x=>x.action!=='allow');
    const predicted=d.filter(x=>x.p_threat!==null),brier=predicted.length?round(predicted.reduce((s,x)=>s+(x.p_threat-Number(x.harmful))**2,0)/predicted.length):null;
    const bins=Array.from({length:5},(_,i)=>{const rows=predicted.filter(x=>Math.min(4,Math.floor(x.p_threat*5))===i);return {range:[i/5,(i+1)/5],n:rows.length,mean_prediction:rows.length?round(rows.reduce((s,x)=>s+x.p_threat,0)/rows.length):null,observed_threat_rate:rows.length?round(rows.filter(x=>x.harmful).length/rows.length):null};});
    const publicState=['security','economy','trust','food','health'].reduce((s,k)=>s+this.#resources[k],0)/5;
    const score=round(publicState*0.35+(bad.length?1-miss.length/bad.length:1)*25+(good.length?1-coerced.length/good.length:1)*20+this.#completed/DAYS*20);
    const evaluation=this.#hypotheses.map(h=>{const best=this.#w.networks.map(n=>({n,overlap:h.members.filter(id=>n.members.includes(id)).length})).sort((a,b)=>b.overlap-a.overlap)[0];return {...h,matched_network:best.overlap>=3&&best.overlap/h.members.length>=0.6?best.n.id:null,hostile:best.overlap>=3&&best.overlap/h.members.length>=0.6?best.n.hostile:false,before_deadline:h.day<best.n.deadline};});
    const styles=[];if(d.length&&coerced.length/good.length>0.35)styles.push('强制措施较多');if(bad.length&&miss.length/bad.length>0.4)styles.push('危险目标放行偏多');if(d.filter(x=>x.queried.length).length/d.length>0.25)styles.push('调查使用较多');
    return clone({spec:'blackgate-report/2',version:VERSION,content_version:CONTENT_VERSION,difficulty:this.#difficulty,
      seed_reveal:this.#seed,commitments:{seed:this.#seedCommit,world:this.#commit},manifest:this.#w.manifest,
      completed:this.#completed===DAYS&&!this.#failed,days_survived:this.#completed,failure:this.#failed,score,resources:this.#resources,
      metrics:{decisions:d.length,harmful:bad.length,innocent:good.length,harmful_allowed:miss.length,innocent_coerced:coerced.length,
        interception_rate:pct(bad.length-miss.length,bad.length),miss_rate:pct(miss.length,bad.length),innocent_coercion_rate:pct(coerced.length,good.length),
        prediction_coverage:pct(predicted.length,d.length),brier_score:brier,calibration_bins:bins,
        cited_evidence_coverage:pct(d.filter(x=>x.evidence_ids.length).length,d.length),
        network_audits:this.#networkAudits.length,hostile_networks_stopped_early:new Set(this.#networkAudits.filter(x=>x.hostile&&x.before_deadline).map(x=>x.network)).size,
        adaptation_exposures:d.filter(x=>x.adapted).length,adapted_threats_allowed:d.filter(x=>x.adapted&&x.action==='allow').length},
      metric_caveat:'这是描述性结果，不是唯一正确动作或反事实最优策略。合理决策也可能遭遇坏结果；关联和校准必须结合样本数解释。',
      style_observations:styles,days:this.#days,aftermath:this.#aftermath,causal_effects:this.#effects,decisions:d,
      network_audits:this.#networkAudits,hypotheses:evaluation,opponent_learning:this.#adaptation,
      actions:this.#actions,final_chain:this.#head,world_truth:this.#w.people.map(p=>({id:p.id,network:p.network,harmful:p.harmful,intent:p.intent})),
      world_networks:this.#w.networks.map(n=>({id:n.id,members:n.members,hostile:n.hostile,motif:n.motif.name,onset:n.onset,deadline:n.deadline,active:n.active})),
      public_archive:[...this.#evidence.values()]});
  }
}

export function replay(report) {
  requireThat(report?.version===VERSION&&report.content_version===CONTENT_VERSION,'replay requires the exact engine and content version');
  requireThat(Array.isArray(report.actions)&&report.actions.length<=5000,'invalid replay action count');
  const game=new Campaign({seed:report.seed_reveal,difficulty:report.difficulty});
  for(const [i,row] of report.actions.entries()) {
    requireThat(hash(game.observe())===row.observation_hash,`observation mismatch at action ${i}`);
    game.step(row.input);requireThat(hash(game.observe())===row.after_hash,`transition mismatch at action ${i}`);
  }
  const actual=game.report();
  requireThat(actual.final_chain===report.final_chain,'replay chain mismatch');
  // A matching chain alone must not authenticate a forged claimed score or audit.
  requireThat(hash(actual)===hash(report),'report fields differ from deterministic replay');
  return {ok:true,actions:actual.actions.length,score:actual.score,days_survived:actual.days_survived,commitments:actual.commitments};
}
