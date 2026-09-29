const DEFAULT_ORIGINS=['https://sstxww.github.io'];
const MAX_BODY=2*1024*1024;
const REQUEST_HEADERS=['accept','content-type','authorization','x-api-key','x-goog-api-key','anthropic-version','anthropic-beta','anthropic-dangerous-direct-browser-access'];
const RESPONSE_HEADERS=['content-type','retry-after','x-request-id','request-id'];

function configuredOrigins(env){
  const raw=String(env?.ALLOWED_ORIGINS||'').trim();
  return raw?raw.split(',').map(x=>x.trim()).filter(Boolean):DEFAULT_ORIGINS;
}
function originAllowed(origin,env){
  if(!origin)return false;
  if(configuredOrigins(env).includes(origin))return true;
  if(String(env?.ALLOW_LOCALHOST||'true')!=='false'&&/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin))return true;
  return false;
}
function cors(origin){
  return {
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, X-API-Key, X-Goog-API-Key, Anthropic-Version, Anthropic-Beta, Anthropic-Dangerous-Direct-Browser-Access, X-Blackgate-Target, X-Blackgate-Path',
    'Access-Control-Expose-Headers':'Retry-After, X-Request-Id, Request-Id, X-Blackgate-Gateway',
    'Access-Control-Max-Age':'86400',
    'Cache-Control':'no-store',
    'Vary':'Origin'
  };
}
function reply(origin,status,body){
  return new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json; charset=utf-8','X-Blackgate-Gateway':'stateless-v1'}});
}
function forbiddenHost(hostname,env){
  const h=hostname.toLowerCase().replace(/\.$/,'');
  if(['localhost','0.0.0.0','::1'].includes(h)||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.lan'))return true;
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)||h.includes(':'))return String(env?.ALLOW_IP_TARGETS||'false')!=='true';
  if(['169.254.169.254','metadata.google.internal'].includes(h))return true;
  return false;
}
function parseTarget(raw,env){
  let u;try{u=new URL(String(raw||'').trim());}catch{throw Error('缺少或无效的 X-Blackgate-Target。');}
  if(u.protocol!=='https:')throw Error('上游只允许 HTTPS。');
  if(u.username||u.password||u.search||u.hash)throw Error('上游地址不能包含账号、查询参数或片段。');
  if(forbiddenHost(u.hostname,env))throw Error('拒绝私网、本机或 IP 目标。');
  u.pathname=u.pathname.replace(/\/+$/,'');
  return u;
}
function parsePath(raw){
  const p=String(raw||'').trim();
  if(!p.startsWith('/')||p.startsWith('//')||p.includes('\\')||p.includes('#')||/[\u0000-\u001f\u007f]/.test(p)||p.length>2048)throw Error('无效的 X-Blackgate-Path。');
  return p;
}
function upstreamUrl(base,path){
  const basePath=base.pathname==='/'?'':base.pathname.replace(/\/+$/,'');
  const out=new URL(base.origin+basePath+path);
  if(out.origin!==base.origin||(basePath&&!(out.pathname===basePath||out.pathname.startsWith(basePath+'/'))))throw Error('上游路径越界。');
  return out;
}
function forwardHeaders(request){
  const h=new Headers();
  for(const name of REQUEST_HEADERS){
    const v=request.headers.get(name);
    if(v)h.set(name,v);
  }
  return h;
}
function responseHeaders(upstream,origin){
  const h=new Headers(cors(origin));
  h.set('X-Blackgate-Gateway','stateless-v1');
  for(const name of RESPONSE_HEADERS){
    const v=upstream.headers.get(name);
    if(v)h.set(name,v);
  }
  return h;
}

export default {
  async fetch(request,env={}){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health'){
      return new Response(JSON.stringify({ok:true,service:'blackgate-stateless-gateway',version:1}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
    }

    const origin=request.headers.get('Origin')||'';
    if(!originAllowed(origin,env))return reply('null',403,{error:{message:'Origin 不在允许列表。',type:'gateway_origin_error'}});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors(origin),'X-Blackgate-Gateway':'stateless-v1'}});
    if(!['GET','POST'].includes(request.method))return reply(origin,405,{error:{message:'只允许 GET/POST。',type:'gateway_method_error'}});

    let target,path;
    try{
      target=parseTarget(request.headers.get('X-Blackgate-Target'),env);
      path=parsePath(request.headers.get('X-Blackgate-Path'));
    }catch(e){
      return reply(origin,400,{error:{message:e.message,type:'gateway_target_error'}});
    }

    const declared=Number(request.headers.get('Content-Length')||0);
    if(Number.isFinite(declared)&&declared>MAX_BODY)return reply(origin,413,{error:{message:'请求体超过 2 MiB。',type:'gateway_body_error'}});

    let body;
    if(request.method==='POST'){
      body=await request.arrayBuffer();
      if(body.byteLength>MAX_BODY)return reply(origin,413,{error:{message:'请求体超过 2 MiB。',type:'gateway_body_error'}});
    }

    let upstream;
    try{
      upstream=await fetch(upstreamUrl(target,path),{
        method:request.method,
        headers:forwardHeaders(request),
        body,
        redirect:'manual'
      });
    }catch{
      return reply(origin,502,{error:{message:'兼容网关无法连接上游。',type:'gateway_upstream_error'}});
    }

    if(upstream.status>=300&&upstream.status<400){
      return reply(origin,502,{error:{message:'上游返回重定向；为避免 API Key 被转发到其他主机，网关已拒绝跟随。',type:'gateway_redirect_error'}});
    }

    return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders(upstream,origin)});
  }
};
