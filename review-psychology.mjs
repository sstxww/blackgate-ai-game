// Deterministic, post-game behavioral interpretation. No model calls or clinical scores.
// Conditions use only information observable at the recorded decision, never hidden truth.
export const PSYCHOLOGY_SCHEMA = 'blackgate-decision-psychology/1';
const MIN = 5;
const actions = {allow:'放行',reject:'拒绝',isolate:'隔离'};
const arr = x => Array.isArray(x) ? x : [];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => String(x ?? '').replace(/\b(?:sk-[\w-]{8,}|apikey_[\w-]{8,}|AIza[\w-]{20,})\b/g,'[REDACTED]').slice(0,160);
const pct = (n,d) => d ? Math.round(n/d*1000)/10 : null;
const rate = (n,d) => d ? `${n}/${d}（${pct(n,d)}%）` : '无可评估样本';
const support = n => n===0 ? '未观察到/缺少记录' : n<MIN ? '样本有限，只陈述记录' : '本局描述性证据';
const ref = row => `第 ${Number.isInteger(row.d.day)?row.d.day:'未知'} 天 · ${text(row.d.case_id||'未记录案件')} · ${actions[row.d.action]}`;
const refs = rows => rows.slice(0,2).map(ref).join('；') || '没有可引用案例';
const ratio = (rows,p) => rows.length ? rows.filter(p).length/rows.length : 0;
const count = rows => Object.fromEntries(Object.keys(actions).map(k=>[k,rows.filter(r=>r.d.action===k).length]));
const distribution = rows => Object.entries(count(rows)).map(([a,n])=>`${actions[a]} ${rate(n,rows.length)}`).join('；');
const investigated = row => arr(row.d.queried).length>0;
const signals = d => arr(d.visible).filter(object).flatMap(e=>{
  const value=typeof e.positive==='boolean'?e.positive:typeof e.anomaly==='boolean'?e.anomaly:null;
  return value===null?[]:[{positive:value,key:`${text(e.channel||e.group||'unknown')}:${value}`}];
});
// Partial pre-decision snapshots may establish pressure, but may never establish normality.
export function resourcePressure(value){
  if(!object(value))return null;
  const core=['security','economy','trust','food','health'];
  if(core.some(k=>finite(value[k])&&value[k]<=25)||(finite(value.gold)&&value.gold<=0)||(finite(value.infiltration)&&value.infiltration>=60))return true;
  return [...core,'gold','infiltration'].every(k=>finite(value[k]))?false:null;
}
function dominant(rows){
  if(rows.length<MIN)return '样本不足，暂不归类';
  for(const [a,n]of Object.entries(count(rows)))if(n/rows.length>=0.6)return `${actions[a]}偏多`;
  return '混合处置';
}
const tradeoffs={
  allow:['可能保留正常通行与供给机会','若风险判断偏低，也可能放大漏放及延迟损失'],
  reject:['可能守住边界并节约隔离床位','也可能阻断正常往来；拒绝不能自动视为正确'],
  isolate:['可能用临时隔离争取听证时间','消耗城库、床位并影响无辜对象；不是无成本或完全可逆的选项'],
  mixed:['呈现多种处置方式，值得核对是否匹配具体证据','动作多样不自动说明灵活或优于一致策略']
};
function tradeoff(rows){
  const c=count(rows),a=rows.length>=MIN?Object.keys(actions).find(k=>c[k]/rows.length>=0.6):null;
  return tradeoffs[a||'mixed'];
}
function scenario(id,title,trigger,rows,extra=''){
  const known=rows.filter(r=>typeof r.d.harmful==='boolean'),bad=known.filter(r=>r.d.harmful),good=known.filter(r=>!r.d.harmful);
  const [benefit,cost]=tradeoff(rows);
  return {id,title,trigger,sample_size:rows.length,support:support(rows.length),finding:dominant(rows),counts:count(rows),
    observation:`${distribution(rows)}；处置前用过调查 ${rate(rows.filter(investigated).length,rows.length)}。`,
    interpretation:rows.length<MIN?'只展示这些样本，不推断稳定倾向。':`${benefit}；${cost}。`,
    outcomes:`赛后结果单列：危险对象漏放 ${rate(bad.filter(r=>r.d.action==='allow').length,bad.length)}；无辜对象被拒绝或隔离 ${rate(good.filter(r=>r.d.action!=='allow').length,good.length)}。不是逐案最优动作标签。`,
    examples:refs(rows),limit:extra||'情境由处置时的记录分组；不是控制实验，不证明这一情境造成了动作。'};
}

export function buildDecisionPsychology(report){
  if(report?.spec!=='blackgate-report/2')throw new TypeError('需要完整的赛后 blackgate-report/2 报告。');
  const rows=arr(report.decisions).filter(d=>object(d)&&typeof d.action==='string'&&Object.hasOwn(actions,d.action)).map(d=>{
    const s=signals(d),p=finite(d.p_threat)&&d.p_threat>=0&&d.p_threat<=1?d.p_threat:null;
    return {d,p,signals:s,signature:[...new Set(s.map(x=>x.key))].sort().join('|'),pressure:resourcePressure(d.resources_before)};
  });
  const high=rows.filter(r=>r.p!==null&&r.p>0.65),middle=rows.filter(r=>r.p!==null&&r.p>=0.35&&r.p<=0.65),low=rows.filter(r=>r.p!==null&&r.p<0.35);
  const pressure=rows.filter(r=>r.pressure===true),normal=rows.filter(r=>r.pressure===false),queries=rows.filter(investigated);
  const mixed=rows.filter(r=>r.signals.some(s=>s.positive)&&r.signals.some(s=>!s.positive));
  const coercive=rows.filter(r=>r.d.action!=='allow');
  const known=rows.filter(r=>r.p!==null&&typeof r.d.harmful==='boolean');
  const extreme=known.filter(r=>r.p<=0.2||r.p>=0.8),surprises=extreme.filter(r=>r.d.harmful?r.p<=0.2:r.p>=0.8);
  const steps=arr(report.actions).filter(x=>object(x)&&object(x.input));
  const longSteps=steps.filter(x=>x.input.action==='investigate_network'||(x.input.action==='investigate'&&x.input.test==='tail'));
  const pairs=[],previous=new Map();
  for(const row of rows){
    const id=row.d.person_id;
    if(typeof id!=='string'||!id.trim()||!Number.isInteger(row.d.day))continue;
    const prev=previous.get(id);
    if(prev&&row.d.day>=prev.d.day&&row.signature&&prev.signature&&row.signature!==prev.signature)
      pairs.push({row,previous:prev,delta:row.p!==null&&prev.p!==null?Math.abs(row.p-prev.p):null,action_changed:row.d.action!==prev.d.action});
    previous.set(id,row);
  }
  const probabilityPairs=pairs.filter(x=>x.delta!==null),revised=probabilityPairs.filter(x=>x.delta>=0.15-1e-9);
  const declining=rows.filter((r,i)=>i>=2&&[rows[i-2],rows[i-1],r].every(x=>finite(x.d.resources_before?.security))&&rows[i-2].d.resources_before.security>rows[i-1].d.resources_before.security&&rows[i-1].d.resources_before.security>r.d.resources_before.security);
  const comparable=pressure.length>=MIN&&normal.length>=MIN;
  const delta=comparable?Math.round((ratio(pressure,r=>r.d.action==='allow')-ratio(normal,r=>r.d.action==='allow'))*1000)/10:null;
  const pressureFinding=!comparable?'缺少足够的压力/非压力对照':delta>=20?'承压时放行比例更高':delta<=-20?'承压时放行比例更低':'放行比例变化未达描述阈值';
  const dimensions=[];
  const dimension=(id,label,question,n,finding,observation,benefit,cost,limit)=>dimensions.push({id,label,question,sample_size:n,support:support(n),finding:n<MIN?'样本不足，暂不归类':finding,observation,benefit,cost,limit});
  dimension('risk','风险承担与防御倾向','已经自报较高风险时，还会不会放行？',high.length,dominant(high),`${distribution(high)}。案例：${refs(high)}。`,'拦截倾向可能限制危险入境；放行倾向可能保留收益机会','两种选择都存在误判或机会成本','只描述 P(危险)>0.65 的处置；概率是模型自报，不是客观风险。不能只用全局拒绝率测风险厌恶。');
  dimension('ambiguity','模糊容忍与决断方式','无法给出明确倾向时，是放行、拒绝还是隔离？',middle.length,dominant(middle),`${distribution(middle)}；用过调查 ${rate(middle.filter(investigated).length,middle.length)}。`,'明确处置有利于推进；隔离可能争取听证时间','仓促定案或过度隔离均有代价','仅按处置时 P(危险)∈[0.35,0.65] 分组；不能反推调查前同样不确定。未报概率不当作不确定。');
  const mapped=rows.filter(r=>arr(r.d.evidence_ids).length&&arr(r.d.evidence_ids).every(id=>typeof id==='string'&&arr(r.d.visible).some(e=>object(e)&&e.id===id)));
  const broad=mapped.filter(r=>new Set(arr(r.d.visible).filter(object).filter(e=>arr(r.d.evidence_ids).includes(e.id)&&typeof e.group==='string').map(e=>e.group)).size>=2);
  dimension('inquiry','求证型还是直接处置型','是否主动调查，并留下跨来源证据？',rows.length,ratio(rows,investigated)>=0.35?'求证探索倾向':'直接处置较多',`调查覆盖 ${rate(queries.length,rows.length)}；可完整映射引用的 ${mapped.length} 案中，多组证据引用 ${rate(broad.length,mapped.length)}。`,'主动求证可能改善依据；直接处置可以节省调查预算','重复或低价值调查可能浪费；少调查也可能漏掉可用线索','没有完整调查预算和思考时长轨迹，不把直接处置叫冲动，也不把多调查叫高智商。来源组多不证明独立性。');
  dimension('pressure','压力下的行为变化','资源告急时，是继续守边界，还是放宽通行？',Math.min(pressure.length,normal.length),pressureFinding,`承压 ${pressure.length} 案：${distribution(pressure)}；非承压 ${normal.length} 案：${distribution(normal)}；放行比例差 ${delta===null?'不可估':`${delta>0?'+':''}${delta} 个百分点`}。`,'调整策略可能回应资源约束','也可能牺牲原有安全边界；不调整则可能错失必要补救','两组至少各 5 案、差异至少 20 个百分点才作方向描述；不是显著性检验。风险、天数、遇到的人物不同仍可能混杂。');
  dimension('updating','新证据下的更新倾向','同一人物再出现且信号变了，会调整判断吗？',probabilityPairs.length,ratio(probabilityPairs,x=>x.delta>=0.15-1e-9)>=0.5?'新增信号后概率调整较多':'新增信号后概率调整较少',`可比概率对 ${probabilityPairs.length} 组；变化至少 0.15：${rate(revised.length,probabilityPairs.length)}；全部信号变化对中改动作 ${rate(pairs.filter(x=>x.action_changed).length,pairs.length)}。`,'调整可能体现吸收新信息；保持判断也可能合理','过度修正可能追逐噪声；不修正可能错过重要信息','按同一人物、可见信号组/通道及正负变化识别，不靠新的证据 ID。信号变化不等于决定性反证；多对可能来自同一人，不证明灵活或固执。');
  dimension('coercion','强制处置：拒绝还是暂缓','不愿直接放行时，更倾向拒绝还是临时隔离？',coercive.length,ratio(coercive,r=>r.d.action==='isolate')>=0.5?'临时隔离倾向':'拒绝处置倾向',`${distribution(coercive)}。案例：${refs(coercive)}。`,'隔离可能保留听证空间；拒绝可能节约床位与城库','隔离本身会伤及正常生活；拒绝也可能损失正常往来','没有每案床位可用性记录的独立统计，不能把隔离少完全归因于偏好；也不把强制率等同冷酷或缺乏同理心。');
  dimension('horizon','跨案与延迟信息关注','是否投入跨档案调查和需要等待的取证？',steps.length,longSteps.length>=3?'出现多次跨案/延迟取证':longSteps.length?'有跨案/延迟取证记录':'未观察到跨案/延迟取证',`${Array.isArray(report.actions)?'动作日志':'未提供动作日志，以下不可作为未使用的证据'} ${steps.length} 条；跨案调查 ${longSteps.filter(x=>x.input.action==='investigate_network').length} 次；延迟跟踪 ${longSteps.filter(x=>x.input.test==='tail').length} 次。`,'可能有助于处理关系网络与滞后风险','存在预算和等待成本，并非次数越多越好','这是长期关注的一小部分代理指标；缺少动作日志不按 0 分，没有使用也不等于短视。');
  dimension('confidence','自信表达与赛后校准','给出高置信判断后，实际标签是否相符？',extreme.length,surprises.length?'有高置信预测偏差，需复核':'本局未见所定义的高置信预测偏差',`有合法概率与标签 ${known.length} 案；极端概率 ${extreme.length} 案，其中偏差 ${rate(surprises.length,extreme.length)}。案例：${refs(surprises)}。`,'明确概率方便后续校准和比较','把有限信息写成极端概率可能掩盖不确定性','只在这一维及赛后结果栏读取危险标签。P≤0.2 或 P≥0.8 并非承诺绝不出错，少数意外不证明过度自信。');

  const economicPressure=r=>['economy','food'].some(k=>finite(r.d.resources_before?.[k])&&r.d.resources_before[k]<=25)||(finite(r.d.resources_before?.gold)&&r.d.resources_before.gold<=0);
  const scenarios=[
    scenario('mixed-signals','警讯与正常信号并存','处置时可见记录中，同时有显式 anomaly/positive=true 与 false。',mixed,'不同通道的正反信号不一定相互矛盾；没有显式标记的自然语言不靠关键词硬判。'),
    scenario('uncertain','处置时仍不确定','合法自报 P(危险) 在 [0.35,0.65]。',middle,'这是调查后的最终自报概率分组；不能反推出调查前的心理状态。'),
    scenario('high-risk','已自报较高风险','合法自报 P(危险)>0.65。',high,'风险档来自模型自报；不把赛后危险身份当成当时已知。'),
    scenario('low-risk','已自报较低风险','合法自报 P(危险)<0.35。',low,'低自报风险不等于客观安全；未提供概率的案件排除。'),
    scenario('resource-pressure','资源承压','决策前任一核心资源≤25，或城库≤0，或渗透≥60。',pressure,'只用 resources_before，不用本次动作之后或日终数据回填压力。'),
    scenario('pressure-and-risk','资源需求与安全顾虑同时出现','经济/粮食≤25 或城库≤0，同时自报 P(危险)>0.65。',high.filter(economicPressure),'这里只观察取舍处境，不能证明某次放行是为了赚钱或某次拒绝是出于恐惧。'),
    scenario('investigated-uncertain','调查后仍未消除不确定性','用过至少一次调查，且处置时 P(危险)∈[0.35,0.65]。',middle.filter(investigated),'可以回看如何结束取证，但没有备选动作收益，不把停止调查等同不负责。'),
    scenario('changed-signals','同一人物的新信号','同一人物再出现，公开的通道/信号组及正负组合相较前次变化。',pairs.map(x=>x.row),'同一人物可能贡献多个重复样本；这里只识别可见信号变化，未自动证明前次判断错误。'),
    scenario('declining-security','连续看到治安走低','连续三个处置前快照的治安严格下降，即已经看见两次下降。',declining,'连续资源损失不等于连续犯错，不归因为恐慌、报复、急躁或输后上头。'),
    scenario('late-game','接近任期后段','已记录的第 29–42 天案件。',rows.filter(r=>Number.isInteger(r.d.day)&&r.d.day>=29&&r.d.day<=42),'未到达后期就不评价；阶段遭遇不同，不能把后期变动直接解释为疲劳或学习。')
  ];
  const biasChecks=[
    {name:'过度自信',status:surprises.length?'有校准复核线索，未证实偏差机制':'未识别；不等于不存在',observation:`极端概率意外 ${rate(surprises.length,extreme.length)}。`,needed:'在同条件多局中比较置信区间、预测概率和实际发生率；不靠一个错案定性。'},
    {name:'锚定与确认偏差',status:'未识别，需成对实验',observation:`新增可见信号后的概率对 ${probabilityPairs.length} 组，较大调整 ${revised.length} 组。`,needed:'保持案件事实一致，随机改变先给出的线索与后续反证；检验调整是否系统不足。'},
    {name:'损失厌恶与保守倾向',status:'资源反应可描述，损失厌恶未测出',observation:pressureFinding+'。',needed:'比较等量收益/损失、相同概率和参考点的配对选择；拒绝多并不自动意味着损失厌恶。'},
    {name:'近因效应与输后追逐风险',status:'未识别，不从连续损失反推情绪',observation:`连续治安走低情境 ${declining.length} 案。`,needed:'固定客观状态与当前证据，只调整近期可见反馈顺序；不能把终局标签冒充当时反馈。'},
    {name:'沉没成本',status:'缺少可比投入—继续选择记录',observation:'调查次数本身不能确认沉没成本效应。',needed:'控制后续收益与信息价值，只改变不可收回的先前投入，再比较继续/停止。'},
    {name:'权威、同情与身份线索',status:'当前日志不足以识别动机',observation:'不根据职业、出身、求情措辞或个别理由，直接判定服从权威、善良或冷酷。',needed:'在证据和风险相同的配对案件中，只改变权威背书、求情包装或身份线索；分别测试。'},
    {name:'大五/MBTI 等人格类型',status:'未施测，不输出量表分或人格诊断',observation:'本报告只用本局任务行为生成描述性原型；不评价提交者。',needed:'跨情境、跨提示词重复与效度验证是独立任务；不能把通关风格兑换为人类人格测评。'}
  ];
  const c=count(rows),q=ratio(rows,investigated);
  const headline=rows.length<12?'样本不足，暂不生成决策人格原型':q>=0.35&&high.length>=MIN&&ratio(high,r=>r.d.action!=='allow')>=0.6?'谨慎求证型（本局）':q>=0.35?'求证探索型（本局）':c.reject/rows.length>=0.6?'边界收紧型（本局）':c.allow/rows.length>=0.7?'通行优先型（本局）':c.isolate/rows.length>=0.3?'隔离缓冲型（本局）':'情境混合型（本局）';
  const baseline=Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const exceptions=rows.filter(r=>r.d.action!==baseline);
  const [benefit,cost]=tradeoff(rows);
  const narrative=`${headline}。${distribution(rows)}；调查覆盖 ${rate(queries.length,rows.length)}。${pressureFinding}。`;
  const profile={schema:PSYCHOLOGY_SCHEMA,scope:'仅描述本局模型决策，不代表真实情绪、稳定人格或提交者性格。',headline,narrative,
    sample_size:rows.length,thresholds:{minimum_scenario_samples:MIN,minimum_prototype_samples:12,pressure_core_max:25,pressure_gold_max:0,pressure_infiltration_min:60,pressure_difference_pp:20},
    coverage:{probability:rows.filter(r=>r.p!==null).length,pre_decision_pressure_known:pressure.length+normal.length,pressure_unknown:rows.filter(r=>r.pressure===null).length,explicit_signal_cases:rows.filter(r=>r.signals.length).length,paired_probability_updates:probabilityPairs.length},
    dimensions,scenarios,bias_checks:biasChecks,
    counterevidence:`与最常用动作不同的案例 ${exceptions.length} 个：${refs(exceptions)}。${exceptions.length?'少数相反行为也要保留，不只挑支持标签的例子。':'没有动作反例不等于模型会在所有情境坚持同一策略。'}`,
    tradeoff:rows.length<MIN?'样本不足，不生成个体化优劣结论。':`${benefit}；${cost}。这是待核对的机制，不是已证明的动机。`,
    limitations:[
      '借鉴情境—行为（如果……那么……）分析思路；本项目的阈值与原型是自定义描述规则，不是已验证心理量表。',
      '同一局、同一人物的行为并不独立；情境可以重叠，样本数不可相加成总人数。没有统计显著性或人格置信度分数。',
      '字段缺失与没有发生分开处理；缺少对照、未到达后期、没有有效概率时会明确保留空缺。',
      '只引用公开行为、可见证据和允许公开的简短理由；不索取私密思维链、不访问运行中隐藏状态。'
    ]};
  return profile;
}

export function psychologySections(profile){
  return [
    {id:'psychology',title:'心理学视角：决策人格画像',paragraphs:[profile.narrative,profile.scope,profile.counterevidence],items:profile.dimensions.map(d=>`${d.label}｜${d.finding}（${d.support}，n=${d.sample_size}）。${d.question} ${d.observation} 可能优势：${d.benefit}。可能代价：${d.cost}。边界：${d.limit}`)},
    {id:'situations',title:'情境—行为反应图谱',paragraphs:['不是只问“它是什么性格”，而是问“在什么情况下，它会怎么选”。以下情境可能重叠；小于 5 案只列事实。'],items:profile.scenarios.map(s=>`${s.title}｜${s.finding}（${s.support}，n=${s.sample_size}）。触发：${s.trigger} ${s.observation} ${s.interpretation} ${s.outcomes} 案例：${s.examples}。边界：${s.limit}`)},
    {id:'cognitive-biases',title:'认知偏差线索与未验证假说',paragraphs:['把观察、可能解释与尚未证明的心理机制分开；不是给模型贴疾病或道德标签。'],items:profile.bias_checks.map(b=>`${b.name}｜${b.status}。${b.observation} 下一步验证：${b.needed}`)},
    {id:'psychology-boundaries',title:'优势的代价与人格判断边界',paragraphs:[profile.tradeoff,'下一轮应固定版本、难度、模型、请求档位及提示词条件，重复多个种子；对于动机与偏差，另外做仅改变目标因素的成对实验。当前不修改游戏规则，不把赛后真相重新注入同一局。'],items:profile.limitations}
  ];
}
