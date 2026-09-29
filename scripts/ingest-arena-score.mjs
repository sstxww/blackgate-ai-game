import fs from 'node:fs';
const fail=s=>{throw Error(s);};
const raw=process.env.ISSUE_BODY||'';
if(raw.length>14000)fail('Payload too large');
const block=raw.match(/```blackgate-arena\s*([\s\S]*?)```/);if(!block)fail('Missing arena score block');
let x;try{x=JSON.parse(block[1]);}catch{fail('Invalid JSON');}
const str=(s,max=200)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x1f<>]/.test(s);
if(x.schema!=='blackgate-arena-score/1')fail('Wrong schema');
if(!/^[0-9a-f]{64}$/i.test(x.run_id||''))fail('Invalid run ID');
if(x.version!=='2.0.0'||x.content_version!=='world-2026-09-29.1')fail('Unrecognized engine/content version');
if(!['hard','abyss','nightmare'].includes(x.difficulty))fail('Invalid difficulty');
if(!['human','ai'].includes(x.participant_type))fail('Invalid participant type');
if(!Number.isInteger(x.days_survived)||x.days_survived<0||x.days_survived>42)fail('Invalid survival days');
if(typeof x.completed!=='boolean'||(x.completed&&x.days_survived!==42))fail('Invalid completion');
if(!Number.isFinite(x.score)||x.score<0||x.score>100)fail('Invalid score');
if(!str(x.username,50)||!x.username.trim()||!str(x.model))fail('Invalid name or model');
if(!['auto','none','minimal','low','medium','high','xhigh','max'].includes(x.effort))fail('Invalid effort');
if(!str(x.prompt_hash||'',64)||!str(x.prompt_profile||'',32))fail('Invalid prompt metadata');
if(!str(x.ended_at,40)||!Number.isFinite(Date.parse(x.ended_at)))fail('Invalid timestamp');
for(const value of [x.username,x.model])if(/\b(?:sk-|apikey_|AIza)/.test(value))fail('Possible secret in score');
const path='data/arena-community.json';const doc=JSON.parse(fs.readFileSync(path,'utf8'));
if(!doc.runs.some(r=>r.id===x.run_id)){
  const row={id:x.run_id,username:x.username,model:x.model,participant_type:x.participant_type,effort:x.effort,prompt_hash:x.prompt_hash,prompt_profile:x.prompt_profile,version:x.version,content_version:x.content_version,difficulty:x.difficulty,completed:x.completed,days_survived:x.days_survived,score:x.score,ended_at:x.ended_at,source:'community-self-reported',submitted_by:String(process.env.ISSUE_USER||'').slice(0,100),github_issue:Number(process.env.ISSUE_NUMBER||0)};
  doc.runs.push(row);doc.updated_at=new Date().toISOString();fs.writeFileSync(path,JSON.stringify(doc,null,2)+'\n');
}
console.log('Score format checked; self-reported only. No gameplay or identity verification implied.');
