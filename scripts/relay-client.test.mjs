import test from 'node:test';
import assert from 'node:assert/strict';
import {RelayClient,endpoint,modelIds,responseText,parseDecision} from '../relay-client.mjs';
const key='fixture-only-secret-1029384756';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const make=fetchImpl=>new RelayClient({url:'https://relay.example/v1',key,fetchImpl});
const options={model:'fixture-model',effort:'high',system:'public rules',user:'public state'};
test('normalize supported endpoint families and retain proxy path',()=>{
 assert.equal(endpoint('https://relay.example/proxy/v1/chat/completions').base,'https://relay.example/proxy/v1');
 assert.equal(endpoint('https://relay.example/v1/responses').protocol,'responses');
 assert.equal(endpoint('https://relay.example/v1/messages').protocol,'anthropic');
 assert.equal(endpoint('https://generativelanguage.googleapis.com/v1beta').protocol,'gemini');
 assert.equal(endpoint('https://relay.example').base,'https://relay.example/v1');
});
test('reject credentials, URL query secrets and unencrypted remote URL',()=>{
 for(const url of ['http://relay.example/v1','https://user:pass@relay.example/v1','https://relay.example/v1?api_key=secret','javascript:alert(1)'])assert.throws(()=>endpoint(url));
 assert.equal(endpoint('http://127.0.0.1:1234/v1').base,'http://127.0.0.1:1234/v1');
});
test('list models without brand whitelist',()=>{
 assert.deepEqual(modelIds({data:[{id:'Qwen3'},{id:'DeepSeek'},{id:'GLM'},{id:'Kimi'},{id:'MiniMax'},{id:'Doubao'},{id:'Hunyuan'}]}),['DeepSeek','Doubao','GLM','Hunyuan','Kimi','MiniMax','Qwen3']);
 assert.deepEqual(modelIds({models:[{name:'models/gemini-test',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]}),['gemini-test']);
});
test('only parse executable final content, not hidden thinking',()=>{
 assert.equal(responseText({content:[{type:'thinking',thinking:'private'},{type:'text',text:'ok'}]}),'ok');
 assert.equal(responseText({output:[{type:'reasoning',summary:[{text:'private'}]},{type:'message',content:[{type:'output_text',text:'ok'}]}]}),'ok');
 assert.equal(responseText({candidates:[{content:{parts:[{thought:true,text:'private'},{text:'ok'}]}}]}),'ok');
});
test('no action guessing from prose or contradictory alternatives',()=>{
 assert.throws(()=>parseDecision('Do not allow; reject could be better.'));
 assert.throws(()=>parseDecision('{"x":"allow"}'));
 assert.equal(parseDecision('```json\n{"action":"allow","revision":0}\n```').action,'allow');
});
test('chat carries requested effort and key only in header',async()=>{
 const c=make(async(url,init)=>{const b=JSON.parse(init.body);assert.equal(b.reasoning_effort,'high');assert.equal(init.headers.Authorization,'Bearer '+key);assert.equal(init.body.includes(key),false);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return json({choices:[{message:{content:'{"action":"allow"}'}}]});});
 const out=await c.complete(options);assert.equal(out.effortStatus,'requested-not-attested');assert.equal(JSON.stringify(c).includes(key),false);
});
test('responses payload is stateless and uses reasoning.effort',()=>{
 const c=make(()=>{}),p=c.payload('responses',options);assert.equal(p.store,false);assert.equal(p.reasoning.effort,'high');assert.equal(p.stream,false);
});
test('Anthropic and Gemini native payload mapping',()=>{
 const c=make(()=>{}),a=c.payload('anthropic',options);assert.equal(a.thinking.budget_tokens,16384);assert(a.max_tokens>a.thinking.budget_tokens);
 const g=c.payload('gemini',{...options,model:'gemini-3-test'});assert.equal(g.generationConfig.thinkingConfig.thinkingLevel,'high');
 assert.throws(()=>c.payload('gemini',{...options,effort:'xhigh'}));
 assert.throws(()=>c.payload('gemini',{...options,model:'gemini-3-test',effort:'none'}),/不会把/);
});
test('unsupported effort is not silently downgraded',async()=>{
 let count=0;const c=make(async()=>{count++;return json({error:{message:'unsupported reasoning_effort'}},400)});
 await assert.rejects(c.complete(options),/未偷偷降级/);assert.equal(count,1);
});
test('error and model-output secrets redacted before logging',async()=>{
 const c=make(async()=>json({error:{message:'bad key '+key+' '+encodeURIComponent(key)}},401));
 try{await c.complete(options);assert.fail('should reject');}catch(e){assert.equal(e.message.includes(key),false);}
 assert.equal(c.sanitize('hello '+key),'hello [REDACTED]');
});
test('pre-aborted calls never send requests',async()=>{
 let count=0;const c=make(async()=>{count++;return json({data:[]})});const a=new AbortController();a.abort();await assert.rejects(c.models(a.signal),{name:'AbortError'});assert.equal(count,0);
});
test('in-flight cancellation interrupts fetch',async()=>{
 const c=make((u,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')))}));
 const a=new AbortController(),p=c.complete(options,a.signal);setTimeout(()=>a.abort(),10);await assert.rejects(p,{name:'AbortError'});
});
test('auto fallback is only endpoint absence, then protocol cached',async()=>{
 const paths=[];const c=make(async(url)=>{paths.push(url);return url.endsWith('/chat/completions')?json({},404):json({output_text:'{"action":"allow"}'});});
 await c.complete(options);await c.complete(options);assert.equal(paths.filter(p=>p.endsWith('/chat/completions')).length,1);assert.equal(c.protocol,'responses');
});
test('Gemini models pagination and key in header not URL',async()=>{
 let page=0;const c=new RelayClient({url:'https://generativelanguage.googleapis.com/v1beta',key,fetchImpl:async(url,init)=>{assert(!url.includes(key));assert.equal(init.headers['x-goog-api-key'],key);return json(++page===1?{models:[{name:'models/a'}],nextPageToken:'next'}:{models:[{name:'models/b'}]});}});
 assert.deepEqual(await c.models(),['a','b']);assert.equal(page,2);
});
