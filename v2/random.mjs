// Shared deterministic HMAC-SHA256 random oracle. Sampling is keyed by event,
// not by call order: inspecting a screen or making an invalid action cannot reroll it.
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const enc = new TextEncoder();
const rr = (x,n) => (x>>>n)|(x<<(32-n));
export const hex = a => Array.from(a, x=>x.toString(16).padStart(2,'0')).join('');
export function sha256(input) {
  const b = typeof input === 'string' ? enc.encode(input) : input;
  const a = new Uint8Array(Math.ceil((b.length+9)/64)*64); a.set(b); a[b.length]=128;
  const view = new DataView(a.buffer); view.setUint32(a.length-8,Math.floor(b.length/536870912)); view.setUint32(a.length-4,b.length*8);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  for(let p=0;p<a.length;p+=64) {
    for(let i=0;i<16;i++) w[i]=view.getUint32(p+i*4);
    for(let i=16;i<64;i++) {const x=w[i-15],y=w[i-2]; w[i]=w[i-16]+(rr(x,7)^rr(x,18)^(x>>>3))+w[i-7]+(rr(y,17)^rr(y,19)^(y>>>10));}
    let [A,B,C,D,E,F,G,H]=h;
    for(let i=0;i<64;i++) {const t1=(H+(rr(E,6)^rr(E,11)^rr(E,25))+((E&F)^(~E&G))+K[i]+w[i])|0,t2=((rr(A,2)^rr(A,13)^rr(A,22))+((A&B)^(A&C)^(B&C)))|0; H=G;G=F;F=E;E=(D+t1)|0;D=C;C=B;B=A;A=(t1+t2)|0;}
    [A,B,C,D,E,F,G,H].forEach((v,i)=>h[i]+=v);
  }
  const out=new Uint8Array(32),dv=new DataView(out.buffer);h.forEach((x,i)=>dv.setUint32(i*4,x));return out;
}
export function oracle(seed) {
  let key=enc.encode(seed); if(key.length>64)key=sha256(key);
  const inner=new Uint8Array(64),outer=new Uint8Array(96); inner.fill(0x36);outer.fill(0x5c,0,64);
  key.forEach((x,i)=>{inner[i]^=x;outer[i]^=x;});
  const digest=k=>{const msg=enc.encode(k),b=new Uint8Array(64+msg.length);b.set(inner);b.set(msg,64);outer.set(sha256(b),64);return sha256(outer);};
  return Object.freeze({
    bytes:digest,
    id:k=>hex(digest('id/'+k).slice(0,8)),
    u:k=>{const b=digest('draw/'+k);return (b[0]*2**40+b[1]*2**32+b[2]*2**24+b[3]*2**16+b[4]*256+b[5])/2**48;},
    pick:(k,list)=>{const b=digest('pick/'+k);return list[((b[0]*16777216+b[1]*65536+b[2]*256+b[3])>>>0)%list.length];}
  });
}
