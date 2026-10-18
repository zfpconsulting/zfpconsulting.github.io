/* Prostředník pro push notifikace Pipeline (Cloudflare Worker, zdarma).
   - VAPID klíče si vytvoří sám při prvním použití a drží je v KV (žádné tajné údaje v repozitáři).
   - Zařízení se přihlašuje Google přihlášením z Pipeline (ověří se e-mail) – každý poradce dostává jen svoje notifikace.
   - Dotazník / rezervace klienta jen „šťouchne“ (/ping): pošle se obecná zpráva bez jména a dat klienta, s omezením četnosti.
   - Připomínky schůzek posílá Pipeline už zašifrované pro konkrétní zařízení – prostředník je nepřečte, jen je v čas odešle.
   - Další appky (Škola – kudla2002.github.io/skola): zařízení se přihlásí Googlem jednou (/dev/subscribe), dál nahrává
     svůj plán (/dev/plan) bez tokenu – prokazuje se tajemstvím vlastního odběru (auth), které zná jen to zařízení a KV.
     Plán je vázaný na jedno zařízení, takže se appky ani zařízení navzájem nepřepisují.
   KV klíče: vapid · subs:<e-mail> · rem:<e-mail> · users (seznam e-mailů / dev:<id> s připomínkami) · rl:<e-mail>:<minuta> · rd:<e-mail>:<den>
             dev:<id> (odběr zařízení jiné appky) · rem:dev:<id> · dsd:<id>:<den> (okamžitá odeslání) */
import "../pipeline/pushcrypto.js";
const PC=globalThis.PushCrypto;
const ORIGINS=["https://zfpconsulting.github.io"];
const DEV_APPS={skola:{origin:"https://kudla2002.github.io",days:45,max:300}};
const ALL_ORIGINS=[...ORIGINS,...Object.values(DEV_APPS).map(a=>a.origin)];
const SUBJECT="https://zfpconsulting.github.io/pipeline/";
const PING={dz:{t:"Nový vstupní dotazník",b:"Klient odeslal dotazník. Otevři Pipeline – založí se lead a plán."},
  bk:{t:"Nová rezervace schůzky",b:"Klient si vybral termín. Otevři Pipeline – zapíše se do kalendáře."}};
const MAX_SUBS=10,MAX_REM=400,PING_MIN=4,PING_DAY=60;

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

async function handle(req,env){
  const o=req.headers.get("Origin")||"",u=new URL(req.url),p=u.pathname.replace(/\/+$/,"")||"/";
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(o)});
  if(req.method==="GET"&&p==="/vapid")return J(o,{pub:(await vapid(env)).pub});
  if(req.method==="GET"&&p==="/")return J(o,{ok:true,service:"zfp-push"});
  if(req.method!=="POST"&&!(req.method==="GET"&&p==="/subs"))return J(o,{error:"method"},405);
  let body={};if(req.method==="POST"){const t=await req.text();if(t.length>200000)return J(o,{error:"big"},413);try{body=t?JSON.parse(t):{}}catch(e){return J(o,{error:"json"},400)}}
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
  if(p==="/subscribe"){const s=body.sub||{},k=s.keys||{};
    if(typeof s.endpoint!=="string"||!/^https:\/\//.test(s.endpoint)||s.endpoint.length>1000||typeof k.p256dh!=="string"||typeof k.auth!=="string")return J(o,{error:"sub"},400);
    try{if(PC.unb64u(k.p256dh).length!==65||PC.unb64u(k.auth).length!==16)throw 0}catch(e){return J(o,{error:"sub"},400)}
    const id=await PC.subId(s.endpoint);
    const L=(await getSubs(env,m)).filter(x=>x.endpoint!==s.endpoint);L.push({id,endpoint:s.endpoint,p256dh:k.p256dh,auth:k.auth,ua:String(body.ua||"").slice(0,80),at:Date.now()});
    await env.KV.put("subs:"+m,JSON.stringify(L.slice(-MAX_SUBS)));return J(o,{ok:true,id,n:Math.min(L.length,MAX_SUBS)})}
  if(p==="/unsubscribe"){const L=(await getSubs(env,m)).filter(x=>x.endpoint!==body.endpoint&&x.id!==body.id);await env.KV.put("subs:"+m,JSON.stringify(L));return J(o,{ok:true,n:L.length})}
  if(p==="/subs")return J(o,{subs:(await getSubs(env,m)).map(s=>({id:s.id,p256dh:s.p256dh,auth:s.auth,ua:s.ua,at:s.at}))});
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
