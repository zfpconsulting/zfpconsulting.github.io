/* Šifrování vstupního dotazníku (klient → poradce), jen Web Crypto prohlížeče, žádné knihovny třetích stran.
   Poradce má pár klíčů ECDH P-256: veřejný klíč je v odkazu pro klienta (za #, takže ho nevidí ani server s webem),
   soukromý zůstává jen v jeho Pipeline. Klient zašifruje dotazník (+ IOLDP) jednorázovým klíčem:
     ECDH(jednorázový klíč klienta, veřejný klíč poradce) → HKDF-SHA-256 (náhodná sůl, info „zfp-dotaznik-v1“) → AES-256-GCM.
   Do schránky se ukládá jen šifrový text – přečíst ho jde jen soukromým klíčem poradce; AES-GCM zároveň odhalí jakoukoli úpravu.
   První bajt otevřeného textu: 1 = gzip, 0 = bez komprese. */
(()=>{
"use strict";
const C=(globalThis.crypto||{}).subtle;
const INFO=new TextEncoder().encode("zfp-dotaznik-v1");
const b64u=b=>{const u=b instanceof Uint8Array?b:new Uint8Array(b);let s="";for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
const unb64u=s=>{const t=String(s||"").replace(/-/g,"+").replace(/_/g,"/");const bin=atob(t+"===".slice((t.length+3)%4));const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u};
async function pipe(bytes,Stream){const s=new Blob([bytes]).stream().pipeThrough(new Stream("gzip"));return new Uint8Array(await new Response(s).arrayBuffer())}
const canZip=typeof CompressionStream==="function"&&typeof DecompressionStream==="function";
async function aesKey(priv,pub,salt,usage){
  const bits=await C.deriveBits({name:"ECDH",public:pub},priv,256);
  const hk=await C.importKey("raw",bits,"HKDF",false,["deriveKey"]);
  return C.deriveKey({name:"HKDF",hash:"SHA-256",salt,info:INFO},hk,{name:"AES-GCM",length:256},false,[usage]);
}
/* nový pár klíčů poradce: pub = 65 bajtů (nekomprimovaný bod) v base64url, priv = JWK */
async function genKey(){
  const kp=await C.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  return {pub:b64u(await C.exportKey("raw",kp.publicKey)),priv:await C.exportKey("jwk",kp.privateKey)};
}
/* otisk veřejného klíče (pro kontrolu, že odkaz je opravdu od poradce) */
async function fingerprint(pub){const h=new Uint8Array(await C.digest("SHA-256",unb64u(pub)));return b64u(h).slice(0,10)}
async function seal(pubB64,obj){
  const pub=await C.importKey("raw",unb64u(pubB64),{name:"ECDH",namedCurve:"P-256"},false,[]);
  const eph=await C.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await aesKey(eph.privateKey,pub,salt,"encrypt");
  let body=new TextEncoder().encode(JSON.stringify(obj)),flag=0;
  if(canZip){try{body=await pipe(body,CompressionStream);flag=1}catch(e){flag=0;body=new TextEncoder().encode(JSON.stringify(obj))}}
  const plain=new Uint8Array(body.length+1);plain[0]=flag;plain.set(body,1);
  const ct=new Uint8Array(await C.encrypt({name:"AES-GCM",iv},key,plain));
  return {epk:b64u(await C.exportKey("raw",eph.publicKey)),salt:b64u(salt),iv:b64u(iv),ct:b64u(ct)};
}
async function open(privJwk,box){
  const priv=await C.importKey("jwk",privJwk,{name:"ECDH",namedCurve:"P-256"},false,["deriveBits"]);
  const epk=await C.importKey("raw",unb64u(box.epk),{name:"ECDH",namedCurve:"P-256"},false,[]);
  const key=await aesKey(priv,epk,unb64u(box.salt),"decrypt");
  const plain=new Uint8Array(await C.decrypt({name:"AES-GCM",iv:unb64u(box.iv)},key,unb64u(box.ct)));
  let body=plain.subarray(1);if(plain[0]===1)body=await pipe(body,DecompressionStream);
  return JSON.parse(new TextDecoder().decode(body));
}
/* schránka: Firestore projektu Pipeline přes REST (klient se nikam nepřihlašuje). Pravidla databáze dovolí cizím jen ZAPSAT
   šifrový text s přesnými poli; číst a mazat smí jen přihlášený poradce, kterému je dotazník určen. Velká data → víc částí. */
const FS="https://firestore.googleapis.com/v1/projects/zfp-pipeline/databases/(default)/documents/dzinbox?key=AIzaSyDfS0FJx1EtbgqJSUUOK722PB_5Zo6hCuI";
const CHUNK=900000,MAXN=10;
async function post(to,box,progress){
  const parts=[];for(let i=0;i<box.ct.length;i+=CHUNK)parts.push(box.ct.slice(i,i+CHUNK));
  if(!parts.length)parts.push("");
  if(parts.length>MAXN)throw Object.assign(new Error("Příloha je moc velká."),{code:"big"});
  const g=b64u(crypto.getRandomValues(new Uint8Array(15)));
  for(let i=0;i<parts.length;i++){
    if(progress)progress(i+1,parts.length);
    const fields={to:{stringValue:String(to).toLowerCase()},v:{integerValue:"1"},g:{stringValue:g},i:{integerValue:String(i)},n:{integerValue:String(parts.length)},
      epk:{stringValue:box.epk},salt:{stringValue:box.salt},iv:{stringValue:box.iv},ct:{stringValue:parts[i]}};
    const r=await fetch(FS,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields}),credentials:"omit",referrerPolicy:"strict-origin",cache:"no-store"});
    if(!r.ok){let m="";try{m=(await r.json()).error.status}catch(e){}throw Object.assign(new Error("Odeslání se nepovedlo ("+r.status+(m?" "+m:"")+")."),{code:r.status})}
  }
  return {g,n:parts.length};
}
const api={b64u,unb64u,genKey,seal,open,post,fingerprint,CHUNK,MAXN};
if(typeof window!=="undefined")window.DzCrypto=api;
if(typeof module==="object"&&module.exports)module.exports=api;
})();
