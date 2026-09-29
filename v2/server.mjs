import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, timingSafeEqual } from 'node:crypto';
import { Campaign } from './engine.mjs';
import { VERSION, CONTENT_VERSION, RULES, TESTS, POLICIES, DIFFICULTIES } from './content.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const digest=s=>createHash('sha256').update(s).digest('hex');
const json=(res,status,data)=>{const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(body);};
function error(status,message){const e=new Error(message);e.status=status;return e;}
async function body(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw error(415,'Content-Type must be application/json');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>16384)throw error(413,'request too large');chunks.push(chunk);}
  try{const out=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!out||typeof out!=='object'||Array.isArray(out))throw Error();return out;}catch{throw error(400,'invalid JSON object');}
}
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,value,{mode:0o600});await fs.rename(tmp,file);}
export function verifyEnvelope(envelope,publicKey) {
  if(!envelope?.report||!envelope?.attestation)return false;
  try{return verify(null,Buffer.from(JSON.stringify({report:envelope.report,metadata:envelope.metadata})),publicKey,Buffer.from(envelope.attestation.signature,'base64'));}catch{return false;}
}

/** No client-supplied seed, verdict, score or public trust level is accepted.
 * Bind behind a TLS/authentication/rate-limiting proxy before exposing to the Internet.
 * A server signature authenticates its transcript, not the identity of a claimed model.
 */
export async function createBenchmarkServer({host='127.0.0.1',port=8788,store=path.join(here,'..','.blackgate-v2'),maxSessions=24,ttlMs=6*60*60*1000,rateLimit=12}={}) {
  await fs.mkdir(store,{recursive:true});
  const keyPath=path.join(store,'signing-key.pem');let privateKey;
  try{privateKey=createPrivateKey(await fs.readFile(keyPath));}catch(e){
    if(e.code!=='ENOENT')throw e;
    const keys=generateKeyPairSync('ed25519');privateKey=keys.privateKey;
    await fs.writeFile(keyPath,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
  }
  const publicKey=createPublicKey(privateKey).export({type:'spki',format:'pem'}).toString();
  const keyId=digest(publicKey).slice(0,20),sessions=new Map(),board=new Map(),rates=new Map();
  await fs.mkdir(path.join(store,'reports'),{recursive:true});
  const summary=envelope=>({id:envelope.metadata.run_id,model:envelope.metadata.model,participant_type:envelope.metadata.participant_type,
    version:envelope.report.version,content_version:envelope.report.content_version,difficulty:envelope.report.difficulty,
    days_survived:envelope.report.days_survived,completed:envelope.report.completed,score:envelope.report.score,metrics:envelope.report.metrics,
    source:'server-authoritative',model_identity:'self-declared',finished_at:envelope.metadata.finished_at,key_id:envelope.attestation.key_id});
  for(const file of await fs.readdir(path.join(store,'reports'))){
    if(!file.endsWith('.json'))continue;
    const envelope=JSON.parse(await fs.readFile(path.join(store,'reports',file),'utf8'));
    if(verifyEnvelope(envelope,publicKey))board.set(envelope.metadata.run_id,summary(envelope));
  }
  function checkpointSession(s){return atomic(path.join(store,'active',s.id+'.json'),JSON.stringify({
    id:s.id,token_hash:s.tokenHash,seed:s.seed,difficulty:s.difficulty,metadata:s.metadata,expires:s.expires,actions:s.actions,
    // The cached request fingerprint makes an interrupted final-response retry idempotent after restart.
    request_cache:[...s.cache.entries()].map(([id,v])=>[id,{fingerprint:v.fingerprint,revision:v.result.observation.revision}])
  }));}
  await fs.mkdir(path.join(store,'active'),{recursive:true});
  for(const file of await fs.readdir(path.join(store,'active'))) {
    if(!file.endsWith('.json'))continue;
    const old=JSON.parse(await fs.readFile(path.join(store,'active',file),'utf8'));
    if(old.expires<Date.now()){await fs.unlink(path.join(store,'active',file));continue;}
    const game=new Campaign({seed:old.seed,difficulty:old.difficulty}),responses=new Map([[0,game.observe()]]);
    for(const input of old.actions){game.step(input);responses.set(game.observe().revision,game.observe());}
    const cache=new Map((old.request_cache||[]).map(([id,v])=>[id,{fingerprint:v.fingerprint,result:{observation:responses.get(v.revision)}}]));
    const s={...old,game,cache,tokenHash:old.token_hash,queue:Promise.resolve(),envelope:null};
    if(game.observe().finished) {
      try{s.envelope=JSON.parse(await fs.readFile(path.join(store,'reports',old.id+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    sessions.set(s.id,s);
  }
  async function completed(s) {
    if(s.envelope)return;
    const report=s.game.report(),metadata={...s.metadata,run_id:s.id,finished_at:new Date().toISOString(),source:'server-authoritative',model_identity:'self-declared'};
    const signature=sign(null,Buffer.from(JSON.stringify({report,metadata})),privateKey).toString('base64');
    s.envelope={report,metadata,attestation:{algorithm:'Ed25519',key_id:keyId,signature}};
    await atomic(path.join(store,'reports',s.id+'.json'),JSON.stringify(s.envelope));
    board.set(s.id,summary(s.envelope));
  }
  for(const s of sessions.values())if(s.game.observe().finished)await completed(s);
  const staticFiles=new Map([
    ['/','index.html'],['/v2/','index.html'],['/v2/index.html','index.html'],
    ['/v2/app.mjs','app.mjs'],['/v2/style.css','style.css']
  ]);
  const server=http.createServer(async(req,res)=>{
    try {
      const authority=req.headers.host||'';
      const hostname=authority.replace(/:\d+$/,'');
      const allowedHosts=new Set(['127.0.0.1','localhost','[::1]',host,...(process.env.BLACKGATE_ALLOWED_HOSTS||'').split(',').filter(Boolean)]);
      if(!allowedHosts.has(hostname))throw error(403,'untrusted Host header');
      if(req.headers.origin) {
        const origin=new URL(req.headers.origin);
        if(origin.host!==authority||!['http:','https:'].includes(origin.protocol))throw error(403,'cross-origin access denied');
      }
      const url=new URL(req.url,'http://'+authority);
      if(url.pathname==='/api/v2/info'&&req.method==='GET')return json(res,200,{version:VERSION,content_version:CONTENT_VERSION,
        mode:'server-authoritative',trust_note:'Model identity is self-declared. A server receipt is not a standardized multi-model tournament.',
        rules:RULES,tests:TESTS,policies:POLICIES,difficulties:DIFFICULTIES});
      if(url.pathname==='/api/v2/public-key'&&req.method==='GET')return json(res,200,{algorithm:'Ed25519',key_id:keyId,public_key:publicKey});
      if(url.pathname==='/api/v2/leaderboard'&&req.method==='GET') {
        const cohort=url.searchParams.get('difficulty')||'abyss';
        return json(res,200,{version:VERSION,content_version:CONTENT_VERSION,difficulty:cohort,
          note:'Only server-generated finished runs; model names are self-declared; no cross-version ranking.',
          rows:[...board.values()].filter(x=>x.version===VERSION&&x.content_version===CONTENT_VERSION&&x.difficulty===cohort)
            .sort((a,b)=>Number(b.completed)-Number(a.completed)||b.days_survived-a.days_survived||b.score-a.score).slice(0,100)});
      }
      if(url.pathname==='/api/v2/sessions'&&req.method==='POST') {
        const input=await body(req);
        if(Object.keys(input).some(k=>!['model','participant_type','difficulty'].includes(k)))throw error(400,'unknown field; client seeds and scores are not accepted');
        for(const [id,s]of sessions)if(s.expires<Date.now()){sessions.delete(id);await fs.unlink(path.join(store,'active',id+'.json')).catch(()=>{});}
        for(const [ip,v]of rates)if(v.until<Date.now())rates.delete(ip);
        const ip=req.socket.remoteAddress,bucket=rates.get(ip)||{count:0,until:Date.now()+60000};
        if(++bucket.count>rateLimit)throw error(429,'too many new sessions; retry after one minute');rates.set(ip,bucket);
        if(sessions.size>=maxSessions)throw error(429,'session capacity reached');
        const difficulty=input.difficulty||'abyss';if(!Object.hasOwn(DIFFICULTIES,difficulty))throw error(400,'unknown difficulty');
        if(input.model!==undefined&&(typeof input.model!=='string'||input.model.length>80))throw error(400,'model name must be at most 80 characters');
        if(input.participant_type!==undefined&&!['human','ai','baseline'].includes(input.participant_type))throw error(400,'invalid participant type');
        const token=randomBytes(32).toString('base64url'),seed=randomBytes(32).toString('hex'),id=randomUUID();
        const game=new Campaign({seed,difficulty}),s={id,seed,difficulty,game,tokenHash:digest(token),expires:Date.now()+ttlMs,
          metadata:{model:input.model||'Anonymous',participant_type:input.participant_type||'ai'},actions:[],cache:new Map(),queue:Promise.resolve(),envelope:null};
        sessions.set(id,s);await checkpointSession(s);
        return json(res,201,{session_id:id,token,observation:game.observe(),mode:'server-authoritative'});
      }
      const match=url.pathname.match(/^\/api\/v2\/sessions\/([a-f0-9-]+)\/(state|action|archive|report)$/);
      if(match) {
        const s=sessions.get(match[1]);
        if(!s||s.expires<Date.now())throw error(404,'session expired or not found');
        const auth=req.headers.authorization||'';
        // Fixed-length hashes are compared here; never return or log the bearer token.
        if(!auth.startsWith('Bearer ')||!timingSafeEqual(Buffer.from(digest(auth.slice(7)),'hex'),Buffer.from(s.tokenHash,'hex')))throw error(401,'invalid session token');
        const endpoint=match[2];
        if(endpoint==='state'&&req.method==='GET')return json(res,200,{observation:s.game.observe()});
        if(endpoint==='archive'&&req.method==='GET')return json(res,200,s.game.recall(url.searchParams.get('q')||'',200));
        if(endpoint==='report'&&req.method==='GET') {
          if(!s.game.observe().finished)throw error(409,'full report is locked until the campaign ends');
          await completed(s);return json(res,200,s.envelope);
        }
        if(endpoint==='action'&&req.method==='POST') {
          const input=await body(req),requestId=req.headers['x-request-id'];
          if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw error(400,'X-Request-Id must contain 8–100 safe characters');
          const fingerprint=digest(JSON.stringify(input));
          const operation=s.queue.then(async()=>{
            if(s.cache.has(requestId)) {
              const cached=s.cache.get(requestId);if(cached.fingerprint!==fingerprint)throw error(409,'request id reused with different content');return cached.result;
            }
            if(s.actions.length>=5000)throw error(429,'action safety cap reached');
            let observation;try{observation=s.game.step(input);}catch(e){throw error(/revision/.test(e.message)?409:400,e.message);}
            s.actions.push(input);const result={observation};s.cache.set(requestId,{fingerprint,result});
            if(s.cache.size>256)s.cache.delete(s.cache.keys().next().value);
            await checkpointSession(s);if(observation.finished)await completed(s);return result;
          });
          s.queue=operation.catch(()=>{});return json(res,200,await operation);
        }
        throw error(405,'method not allowed');
      }
      if(req.method==='GET'&&url.pathname==='/'){res.writeHead(302,{location:'/v2/'});return res.end();}
      if(req.method==='GET'&&staticFiles.has(url.pathname)) {
        const file=staticFiles.get(url.pathname),data=await fs.readFile(path.join(here,file));
        const mime=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript';
        res.writeHead(200,{'content-type':mime+'; charset=utf-8','content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff',
          'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
          'referrer-policy':'no-referrer'});return res.end(data);
      }
      // Explicit allowlist: no seed, source module, .git, private key, stored run or active file can be fetched.
      throw error(404,'not found');
    }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'internal server error'});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {server,port:server.address().port,publicKey,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=await createBenchmarkServer({host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||8788),store:process.env.BLACKGATE_STORE||path.join(here,'..','.blackgate-v2')});
  console.log(`Blackgate v${VERSION} authoritative referee: http://${process.env.HOST||'127.0.0.1'}:${server.port}/v2/`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close().then(()=>process.exit(0)));
}
