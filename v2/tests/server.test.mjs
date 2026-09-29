import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBenchmarkServer,verifyEnvelope} from '../server.mjs';
import {replay} from '../engine.mjs';

test('authoritative API: isolation, boundaries, idempotency, restart, locked reports and signed completion',async t=>{
  const store=path.resolve('v2/tests/.scratch/'+randomUUID());
  let referee=await createBenchmarkServer({port:0,store,rateLimit:100,maxSessions:8});
  t.after(async()=>{await referee.close();await fs.rm(store,{recursive:true,force:true});});
  const request=async(endpoint,{method='GET',data,token,requestId,origin}={})=>{
    const headers={};if(data!==undefined)headers['content-type']='application/json';if(token)headers.authorization='Bearer '+token;
    if(requestId)headers['x-request-id']=requestId;if(origin)headers.origin=origin;
    const res=await fetch(`http://127.0.0.1:${referee.port}${endpoint}`,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
    const txt=await res.text();let value;try{value=JSON.parse(txt);}catch{value=txt;}return {status:res.status,data:value};
  };
  assert.equal((await request('/api/v2/info')).data.mode,'server-authoritative');
  for(const bad of ['/v2/engine.mjs','/v2/content.mjs','/v2/random.mjs','/v2/server.mjs','/.git/config','/.blackgate-v2/signing-key.pem','/v2/../server.mjs','/api/v2/sessions/not-a-session/state'])assert.equal((await request(bad)).status,404,bad);
  assert.equal((await request('/api/v2/info',{origin:'https://attacker.example'})).status,403);
  assert.equal((await request('/api/v2/sessions',{method:'POST',data:{seed:'known-answer'}})).status,400);
  assert.equal((await request('/api/v2/sessions',{method:'POST',data:{score:100}})).status,400);
  assert.equal((await request('/api/v2/sessions',{method:'POST',data:{model:'x'.repeat(20000)}})).status,413);
  const a=(await request('/api/v2/sessions',{method:'POST',data:{model:'API regression control',participant_type:'baseline'}})).data;
  const b=(await request('/api/v2/sessions',{method:'POST',data:{model:'other session'}})).data;
  const route=`/api/v2/sessions/${a.session_id}`;
  assert.notEqual(a.observation.commitments.seed,b.observation.commitments.seed);
  assert.equal((await request(route+'/state')).status,401);
  assert.equal((await request(route+'/state',{token:b.token})).status,401);
  assert.equal((await request(route+'/report',{token:a.token})).status,409);
  const first={revision:0,action:'reject'};
  const send=data=>request(route+'/action',{method:'POST',data,token:a.token,requestId:'same-request-001'});
  const [one,two]=await Promise.all([send(first),send(first)]);
  assert.equal(one.status,200);assert.deepEqual(one.data,two.data);assert.equal(one.data.observation.revision,1);
  assert.equal((await send({revision:1,action:'allow'})).status,409);
  assert.equal((await request(route+'/action',{method:'POST',data:first,token:a.token,requestId:'stale-request-002'})).status,409);
  const before=(await request(route+'/state',{token:a.token})).data;
  assert.ok(!JSON.stringify(before).includes('seed_reveal'));
  await referee.close();referee=await createBenchmarkServer({port:0,store,rateLimit:100,maxSessions:8});
  assert.deepEqual((await request(route+'/state',{token:a.token})).data,before);
  assert.deepEqual((await send(first)).data,one.data,'idempotent request receipt survives restart');
  let o=before.observation;
  while(!o.finished) {
    const response=await request(route+'/action',{method:'POST',token:a.token,requestId:'finish-'+String(o.revision).padStart(6,'0'),
      data:{revision:o.revision,action:o.phase==='council'?'next_day':'reject'}});
    assert.equal(response.status,200,JSON.stringify(response.data));o=response.data.observation;
  }
  const envelope=(await request(route+'/report',{token:a.token})).data;
  assert.ok(verifyEnvelope(envelope,referee.publicKey));assert.equal(replay(envelope.report).ok,true);
  const forged=structuredClone(envelope);forged.report.score=100;assert.equal(verifyEnvelope(forged,referee.publicKey),false);
  const forgedName=structuredClone(envelope);forgedName.metadata.model='Unobserved model';assert.equal(verifyEnvelope(forgedName,referee.publicKey),false);
  const board=(await request('/api/v2/leaderboard?difficulty=abyss')).data;
  assert.equal(board.rows.length,1);assert.equal(board.rows[0].score,envelope.report.score);assert.equal(board.rows[0].model_identity,'self-declared');
  assert.equal((await request('/api/v2/leaderboard?difficulty=nightmare')).data.rows.length,0);
  assert.equal((await request('/api/v2/leaderboard',{method:'POST',data:{score:100}})).status,404);
  assert.equal((await request('/v2/')).status,200);assert.equal((await request('/v2/app.mjs')).status,200);
});
