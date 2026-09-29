import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../../gateway/worker.mjs';
import {RelayClient} from '../../relay-client.mjs';

test('gateway answers browser preflight without provider auth',async()=>{
  const req=new Request('https://gateway.example/',{
    method:'OPTIONS',
    headers:{
      Origin:'https://sstxww.github.io',
      'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'authorization,content-type,x-blackgate-target,x-blackgate-path'
    }
  });
  const res=await gateway.fetch(req,{});
  assert.equal(res.status,204);
  assert.equal(res.headers.get('access-control-allow-origin'),'https://sstxww.github.io');
  assert.match(res.headers.get('access-control-allow-headers'),/Authorization/i);
  assert.match(res.headers.get('access-control-allow-headers'),/X-Blackgate-Target/i);
});

test('relay client sends provider target and path to explicit gateway',async()=>{
  let seen;
  const fakeFetch=async(url,init)=>{
    seen={url:String(url),headers:new Headers(init.headers),method:init.method};
    return new Response(JSON.stringify({data:[{id:'deepseek-test'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new RelayClient({
    url:'https://provider.example/v1',
    key:'sk-test-only-not-real',
    gateway:'https://gateway.example/relay',
    fetchImpl:fakeFetch
  });
  const ids=await client.models();
  assert.deepEqual(ids,['deepseek-test']);
  assert.equal(seen.url,'https://gateway.example/relay');
  assert.equal(seen.method,'GET');
  assert.equal(seen.headers.get('x-blackgate-target'),'https://provider.example/v1');
  assert.equal(seen.headers.get('x-blackgate-path'),'/models');
  assert.equal(seen.headers.get('authorization'),'Bearer sk-test-only-not-real');
  assert.equal(client.transport,'gateway');
});

test('gateway forwards only approved headers and preserves provider response',async()=>{
  const originalFetch=globalThis.fetch;
  let seen;
  globalThis.fetch=async(url,init)=>{
    seen={url:String(url),headers:new Headers(init.headers),body:init.body};
    return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{
      status:200,
      headers:{'Content-Type':'application/json','Set-Cookie':'do-not-forward=1','X-Request-Id':'req-1'}
    });
  };
  try{
    const req=new Request('https://gateway.example/relay',{
      method:'POST',
      headers:{
        Origin:'https://sstxww.github.io',
        'Content-Type':'application/json',
        Authorization:'Bearer test-secret',
        Cookie:'must-not-forward=1',
        'X-Blackgate-Target':'https://provider.example/v1',
        'X-Blackgate-Path':'/chat/completions'
      },
      body:'{"model":"x"}'
    });
    const res=await gateway.fetch(req,{});
    assert.equal(res.status,200);
    assert.equal(seen.url,'https://provider.example/v1/chat/completions');
    assert.equal(seen.headers.get('authorization'),'Bearer test-secret');
    assert.equal(seen.headers.get('cookie'),null);
    assert.equal(seen.headers.get('x-blackgate-target'),null);
    assert.equal(res.headers.get('set-cookie'),null);
    assert.equal(res.headers.get('x-request-id'),'req-1');
    assert.equal(res.headers.get('access-control-allow-origin'),'https://sstxww.github.io');
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('gateway rejects private/IP targets and upstream redirects',async()=>{
  const privateReq=new Request('https://gateway.example/relay',{
    method:'GET',
    headers:{
      Origin:'https://sstxww.github.io',
      'X-Blackgate-Target':'https://127.0.0.1/v1',
      'X-Blackgate-Path':'/models'
    }
  });
  const privateRes=await gateway.fetch(privateReq,{});
  assert.equal(privateRes.status,400);

  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}});
  try{
    const req=new Request('https://gateway.example/relay',{
      method:'GET',
      headers:{
        Origin:'https://sstxww.github.io',
        'X-Blackgate-Target':'https://provider.example/v1',
        'X-Blackgate-Path':'/models'
      }
    });
    const res=await gateway.fetch(req,{});
    assert.equal(res.status,502);
    const body=await res.json();
    assert.match(body.error.message,/重定向/);
  }finally{
    globalThis.fetch=originalFetch;
  }
});
