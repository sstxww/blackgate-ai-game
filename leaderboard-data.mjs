// Pure, allowlisted leaderboard data. Community records remain self-reported.
import {cleanText} from './review-analysis.mjs';
const finite = x => typeof x === 'number' && Number.isFinite(x);
const validText = (x,max=200) => typeof x==='string' && x.length<=max && !/[\x00-\x1f<>]/.test(x) && !/\b(?:sk-|apikey_|AIza)/.test(x);
const efforts = new Set(['auto','none','minimal','low','medium','high','xhigh','max']);
const median = values => {const a=[...values].sort((a,b)=>a-b),n=a.length;return n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null;};
export const difficultyNames = {hard:'高难度',abyss:'深渊',nightmare:'梦魇'};
export const effortName = value => ({auto:'默认 / auto',none:'关闭 / none',minimal:'极低 / minimal',low:'低 / low',medium:'中 / medium',high:'高 / high',xhigh:'极高 / xhigh',max:'最大 / max',unknown:'未记录'})[value] || '未记录';
export function normalizeScores(input, scope='community') {
  if(!Array.isArray(input)) throw new TypeError('榜单 runs 必须是数组。');
  if(input.length>20000) throw new RangeError('榜单超过当前可读取的 20,000 条上限，请缩小数据集。');
  const seen=new Set(),rows=[];let invalid=0,duplicates=0,human=0;
  for(const x of input){
    if(x?.participant_type==='human'){human++;continue;}
    const id=x?.id||x?.run_id;
    if(!x || x.participant_type!=='ai' || typeof id!=='string' || !/^[a-f0-9]{64}$/i.test(id) ||
      !validText(x.model)||!x.model.trim()||!validText(x.username||'Anonymous',200)||!validText(x.version,80)||!x.version||!validText(x.content_version,100)||!x.content_version||
      !Object.hasOwn(difficultyNames,x.difficulty)||!Number.isInteger(x.days_survived)||x.days_survived<0||x.days_survived>42||!finite(x.score)||x.score<0||x.score>100||
      typeof x.completed!=='boolean'||(x.completed&&x.days_survived!==42)) {invalid++;continue;}
    const canonical=id.toLowerCase();if(seen.has(canonical)){duplicates++;continue;}seen.add(canonical);
    const promptHash=typeof x.prompt_hash==='string'&&/^[a-f0-9]{64}$/i.test(x.prompt_hash)?x.prompt_hash.toLowerCase():'';
    const promptProfile=['default','custom'].includes(x.prompt_profile)?x.prompt_profile:'unknown';
    const effort=efforts.has(x.effort)?x.effort:'unknown';
    rows.push({id:canonical,model:x.model,username:x.username||'Anonymous',version:x.version,content_version:x.content_version,difficulty:x.difficulty,
      effort,effort_status:validText(x.effort_status,200)?x.effort_status:'未记录 / 未确认',protocol:validText(x.protocol,40)?x.protocol:'未记录',
      prompt_hash:promptHash,prompt_profile:promptProfile,days_survived:x.days_survived,completed:x.completed,score:x.score,
      ended_at:typeof x.ended_at==='string'&&Number.isFinite(Date.parse(x.ended_at))?x.ended_at:null,
      github_issue:Number.isSafeInteger(x.github_issue)&&x.github_issue>0?x.github_issue:null,
      source:scope==='community'?'community-self-reported':'local-self-reported'});
  }
  return {rows,invalid,duplicates,human};
}
export function cohortKey(r){return JSON.stringify([r.source,r.version,r.content_version,r.difficulty,r.prompt_profile,r.prompt_hash]);}
export function cohortLabel(r){return `${r.version} / ${r.content_version} · ${difficultyNames[r.difficulty]} · ${r.prompt_profile==='default'?'默认提示词':r.prompt_profile==='custom'?'自定义提示词':'提示词未记录'} · ${r.prompt_hash?r.prompt_hash.slice(0,10):'无指纹（仅逐局展示）'}`;}
export function cohorts(rows){
  const groups=new Map();for(const r of rows){const key=cohortKey(r);if(!groups.has(key))groups.set(key,{key,label:cohortLabel(r),row:r,count:0});groups.get(key).count++;}
  return [...groups.values()].sort((a,b)=>b.row.version.localeCompare(a.row.version,undefined,{numeric:true})||b.row.content_version.localeCompare(a.row.content_version)||Number(b.row.difficulty==='abyss')-Number(a.row.difficulty==='abyss')||Number(b.row.prompt_profile==='default')-Number(a.row.prompt_profile==='default')||b.count-a.count||a.key.localeCompare(b.key));
}
function assertSingleCohort(rows){if(new Set(rows.map(cohortKey)).size>1)throw new Error('不同来源、版本、难度或提示词指纹不能混排。');}
const runCompare=(a,b)=>Number(b.completed)-Number(a.completed)||b.days_survived-a.days_survived||b.score-a.score;
function ranks(rows,compare){let rank=0;return rows.map((row,i)=>{if(!i||compare(rows[i-1],row)!==0)rank=i+1;return {...row,rank};});}
export function rankRuns(rows){assertSingleCohort(rows);return ranks([...rows].sort((a,b)=>runCompare(a,b)||a.id.localeCompare(b.id)),runCompare);}
export function rankModels(rows){
  assertSingleCohort(rows);const groups=new Map();
  for(const r of rows){
    // Unknown prompt or effort provenance is not enough to claim repeatability.
    const incomplete=!r.prompt_hash||r.prompt_profile==='unknown'||r.effort==='unknown';
    const key=JSON.stringify([r.model,r.effort,r.effort_status,r.protocol,incomplete?r.id:'']);
    if(!groups.has(key))groups.set(key,{key,model:r.model,effort:r.effort,effort_status:r.effort_status,protocol:r.protocol,incomplete,runs:[]});
    groups.get(key).runs.push(r);
  }
  const result=[...groups.values()].map(g=>({...g,count:g.runs.length,completion_count:g.runs.filter(x=>x.completed).length,
    completion_rate:g.runs.filter(x=>x.completed).length/g.runs.length,median_days:median(g.runs.map(x=>x.days_survived)),median_score:median(g.runs.map(x=>x.score)),
    best:rankRuns(g.runs)[0],submitters:new Set(g.runs.map(x=>x.username)).size}));
  const cmp=(a,b)=>b.completion_rate-a.completion_rate||b.median_days-a.median_days||b.median_score-a.median_score;
  return ranks(result.sort((a,b)=>cmp(a,b)||a.key.localeCompare(b.key)),cmp);
}
export function scoreEntry(envelope){
  const {report:r,metadata:m={}}=envelope;
  const safe=x=>cleanText(x,200).replace(/[\r\n<>]/g,' ');
  return {schema:'blackgate-arena-score/1',run_id:r.final_chain,username:safe(m.username||m.model||'Anonymous').slice(0,50),model:safe(m.model),
    participant_type:m.participant_type==='ai'?'ai':'human',effort:efforts.has(m.effort)?m.effort:'auto',effort_status:safe(m.effort_status||'未记录 / 未确认'),protocol:safe(m.protocol||'未记录').slice(0,40),
    prompt_hash:safe(m.prompt_hash||''),prompt_profile:safe(m.prompt_profile||'unknown'),version:r.version,content_version:r.content_version,difficulty:r.difficulty,
    completed:!!r.completed,days_survived:r.days_survived,score:r.score,ended_at:new Date().toISOString()};
}
