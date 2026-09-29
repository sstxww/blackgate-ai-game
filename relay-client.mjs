/* Browser-only relay transport. Keys stay in private memory; never persisted.
 * No third-party SDK, analytics, credential proxy or protocol downgrade.
 */
export function endpoint(raw, requested = 'auto') {
  let u; try { u = new URL(String(raw).trim()); } catch { throw Error('请输入完整 API 地址，例如 https://relay.example/v1'); }
  if (u.username || u.password || u.search || u.hash) throw Error('地址不能包含密码、查询参数或片段；请把密钥只填入 API Key。');
  const local = ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw Error('为保护密钥，只支持 HTTPS；本机 localhost 可用 HTTP。');
  let p = u.pathname.replace(/\/+$/, ''), detected = 'chat';
  if (/\/responses$/i.test(p)) detected = 'responses';
  else if (/\/messages$/i.test(p) || /(^|\.)anthropic\.com$/.test(u.hostname)) detected = 'anthropic';
  else if (/generativelanguage\.googleapis\.com$/.test(u.hostname) && !/\/openai(?:\/|$)/.test(p)) detected = 'gemini';
  if (/\/models\/[^/]+:generateContent$/.test(p)) detected = 'gemini';
  p = p.replace(/\/(?:chat\/completions|responses|messages|models\/[^/]+:generateContent|models)$/i, '');
  const protocol = requested === 'auto' ? detected : requested;
  if (!['chat','responses','anthropic','gemini'].includes(protocol)) throw Error('不支持的接口协议');
  if (!p) p = protocol === 'gemini' ? '/v1beta' : '/v1';
  return {base:u.origin+p, origin:u.origin, protocol, automatic:requested === 'auto' && detected === 'chat'};
}

export function gatewayEndpoint(raw) {
  const value=String(raw||'').trim();
  if(!value)return '';
  let u;try{u=new URL(value);}catch{throw Error('兼容网关地址无效，请填写完整 HTTPS 地址。');}
  if(u.username||u.password||u.search||u.hash)throw Error('兼容网关地址不能包含账号、查询参数或片段。');
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if(u.protocol!=='https:'&&!(local&&u.protocol==='http:'))throw Error('兼容网关只支持 HTTPS；本机 localhost 可用 HTTP。');
  return u.origin+u.pathname.replace(/\/+$/,'');
}
export function normalizeApiKey(raw){
  let s=String(raw??'').normalize('NFKC').trim();
  s=s.replace(/^Bearer\s+/i,'');
  s=s.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'');
  s=s.replace(/\s+/g,'');
  s=s.replace(/^[\"'“”‘’]+|[\"'“”‘’]+$/g,'');
  return s;
}
export function modelIds(data) {
  const list = Array.isArray(data) ? data : data?.data || data?.models || [];
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(x => !x?.supportedGenerationMethods || x.supportedGenerationMethods.includes('generateContent')).map(x => typeof x === 'string' ? x : x?.id || x?.name || x?.model).filter(x => typeof x === 'string' && x.length > 0 && x.length <= 200).map(x => x.replace(/^models\//,'')))].sort();
}
export function responseText(data) {
  const m = data?.choices?.[0]?.message;
  if (typeof m?.content === 'string') return m.content;
  if (Array.isArray(m?.content)) return m.content.filter(p => !p.thought && p.type !== 'thinking').map(p=>p.text||'').join('\n');
  if (typeof data?.output_text === 'string') return data.output_text;
  if (Array.isArray(data?.output)) return data.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(p=>p.type==='output_text').map(p=>p.text||'').join('\n');
  if (Array.isArray(data?.content)) return data.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n');
  if (data?.candidates) return (data.candidates[0]?.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('\n');
  return '';
}
export function usage(data) {
  const u=data?.usage||data?.usageMetadata||{};
  const input=Number(u.input_tokens??u.prompt_tokens??u.promptTokenCount??0)||0;
  const output=Number(u.output_tokens??u.completion_tokens??u.candidatesTokenCount??0)||0;
  const reasoning=Number(u.output_tokens_details?.reasoning_tokens??u.completion_tokens_details?.reasoning_tokens??u.thoughtsTokenCount??0)||0;
  return {input,output,reasoning,total:Number(u.total_tokens??u.totalTokenCount??input+output)||0,reported:!!(data?.usage||data?.usageMetadata)};
}
export function parseDecision(raw) {
  let t=String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let obj; try { obj=JSON.parse(t); } catch { throw Error('模型没有返回完整 JSON 动作；不会猜测或替它落子。'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.action !== 'string') throw Error('模型动作格式不正确');
  return obj;
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new DOMException('已停止','AbortError'));
  const abort=()=>{clearTimeout(t);reject(new DOMException('已停止','AbortError'));};
  const t=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});
export class RelayClient {
  #key; #config; #gateway; #publicGateway; #activeGateway; #gatewayType; #preferPublic; #fetch;
  constructor({url,key,protocol='auto',gateway='',publicGateway='',preferPublic=false,fetchImpl=globalThis.fetch}) {
    this.#config=endpoint(url,protocol);
    this.#gateway=gatewayEndpoint(gateway);
    this.#publicGateway=gatewayEndpoint(publicGateway);
    this.#preferPublic=!!preferPublic;
    this.#activeGateway=this.#gateway||(this.#preferPublic?this.#publicGateway:'');
    this.#gatewayType=this.#gateway?'gateway':this.#activeGateway?'public-gateway':'direct';
    this.#key=normalizeApiKey(key);
    this.#fetch=fetchImpl.bind(globalThis);
    if(!this.#key && !/https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(this.#config.base)) throw Error('请输入 API Key');
  }
  get protocol(){return this.#config.protocol;}
  get transport(){return this.#gatewayType;}
  clear(){this.#key='';}
  sanitize(value){
    let s=typeof value==='string'?value:JSON.stringify(value);
    if(this.#key)for(const secret of new Set([this.#key,encodeURIComponent(this.#key)]))s=s.split(secret).join('[REDACTED]');
    return s.replace(/\b(?:sk-[\w-]{8,}|apikey_[\w-]{8,}|AIza[\w-]{20,})\b/g,'[REDACTED]');
  }
  headers(protocol=this.protocol,forGateway=false){
    const h={Accept:'application/json'};
    if(protocol==='anthropic'){h['anthropic-version']='2023-06-01';h['anthropic-dangerous-direct-browser-access']='true';}
    if(!this.#key)return h;
    if(forGateway){
      h['X-Blackgate-Key']=this.#key;
      h['X-Blackgate-Auth']=protocol==='anthropic'?'anthropic':protocol==='gemini'?'gemini':'bearer';
    }else if(protocol==='anthropic')h['x-api-key']=this.#key;
    else if(protocol==='gemini')h['x-goog-api-key']=this.#key;
    else h.Authorization='Bearer '+this.#key;
    return h;
  }
  async request(path,{body,signal,protocol=this.protocol,onAttempt=()=>{}}={}){
    if(signal?.aborted)throw new DOMException('已停止','AbortError');
    for(let attempt=0;attempt<3;attempt++){
      const aborter=new AbortController(), abort=()=>aborter.abort();
      signal?.addEventListener('abort',abort,{once:true});
      let timedOut=false;const timer=setTimeout(()=>{timedOut=true;aborter.abort();},300000);
      const started=performance.now();
      try{
        onAttempt({attempt:attempt+1,protocol});
        const headers=this.headers(protocol,!!this.#activeGateway);if(body)headers['Content-Type']='application/json';
        let requestUrl=this.#config.base+path;
        if(this.#activeGateway){
          requestUrl=this.#activeGateway;
          headers['X-Blackgate-Target']=this.#config.base;
          headers['X-Blackgate-Path']=path;
        }
        const res=await this.#fetch(requestUrl,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:aborter.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
        const raw=await res.text();
        if(!res.ok){
          if([429,502,503,504].includes(res.status)&&attempt<2){
            const retry=Math.min(20000,Math.max(1000,Number(res.headers.get('retry-after')||0)*1000||1000*2**attempt));
            clearTimeout(timer);signal?.removeEventListener('abort',abort);await delay(retry,signal);continue;
          }
          let note='';try{const d=JSON.parse(raw);note=d.error?.message||d.message||'';}catch{}
          const baseMessage=this.sanitize(String(note)||({401:'密钥无效或已过期',403:'无模型权限或额度不足',404:'接口路径或模型不存在',429:'请求限流'}[res.status]||'接口返回错误')).slice(0,240);\n          const keyHint=res.status===401?`（已清理 Bearer/空格/隐藏字符；当前 Key 长度 ${this.#key.length}）`:'';\n          const err=Error(`HTTP ${res.status}：`+baseMessage+keyHint);
          err.status=res.status;
          if([400,422].includes(res.status)&&/reasoning|thinking|effort|budget/i.test(note))err.message+='。未偷偷降级，请选择“模型默认”或该模型支持的档位。';
          throw err;
        }
        let data;try{data=JSON.parse(raw);}catch{throw Error('接口返回的不是 JSON。请检查地址是否为 API，而不是中转站首页。');}
        return {data,latency:Math.round(performance.now()-started),protocol};
      }catch(e){
        if(signal?.aborted)throw new DOMException('已停止','AbortError');
        if(timedOut)throw Error('请求超过 5 分钟，已暂停。服务商可能仍计费；本页不会自动重复这次请求。');
        if(e instanceof TypeError){
          const err=Error(this.#activeGateway?'浏览器无法连接兼容网关：请检查网关地址、HTTPS 与网关 CORS。':'浏览器无法直连该接口：通常是中转站 CORS/OPTIONS 被拦。');
          err.code=this.#activeGateway?'GATEWAY_CONNECT_FAILED':'DIRECT_CONNECT_FAILED';
          throw err;
        }
        throw e;
      }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
  }
  async models(signal){
    try{
      let path='/models', all=[];
      for(let page=0;page<5;page++){
        const {data}=await this.request(path,{signal});all.push(...modelIds(data));
        if(this.protocol==='gemini'&&data.nextPageToken)path='/models?pageToken='+encodeURIComponent(data.nextPageToken);
        else if(this.protocol==='anthropic'&&data.has_more&&data.last_id)path='/models?after_id='+encodeURIComponent(data.last_id);
        else break;
      }
      const ids=[...new Set(all)].sort();
      if(!ids.length)throw Error('接口未返回可用模型，请展开“连接帮助”填写模型 ID。');
      return ids;
    }catch(e){
      // Public site prefers the shared gateway so first-time users never need a failed CORS attempt.
      // If the shared gateway itself is unreachable at the browser/network layer, model discovery
      // may safely try direct once because GET /models is non-mutating. Generation requests are
      // never replayed across transports.
      if(e?.code==='GATEWAY_CONNECT_FAILED'&&this.#gatewayType==='public-gateway'){
        this.#activeGateway='';
        this.#gatewayType='direct';
        return this.models(signal);
      }
      if(e?.code==='DIRECT_CONNECT_FAILED'&&this.#publicGateway&&!this.#activeGateway&&!this.#preferPublic){
        this.#activeGateway=this.#publicGateway;
        this.#gatewayType='public-gateway';
        return this.models(signal);
      }
      throw e;
    }
  }
  payload(protocol,{model,effort='auto',system,user}){
    const thought=effort==='auto'?{}:{reasoning_effort:effort};
    if(protocol==='chat')return {model,messages:[{role:'system',content:system},{role:'user',content:user}],stream:false,...thought};
    if(protocol==='responses')return {model,input:[{role:'system',content:system},{role:'user',content:user}],stream:false,store:false,...(effort==='auto'?{}:{reasoning:{effort}})};
    if(protocol==='anthropic'){
      // Explicit token budgets, not a claim of equal effort across model families.
      const budgets={minimal:1024,low:2048,medium:8192,high:16384,xhigh:32768,max:32768};
      if(!['auto','none',...Object.keys(budgets)].includes(effort))throw Error('此协议不支持该推理档位');
      const thinking=effort==='auto'?{}:effort==='none'?{thinking:{type:'disabled'}}:{thinking:{type:'enabled',budget_tokens:budgets[effort]}};
      return {model,max_tokens:Math.max(4096,(budgets[effort]||0)+4096),system,messages:[{role:'user',content:user}],...thinking};
    }
    if(protocol==='gemini'){
      if(['xhigh','max'].includes(effort))throw Error('Gemini 原生接口无 xhigh/max 通用档位，请选默认、低、中或高。');
      if(effort==='none'&&/gemini-[3-9]/i.test(model))throw Error('当前 Gemini 适配器不会把“关闭推理”偷换成 minimal。请选择模型默认或支持的档位。');
      const thinkingConfig=/gemini-[3-9]/i.test(model)?{thinkingLevel:effort==='none'?'minimal':effort}:{thinkingBudget:{none:0,minimal:1024,low:1024,medium:8192,high:24576}[effort]};
      return {systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],...(effort==='auto'?{}:{generationConfig:{thinkingConfig}})};
    }
    throw Error('未知协议');
  }
  async complete(options,signal,onAttempt){
    let protocol=this.protocol;
    const run=async p=>this.request(p==='chat'?'/chat/completions':p==='responses'?'/responses':p==='anthropic'?'/messages':'/models/'+encodeURIComponent(options.model.replace(/^models\//,''))+':generateContent',{body:this.payload(p,options),protocol:p,signal,onAttempt});
    let response;
    try{response=await run(protocol);}catch(e){
      if(!this.#config.automatic||![404,405,501].includes(e.status))throw e;
      protocol='responses';response=await run(protocol);this.#config.protocol=protocol;this.#config.automatic=false;
    }
    if(response.data?.status==='incomplete')throw Error('模型响应未完成，未执行任何动作。');
    const text=responseText(response.data);if(!text)throw Error('模型没有返回可执行的正文。可能输出被截断或模型只返回了推理内容。');
    return {text:this.sanitize(text),usage:usage(response.data),latency:response.latency,protocol,transport:this.transport,requestedEffort:options.effort,effortStatus:options.effort==='auto'?'provider-default':'requested-not-attested'};
  }
}
