import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve('scripts/ingest-arena-score.mjs');
const sample={schema:'blackgate-arena-score/1',run_id:'a'.repeat(64),username:'Fixture only',model:'Fixture model',participant_type:'ai',effort:'high',prompt_hash:'b'.repeat(64),prompt_profile:'default',version:'2.0.0',content_version:'world-2026-09-29.1',difficulty:'abyss',completed:false,days_survived:11,score:42,ended_at:'2026-09-29T00:00:00Z'};
function fixture(callback){fs.mkdirSync('.scratch-web',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.scratch-web/score-'));fs.mkdirSync(path.join(dir,'data'));const file=path.join(dir,'data/arena-community.json');fs.writeFileSync(file,JSON.stringify({runs:[]}));
 const ingest=x=>spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8',env:{...process.env,ISSUE_BODY:'```blackgate-arena\n'+JSON.stringify(x)+'\n```',ISSUE_USER:'fixture',ISSUE_NUMBER:'1'}});
 try{callback(ingest,()=>JSON.parse(fs.readFileSync(file,'utf8')));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('community ingestion stores allowlisted summary only and deduplicates',()=>fixture((ingest,read)=>{
 const value={...sample,api_key:'fixture-private-extra',api_url:'https://fixture.invalid',logs:['not a public field']};assert.equal(ingest(value).status,0);assert.equal(ingest(value).status,0);const doc=read();assert.equal(doc.runs.length,1);assert.equal(doc.runs[0].source,'community-self-reported');assert(!JSON.stringify(doc).includes('fixture-private-extra'));assert(!Object.hasOwn(doc.runs[0],'logs'));
}));
test('community ingestion rejects inflated, malformed and secret-like entries',()=>fixture((ingest,read)=>{
 for(const changed of [{score:10001},{completed:true,days_survived:11},{days_survived:43},{difficulty:'unfair'},{participant_type:'admin'},{username:'sk-not-a-real-key-fixture'},{version:'wrong'},{run_id:'bad'}])assert.notEqual(ingest({...sample,...changed}).status,0);
 assert.deepEqual(read().runs,[]);
}));
