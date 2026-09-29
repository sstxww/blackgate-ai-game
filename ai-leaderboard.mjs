import {normalizeScores,cohorts,cohortKey,rankModels,rankRuns,effortName} from './leaderboard-data.mjs';
const $=id=>document.getElementById(id);
const el=(tag,value='',className='')=>{const n=document.createElement(tag);n.textContent=String(value??'');n.className=className;return n;};
let rows=[],view='models',epoch=0,abort=null,limit=30;
function sourceLink(r){
  if(!r.github_issue)return el('small',r.source==='community-self-reported'?'缺少公开提交链接；当前只有成绩摘要。':'本机摘要；完整复盘在挑战结束页或导出文件中。','review-muted');
  const a=el('a','查看提交记录 #'+r.github_issue);a.href='https://github.com/sstxww/blackgate-ai-game/issues/'+r.github_issue;a.target='_blank';a.rel='noopener noreferrer';return a;
}
function runDetail(r){
  const p=el('p','','rank-run-detail');p.append(el('strong',r.username),el('span',` · ${r.completed?'完成':'提前结束'} · ${r.days_survived}/42 天 · ${r.score} 分 · ${r.ended_at?new Date(r.ended_at).toISOString().slice(0,10):'日期未记录'} `),sourceLink(r));return p;
}
function cell(row,label,node){const td=el('td');td.dataset.label=label;if(typeof node==='string'||typeof node==='number')td.textContent=String(node);else td.append(node);row.append(td);}
function table(headers){const wrap=el('div','','rank-table-wrap'),t=el('table','','rank-table'),head=el('thead'),tr=el('tr'),body=el('tbody');for(const title of headers){const th=el('th',title);th.scope='col';tr.append(th);}head.append(tr);t.append(head,body);wrap.append(t);return {wrap,body};}
function modelNode(g){const node=el('div','','rank-model');node.append(el('strong',g.model),el('small',g.protocol+' · '+g.effort_status));return node;}
function paint(){
  const key=$('cohortSelect').value,query=$('rankingSearch').value.trim().toLocaleLowerCase(),effort=$('rankingEffort').value;
  const cohortRows=rows.filter(r=>cohortKey(r)===key),visible=cohortRows.filter(r=>(effort==='all'||r.effort===effort)&&(!query||(r.model+' '+r.username).toLocaleLowerCase().includes(query)));
  const models=rankModels(visible),runs=rankRuns(visible);$('rankingRunCount').textContent=visible.length;$('rankingModelCount').textContent=models.length;$('rankingCompletedCount').textContent=visible.filter(r=>r.completed).length;
  $('rankingBestDays').textContent=visible.length?Math.max(...visible.map(r=>r.days_survived))+'/42':'—';
  const representative=cohortRows[0];$('cohortDescription').textContent=representative?`完整提示词指纹：${representative.prompt_hash||'未记录'}。${representative.prompt_profile==='unknown'||!representative.prompt_hash?'元数据不完整，不将多条记录聚合为复测。':'该赛道只比较这一提示词版本。'} 来源：${representative.source==='community-self-reported'?'公开社区自报':'本机自报'}。`:'没有可选赛道。';
  $('rankingTitle').textContent=view==='models'?'模型配置榜':'单次挑战榜';
  $('rankingRule').textContent=view==='models'?'排序：完成率 → 生存天数中位数 → 综合分中位数，均从高到低；相同成绩并列。不是按某一次最高分排序。这里只统计已提交记录，存在选择性提交偏差；未记录的失败不能计入完成率。':'排序：是否完成任期 → 生存天数 → 综合分，均从高到低；相同成绩并列。单次最好成绩不能代表稳定水平。';
  $('modelView').setAttribute('aria-pressed',String(view==='models'));$('runView').setAttribute('aria-pressed',String(view==='runs'));
  const root=$('rankingResults');root.replaceChildren();root.setAttribute('aria-busy','false');
  if(!visible.length){const empty=el('div','','rank-empty');empty.append(el('strong',rows.length?'这个条件下还没有记录':'暂无可显示的 AI 记录'),el('p',rows.length?'调整搜索或推理档位；不会用其他赛道的成绩补位。':'完成自动挑战后可主动提交公开社区榜。本机成绩不会自动上传，人类成绩不在此页显示。'));root.append(empty);$('moreRanking').hidden=true;return;}
  if(view==='models'){
    const {wrap,body}=table(['名次','模型 / 响应记录','请求推理档位','记录 / 完成率','生存中位数','分数中位数','记录详情']);
    for(const g of models.slice(0,limit)){
      const tr=el('tr');cell(tr,'名次',el('span',String(g.rank).padStart(2,'0'),'rank-position'));cell(tr,'模型',modelNode(g));cell(tr,'请求推理档位',effortName(g.effort));
      const count=el('div');count.append(el('strong',`${g.count} 次 · ${Math.round(g.completion_rate*10000)/100}%`),el('small',g.incomplete?'条件缺失，仅单条展示':g.count<5?'样本较少，谨慎解读':'仍需独立、多种子复测'));cell(tr,'记录 / 完成率',count);cell(tr,'生存中位数',g.median_days+'/42');cell(tr,'分数中位数',String(Math.round(g.median_score*100)/100));
      const details=el('details','','rank-details');details.append(el('summary','查看 '+g.count+' 条记录'));details.append(el('p',`最佳单次：${g.best.days_survived}/42 天 · ${g.best.score} 分；提交者 ${g.submitters} 位。`));
      let rendered=0;const batch=()=>{for(const r of g.runs.slice(rendered,rendered+30))details.append(runDetail(r));rendered+=30;};
      details.addEventListener('toggle',()=>{if(details.open&&!rendered){batch();if(rendered<g.runs.length){const more=el('button','再显示 30 条');more.type='button';more.addEventListener('click',()=>{more.remove();batch();if(rendered<g.runs.length)details.append(more);});details.append(more);}}});
      cell(tr,'记录详情',details);body.append(tr);
    }root.append(wrap);$('moreRanking').hidden=models.length<=limit;
  }else{
    const {wrap,body}=table(['名次','模型 / 响应记录','请求推理档位','提交者','生存 / 结果','综合分','提交记录']);
    for(const r of runs.slice(0,limit)){const tr=el('tr');cell(tr,'名次',el('span',String(r.rank).padStart(2,'0'),'rank-position'));cell(tr,'模型',modelNode(r));cell(tr,'请求推理档位',effortName(r.effort));cell(tr,'提交者',r.username);cell(tr,'生存 / 结果',`${r.days_survived}/42 · ${r.completed?'完成':'提前结束'}`);cell(tr,'综合分',r.score);cell(tr,'提交记录',sourceLink(r));body.append(tr);}root.append(wrap);$('moreRanking').hidden=runs.length<=limit;
  }
  const count=view==='models'?models.length:runs.length;root.append(el('p',`显示 ${Math.min(limit,count)} / ${count} 项。社区摘要不含完整复盘；不会从分数猜测模型性格。`,'review-muted'));
}
async function load(){
  const id=++epoch;abort?.abort();abort=new AbortController();const scope=$('rankingScope').value,previous=$('cohortSelect').value;
  rows=[];limit=30;$('cohortSelect').replaceChildren();$('cohortSelect').disabled=true;paint();$('rankingResults').replaceChildren(el('p','正在读取所选来源…','rank-empty'));$('rankingResults').setAttribute('aria-busy','true');$('rankingStatus').textContent='正在读取'+(scope==='community'?'公开社区':'本机')+'记录…';
  try{
    let data,updated='';
    if(scope==='community'){
      const response=await fetch('./data/arena-community.json',{signal:abort.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('公开社区榜读取失败（HTTP '+response.status+'），请稍后重试。');
      const text=await response.text();if(text.length>8000000)throw new Error('榜单文件过大，暂不读取。');const doc=JSON.parse(text);
      data=doc.runs;updated=typeof doc.updated_at==='string'&&Number.isFinite(Date.parse(doc.updated_at))?'；数据更新 '+new Date(doc.updated_at).toISOString().slice(0,16).replace('T',' ')+' UTC':'';
    }else{data=JSON.parse(localStorage.getItem('blackgate_arena_board_v1')||'[]');}
    if(id!==epoch)return;
    const result=normalizeScores(data,scope);rows=result.rows;const choices=cohorts(rows);
    for(const c of choices){const option=el('option',c.label+' · '+c.count+' 条');option.value=c.key;$('cohortSelect').append(option);}
    if(!choices.length)$('cohortSelect').append(el('option','暂无 AI 赛道'));
    else if(choices.some(c=>c.key===previous))$('cohortSelect').value=previous;
    $('cohortSelect').disabled=!choices.length;
    $('rankingStatus').textContent=`已读取 ${rows.length} 条 AI 记录；排除 ${result.human} 条人类记录、${result.invalid} 条无效记录、${result.duplicates} 条重复记录${updated}。${scope==='local'?'仅此浏览器，不会上传。':'格式校验不等于真实性认证。'}`;
    paint();
  }catch(error){if(id!==epoch||error.name==='AbortError')return;rows=[];paint();$('rankingStatus').textContent='读取失败：'+error.message+' 未切换到其他来源，也未显示旧榜单。';$('rankingResults').replaceChildren(el('p','记录暂时不可用。点击“刷新记录”重试；现有本机数据没有被修改。','rank-empty'));}
  finally{if(id===epoch){$('rankingResults').setAttribute('aria-busy','false');document.body.dataset.rankingReady='true';}}
}
$('rankingScope').addEventListener('change',load);$('refreshRanking').addEventListener('click',load);
for(const id of ['cohortSelect','rankingEffort'])$(id).addEventListener('change',()=>{limit=30;paint();});$('rankingSearch').addEventListener('input',()=>{limit=30;paint();});
$('modelView').addEventListener('click',()=>{view='models';limit=30;paint();});$('runView').addEventListener('click',()=>{view='runs';limit=30;paint();});$('moreRanking').addEventListener('click',()=>{limit+=30;paint();});
await load();
