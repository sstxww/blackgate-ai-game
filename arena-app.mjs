import {buildReview,reviewMarkdown} from './review-analysis.mjs';
import {renderReview,announceReview} from './review-ui.mjs';
import {scoreEntry} from './leaderboard-data.mjs';
const $=id=>document.getElementById(id);
const labels={security:'治安',economy:'经济',trust:'民意',food:'粮食',health:'健康',gold:'城库',infiltration:'渗透'};
const actionNames={allow:'放行',reject:'拒绝',isolate:'隔离'};
let runMetadata={};
let serverMode=false,info=null,engine=null,observation=null,session=null,transcript=[],practiceSeed='',archiveResult=null,envelope=null,busy=false,pending=null;
const BOARD_KEY='blackgate_arena_board_v1',SAVE_KEY='blackgate_arena_human_save_v1',SESSION_KEY='blackgate_v2_server_session';
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

  $('nextDay').disabled=busy||o.phase!=='council';
  const selected=$('policy').value;
  $('policy').replaceChildren();for(const [id,p]of Object.entries(o.policy_options)){const opt=text('option',p.name);opt.value=id;$('policy').append(opt);}
  $('policy').value=selected&&o.phase==='council'?selected:o.policy;policyDetail();
  $('news').replaceChildren();for(const n of [...o.news].reverse()){const p=text('p','');p.append(text('small','第'+n.day+'天'),document.createTextNode(n.text));$('news').append(p);}
  window.dispatchEvent(new CustomEvent('blackgate-world'));
  $('start').disabled=busy;$('resume').hidden=$('participant').value==='ai'||!(serverMode?readStorage(sessionStorage,SESSION_KEY,null):readStorage(localStorage,SAVE_KEY,null));
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
    pending=null;envelope=null;archiveResult=null;$('archive').replaceChildren();$('postmortem').hidden=true;
    if(serverMode) {
      if(resume){session=readStorage(sessionStorage,SESSION_KEY,null);if(!session)throw Error('没有可恢复的裁判会话');observation=(await api(`sessions/${session.id}/state`)).observation;}
      else {
        const created=await api('sessions',{method:'POST',body:{model:$('model').value||'Anonymous',participant_type:$('participant').value,difficulty:$('difficulty').value}});
        session={id:created.session_id,token:created.token};storeValue(sessionStorage,SESSION_KEY,session);observation=created.observation;
      }
    } else {
      const {Campaign}=await import('./v2/engine.mjs');
      if(resume) {
        const saved=readStorage(localStorage,SAVE_KEY,null);if(!saved)throw Error('没有可恢复的练习存档');
        practiceSeed=saved.seed;transcript=saved.actions;engine=new Campaign({seed:saved.seed,difficulty:saved.difficulty});
        if(engine.version!==saved.version)throw Error('此存档属于不同引擎版本，请导出旧存档后新开一局');
        for(const input of transcript)engine.step(input);$('model').value=saved.model;$('participant').value=saved.participant_type;
      } else {
        observation=null;practiceSeed=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');transcript=[];
        engine=new Campaign({seed:practiceSeed,difficulty:$('difficulty').value});
      }
      observation=engine.observe();info=engine.rules();showRules(info);savePractice();
    }
    $('difficulty').value=observation.difficulty;message(serverMode?'裁判已锁定本局世界；模型只能读取公开观察。':'练习已开始。此模式可检查源码，因此成绩不会标记为正式验证。');
    if(observation.finished)await finish();
  }catch(e){message(e.message);}finally{busy=false;$('start').disabled=false;render();await loadBoard();}
}
function savePractice(){if($('participant').value==='ai')return;storeValue(localStorage,SAVE_KEY,{version:engine.version,seed:practiceSeed,difficulty:observation.difficulty,model:$('model').value||'Anonymous',participant_type:$('participant').value,actions:transcript});}
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
    message('决定已执行，revision '+observation.revision+'。');
    window.BlackgateSound?.sfx(fields.action==='next_day'?'day':fields.action==='investigate'?'search':fields.action);
    if(observation.finished)await finish();
  }catch(e){if(e.status&&e.status<500)pending=null;message(e.message);}finally{busy=false;render();}
}
async function recall(){try{archiveResult=serverMode?await api(`sessions/${session.id}/archive?q=${encodeURIComponent($('archiveQuery').value)}`):engine.recall($('archiveQuery').value,200);facts($('archive'),archiveResult.entries);message(`找到 ${archiveResult.total} 条公开记录，显示最近 ${archiveResult.entries.length} 条。`);}catch(e){message(e.message);}}
async function copy(value){try{await navigator.clipboard.writeText(value);message('已复制。');}catch{const area=text('textarea',value);area.value=value;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();message(ok?'已复制。':'复制失败，请使用浏览器允许剪贴板后重试。');}}
function reportMarkdown(e) { return reviewMarkdown(buildReview(e)); }

function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function finish() {
  envelope=serverMode?await api(`sessions/${session.id}/report`):{report:engine.report(),metadata:{username:$('username').value.trim()||'Anonymous',model:$('model').value||'Anonymous',participant_type:$('participant').value,effort:$('effort').value,source:'practice-self-reported',...runMetadata}};
  const r=envelope.report,m=r.metrics;$('postmortem').hidden=false;$('resultTitle').textContent=r.completed?'任期完成 · 已清算延迟责任':`任期结束 · ${r.failure}`;
  $('reportSummary').replaceChildren();for(const [title,value]of [['存活天数',r.days_survived+'/42'],['综合分',r.score],['漏放率',m.miss_rate===null?'—':m.miss_rate+'%'],['无辜强制率',m.innocent_coercion_rate===null?'—':m.innocent_coercion_rate+'%'],['Brier',m.brier_score??'未提供'],['提前阻断网络',m.hostile_networks_stopped_early],['适应后漏放',m.adapted_threats_allowed]])metric($('reportSummary'),title,value);
  $('reportCaveat').textContent=r.metric_caveat+' 预测覆盖率 '+(m.prediction_coverage??0)+'%；所有比例均在完整报告中提供分母。';
  $('reviewRows').replaceChildren();
  for(const d of r.decisions.filter(d=>(d.harmful&&d.action==='allow')||(!d.harmful&&d.action!=='allow')).slice(0,12)) {
    const card=text('div','','fact');card.append(text('strong',`第${d.day}天 · ${d.person_id} · ${actionNames[d.action]}`),text('p',`赛后审计：${d.harmful?'存在危险意图':'无危险意图'}；当时概率 ${d.p_threat??'未提供'}。`),text('p','公开理由：'+(d.reason||'未提供')),text('small','依据：'+d.visible.map(e=>e.text).join(' / ')));$('reviewRows').append(card);
  }
  renderReview($('detailedReview'),envelope);
  if(!serverMode){
    const saved=readStorage(localStorage,BOARD_KEY,[]),rows=Array.isArray(saved)?saved:[];
    const entry=scoreEntry(envelope),id=entry.run_id;
    if(!rows.some(x=>x?.id===id||x?.run_id===id)){rows.push({...entry,id,source:'practice-self-reported'});storeValue(localStorage,BOARD_KEY,rows.slice(-80));}
  }
  announceReview(envelope);
  window.dispatchEvent(new CustomEvent('blackgate-complete'));
  await loadBoard();
}
async function loadBoard(){
  const {renderBoard}=await import('./arena-board.mjs');await renderBoard();
}
$('start').addEventListener('click',()=>{runMetadata={};window.BlackgateSound?.start();$('model').value=$('username').value.trim()||'Anonymous';start();});$('resume').addEventListener('click',()=>start(true));
for(const b of document.querySelectorAll('[data-action]'))b.addEventListener('click',()=>perform({action:b.dataset.action,...rationale()}));
$('nextDay').addEventListener('click',()=>perform({action:'next_day',policy:$('policy').value,reason:$('reason').value.trim()}));
$('policy').addEventListener('change',policyDetail);
$('network').addEventListener('click',()=>perform({action:'investigate_network',members:ids($('members').value),evidence_ids:ids($('networkRefs').value),reason:$('reason').value.trim()}));
$('recall').addEventListener('click',recall);
$('downloadReport').addEventListener('click',()=>download('blackgate-v2-report.json',JSON.stringify(envelope,null,2),'application/json'));
$('downloadMarkdown').addEventListener('click',()=>download('blackgate-v2-postmortem.md',reportMarkdown(envelope),'text/markdown;charset=utf-8'));
$('refreshBoard').addEventListener('click',loadBoard);$('difficulty').addEventListener('change',loadBoard);
try {
  const response=await fetch('/api/v2/info',{cache:'no-store'});
  if(response.ok){info=await response.json();serverMode=info.mode==='server-authoritative';}
  else if(response.status!==404)message('裁判端点不可用；当前只能使用明确标记的练习模式。');
}catch{message('未连接到裁判服务；当前为本地练习模式。');}
if(!serverMode){const {RULES,TESTS,POLICIES,DIFFICULTIES}=await import('./v2/content.mjs');info={rules:RULES,tests:TESTS,policies:POLICIES,difficulties:DIFFICULTIES};}
$('mode').textContent=serverMode?'服务端裁判 · 状态隔离':'浏览器练习 · 非正式验证';
$('trustNote').textContent=serverMode?'裁判持有隐藏身份和随机种子，完整报告赛后解锁。签名只证明此裁判生成记录，不证明参与者模型身份。':'GitHub Pages 上是浏览器练习模式：可进行人类挑战、API 自动挑战和复盘，但无法阻止拥有源码访问权限的玩家作弊。正式评测需独立裁判。';
showRules(info);$('resume').hidden=!(serverMode?readStorage(sessionStorage,SESSION_KEY,null):readStorage(localStorage,SAVE_KEY,null));
await loadBoard();document.body.dataset.ready='true';

export const publicGame=Object.freeze({
  state:()=>observation?structuredClone(observation):null,
  rules:()=>structuredClone(info?.rules||{}),
  metadata:value=>{runMetadata={...value};},
  start:async()=>{await start(false);if(!observation||observation.finished)throw Error($('message').textContent||'游戏初始化失败');return structuredClone(observation);},
  step:async fields=>{const rev=observation?.revision;if(busy||!observation||observation.finished)throw Error('当前不能执行动作');await perform(fields);if(observation.revision===rev)throw Error($('message').textContent||'动作未执行');return structuredClone(observation);},
  recall:async query=>{if(!observation)throw Error('请先开始挑战');return serverMode?await api('sessions/'+session.id+'/archive?q='+encodeURIComponent(query)):engine.recall(query,200);},
  report:()=>observation?.finished&&envelope?structuredClone(envelope):null
});
