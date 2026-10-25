/* SESTAVENO z pipeline/pushcrypto.js + worker/push.js (node worker/build.mjs) – neupravovat ručně */
/* Push notifikace – šifrování zprávy pro konkrétní zařízení (Web Push, RFC 8291 „aes128gcm“) a podpis VAPID (RFC 8292).
   Jen Web Crypto, žádné knihovny. Stejný soubor používá Pipeline (předšifrované připomínky – prostředník je nepřečte)
   i prostředník na Cloudflare (upozornění na nový dotazník / rezervaci a odeslání na zařízení). */
(()=>{
"use strict";
const C=globalThis.crypto.subtle,TE=new TextEncoder();
const b64u=b=>{const u=b instanceof Uint8Array?b:new Uint8Array(b);let s="";for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
const unb64u=s=>{const t=String(s||"").replace(/-/g,"+").replace(/_/g,"/");const bin=atob(t+"===".slice((t.length+3)%4));const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u};
const cat=(...a)=>{const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length}return o};
async function hkdf(salt,ikm,info,len){const k=await C.importKey("raw",ikm,"HKDF",false,["deriveBits"]);return new Uint8Array(await C.deriveBits({name:"HKDF",hash:"SHA-256",salt,info},k,len*8))}
/* zašifruje zprávu (objekt nebo text) pro odběr {p256dh,auth} → tělo požadavku pro push službu */
async function encrypt(sub,payload,opt={}){
  const ua=unb64u(sub.p256dh),auth=unb64u(sub.auth);
  if(ua.length!==65||auth.length!==16)throw new Error("neplatný odběr");
  const uaKey=await C.importKey("raw",ua,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const as=opt.asKeys||await C.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const asPub=new Uint8Array(await C.exportKey("raw",as.publicKey));
  const ecdh=new Uint8Array(await C.deriveBits({name:"ECDH",public:uaKey},as.privateKey,256));
  const ikm=await hkdf(auth,ecdh,cat(TE.encode("WebPush: info\0"),ua,asPub),32);
  const salt=opt.salt||crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(salt,ikm,TE.encode("Content-Encoding: aes128gcm\0"),16);
  const nonce=await hkdf(salt,ikm,TE.encode("Content-Encoding: nonce\0"),12);
  const text=typeof payload==="string"?payload:JSON.stringify(payload);
  const plain=cat(TE.encode(text),new Uint8Array([2]));
  if(plain.length>3800)throw new Error("zpráva je moc dlouhá");
  const key=await C.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
  const ct=new Uint8Array(await C.encrypt({name:"AES-GCM",iv:nonce},key,plain));
  const rs=new Uint8Array([0,0,16,0]); /* 4096 */
  return cat(salt,rs,new Uint8Array([65]),asPub,ct);
}
/* VAPID: pár klíčů prostředníka (ECDSA P-256) a hlavička Authorization pro push službu */
async function vapidKeys(){const kp=await C.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  return {pub:b64u(await C.exportKey("raw",kp.publicKey)),priv:await C.exportKey("jwk",kp.privateKey)}}
async function vapidAuth(endpoint,keys,subject,nowSec){
  const aud=new URL(endpoint).origin,now=nowSec||Math.floor(Date.now()/1000);
  const h=b64u(TE.encode(JSON.stringify({typ:"JWT",alg:"ES256"}))),c=b64u(TE.encode(JSON.stringify({aud,exp:now+12*3600,sub:subject})));
  const k=await C.importKey("jwk",keys.priv,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=new Uint8Array(await C.sign({name:"ECDSA",hash:"SHA-256"},k,TE.encode(h+"."+c)));
  return "vapid t="+h+"."+c+"."+b64u(sig)+", k="+keys.pub}
/* krátký identifikátor odběru (z adresy zařízení) – Pipeline posílá jen tohle, ne adresu */
async function subId(endpoint){const d=new Uint8Array(await C.digest("SHA-256",TE.encode(String(endpoint))));return b64u(d).slice(0,16)}
const api={b64u,unb64u,encrypt,vapidKeys,vapidAuth,subId};
globalThis.PushCrypto=api;
})();

/* Prostředník pro push notifikace Pipeline (Cloudflare Worker, zdarma).
   - VAPID klíče si vytvoří sám při prvním použití a drží je v KV (žádné tajné údaje v repozitáři).
   - Zařízení se přihlašuje Google přihlášením z Pipeline (ověří se e-mail) – každý poradce dostává jen svoje notifikace.
   - Dotazník / rezervace klienta jen „šťouchne“ (/ping): pošle se obecná zpráva bez jména a dat klienta, s omezením četnosti.
   - Připomínky schůzek posílá Pipeline už zašifrované pro konkrétní zařízení – prostředník je nepřečte, jen je v čas odešle.
   - Další appky (Škola – kudla2002.github.io/skola): zařízení se přihlásí Googlem jednou (/dev/subscribe), dál nahrává
     svůj plán (/dev/plan) bez tokenu – prokazuje se tajemstvím vlastního odběru (auth), které zná jen to zařízení a KV.
     Plán je vázaný na jedno zařízení, takže se appky ani zařízení navzájem nepřepisují.
   Odkazy poradců s jejich jménem v náhledu: poradce si v Pipeline zadá jméno (Nastavení → Podpis), Pipeline z něj vyrobí náhledové
   obrázky a nahraje je sem (/adv/publish, ověřeno Google přihlášením – poradce může psát jen pod svůj e-mail). Prostředník pak podává
   /t/<kód> (rezervace) a /d/<kód> (dotazník): stránku s náhledem (og:image se jménem) a okamžitým přesměrováním na dotazník v Pipeline.
   KV klíče: adv:<kód> (údaje z odkazu) · advmail:<e-mail> (kód poradce) · advimg:<druh>:<kód> (JPEG v base64) · advrl:<e-mail>:<den>
             vapid · subs:<e-mail> · rem:<e-mail> · users (seznam e-mailů / dev:<id> s připomínkami) · rl:<e-mail>:<minuta> · rd:<e-mail>:<den>
             dev:<id> (odběr zařízení jiné appky) · rem:dev:<id> · dsd:<id>:<den> (okamžitá odeslání) */
const PC=globalThis.PushCrypto;
const ORIGINS=["https://zfpconsulting.github.io"];
const DEV_APPS={skola:{origin:"https://kudla2002.github.io",days:45,max:300}};
const ALL_ORIGINS=[...ORIGINS,...Object.values(DEV_APPS).map(a=>a.origin)];
const SUBJECT="https://zfpconsulting.github.io/pipeline/";
const PING={dz:{t:"Nový vstupní dotazník",b:"Klient odeslal dotazník. Otevři Pipeline – založí se lead a plán."},
  bk:{t:"Nová rezervace schůzky",b:"Klient si vybral termín. Otevři Pipeline – zapíše se do kalendáře."},
  nr:{t:"Nahrávka schůzky ke schválení",b:"Přijmout, nebo odmítnout? Nic se nezapíše, dokud nerozhodneš."}};
const MAX_SUBS=10,MAX_REM=400,PING_MIN=4,PING_DAY=60;
const ADV_BK=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/,ADV_CODE=/^[a-z0-9-]{3,40}$/,ADV_APP="https://zfpconsulting.github.io/pipeline/dotaznik.html#";
const esc=t=>String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const cors=o=>({"Access-Control-Allow-Origin":ALL_ORIGINS.includes(o)?o:ORIGINS[0],"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"});
const J=(o,x,st=200)=>new Response(JSON.stringify(x),{status:st,headers:{...cors(o),"Content-Type":"application/json","Cache-Control":"no-store"}});
const okMail=e=>typeof e==="string"&&/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(e);

async function vapid(env){let v=await env.KV.get("vapid",{type:"json"});if(!v){v=await PC.vapidKeys();await env.KV.put("vapid",JSON.stringify(v))}return v}
const TOK=new Map();
async function who(req){
  const a=req.headers.get("Authorization")||"",t=a.startsWith("Bearer ")?a.slice(7).trim():"";if(!t||t.length>4096)return null;
  const c=TOK.get(t);if(c&&c.exp>Date.now())return c.email;
  const r=await fetch("https://www.googleapis.com/oauth2/v3/tokeninfo?access_token="+encodeURIComponent(t));if(!r.ok)return null;
  const j=await r.json();const email=String(j.email||"").toLowerCase();
  if(!okMail(email)||!(j.email_verified===true||j.email_verified==="true")||!(+j.expires_in>0))return null;
  TOK.set(t,{email,exp:Date.now()+Math.min(+j.expires_in*1000,5*60000)});if(TOK.size>500)TOK.clear();return email}
const getSubs=async(env,m)=>(await env.KV.get("subs:"+m,{type:"json"}))||[];
/* odeslání na jedno zařízení; 404/410 = zařízení odběr zrušilo → smazat */
async function send(env,m,s,body,opt={}){
  const v=await vapid(env);
  const r=await fetch(s.endpoint,{method:"POST",headers:{"Authorization":await PC.vapidAuth(s.endpoint,v,SUBJECT),"Content-Encoding":"aes128gcm","Content-Type":"application/octet-stream","TTL":String(opt.ttl||3600),"Urgency":opt.urgency||"high",...(opt.topic?{"Topic":opt.topic}:{})},body});
  if(r.status===404||r.status===410){if(m.startsWith("dev:")){await devDrop(env,m.slice(4));return r.status}
    const L=(await getSubs(env,m)).filter(x=>x.endpoint!==s.endpoint);await env.KV.put("subs:"+m,JSON.stringify(L))}
  return r.status}
async function sendAll(env,m,payload,opt){const L=await getSubs(env,m);const out=[];for(const s of L){try{out.push(await send(env,m,s,await PC.encrypt(s,payload),opt))}catch(e){out.push(0)}}return out}
/* zařízení jiné appky: ověří se tajemstvím vlastního odběru (16 B auth z PushSubscription) */
const same=(a,b)=>{a=String(a||"");b=String(b||"");if(!a||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0};
async function devAuth(env,body){const id=String(body.id||"");if(!/^[A-Za-z0-9_-]{8,64}$/.test(id))return null;
  const d=await env.KV.get("dev:"+id,{type:"json"});return d&&same(d.auth,body.k)?{id,...d}:null}
async function devDrop(env,id){await env.KV.delete("dev:"+id);await env.KV.delete("rem:dev:"+id);
  const U=(await env.KV.get("users",{type:"json"}))||[];if(U.includes("dev:"+id))await env.KV.put("users",JSON.stringify(U.filter(x=>x!=="dev:"+id)))}
async function addUser(env,m){const U=(await env.KV.get("users",{type:"json"}))||[];if(!U.includes(m)){U.push(m);await env.KV.put("users",JSON.stringify(U.slice(-500)))}}

/* ---------- odkazy poradců se jménem v náhledu ---------- */
/* rozměry JPEG ze záhlaví (SOF) – [šířka, výška] nebo null, když to není JPEG */
function jpegSize(u){if(u.length<4||u[0]!==0xFF||u[1]!==0xD8)return null;let i=2;
  while(i+9<u.length){if(u[i]!==0xFF){i++;continue}const mk=u[i+1];if(mk===0xFF){i++;continue}
    if(mk>=0xC0&&mk<=0xCF&&mk!==0xC4&&mk!==0xC8&&mk!==0xCC)return [(u[i+7]<<8)|u[i+8],(u[i+5]<<8)|u[i+6]];
    if(mk===0xD8||mk===0x01||(mk>=0xD0&&mk<=0xD7)){i+=2;continue}
    i+=2+((u[i+2]<<8)|u[i+3])}
  return null}
const unb64=t=>Uint8Array.from(atob(t),c=>c.charCodeAt(0));
async function advPublish(o,env,m,b){
  const day=new Date().toISOString().slice(0,10),rk="advrl:"+m+":"+day,n=+(await env.KV.get(rk)||0);if(n>=30)return J(o,{error:"rate"},429);
  const p=String(b.p||"").replace(/[\u0000-\u001f<>]/g,"").replace(/\s+/g," ").trim();
  if(p.length<2||p.length>60||!/\p{L}/u.test(p))return J(o,{error:"name"},400);
  const k=String(b.k||"");if(!/^[A-Za-z0-9_-]{60,200}$/.test(k))return J(o,{error:"key"},400);
  const bk=String(b.b||"");if(bk&&!ADV_BK.test(bk))return J(o,{error:"bk"},400);
  const e=String(b.e||"");if(e&&!okMail(e))return J(o,{error:"mail"},400);
  const t=String(b.t||"");if(t&&!/^[+\d\s]{6,20}$/.test(t))return J(o,{error:"tel"},400);
  const img=b.img||{},raw={};
  for(const kind of ["termin","dotaznik"]){let u;try{u=unb64(String(img[kind]||""))}catch(x){return J(o,{error:"img"},400)}
    const z=jpegSize(u);if(u.length>150000||!z||z[0]!==1200||z[1]!==630)return J(o,{error:"img"},400);raw[kind]=String(img[kind])}
  let code=await env.KV.get("advmail:"+m);
  if(!code){const h=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(m))),hex=[h[0],h[1]].map(x=>x.toString(16).padStart(2,"0")).join("");
    const slug=p.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,24).replace(/-+$/,"")||"poradce";
    code=slug+"-"+hex;await env.KV.put("advmail:"+m,code)}
  const at=Date.now();
  await env.KV.put("adv:"+code,JSON.stringify({to:m,k,p,b:bk,e,t,at}));
  await env.KV.put("advimg:termin:"+code,raw.termin);await env.KV.put("advimg:dotaznik:"+code,raw.dotaznik);
  await env.KV.put(rk,String(n+1),{expirationTtl:172800});
  return J(o,{ok:true,code,at})}
/* stránka s náhledem (jméno poradce v og:image) – člověka hned přesměruje na dotazník / rezervaci v Pipeline; za # předá i případná data (#r=… u výroční schůzky) */
async function advPage(req,env,p){
  const [,w,code]=p.split("/"),a=await env.KV.get("adv:"+code,{type:"json"});
  if(!a)return new Response("Odkaz neexistuje",{status:404,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  const only=w==="t",kind=only?"termin":"dotaznik",origin=new URL(req.url).origin,url=origin+"/"+w+"/"+code,img=origin+"/i/"+kind+"/"+code+".jpg?v="+a.at;
  const h=new URLSearchParams({v:"1",to:a.to,k:a.k,p:a.p});if(a.b)h.set("b",a.b);if(a.e)h.set("e",a.e);if(a.t)h.set("t",a.t);if(only)h.set("m","r");
  const target=ADV_APP+h.toString(),title=(only?"Rezervace konzultace – ":"Vstupní dotazník – ")+a.p,
    desc=only?"Vyberte si termín konzultace – osobně v Brně (Trnitá 500/9) nebo online. ZFP Consulting":"Podklady k finančnímu plánu – vyplnění zabere asi 15 minut, odpovědi se šifrují. ZFP Consulting";
  const html=`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="strict-origin">
<title>${esc(title)} | ZFP Consulting</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="ZFP Consulting"><meta property="og:locale" content="cs_CZ"><meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:secure_url" content="${esc(img)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(title)} · ZFP Consulting">
<meta name="twitter:card" content="summary_large_image"><meta name="description" content="${esc(desc)}">
<style>body{margin:0;background:#000;color:#f2f2f2;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}a{color:#F37520}</style></head>
<body><p>Otevírám… <a href="${esc(target)}">Pokračovat</a></p>
<script>var T=${JSON.stringify(target).replace(/</g,"\\u003c")};location.replace(T+(location.hash.length>1?"&"+location.hash.slice(1):""))</script></body></html>`;
  return new Response(html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=300","Referrer-Policy":"strict-origin"}})}
async function advImage(env,p){
  const [,,kind,f]=p.split("/"),b64=await env.KV.get("advimg:"+kind+":"+f.slice(0,-4));
  if(!b64)return new Response("Obrázek neexistuje",{status:404,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  return new Response(unb64(b64),{status:200,headers:{"Content-Type":"image/jpeg","Cache-Control":"public, max-age=86400"}})}

async function handle(req,env){
  const o=req.headers.get("Origin")||"",u=new URL(req.url),p=u.pathname.replace(/\/+$/,"")||"/";
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(o)});
  if(req.method==="GET"&&p==="/vapid")return J(o,{pub:(await vapid(env)).pub});
  if(req.method==="GET"&&p==="/")return J(o,{ok:true,service:"zfp-push"});
  if(req.method==="GET"){const q=/^\/(t|d)\/([a-z0-9-]{3,40})$/.test(p),i=/^\/i\/(termin|dotaznik)\/([a-z0-9-]{3,40})\.jpg$/.test(p);
    if(q)return advPage(req,env,p);if(i)return advImage(env,p)}
  if(req.method!=="POST"&&!(req.method==="GET"&&p==="/subs"))return J(o,{error:"method"},405);
  let body={};if(req.method==="POST"){const t=await req.text();if(t.length>(p==="/adv/publish"?700000:200000))return J(o,{error:"big"},413);try{body=t?JSON.parse(t):{}}catch(e){return J(o,{error:"json"},400)}}
  /* ---------- zařízení dalších appek (Škola) ---------- */
  if(p.startsWith("/dev/")){
    if(p==="/dev/subscribe"){const app=DEV_APPS[body.app];if(!app||o!==app.origin)return J(o,{error:"app"},403);
      const m=await who(req);if(!m)return J(o,{error:"auth"},401);
      const s=body.sub||{},k=s.keys||{};
      if(typeof s.endpoint!=="string"||!/^https:\/\//.test(s.endpoint)||s.endpoint.length>1000||typeof k.p256dh!=="string"||typeof k.auth!=="string")return J(o,{error:"sub"},400);
      try{if(PC.unb64u(k.p256dh).length!==65||PC.unb64u(k.auth).length!==16)throw 0}catch(e){return J(o,{error:"sub"},400)}
      const id=await PC.subId(s.endpoint);
      await env.KV.put("dev:"+id,JSON.stringify({m,app:body.app,endpoint:s.endpoint,p256dh:k.p256dh,auth:k.auth,ua:String(body.ua||"").slice(0,80),at:Date.now()}));
      return J(o,{ok:true,id})}
    const d=await devAuth(env,body);if(!d)return J(o,{error:"auth"},401);const app=DEV_APPS[d.app]||{days:21,max:100};
    if(p==="/dev/plan"){const now=Date.now(),its=(Array.isArray(body.items)?body.items:[]).filter(x=>x&&typeof x.body==="string"&&x.body.length<6000&&+x.at>now-60000&&+x.at<now+app.days*864e5).slice(0,app.max).map(x=>({id:d.id,at:+x.at,body:x.body,tag:String(x.tag||"").slice(0,60)}));
      await env.KV.put("rem:dev:"+d.id,JSON.stringify({v:1,items:its}));await addUser(env,"dev:"+d.id);return J(o,{ok:true,n:its.length})}
    if(p==="/dev/send"){const day=new Date().toISOString().slice(0,10),key="dsd:"+d.id+":"+day,used=+(await env.KV.get(key)||0);
      const its=(Array.isArray(body.items)?body.items:[]).filter(x=>x&&typeof x.body==="string"&&x.body.length<6000).slice(0,Math.max(0,Math.min(10,40-used)));let n=0;
      for(const x of its){try{const st=await send(env,"dev:"+d.id,d,PC.unb64u(x.body),{ttl:600});if(st>=200&&st<300)n++}catch(e){}}
      if(its.length)await env.KV.put(key,String(used+its.length),{expirationTtl:172800});return J(o,{ok:true,sent:n,n:its.length})}
    if(p==="/dev/unsubscribe"){await devDrop(env,d.id);return J(o,{ok:true})}
    return J(o,{error:"path"},404)}
  /* klient (dotazník / rezervace) – bez přihlášení, jen obecná zpráva a omezení četnosti */
  if(p==="/ping"){
    const m=String(body.to||"").toLowerCase(),k=PING[body.k]?body.k:"dz";
    if(!okMail(m)||!ORIGINS.includes(o))return J(o,{ok:true});
    const min=Math.floor(Date.now()/60000),day=new Date().toISOString().slice(0,10);
    const a=+(await env.KV.get("rl:"+m+":"+min)||0),d=+(await env.KV.get("rd:"+m+":"+day)||0);
    if(a>=PING_MIN||d>=PING_DAY)return J(o,{ok:true});
    await env.KV.put("rl:"+m+":"+min,String(a+1),{expirationTtl:120});await env.KV.put("rd:"+m+":"+day,String(d+1),{expirationTtl:172800});
    await sendAll(env,m,{...PING[k],u:"./?push="+k,tag:"ping-"+k+"-"+Date.now()},{ttl:86400});
    return J(o,{ok:true})}
  const m=await who(req);if(!m)return J(o,{error:"auth"},401);
  if(p==="/adv/publish"&&ORIGINS.includes(o))return advPublish(o,env,m,body);
  if(p==="/subscribe"){const s=body.sub||{},k=s.keys||{};
    if(typeof s.endpoint!=="string"||!/^https:\/\//.test(s.endpoint)||s.endpoint.length>1000||typeof k.p256dh!=="string"||typeof k.auth!=="string")return J(o,{error:"sub"},400);
    try{if(PC.unb64u(k.p256dh).length!==65||PC.unb64u(k.auth).length!==16)throw 0}catch(e){return J(o,{error:"sub"},400)}
    const id=await PC.subId(s.endpoint);
    const L=(await getSubs(env,m)).filter(x=>x.endpoint!==s.endpoint);L.push({id,endpoint:s.endpoint,p256dh:k.p256dh,auth:k.auth,ua:String(body.ua||"").slice(0,80),at:Date.now()});
    await env.KV.put("subs:"+m,JSON.stringify(L.slice(-MAX_SUBS)));return J(o,{ok:true,id,n:Math.min(L.length,MAX_SUBS)})}
  if(p==="/unsubscribe"){const L=(await getSubs(env,m)).filter(x=>x.endpoint!==body.endpoint&&x.id!==body.id);await env.KV.put("subs:"+m,JSON.stringify(L));return J(o,{ok:true,n:L.length})}
  if(p==="/subs")return J(o,{subs:(await getSubs(env,m)).map(s=>({id:s.id,p256dh:s.p256dh,auth:s.auth,ua:s.ua,at:s.at}))});
  /* Fireflies: API klíč si poradce uloží z Pipeline (Nastavení) – zůstává jen tady v KV, Pipeline ani Claude ho neuvidí.
     Pipeline po uložení přepisu schůzky ke klientovi požádá o smazání přepisu ve Fireflies (každý smí mazat jen svým klíčem). */
  if(p==="/ff/key"){const k=String(body.key||"").trim();if(k&&!/^[A-Za-z0-9._-]{16,256}$/.test(k))return J(o,{error:"key"},400);
    if(k)await env.KV.put("ffkey:"+m,k);else await env.KV.delete("ffkey:"+m);return J(o,{ok:true,on:!!k})}
  if(p==="/ff/state")return J(o,{on:!!(await env.KV.get("ffkey:"+m))});
  if(p==="/ff/delete"){const id=String(body.id||"");if(!/^[A-Za-z0-9_-]{6,64}$/.test(id))return J(o,{error:"id"},400);
    const k=await env.KV.get("ffkey:"+m);if(!k)return J(o,{error:"nokey"},409);
    const r=await fetch("https://api.fireflies.ai/graphql",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},body:JSON.stringify({query:"mutation($id:String!){deleteTranscript(id:$id){id}}",variables:{id}})});
    let j={};try{j=await r.json()}catch(e){}
    if(j&&j.data&&j.data.deleteTranscript)return J(o,{ok:true});
    const e0=(j&&j.errors&&j.errors[0])||{},code=String((e0.extensions&&e0.extensions.code)||e0.code||e0.message||r.status);
    if(/not.?found/i.test(code))return J(o,{ok:true,gone:true});
    return J(o,{error:"ff",detail:code.slice(0,120)},502)}
  if(p==="/test"){const st=await sendAll(env,m,{t:"Pipeline",b:"Zkušební notifikace – funguje to.",u:"./",tag:"test"},{ttl:600});return J(o,{ok:true,sent:st.filter(x=>x>=200&&x<300).length,n:st.length})}
  /* hned odeslat předšifrované zprávy na moje zařízení (ukázka notifikací z Pipeline) */
  if(p==="/send"){const S=await getSubs(env,m),its=(Array.isArray(body.items)?body.items:[]).filter(x=>x&&typeof x.id==="string"&&typeof x.body==="string"&&x.body.length<6000).slice(0,40);let n=0;
    for(const x of its){const s=S.find(y=>y.id===x.id);if(!s)continue;try{const st=await send(env,m,s,PC.unb64u(x.body),{ttl:600});if(st>=200&&st<300)n++}catch(e){}}
    return J(o,{ok:true,sent:n,n:its.length})}
  if(p==="/reminders"){
    /* verze plánu: starší verze appky (na jiném zařízení) nesmí přepsat plán od novější */
    const v=Math.max(1,Math.floor(+body.v||1)),cur=await env.KV.get("rem:"+m,{type:"json"}),curV=cur&&!Array.isArray(cur)?+cur.v||1:1;
    if(v<curV)return J(o,{ok:true,n:0,stale:true,v:curV});
    const now=Date.now(),its=(Array.isArray(body.items)?body.items:[]).filter(x=>x&&typeof x.id==="string"&&typeof x.body==="string"&&x.body.length<6000&&+x.at>now-60000&&+x.at<now+21*864e5).slice(0,MAX_REM).map(x=>({id:x.id,at:+x.at,body:x.body,tag:String(x.tag||"").slice(0,60)}));
    await env.KV.put("rem:"+m,JSON.stringify({v,items:its}));if(its.length)await addUser(env,m);return J(o,{ok:true,n:its.length,v})}
  return J(o,{error:"path"},404)}

/* každou minutu: odešle připomínky, které spadají do této minuty (bez zápisu do KV – nic se neposílá dvakrát) */
async function cron(env,t){
  const to=Math.floor(t/60000)*60000,from=to-60000,U=(await env.KV.get("users",{type:"json"}))||[];let n=0;
  for(const m of U){const R0=(await env.KV.get("rem:"+m,{type:"json"}))||[],R=Array.isArray(R0)?R0:(R0.items||[]);const due=R.filter(x=>x.at>from&&x.at<=to);if(!due.length)continue;
    const S=m.startsWith("dev:")?[{id:m.slice(4),...((await env.KV.get(m,{type:"json"}))||{})}].filter(x=>x.endpoint):await getSubs(env,m);
    for(const x of due){const s=S.find(y=>y.id===x.id);if(!s)continue;try{await send(env,m,s,PC.unb64u(x.body),{ttl:900,topic:x.tag?x.tag.replace(/[^A-Za-z0-9_-]/g,"").slice(0,32):undefined});n++}catch(e){}}}
  return n}

export default{
  async fetch(req,env){try{return await handle(req,env)}catch(e){return J(req.headers.get("Origin")||"",{error:"server"},500)}},
  async scheduled(ev,env,ctx){ctx.waitUntil(cron(env,ev.scheduledTime))}
};
export {cron,handle};
