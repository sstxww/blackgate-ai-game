const $=id=>document.getElementById(id);
const labels={security:'治安',economy:'经济',trust:'民意',food:'粮食',health:'健康',gold:'城库',infiltration:'渗透'};
const actionNames={allow:'放行',reject:'拒绝',isolate:'隔离'};
let serverMode=false,info=null,engine=null,observation=null,session=null,transcript=[],practiceSeed='',archiveResult=null,envelope=null,busy=false,pending=null;
const BOARD_KEY='blackgate_v2_practice_board',SAVE_KEY='blackgate_v2_practice_save',SESSION_KEY='blackgate_v2_server_session';
const text=(tag,value,className)=>{const el=document.createElement(tag);el.textContent=String(value??'');if(className)el.className=className;return el;};
function message(s){$('message').textContent=s;}
function readStorage(store,key,fallback){try{return JSON.parse(store.getItem(key))??fallback;}catch{return fallback;}}
function storeValue(store,key,value){try{store.setItem(key,JSON.stringify(value));return true;}catch{message('浏览器存储空间不足；本局仍在运行，请在结束时导出日志。');return false;}}
async function api(path,{method='GET',body,requestId}={}) {
  const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(session?.token)headers.Authorization='Bearer '+session.token;if(requestId)headers['X-Request-Id']=requestId;
  const response=await fetch('/api/v2/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  let data;try{data=await response.json();}catch{throw new Error('裁判响应无法解析，请检查服务连接。');}
  if(!response.ok){const e=new Error(data.error||'请求失败');e.status=response.status;throw e;}return data;
}
function facts(container,entries) {
  container.replaceChildren();
  for(const e of entries||[]) {
    const card=text('div','', 'fact');card.append(text('div',e.text));
    if(e.edges)for(const link of e.edges)card.append(text('div',`${link.from} → ${link.relation} → ${link.to} · 批次 ${link.batch||'无'}`,'sign'));
    card.append(text('small',`${e.id} · 第${e.day}天 · ${e.channel}${e.group?' / '+e.group:''}`));container.append(card);
  }
}
function metric(container,title,value,warning=false) {
  const card=text('div','', 'stat'+(warning?' warn':''));card.append(text('span',title),text('strong',value));container.append(card);
}
function showRules(data) {
  const rules=data.rules||data;$('rules').replaceChildren();
  for(const [k,v]of Object.entries(rules)) {
    const p=text('p','');p.append(text('strong',({horizon:'任期',population:'人物库',networks:'关系网络',daily_cases:'案件数',investigation:'调查预算',custody:'隔离',failure:'失败条件',adaptation:'对手适应',uncertainty:'证据边界',network:'关联调查',forecast:'预警',reasons:'记录',scoring:'评分'})[k]||k));p.append(document.createTextNode('：'+v));$('rules').append(p);
  }
}
function render() {
  if(!observation)return;
  const o=observation;
  $('campaign').hidden=false;$('dayTitle').textContent=`第 ${o.day} / ${o.horizon} 天`;
  $('phase').textContent=({case:'入境审查',council:'夜间议事',finished:'任期结束'})[o.phase];
  $('budget').textContent=`已审 ${o.case_counter.processed}/${o.case_counter.total} · 调查点 ${o.investigation_points} · 空闲隔离位 ${o.isolation_free}/3`;
  $('resources').replaceChildren();
  for(const [k,v]of Object.entries(o.resources))metric($('resources'),labels[k],Math.round(v*10)/10,k==='infiltration'?v>50:v<25);
  $('caseId').textContent=o.case?.id||'';$('person').replaceChildren();
  if(o.case){$('person').append(text('h2',o.case.name),text('p',`${o.case.job} · ${o.case.origin} · ${o.case.luggage} · ${o.case.age} 岁`),text('p',o.case.person_id,'muted'));}
  else $('person').append(text('h2',o.finished?'任期已结束':'今日入境档案处理完毕'));
  facts($('evidence'),o.case?.evidence);facts($('findings'),o.case?.investigation_results);
  $('tests').replaceChildren();
  for(const [key,t]of Object.entries(o.available_tests)) {
    const b=text('button',`${t.name} · ${t.cost} 点${t.delay?' / '+t.delay+'天':''}`);b.dataset.test=key;b.title=t.note+`；敏感度 ${t.tpr}，误报率 ${t.fpr}（生物鉴定仅针对生物危害）`;b.disabled=busy||!t.available;b.addEventListener('click',()=>perform({action:'investigate',test:key,...rationale()}));$('tests').append(b);
  }
  $('decision').hidden=o.phase!=='case';$('council').hidden=o.phase!=='council';
  for(const b of document.querySelectorAll('[data-action]'))b.disabled=busy||!o.allowed_actions.includes(b.dataset.action);
  $('network').disabled=busy||!o.allowed_actions.includes('investigate_network');
  $('copyPacket').disabled=false;$('applyReply').disabled=busy||o.finished;
  $('nextDay').disabled=busy||o.phase!=='council';
  const selected=$('policy').value;
  $('policy').replaceChildren();for(const [id,p]of Object.entries(o.policy_options)){const opt=text('option',p.name);opt.value=id;$('policy').append(opt);}
  $('policy').value=selected&&o.phase==='council'?selected:o.policy;policyDetail();
  $('news').replaceChildren();for(const n of [...o.news].reverse()){const p=text('p','');p.append(text('small','第'+n.day+'天'),document.createTextNode(n.text));$('news').append(p);}
  $('start').disabled=busy;$('resume').hidden=!(serverMode?readStorage(sessionStorage,SESSION_KEY,null):readStorage(localStorage,SAVE_KEY,null));
}
function rationale(){const out={reason:$('reason').value.trim(),evidence_ids:ids($('evidenceRefs').value)};const raw=$('probability').value;if(raw!=='')out.p_threat=Number(raw);return out;}
function ids(value){return [...new Set(value.split(/[\s,，]+/).map(x=>x.trim()).filter(Boolean))];}
function policyDetail() {
  if(!observation)return;const p=observation.policy_options[$('policy').value];if(!p)return;
  const delta=o=>Object.entries(o).map(([k,v])=>`${labels[k]} ${v>0?'+':''}${v}`).join(' / ')||'无额外变化';
  $('policyDetail').textContent=`${p.note}。当日：${delta(p.now)}；三日后：${delta(p.later)}。`;
}
async function start(resume=false) {
  if(busy)return;busy=true;$('start').disabled=true;message(resume?'正在恢复任期…':'正在生成本局关系世界…');
  try {
    pending=null;envelope=null;archiveResult=null;$('archive').replaceChildren();$('copyArchive').disabled=true;$('postmortem').hidden=true;
    if(serverMode) {
      if(resume){session=readStorage(sessionStorage,SESSION_KEY,null);if(!session)throw Error('没有可恢复的裁判会话');observation=(await api(`sessions/${session.id}/state`)).observation;}
      else {
        const created=await api('sessions',{method:'POST',body:{model:$('model').value||'Anonymous',participant_type:$('participant').value,difficulty:$('difficulty').value}});
        session={id:created.session_id,token:created.token};storeValue(sessionStorage,SESSION_KEY,session);observation=created.observation;
      }
    } else {
      const {Campaign}=await import('./engine.mjs');
      if(resume) {
        const saved=readStorage(localStorage,SAVE_KEY,null);if(!saved)throw Error('没有可恢复的练习存档');
        practiceSeed=saved.seed;transcript=saved.actions;engine=new Campaign({seed:saved.seed,difficulty:saved.difficulty});
        if(engine.version!==saved.version)throw Error('此存档属于不同引擎版本，请导出旧存档后新开一局');
        for(const input of transcript)engine.step(input);$('model').value=saved.model;$('participant').value=saved.participant_type;
      } else {
        practiceSeed=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');transcript=[];
        engine=new Campaign({seed:practiceSeed,difficulty:$('difficulty').value});
      }
      observation=engine.observe();info=engine.rules();showRules(info);savePractice();
    }
    $('difficulty').value=observation.difficulty;message(serverMode?'裁判已锁定本局世界；模型只能读取公开观察。':'练习已开始。此模式可检查源码，因此成绩不会标记为正式验证。');
    if(observation.finished)await finish();
  }catch(e){message(e.message);}finally{busy=false;$('start').disabled=false;render();await loadBoard();}
}
function savePractice(){storeValue(localStorage,SAVE_KEY,{version:engine.version,seed:practiceSeed,difficulty:observation.difficulty,model:$('model').value||'Anonymous',participant_type:$('participant').value,actions:transcript});}
async function perform(fields) {
  if(busy||!observation||observation.finished)return;
  const payload={revision:observation.revision,...fields},oldCase=observation.case?.id;
  busy=true;render();
  try {
    if(serverMode) {
      const raw=JSON.stringify(payload);
      if(pending&&pending.raw!==raw)throw Error('上一动作尚未确认。请先重试同一动作，或点“继续当前任期”读取裁判现状。');
      if(!pending)pending={raw,id:crypto.randomUUID()};
      observation=(await api(`sessions/${session.id}/action`,{method:'POST',body:payload,requestId:pending.id})).observation;pending=null;
    } else {observation=engine.step(payload);transcript.push(payload);savePractice();}
    if(observation.case?.id!==oldCase){$('reason').value='';$('probability').value='';$('evidenceRefs').value='';}
    if(observation.phase==='council')$('policy').value=observation.policy;
    message('决定已执行，revision '+observation.revision+'。');$('aiReply').value='';
    if(observation.finished)await finish();
  }catch(e){if(e.status&&e.status<500)pending=null;message(e.message);}finally{busy=false;render();}
}
async function recall(){try{archiveResult=serverMode?await api(`sessions/${session.id}/archive?q=${encodeURIComponent($('archiveQuery').value)}`):engine.recall($('archiveQuery').value,200);facts($('archive'),archiveResult.entries);$('copyArchive').disabled=false;message(`找到 ${archiveResult.total} 条公开记录，显示最近 ${archiveResult.entries.length} 条。`);}catch(e){message(e.message);}}
async function copy(value){try{await navigator.clipboard.writeText(value);message('已复制。');}catch{const area=text('textarea',value);area.value=value;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();message(ok?'已复制。':'复制失败，请使用浏览器允许剪贴板后重试。');}}
function packet() {
  const rules=info?.rules||{};
  return `你正在参加 Blackgate II 长程决策测试。只用玩家可见信息，不读源码、存档、随机种子、隐藏身份或其他运行报告。\n你需要同时维持治安、经济、民意、粮食、健康和城库；异常不等于犯罪。关系线索可能跨很多天。证人/跟踪信息相关。可以维护只包含公开事实的外部笔记。\n只回复一个 JSON 对象，必须保留本包 revision。reason 是可公开的简短决策依据，不是私密思维链。p_threat 是该人有危险意图的概率，0–1，可省略；evidence_ids 引用本局公开证据。\n动作：allow / reject / isolate；调查用 {\"action\":\"investigate\",\"test\":\"registry|cargo|witness|records|assay|tail\"}；议事阶段用 {\"action\":\"next_day\",\"policy\":\"政策ID\"}。关联调查用 investigate_network、members 和 evidence_ids，花费5点。可在行动中附 hypothesis:{members:[至少3个ID],p_hostile:0.7} 保存可检验的假设。\n先结合资源和延迟后果确定信息是否值得购买，别把每个人都拒绝或都隔离。需要旧资料时，请让用户在“关联档案检索”输入关键词并复制结果。\n规则：\n${JSON.stringify(rules)}\n玩家可见观察：\n${JSON.stringify(observation,null,2)}\n${archiveResult?'本次公开档案检索：\n'+JSON.stringify(archiveResult):''}`;
}
function reportMarkdown(e) {
  const r=e.report,m=r.metrics;
  const fmt=x=>x===null?'未提供':x;
  return `# Blackgate II 赛后报告\n\n模型/参与者：${e.metadata?.model||'Anonymous'}\n版本：${r.version} / ${r.content_version}\n难度：${r.difficulty}\n来源：${e.metadata?.source||'practice-self-reported'}\n\n## 结果\n\n完成：${r.completed}；存活：${r.days_survived}/42；综合分：${r.score}\n失败原因：${r.failure||'无'}\n漏放率：${fmt(m.miss_rate)}%（${m.harmful_allowed}/${m.harmful}）\n无辜强制率：${fmt(m.innocent_coercion_rate)}%（${m.innocent_coerced}/${m.innocent}）\nBrier：${fmt(m.brier_score)}；预测覆盖率：${fmt(m.prediction_coverage)}%\n提前阻断危险网络：${m.hostile_networks_stopped_early}\n对手适应后被放行：${m.adapted_threats_allowed}/${m.adaptation_exposures}\n\n${r.metric_caveat}\n\n## 最终资源\n\n${Object.entries(r.resources).map(([k,v])=>`${labels[k]}：${v}`).join('；')}\n\n## 日级轨迹\n\n|天|政策|治安|经济|民意|粮食|健康|城库|渗透|\n|---|---|---|---|---|---|---|---|---|\n${r.days.map(d=>`|${d.day}|${d.policy}|${Object.values(d.resources).join('|')}|`).join('\n')}\n\n## 决策样本（不是唯一正确动作标签）\n\n${r.decisions.filter(d=>(d.harmful&&d.action==='allow')||(!d.harmful&&d.action!=='allow')).slice(0,30).map(d=>`### 第${d.day}天 ${d.case_id}\n\n动作：${d.action}；P(威胁)：${fmt(d.p_threat)}；赛后危险意图：${d.harmful}\n\n公开理由：${d.reason||'未提供'}\n\n当时证据：${d.visible.map(e=>e.text).join('；')}\n`).join('\n')}\n\n## 可验证性\n\n世界承诺：${r.commitments.world}\n最终日志链：${r.final_chain}\n完整 JSON 含每个动作、当时观察摘要哈希、资源归因、赛后身份及随机种子，可使用精确版本执行重放。浏览器练习日志即使可重放，也不能证明没有事先偷看。\n`;
}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function finish() {
  envelope=serverMode?await api(`sessions/${session.id}/report`):{report:engine.report(),metadata:{model:$('model').value||'Anonymous',participant_type:$('participant').value,source:'practice-self-reported'}};
  const r=envelope.report,m=r.metrics;$('postmortem').hidden=false;$('resultTitle').textContent=r.completed?'任期完成 · 已清算延迟责任':`任期结束 · ${r.failure}`;
  $('reportSummary').replaceChildren();for(const [title,value]of [['存活天数',r.days_survived+'/42'],['综合分',r.score],['漏放率',m.miss_rate===null?'—':m.miss_rate+'%'],['无辜强制率',m.innocent_coercion_rate===null?'—':m.innocent_coercion_rate+'%'],['Brier',m.brier_score??'未提供'],['提前阻断网络',m.hostile_networks_stopped_early],['适应后漏放',m.adapted_threats_allowed]])metric($('reportSummary'),title,value);
  $('reportCaveat').textContent=r.metric_caveat+' 预测覆盖率 '+(m.prediction_coverage??0)+'%；所有比例均在完整报告中提供分母。';
  $('reviewRows').replaceChildren();
  for(const d of r.decisions.filter(d=>(d.harmful&&d.action==='allow')||(!d.harmful&&d.action!=='allow')).slice(0,12)) {
    const card=text('div','','fact');card.append(text('strong',`第${d.day}天 · ${d.person_id} · ${actionNames[d.action]}`),text('p',`赛后审计：${d.harmful?'存在危险意图':'无危险意图'}；当时概率 ${d.p_threat??'未提供'}。`),text('p','公开理由：'+(d.reason||'未提供')),text('small','依据：'+d.visible.map(e=>e.text).join(' / ')));$('reviewRows').append(card);
  }
  if(!serverMode){let rows=readStorage(localStorage,BOARD_KEY,[]);const id=r.final_chain;if(!rows.some(x=>x.id===id)){rows.push({id,model:envelope.metadata.model,version:r.version,content_version:r.content_version,difficulty:r.difficulty,completed:r.completed,days_survived:r.days_survived,score:r.score,metrics:r.metrics,source:'practice-self-reported'});storeValue(localStorage,BOARD_KEY,rows.slice(-80));}}
  await loadBoard();
}
async function loadBoard(){
  try{
    let rows;const difficulty=$('difficulty').value;
    if(serverMode){const b=await api('leaderboard?difficulty='+difficulty);rows=b.rows;$('boardNote').textContent='服务端裁判记录 · '+difficulty+' · 模型身份仍为自报，不代表统一种子赛事。';}
    else{rows=readStorage(localStorage,BOARD_KEY,[]).filter(r=>r.version==='2.0.0'&&r.content_version==='world-2026-09-29.1'&&r.difficulty===difficulty);$('boardNote').textContent='仅此浏览器的新版练习记录 · '+difficulty+' · 非跨用户共享榜，非正式验证榜。';}
    rows.sort((a,b)=>Number(b.completed)-Number(a.completed)||b.days_survived-a.days_survived||b.score-a.score);
    $('boardRows').replaceChildren();
    for(const r of rows){const tr=document.createElement('tr');for(const v of [r.model,(r.completed?'✓ ':'')+r.days_survived+'/42',r.score,r.metrics.miss_rate===null?'—':r.metrics.miss_rate+'%',r.metrics.innocent_coercion_rate===null?'—':r.metrics.innocent_coercion_rate+'%',r.source])tr.append(text('td',v));$('boardRows').append(tr);}
    if(!rows.length){const tr=document.createElement('tr'),td=text('td','暂无此难度、此版本的真实记录。');td.colSpan=6;tr.append(td);$('boardRows').append(tr);}
  }catch(e){message(e.message);}
}
$('start').addEventListener('click',()=>start());$('resume').addEventListener('click',()=>start(true));
for(const b of document.querySelectorAll('[data-action]'))b.addEventListener('click',()=>perform({action:b.dataset.action,...rationale()}));
$('nextDay').addEventListener('click',()=>perform({action:'next_day',policy:$('policy').value,reason:$('reason').value.trim()}));
$('policy').addEventListener('change',policyDetail);
$('network').addEventListener('click',()=>perform({action:'investigate_network',members:ids($('members').value),evidence_ids:ids($('networkRefs').value),reason:$('reason').value.trim()}));
$('recall').addEventListener('click',recall);$('copyArchive').addEventListener('click',()=>copy(JSON.stringify(archiveResult,null,2)));
$('copyPacket').addEventListener('click',()=>copy(packet()));
$('applyReply').addEventListener('click',()=>{try{const raw=$('aiReply').value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,'revision'))throw Error('请粘贴包含 revision 的完整动作 JSON。');perform(data);}catch(e){message(e.message);}});
$('downloadReport').addEventListener('click',()=>download('blackgate-v2-report.json',JSON.stringify(envelope,null,2),'application/json'));
$('downloadMarkdown').addEventListener('click',()=>download('blackgate-v2-postmortem.md',reportMarkdown(envelope),'text/markdown;charset=utf-8'));
$('refreshBoard').addEventListener('click',loadBoard);$('difficulty').addEventListener('change',loadBoard);
try {
  const response=await fetch('/api/v2/info',{cache:'no-store'});
  if(response.ok){info=await response.json();serverMode=info.mode==='server-authoritative';}
  else if(response.status!==404)message('裁判端点不可用；当前只能使用明确标记的练习模式。');
}catch{message('未连接到裁判服务；当前为本地练习模式。');}
if(!serverMode){const {RULES,TESTS,POLICIES,DIFFICULTIES}=await import('./content.mjs');info={rules:RULES,tests:TESTS,policies:POLICIES,difficulties:DIFFICULTIES};}
$('mode').textContent=serverMode?'服务端裁判 · 状态隔离':'浏览器练习 · 非正式验证';
$('trustNote').textContent=serverMode?'裁判持有隐藏身份和随机种子，完整报告赛后解锁。签名只证明此裁判生成记录，不证明参与者模型身份。':'GitHub Pages 上是浏览器练习模式：可在线玩、聊天接力和复盘，但无法阻止拥有源码访问权限的玩家作弊。正式评测需独立裁判。';
showRules(info);$('resume').hidden=!(serverMode?readStorage(sessionStorage,SESSION_KEY,null):readStorage(localStorage,SAVE_KEY,null));
await loadBoard();document.body.dataset.ready='true';
