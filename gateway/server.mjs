import http from 'node:http';
import worker from './worker.mjs';

const PORT=Number(process.env.PORT||8787);
const MAX_BODY=2*1024*1024;

function absoluteUrl(req){
  const proto=(req.headers['x-forwarded-proto']||'https').toString().split(',')[0].trim();
  const host=(req.headers['x-forwarded-host']||req.headers.host||'localhost').toString().split(',')[0].trim();
  return `${proto}://${host}${req.url||'/'}`;
}

async function readBody(req){
  if(['GET','HEAD','OPTIONS'].includes(req.method||'GET'))return undefined;
  const chunks=[];let total=0;
  for await (const chunk of req){
    total+=chunk.length;
    if(total>MAX_BODY)throw Object.assign(new Error('body too large'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function nodeHeadersToWeb(headers){
  const h=new Headers();
  for(const [name,value] of Object.entries(headers||{})){
    if(value===undefined)continue;
    if(Array.isArray(value))h.set(name,value.join(', '));
    else h.set(name,String(value));
  }
  return h;
}

const server=http.createServer(async(req,res)=>{
  try{
    const body=await readBody(req);
    const init={method:req.method||'GET',headers:nodeHeadersToWeb(req.headers)};
    if(body!==undefined)init.body=body;
    const request=new Request(absoluteUrl(req),init);
    const response=await worker.fetch(request,{
      ALLOWED_ORIGINS:process.env.ALLOWED_ORIGINS||'https://sstxww.github.io',
      ALLOW_LOCALHOST:process.env.ALLOW_LOCALHOST||'false',
      ALLOW_IP_TARGETS:process.env.ALLOW_IP_TARGETS||'false',
      RATE_LIMIT_PER_MINUTE:process.env.RATE_LIMIT_PER_MINUTE||'240'
    });
    res.statusCode=response.status;
    for(const [name,value] of response.headers){
      if(name.toLowerCase()==='content-length')continue;
      res.setHeader(name,value);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){
    res.statusCode=e?.status||500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.end(JSON.stringify({error:{message:e?.status===413?'请求体超过 2 MiB。':'Blackgate 公共网关内部错误。',type:'gateway_internal_error'}}));
  }
});

server.requestTimeout=310000;
server.headersTimeout=320000;
server.keepAliveTimeout=65000;

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`Blackgate gateway listening on :${PORT}`);
});
