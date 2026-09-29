const $=id=>document.getElementById(id),KEY='blackgate_arena_board_v1';
const safe=x=>String(x??'').replace(/[\r\n<>]/g,' ').slice(0,200);
export async function renderBoard(){
  const type=$('boardType')?.value||'human',scope=$('boardScope')?.value||'local',difficulty=$('difficulty')?.value||'abyss';
  let rows=[];
  try{
    if(scope==='community'){
      const r=await fetch('./data/arena-community.json',{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw Error('公开社区榜暂时无法读取');rows=(await r.json()).runs||[];
    }else{try{rows=JSON.parse(localStorage.getItem(KEY)||'[]');}catch{rows=[];}}
    rows=rows.filter(r=>r.participant_type===type&&r.difficulty===difficulty&&r.version==='2.0.0'&&r.content_version==='world-2026-09-29.1');
    rows.sort((a,b)=>Number(b.completed)-Number(a.completed)||b.days_survived-a.days_survived||b.score-a.score);
    $('boardRows').replaceChildren();
    for(const r of rows.slice(0,100)){
      const tr=document.createElement('tr');
      for(const v of [safe(r.username||'Anonymous')+(type==='ai'?' / '+safe(r.model):''),`${r.completed?'✓ ':''}${r.days_survived}/42`,r.score,type==='ai'?safe(r.effort||'auto'):'—',safe(r.ended_at?.slice(0,10)||'—'),scope==='community'?'GitHub 社区自报':'本机练习']){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}
      $('boardRows').append(tr);
    }
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='暂无这个版本、难度与挑战类型的成绩。完成一局，留下你的记录。';tr.append(td);$('boardRows').append(tr);}
    $('boardNote').textContent=`${type==='ai'?'AI':'人类'} · ${difficulty} · 引擎 2.0.0 · ${scope==='community'?'跨用户公开自报榜：GitHub 登录后提交，自动格式校验；不是服务端防作弊认证。':'仅此浏览器，完成后自动入榜；不会未经同意上传。'} 同名推理档位不保证跨模型等价；默认与自定义提示词由完整报告记录。`;
  }catch(e){$('boardNote').textContent=e.message;}
}
export function scoreEntry(envelope){
  const {report:r,metadata:m={}}=envelope;
  return {schema:'blackgate-arena-score/1',run_id:r.final_chain,username:safe(m.username||m.model||'Anonymous'),model:safe(m.model),participant_type:m.participant_type==='ai'?'ai':'human',effort:safe(m.effort||'auto'),prompt_hash:safe(m.prompt_hash||''),prompt_profile:safe(m.prompt_profile||'human'),version:r.version,content_version:r.content_version,difficulty:r.difficulty,completed:!!r.completed,days_survived:r.days_survived,score:r.score,ended_at:new Date().toISOString()};
}
export function shareScore(envelope){
  const entry=scoreEntry(envelope);
  // Only this allowlisted score summary is shared. No API URL, key, raw prompt or logs.
  const body='我主动提交这条浏览器练习成绩。了解它仅为社区自报，不是防作弊认证。\n\n```blackgate-arena\n'+JSON.stringify(entry,null,2)+'\n```\n';
  const url='https://github.com/sstxww/blackgate-ai-game/issues/new?title='+encodeURIComponent('[Blackgate Arena] '+entry.username+' / '+entry.model)+'&body='+encodeURIComponent(body);
  window.open(url,'_blank','noopener,noreferrer');
  $('message').textContent='已打开 GitHub 成绩提交页。登录并点击创建 Issue 后，自动校验流程会将摘要加入公开社区榜。不包含 API Key。';
}
