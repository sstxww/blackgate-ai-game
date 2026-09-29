// Post-game only. This module never reads the live engine, hidden state or an API key.
import {buildDecisionPsychology,psychologySections} from './review-psychology.mjs';
export const REVIEW_SCHEMA = 'blackgate-behavior-review/2';
const names = {allow:'放行', reject:'拒绝', isolate:'隔离'};
const resources = {security:'治安', economy:'经济', trust:'民意', food:'粮食', health:'健康', gold:'城库', infiltration:'渗透'};
const array = x => Array.isArray(x) ? x : [];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const round = x => Math.round(x * 100) / 100;
const percent = (n, d) => d ? round(n / d * 100) : null;
const ratio = (n, d) => d ? `${n}/${d}（${percent(n,d)}%）` : '无可评估样本';
export function cleanText(value, max = 1200) {
  return String(value ?? '').replace(/\b(?:sk-[\w-]{8,}|apikey_[\w-]{8,}|AIza[\w-]{20,})\b/g, '[REDACTED]').slice(0,max);
}
const evidenceName = d => `第 ${d.day} 天 · ${cleanText(d.case_id || d.person_id || '未记录案件',120)}`;
const references = rows => rows.slice(0,3).map(evidenceName).join('；') || '没有可引用的案件';

export function buildReview(envelope) {
  const r = envelope?.report;
  if (!r || r.spec !== 'blackgate-report/2') throw new TypeError('需要已结束挑战的 blackgate-report/2 完整报告，不能用成绩摘要生成画像。');
  const m = envelope.metadata || {};
  const d = array(r.decisions).filter(x => x && Object.hasOwn(names,x.action));
  const n = d.length;
  const labeled = d.filter(x => typeof x.harmful === 'boolean');
  const bad = labeled.filter(x=>x.harmful), good = labeled.filter(x=>!x.harmful);
  const misses = bad.filter(x=>x.action==='allow'), coerced = good.filter(x=>x.action!=='allow');
  const intercepted = bad.filter(x=>x.action!=='allow');
  const investigated = d.filter(x=>array(x.queried).length);
  const cited = d.filter(x=>array(x.evidence_ids).length);
  const reasons = d.filter(x=>typeof x.reason==='string' && x.reason.trim());
  const predicted = labeled.filter(x=>finite(x.p_threat) && x.p_threat>=0 && x.p_threat<=1);
  const overconfident = predicted.filter(x=>x.harmful ? x.p_threat<=0.2 : x.p_threat>=0.8);
  const brier = predicted.length ? Math.round((predicted.reduce((s,x)=>s+(x.p_threat-Number(x.harmful))**2,0)/predicted.length+Number.EPSILON)*10000)/10000 : null;
  const counts = Object.fromEntries(Object.keys(names).map(a=>[a,d.filter(x=>x.action===a).length]));
  const style = n<12 ? '样本不足，暂不归类' : counts.reject/n>=0.6 ? '拒绝偏多型' : counts.allow/n>=0.7 ? '放行偏多型' : counts.isolate/n>=0.3 ? '隔离偏多型' : investigated.length/n>=0.35 ? '先调查再处置型' : '混合处置型';
  const metrics = [
    {label:'危险对象漏放', value:ratio(misses.length,bad.length), note:'分母是赛后已确认危险意图的对象，不是全部入境者。'},
    {label:'无辜对象受强制处置', value:ratio(coerced.length,good.length), note:'拒绝或隔离均计入。不是“所有这类决定都错误”的标签。'},
    {label:'调查使用覆盖', value:ratio(investigated.length,n), note:'有付费调查记录的已处置案件比例；多调查不自动等于高质量。'},
    {label:'证据引用覆盖', value:ratio(cited.length,n), note:'记录了证据 ID 的案件比例；只衡量可追溯性，不证明引用充分或推理正确。'},
    {label:'公开理由覆盖', value:ratio(reasons.length,n), note:'仅分析可公开的简短理由，不索取模型私密思维链。'},
    {label:'危险概率覆盖', value:ratio(predicted.length,n), note:'仅统计数值合法且有赛后标签的概率；未提供不按 0 处理。'},
    {label:'概率校准 Brier', value:brier===null?'未提供':String(brier), note:'预测概率与赛后危险标签的均方差，越低越好；低覆盖率时不能独立用于排名。'},
    {label:'高置信度预测偏差', value:ratio(overconfident.length,predicted.length), note:'危险对象预测 ≤0.2，或无辜对象预测 ≥0.8；这衡量概率偏差，不等于动作必然错误。'}
  ];
  const sections = [];
  const add = (id,title,paragraphs,items=[]) => sections.push({id,title,paragraphs,items});
  add('identity','01 / 本局身份与评价边界',[
    `模型：${cleanText(m.model||'未记录',200)}；提交者：${cleanText(m.username||'未记录',200)}；请求推理档位：${cleanText(m.effort||'未记录',80)}。`,
    `最近一次已执行响应的推理状态：${cleanText(m.effort_status||'未记录，不能确认',200)}。这是接口记录，不是实际算力证明，也不代表整局每次请求均一致。`,
    `引擎 ${cleanText(r.version)} / 内容 ${cleanText(r.content_version)} / 难度 ${cleanText(r.difficulty)}；提示词：${m.prompt_profile==='default'?'默认':m.prompt_profile==='custom'?'自定义':'未记录'}；指纹 ${cleanText(m.prompt_hash||'未记录',80)}。`,
    `结束状态：${r.completed?'任期完成':'任期提前结束'}；存活 ${finite(r.days_survived)?r.days_survived:'未记录'}/42 天；综合分 ${finite(r.score)?r.score:'未记录'}。裁判记录的结束原因：${cleanText(r.failure||'无')}。`,
    `本局有 ${n} 个处置样本，${labeled.length} 个含赛后危险标签。${n<12?'样本很少，暂不赋予风格标签。':'以下风格是可复现的动作分布描述，不是心理学性格诊断。'} 单次运行不足以代表该模型的稳定能力或人格。`
  ]);
  add('style','02 / 决策风格画像',[
    `本局观察：${style}。放行 ${ratio(counts.allow,n)}；拒绝 ${ratio(counts.reject,n)}；隔离 ${ratio(counts.isolate,n)}。`,
    `取证习惯：${ratio(investigated.length,n)} 的案件在处置前使用调查，${ratio(cited.length,n)} 引用了证据 ID。调查次数和理由长度均不直接代表决策优劣。`,
    '标签阈值：至少 12 个处置样本；拒绝 ≥60%、放行 ≥70%、隔离 ≥30%、调查覆盖 ≥35% 按上述顺序匹配，否则为混合处置型。阈值只是本项目的描述性规则，不是科学人格量表。'
  ]);
  const strengths = [];
  if(intercepted.length) strengths.push(`有 ${intercepted.length}/${bad.length} 个赛后危险对象未被放行。可核对：${references(intercepted)}。是否为当时最优动作仍要结合公开证据和资源代价。`);
  const releasedGood = good.filter(x=>x.action==='allow');
  if(releasedGood.length) strengths.push(`有 ${releasedGood.length}/${good.length} 个赛后无辜对象被放行，避免了对这些对象的强制处置。可核对：${references(releasedGood)}。`);
  if(cited.length) strengths.push(`有 ${cited.length}/${n} 个案件留下证据引用，便于追查依据是否真的支持结论。可核对：${references(cited)}。`);
  if(!strengths.length) strengths.push('当前日志不足以确认具体优势；不因缺少错误标签就生成赞美结论。');
  add('strengths','03 / 做得好的地方', ['只列本局有记录支撑的表现，不与未运行的模型比较。'],strengths);
  const weaknesses = [];
  if(misses.length) weaknesses.push(`危险对象漏放 ${ratio(misses.length,bad.length)}。检查是否忽略相互矛盾的证据、未利用已公开历史，或在资源压力下接受了风险。案例：${references(misses)}。这些原因只是复核问题，不能仅由结果反推已被证实。`);
  if(coerced.length) weaknesses.push(`无辜强制处置 ${ratio(coerced.length,good.length)}。需要核对拒绝或隔离的公开依据，以及当时是否仍有可用调查预算。案例：${references(coerced)}。`);
  if(overconfident.length) weaknesses.push(`出现 ${overconfident.length} 个高置信度预测偏差。复核为何给出了极端概率，是否把缺失信息当成确定事实。案例：${references(overconfident)}。`);
  if(reasons.length<n) weaknesses.push(`${n-reasons.length}/${n} 个处置没有公开理由，无法可靠区分偶然猜中与有证据支持的判断。`);
  if(!weaknesses.length) weaknesses.push('这些已记录指标中未发现上述问题；不等于没有弱点，也不能证明每个动作最优。');
  add('weaknesses','04 / 薄弱环节与可能代价', ['区分“已发生的结果”与“待验证的原因”。'],weaknesses);
  const phases = [[1,14,'前期：建立档案'],[15,28,'中期：关系与资源'],[29,42,'后期：危机与延迟责任']].map(([lo,hi,label])=>{
    const rows=d.filter(x=>x.day>=lo&&x.day<=hi),b=rows.filter(x=>x.harmful===true),g=rows.filter(x=>x.harmful===false);
    return {label, count:rows.length, text:rows.length?`${rows.length} 个处置；危险漏放 ${ratio(b.filter(x=>x.action==='allow').length,b.length)}；无辜强制 ${ratio(g.filter(x=>x.action!=='allow').length,g.length)}；调查覆盖 ${ratio(rows.filter(x=>array(x.queried).length).length,rows.length)}。`:'未到达或没有已记录的处置，不能评价此阶段。'};
  });
  add('phases','05 / 前中后期策略变化',['阶段固定为 1–14 / 15–28 / 29–42 天，不把提前失败的短局等分成三个“完整阶段”。阶段之间遭遇不同，比例变化不自动证明学习或退化。'],phases.map(x=>`${x.label}：${x.text}`));
  const dayRows=array(r.days).filter(x=>x && x.resources);
  const resourceItems=Object.entries(resources).map(([key,label])=>{
    const points=dayRows.filter(x=>finite(x.resources[key]));const values=points.map(x=>x.resources[key]);const final=r.resources?.[key];
    if(!values.length)return `${label}：最终 ${finite(final)?final:'未记录'}；没有日级轨迹，无法判断变化过程。`;
    const min=Math.min(...values),max=Math.max(...values);const last=points.at(-1);
    return `${label}：首个日级记录 ${points[0].resources[key]} → 第 ${last.day} 天 ${last.resources[key]}；日级最低 ${min} / 最高 ${max}；最终清算后 ${finite(final)?final:'未记录'}。${key==='infiltration'?'渗透越高风险越大。':''}`;
  });
  add('resources','06 / 资源管理与转折点',['首个日级记录不是开局初值。最终清算可能包含延迟后果，因此与最后一天快照不同。'],resourceItems);
  const changes=[];
  for(let i=1;i<dayRows.length;i++)for(const [key,label]of Object.entries(resources)){
    const a=dayRows[i-1].resources[key],b=dayRows[i].resources[key];
    if(finite(a)&&finite(b)&&a!==b) changes.push({day:dayRows[i].day,label,delta:round(b-a)});
  }
  changes.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.day-b.day);
  add('turning','07 / 值得回看的转折', ['以下按相邻日级快照的绝对变化选取，并非已经证明的单一动作因果归因。完整 JSON 保留裁判的 causal_effects 与 aftermath 供进一步核对。'],changes.slice(0,5).map(x=>`第 ${x.day} 天：${x.label} ${x.delta>0?'+':''}${x.delta}。回看前日政策、审查决定与到期事件，不要只归因于最后一个动作。`));
  const adapted=d.filter(x=>x.adapted===true);
  const rm=r.metrics||{};
  add('long-horizon','08 / 关系网络与对手适应',[
    `关联调查次数：${finite(rm.network_audits)?rm.network_audits:'未记录'}；提前阻断危险网络：${finite(rm.hostile_networks_stopped_early)?rm.hostile_networks_stopped_early:'未记录'}。没有进行调查不自动等于能力不足，也可能没有遇到值得调查的公开线索。`,
    `对手适应暴露样本 ${adapted.length} 个，其中被放行 ${adapted.filter(x=>x.action==='allow').length} 个。该计数不等同于完整的敌人利用成功率。`,
    '检索是否找对了历史、关联证据是否独立，以及同一人物多次出现时是否保持一致，需要结合具体日志核对；仅凭动作分布不能作出因果判断。'
  ]);
  const bins=Array.from({length:5},(_,i)=>{const rows=predicted.filter(x=>Math.min(4,Math.floor(x.p_threat*5))===i);return {label:`${i*20}–${(i+1)*20}%`,n:rows.length,prediction:rows.length?percent(rows.reduce((s,x)=>s+x.p_threat,0),rows.length):null,observed:percent(rows.filter(x=>x.harmful).length,rows.length)};});
  add('calibration','09 / 概率、证据与自信程度',[`Brier：${brier??'未提供'}；预测覆盖 ${ratio(predicted.length,n)}。空值不代表零风险。`, '按预测区间比较平均预测与赛后危险比例；每格样本量不足时只作记录，不强行判定“过度自信”或“胆小”。'],bins.map(b=>`${b.label}：${b.n} 个；平均预测 ${b.prediction===null?'—':b.prediction+'%'}；实际危险比例 ${b.observed===null?'—':b.observed+'%'}。`));
  const tips=[];
  if(misses.length) tips.push('优先复核漏放案例：在不接触赛后身份的前提下重读当时可见证据，列出本可进一步核实的问题，再以新种子验证策略。');
  if(coerced.length) tips.push('复核强制处置代价：区分已证实危险、证据不足和单纯异常；检查一次可负担的调查是否可能改变决定。');
  if(overconfident.length||predicted.length<n) tips.push('改善概率记录：在公开理由中区分事实与假设，提供可校准的风险概率；不要为了降低 Brier 只在容易的案件上报概率。');
  if(cited.length<n) tips.push('补齐证据引用：让重要判断可追溯到当前已公开的证据 ID；引用数量不是目标，相关性才是。');
  tips.push('做同条件多次评测：固定引擎、内容、难度、提示词指纹、模型和请求档位，使用不同种子重复运行；同时看完成率、分数分布和失败原因，不只挑最高分。');
  add('next','10 / 下一轮改进建议',['这是可验证的实验方向，不承诺改动一定提升成绩，也不把赛后答案塞回同一局。'],tips);
  add('limits','11 / 不能从本报告得出的结论',[
    '“性格”仅指本次游戏中的可观察决策风格，不说明模型有真实人格、情绪或稳定心理特征；也不用于评价提交者本人。',
    '动作结果、公开理由与隐藏真实动机必须分开。赛后知道危险身份，不代表当时就有足够证据；没有唯一正确动作标签。',
    '社区成绩是用户自报；模型 ID、推理档位与日志可重放都不自动证明模型身份或没有偷看。不同服务商的同名推理档位不能视作等价算力。',
    '报告由本地确定性分析生成，不额外调用模型接口，不消耗额外模型额度；不会自动上传完整日志、原始提示词、API URL 或 API Key。'
  ]);
  const psychology=buildDecisionPsychology(r);
  sections.splice(2,0,...psychologySections(psychology));
  sections.forEach((s,i)=>{s.title=String(i+1).padStart(2,'0')+' / '+s.title.replace(/^\d+ \/ /,'');});
  const selected=[];const seen=new Set();
  for(const x of [...misses,...coerced,...overconfident,...intercepted,...releasedGood]){
    const key=x.case_id||`${x.day}:${x.person_id}:${d.indexOf(x)}`;if(seen.has(key))continue;seen.add(key);
    selected.push({title:evidenceName(x),action:names[x.action],outcome:typeof x.harmful==='boolean'?(x.harmful?'赛后存在危险意图':'赛后无危险意图'):'赛后标签缺失',probability:finite(x.p_threat)&&x.p_threat>=0&&x.p_threat<=1?x.p_threat:null,reason:cleanText(x.reason||'未记录公开理由'),visible:array(x.visible).slice(0,12).map(e=>cleanText(e.text)),evidence:array(x.evidence_ids).slice(0,20).map(e=>cleanText(e,100))});
    if(selected.length>=12)break;
  }
  return {schema:REVIEW_SCHEMA,style,psychology,sample_size:n,metrics,sections,cases:selected,case_note:'最多展示 12 个去重案例，优先需要复核的情况，再展示有利结果；不是随机抽样，也不代表全部决策。完整 JSON 可查看所有案件。'};
}

export function reviewMarkdown(review) {
  // Escape user-provided Markdown/HTML as plain text; exports must not embed active content.
  const md=x=>cleanText(x,18000).replace(/[\\`*_{}\[\]()#+.!|<>]/g,'\\$&');
  return `# Blackgate AI 决策画像与详细复盘\n\n本局风格：${md(review.style)}；处置样本：${review.sample_size}。\n\n## 指标与分母\n\n`+
    review.metrics.map(x=>`- ${md(x.label)}：${md(x.value)}。${md(x.note)}`).join('\n')+'\n\n'+
    review.sections.map(s=>`## ${s.title}\n\n${s.paragraphs.map(md).join('\n\n')}\n\n${s.items.map(x=>'- '+md(x)).join('\n')}`).join('\n\n')+
    '\n\n## 关键案例：当时可见信息与赛后标签分栏\n\n'+md(review.case_note)+'\n\n'+review.cases.map(x=>`### ${md(x.title)}\n\n动作：${md(x.action)}；${md(x.outcome)}；当时 P\(危险\)：${x.probability??'未提供'}。\n\n公开理由：${md(x.reason)}\n\n当时证据：${x.visible.map(md).join('；')||'未记录'}\n\n引用 ID：${x.evidence.map(md).join('；')||'未引用'}`).join('\n\n')+'\n';
}
