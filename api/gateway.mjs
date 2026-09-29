import worker from '../gateway/worker.mjs';

function first(value){
  return Array.isArray(value)?value[0]:value;
}

function absoluteUrl(req){
  const proto=first(req.headers['x-forwarded-proto'])||'https';
  const host=first(req.headers['x-forwarded-host'])||first(req.headers.host)||'localhost';
  return `${proto}://${host}${req.url||'/api/gateway'}`;
}

function bodyFrom(req){
  if(['GET','HEAD','OPTIONS'].includes(String(req.method||'GET').toUpperCase()))return undefined;
  const body=req.body;
  if(body===undefined||body===null)return undefined;
  if(typeof body==='string'||body instanceof Uint8Array)return body;
  return JSON.stringify(body);
}

export default async function handler(req,res){
  try{
    const headers=new Headers();
    for(const [name,value] of Object.entries(req.headers||{})){
      if(value===undefined)continue;
      if(Array.isArray(value))headers.set(name,value.join(', '));
      else headers.set(name,String(value));
    }
    const body=bodyFrom(req);
    const init={method:req.method||'GET',headers};
    if(body!==undefined)init.body=body;
    const webRequest=new Request(absoluteUrl(req),init);
    const response=await worker.fetch(webRequest,{
      ALLOWED_ORIGINS:process.env.ALLOWED_ORIGINS||'https://sstxww.github.io',
      ALLOW_LOCALHOST:process.env.ALLOW_LOCALHOST||'false',
      ALLOW_IP_TARGETS:process.env.ALLOW_IP_TARGETS||'false'
    });

    res.statusCode=response.status;
    for(const [name,value] of response.headers){
      if(name.toLowerCase()==='content-length')continue;
      res.setHeader(name,value);
    }
    const bytes=new Uint8Array(await response.arrayBuffer());
    res.end(Buffer.from(bytes));
  }catch{
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.end(JSON.stringify({error:{message:'Blackgate 公共网关内部错误。',type:'gateway_internal_error'}}));
  }
}
