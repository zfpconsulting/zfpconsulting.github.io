/* Testy prostředníka pro push (bez sítě): falešné KV + falešný fetch. Dešifrování a ověření podpisu dělá node:crypto,
   tedy jiná implementace než Web Crypto v pushcrypto.js – ověřuje, že zpráva odpovídá RFC 8291 / 8292. */
import crypto from "node:crypto";
import W,{cron} from "./push.js";
const PC=globalThis.PushCrypto;
let pass=0,fail=0;const ok=(c,n)=>{if(c){pass++;console.log("✓ "+n)}else{fail++;console.log("✗ "+n)}};

const store=new Map();
const env={KV:{async get(k,o){const v=store.get(k);if(v==null)return null;return o&&o.type==="json"?JSON.parse(v):v},async put(k,v){store.set(k,String(v))},async delete(k){store.delete(k)}}};
const sent=[];let gone=new Set();
globalThis.fetch=async(u,o={})=>{u=String(u);
  if(u.startsWith("https://www.googleapis.com/oauth2/v3/tokeninfo")){const t=new URL(u).searchParams.get("access_token");
    if(t==="tok-vk")return new Response(JSON.stringify({email:"Vojta@Example.com",email_verified:"true",expires_in:"3000"}),{status:200});
    if(t==="tok-jt")return new Response(JSON.stringify({email:"jt@example.com",email_verified:"true",expires_in:"3000"}),{status:200});
    return new Response("{}",{status:400})}
  if(u.startsWith("https://push.example/")){sent.push({u,h:o.headers,body:new Uint8Array(o.body)});return new Response("",{status:gone.has(u)?410:201})}
  throw new Error("neočekávaný fetch "+u)};
const ORIGIN="https://zfpconsulting.github.io";
const call=async(path,{method="POST",body,tok,origin=ORIGIN}={})=>{const h={Origin:origin};if(tok)h.Authorization="Bearer "+tok;if(body)h["Content-Type"]="application/json";
  const r=await W.fetch(new Request("https://zfp-push.x.workers.dev"+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env);return {st:r.status,j:await r.json().catch(()=>null),h:r.headers}};

/* zařízení (strana prohlížeče): ECDH pár + auth tajemství */
function device(){const e=crypto.createECDH("prime256v1");e.generateKeys();const auth=crypto.randomBytes(16);
  return {e,auth,sub:{endpoint:"https://push.example/"+crypto.randomBytes(6).toString("hex"),keys:{p256dh:e.getPublicKey().toString("base64url"),auth:auth.toString("base64url")}}}}
const hk=(salt,ikm,info,len)=>Buffer.from(crypto.hkdfSync("sha256",ikm,salt,info,len));
function decrypt(dev,body){const b=Buffer.from(body);const salt=b.subarray(0,16),rs=b.readUInt32BE(16),idlen=b[20],asPub=b.subarray(21,21+idlen),ct=b.subarray(21+idlen);
  const ecdh=dev.e.computeSecret(asPub),ua=dev.e.getPublicKey();
  const ikm=hk(dev.auth,ecdh,Buffer.concat([Buffer.from("WebPush: info\0"),ua,asPub]),32);
  const cek=hk(salt,ikm,Buffer.from("Content-Encoding: aes128gcm\0"),16),nonce=hk(salt,ikm,Buffer.from("Content-Encoding: nonce\0"),12);
  const d=crypto.createDecipheriv("aes-128-gcm",cek,nonce);d.setAuthTag(ct.subarray(ct.length-16));const pt=Buffer.concat([d.update(ct.subarray(0,ct.length-16)),d.final()]);
  if(pt[pt.length-1]!==2)throw new Error("chybí oddělovač");return {rs,text:pt.subarray(0,pt.length-1).toString("utf8")}}
function verifyVapid(auth,endpoint){const m=/^vapid t=([^,]+), k=(.+)$/.exec(auth);if(!m)return false;const [h,c,s]=m[1].split(".");
  const claims=JSON.parse(Buffer.from(c,"base64url").toString());const pub=Buffer.from(m[2],"base64url");
  const key=crypto.createPublicKey({key:{kty:"EC",crv:"P-256",x:pub.subarray(1,33).toString("base64url"),y:pub.subarray(33,65).toString("base64url")},format:"jwk"});
  const v=crypto.verify("sha256",Buffer.from(h+"."+c),{key,dsaEncoding:"ieee-p1363"},Buffer.from(s,"base64url"));
  return v&&claims.aud===new URL(endpoint).origin&&claims.exp>Date.now()/1000&&/^https:|^mailto:/.test(claims.sub)}

/* 1) VAPID klíč se vytvoří jednou a pak drží */
const v1=await call("/vapid",{method:"GET"}),v2=await call("/vapid",{method:"GET"});
ok(v1.st===200&&v1.j.pub&&v1.j.pub===v2.j.pub&&Buffer.from(v1.j.pub,"base64url").length===65,"VAPID klíč vznikne jednou a zůstává stejný");
ok(v1.h.get("Access-Control-Allow-Origin")===ORIGIN,"CORS jen pro web Pipeline");
/* 2) přihlášení zařízení */
const A=device(),B=device(),C=device();
ok((await call("/subscribe",{body:{sub:A.sub}})).st===401,"bez Google přihlášení nejde zařízení přidat");
ok((await call("/subscribe",{body:{sub:A.sub},tok:"spatny"})).st===401,"neplatný token odmítnut");
const s1=await call("/subscribe",{body:{sub:A.sub,ua:"Mac"},tok:"tok-vk"});await call("/subscribe",{body:{sub:B.sub,ua:"iPhone"},tok:"tok-vk"});await call("/subscribe",{body:{sub:C.sub},tok:"tok-jt"});
ok(s1.st===200&&s1.j.id&&JSON.parse(store.get("subs:vojta@example.com")).length===2,"zařízení se uloží pod e-mail (malými písmeny)");
ok((await call("/subscribe",{body:{sub:{endpoint:"http://x",keys:{p256dh:"a",auth:"b"}}},tok:"tok-vk"})).st===400,"vadný odběr odmítnut");
/* 3) ping z dotazníku → jen zařízení toho poradce, šifrované, podepsané */
sent.length=0;const pg=await call("/ping",{body:{to:"vojta@example.com",k:"bk"}});
ok(pg.st===200&&sent.length===2&&sent.every(x=>x.u!==C.sub.endpoint),"ping dojde jen na zařízení daného poradce");
const dA=decrypt(A,sent.find(x=>x.u===A.sub.endpoint).body),msg=JSON.parse(dA.text);
ok(msg.t==="Nová rezervace schůzky"&&!/@/.test(dA.text)&&dA.rs===4096,"zpráva se dešifruje (RFC 8291) a neobsahuje údaje klienta");
ok(sent.every(x=>verifyVapid(x.h.Authorization,x.u)&&x.h["Content-Encoding"]==="aes128gcm"&&+x.h.TTL>0),"VAPID podpis platný (RFC 8292), hlavičky v pořádku");
sent.length=0;await call("/ping",{body:{to:"vojta@example.com",k:"dz"},origin:"https://evil.example"});
ok(sent.length===0,"ping z cizího webu se neodešle");
sent.length=0;for(let i=0;i<6;i++)await call("/ping",{body:{to:"vojta@example.com",k:"dz"}});
ok(sent.length<=2*(4-1),"omezení četnosti – spam pingů se zastaví");
const pn=await call("/ping",{body:{to:"nikdo@example.com"}});ok(pn.st===200&&pn.j.ok,"neznámý poradce – stejná odpověď (neprozradí, kdo existuje)");
/* 4) připomínky: předšifrované v Pipeline, prostředník je jen v čas odešle */
const subs=(await call("/subs",{method:"GET",tok:"tok-vk"})).j.subs;
ok(subs.length===2&&subs.every(s=>!("endpoint" in s)),"Pipeline dostane klíče zařízení, ne jejich adresy");
const at=Math.floor(Date.now()/60000)*60000+5*60000;
const items=[];for(const s of subs)items.push({id:s.id,at,body:PC.b64u(await PC.encrypt(s,{t:"Za 30 min schůzka",b:"VK: Novák · 10:00"})),tag:"rem-1"});
items.push({id:subs[0].id,at:at+3600e3,body:PC.b64u(await PC.encrypt(subs[0],{t:"později"})),tag:"rem-2"});
const rr=await call("/reminders",{body:{items},tok:"tok-vk"});ok(rr.st===200&&rr.j.n===3,"připomínky uložené");
ok(!/Novák/.test(store.get("rem:vojta@example.com")),"prostředník obsah připomínek nevidí (jen šifra)");
sent.length=0;ok(await cron(env,at-60000)===0&&sent.length===0,"minutu předem se nic neposílá");
const n=await cron(env,at);const dB=decrypt(B,sent.find(x=>x.u===B.sub.endpoint).body);
ok(n===2&&JSON.parse(dB.text).b==="VK: Novák · 10:00","v čas dojde připomínka na obě zařízení a dešifruje se");
sent.length=0;ok(await cron(env,at+60000)===0,"další minutu se znovu neposílá (žádné duplicity)");
/* 4b) verze plánu a okamžité odeslání */
const stale=await call("/reminders",{body:{items:[{id:subs[0].id,at:at+7200e3,body:"x"}]},tok:"tok-vk"});
ok(stale.j.n===1,"bez verze (v1) se uloží, když je uložený v1");
await call("/reminders",{body:{v:2,items}, tok:"tok-vk"});
const st2=await call("/reminders",{body:{items:[{id:subs[0].id,at:at+7200e3,body:"x"}]},tok:"tok-vk"});
ok(st2.j.stale&&JSON.parse(store.get("rem:vojta@example.com")).items.length===3,"starší verze appky nepřepíše plán od novější");
sent.length=0;const sn=await call("/send",{body:{items:[{id:subs[0].id,body:PC.b64u(await PC.encrypt(subs[0],{t:"Ukázka"}))}]},tok:"tok-vk"});
ok(sn.j.sent===1&&sent.length===1,"okamžité odeslání ukázky na moje zařízení");
ok((await call("/send",{body:{items:[]}})).st===401,"okamžité odeslání jen přihlášenému");
sent.length=0;ok(await cron(env,at)===2,"cron čte i nový formát plánu");
/* 5) zrušený odběr (410) se smaže */
gone.add(A.sub.endpoint);sent.length=0;await call("/test",{tok:"tok-vk"});
ok(JSON.parse(store.get("subs:vojta@example.com")).length===1,"zařízení, které odběr zrušilo, se odstraní");
const un=await call("/unsubscribe",{body:{endpoint:B.sub.endpoint},tok:"tok-vk"});ok(un.j.n===0,"odhlášení zařízení");
/* 6) šifra z pushcrypto je stejná i v prohlížeči – kontrola délky/hlavičky */
const raw=await PC.encrypt(B.sub.keys,"x");ok(raw[20]===65&&raw.length===16+4+1+65+1+1+16,"formát hlavičky aes128gcm");
/* 7) zařízení appky Škola: jednou Google, dál jen tajemství vlastního odběru; plán vázaný na zařízení */
const SK="https://kudla2002.github.io",D1=device(),D2=device();
ok((await call("/dev/subscribe",{body:{app:"skola",sub:D1.sub},tok:"tok-vk",origin:"https://evil.example"})).st===403,"Škola: přihlášení zařízení jen z webu appky");
ok((await call("/dev/subscribe",{body:{app:"skola",sub:D1.sub},origin:SK})).st===401,"Škola: přihlášení zařízení vyžaduje Google");
const ds=await call("/dev/subscribe",{body:{app:"skola",sub:D1.sub,ua:"iPhone"},tok:"tok-vk",origin:SK});
const ds2=await call("/dev/subscribe",{body:{app:"skola",sub:D2.sub},tok:"tok-vk",origin:SK});
ok(ds.st===200&&ds.j.id&&ds.h.get("Access-Control-Allow-Origin")===SK,"Škola: zařízení přihlášené, CORS pro web appky");
ok(JSON.parse(store.get("subs:vojta@example.com")||"[]").every(x=>x.endpoint!==D1.sub.endpoint),"Škola: odběr se nemíchá se zařízeními Pipeline");
const k1=D1.sub.keys.auth,dk={p256dh:D1.sub.keys.p256dh,auth:k1};
ok((await call("/dev/plan",{body:{id:ds.j.id,k:D2.sub.keys.auth,items:[]},origin:SK})).st===401,"Škola: cizí tajemství plán nenahraje");
const at2=Math.floor(Date.now()/60000)*60000+10*60000;
const far=Date.now()+40*864e5,tooFar=Date.now()+50*864e5;
const pl=await call("/dev/plan",{body:{id:ds.j.id,k:k1,items:[{at:at2,body:PC.b64u(await PC.encrypt(dk,{t:"Zítra: Odevzdání eseje",b:"MAKRO · 23:59"})),tag:"dl-1"},{at:far,body:"x"},{at:tooFar,body:"x"}]},origin:SK});
ok(pl.st===200&&pl.j.n===2,"Škola: plán uložený bez tokenu, horizont 45 dní");
await call("/dev/plan",{body:{id:ds2.j.id,k:D2.sub.keys.auth,items:[]},origin:SK});
ok(JSON.parse(store.get("rem:dev:"+ds.j.id)).items.length===2,"Škola: plán druhého zařízení nepřepíše plán prvního");
ok(JSON.parse(store.get("rem:vojta@example.com")).items.length===3,"Škola: plán Pipeline zůstal netknutý");
ok(!/Odevzdání/.test(store.get("rem:dev:"+ds.j.id)),"Škola: prostředník obsah termínů nevidí");
sent.length=0;const nd=await cron(env,at2);
ok(nd===1&&sent.length===1&&sent[0].u===D1.sub.endpoint&&JSON.parse(decrypt(D1,sent[0].body).text).b==="MAKRO · 23:59","Škola: v čas dojde na správné zařízení a dešifruje se");
sent.length=0;const sd=await call("/dev/send",{body:{id:ds.j.id,k:k1,items:[{body:PC.b64u(await PC.encrypt(dk,{t:"Ukázka"}))}]},origin:SK});
ok(sd.j.sent===1&&sent.length===1,"Škola: okamžitá ukázka na vlastní zařízení");
gone.add(D2.sub.endpoint);await call("/dev/send",{body:{id:ds2.j.id,k:D2.sub.keys.auth,items:[{body:"AAAA"}]},origin:SK});
ok(!store.get("dev:"+ds2.j.id)&&!JSON.parse(store.get("users")).includes("dev:"+ds2.j.id),"Škola: zrušený odběr (410) se smaže i s plánem");
const du=await call("/dev/unsubscribe",{body:{id:ds.j.id,k:k1},origin:SK});
ok(du.j.ok&&!store.get("dev:"+ds.j.id)&&!store.get("rem:dev:"+ds.j.id),"Škola: vypnutí smaže zařízení i plán");
/* 6) odkazy poradců se jménem v náhledu */
const jpg=(w,h,n=2000)=>{const b=Buffer.alloc(n,7);Buffer.from([0xFF,0xD8,0xFF,0xC0,0,17,8,h>>8,h&255,w>>8,w&255,3,1,0x22,0,2,0x11,1,3,0x11,1]).copy(b);return b.toString("base64")};
const KEY="K".repeat(86),good={p:"Jan Novák",k:KEY,b:"https://script.google.com/macros/s/AKfycbxABC_-123/exec",e:"jan@zfpa.cz",t:"+420 777 123 456",img:{termin:jpg(1200,630),dotaznik:jpg(1200,630)}};
ok((await call("/adv/publish",{body:good})).st===401,"odkazy: bez přihlášení nejde zveřejnit");
ok((await call("/adv/publish",{body:good,tok:"tok-jt",origin:"https://evil.example"})).st===403||(await call("/adv/publish",{body:good,tok:"tok-jt",origin:"https://evil.example"})).st===404,"odkazy: z cizího webu nejde zveřejnit");
const bad=async o=>(await call("/adv/publish",{body:{...good,...o},tok:"tok-jt"})).st;
ok(await bad({p:"<b>"})===400&&await bad({p:"x"})===400&&await bad({k:"krátký"})===400&&await bad({b:"https://evil.example/exec"})===400&&await bad({e:"nemail"})===400&&await bad({t:"<script>"})===400,"odkazy: vadné jméno / klíč / adresa skriptu / e-mail / telefon se odmítnou");
ok(await bad({img:{termin:jpg(800,600),dotaznik:jpg(1200,630)}})===400&&await bad({img:{termin:"AAAA",dotaznik:jpg(1200,630)}})===400&&await bad({img:{termin:jpg(1200,630,200000),dotaznik:jpg(1200,630)}})===400&&await bad({img:{}})===400,"odkazy: obrázek musí být JPEG 1200×630 do 150 kB");
import {readFileSync} from "node:fs";
const real={termin:readFileSync(new URL("../og/termin.jpg",import.meta.url)).toString("base64"),dotaznik:readFileSync(new URL("../og/dotaznik.jpg",import.meta.url)).toString("base64")};
ok((await call("/adv/publish",{body:{...good,p:"Skutečný JPEG",img:real},tok:"tok-vk"})).st===200,"odkazy: skutečné JPEG z generátoru projde kontrolou rozměrů");
const pb=await call("/adv/publish",{body:{...good,p:"  Ing. Jan  Novák "},tok:"tok-jt"});
ok(pb.st===200&&pb.j.ok&&/^ing-jan-novak-[0-9a-f]{4}$/.test(pb.j.code),"odkazy: zveřejnění vrátí kód ze jména + část hashe e-mailu");
const CODE=pb.j.code,adv=JSON.parse(store.get("adv:"+CODE));
ok(adv.to==="jt@example.com"&&adv.p==="Ing. Jan Novák"&&store.get("advmail:jt@example.com")===CODE,"odkazy: údaje se uloží pod e-mail přihlášeného, ne pod to, co pošle klient");
const pb2=await call("/adv/publish",{body:{...good,p:"Jan Nový"},tok:"tok-jt"});
ok(pb2.j.code===CODE&&JSON.parse(store.get("adv:"+CODE)).p==="Jan Nový","odkazy: změna jména zachová stejný odkaz");
const pv=await call("/adv/publish",{body:{...good,p:"Vojta K"},tok:"tok-vk"});
ok(pv.j.code!==CODE&&JSON.parse(store.get("adv:"+CODE)).to==="jt@example.com","odkazy: druhý poradce nepřepíše odkaz prvního");
const getRaw=async path=>W.fetch(new Request("https://zfp-push.x.workers.dev"+path,{method:"GET"}),env);
const tp=await getRaw("/t/"+CODE),th=await tp.text();
ok(tp.status===200&&/text\/html/.test(tp.headers.get("content-type"))&&th.includes('og:image" content="https://zfp-push.x.workers.dev/i/termin/'+CODE+'.jpg?v=')&&th.includes("Jan Nový"),"odkazy: /t/<kód> vrací stránku s náhledem se jménem poradce");
ok(/dotaznik\.html#v=1&amp;to=jt%40example\.com/.test(th)&&th.includes("m=r")&&!th.includes(KEY.slice(0,10)+"</")&&th.includes("location.replace"),"odkazy: stránka přesměruje na dotazník s údaji poradce a režimem rezervace");
const dp=await (await getRaw("/d/"+CODE)).text();
ok(dp.includes("/i/dotaznik/"+CODE+".jpg")&&!/[?&;]m=r/.test(dp.replace(/&amp;/g,"&").split("dotaznik.html#")[1].split('"')[0]),"odkazy: /d/<kód> je dotazník bez režimu rezervace s obrázkem dotazníku");
const im=await getRaw("/i/termin/"+CODE+".jpg"),ib=Buffer.from(await im.arrayBuffer());
ok(im.status===200&&im.headers.get("content-type")==="image/jpeg"&&ib[0]===0xFF&&ib[1]===0xD8&&ib.length===1500+500,"odkazy: obrázek se podává jako JPEG");
ok((await getRaw("/t/neexistuje-1234")).status===404&&(await getRaw("/i/termin/neexistuje-1234.jpg")).status===404&&(await getRaw("/t/..%2f..")).status!==200,"odkazy: neznámý kód → 404");
store.set("adv:xss-0000",JSON.stringify({to:"a@b.cz",k:KEY,p:'"><script>alert(1)</script>',b:"",e:"",t:"",at:1}));
const xs=await (await getRaw("/t/xss-0000")).text();
ok(!xs.includes("<script>alert")&&!/<\/script><script/.test(xs),"odkazy: jméno se do stránky vkládá escapované");
for(let i=0;i<30;i++)await call("/adv/publish",{body:good,tok:"tok-vk"});
ok((await call("/adv/publish",{body:good,tok:"tok-vk"})).st===429,"odkazy: denní omezení zveřejňování");
console.log(`\n${pass} prošlo, ${fail} selhalo`);if(fail)process.exit(1);
