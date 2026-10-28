/* CACHE a CORE needitovat ručně – srovná je `node tools/bump.mjs` podle ?v= v index.html (kontrola v CI: --check) */
const CACHE="pipeline-v180", RCACHE="pipeline-rt-v1", VCACHE="pipeline-vendor-v1";
const CORE=["./","./index.html","./manifest.webmanifest","./favicon-48.png?v=2","./icon-192.png?v=2","./apple-touch-icon.png?v=2","./fincalc.js?v=13","./duchod.js?v=11","./uvery.js?v=5","./databaze.js?v=12","./dzcrypto.js?v=2","./advimg.js?v=1","./pushcrypto.js?v=1","./photoedit.js?v=4","./dmy.js?v=1","./docs.js?v=6","./wallpaper.js?v=7","./icon-512.png?v=2"];
/* CORE (appka) se stáhne při instalaci. Ostatní se ukládá až při prvním použití:
   RCACHE = finanční plán (fp.html), dotazník, tapeta, sazby… – přežije vydání nové verze, staré verze téhož souboru se při uložení nové smažou;
   VCACHE = knihovny pro náhled souborů (PDF, Word, Excel, ~2,2 MB) – nemažou se ani nestahují znovu. */
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:"reload"})))));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>![CACHE,RCACHE,VCACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
/* ukládá se jen skutečná odpověď webu – ne přesměrování na přihlášení (Cloudflare Access), jinak by se místo appky uložila přihlašovací stránka */
const good=r=>r&&r.ok&&!r.redirected&&r.type==="basic";
const plain=u=>u.split("?")[0];
async function put(name,req,r){const c=await caches.open(name);
  if(name===RCACHE){const p=plain(req.url);for(const k of await c.keys())if(plain(k.url)===p&&k.url!==req.url)await c.delete(k)}
  await c.put(req,r)}
const store=u=>CORE.some(x=>new URL(x,self.registration.scope).href===u)?CACHE:RCACHE;
/* síť; odpověď se zároveň uloží */
const net=(req,name)=>fetch(req.url,{cache:"no-cache"}).then(r=>{if(good(r))put(name,req,r.clone()).catch(()=>{});return r});
/* hláška „nová verze“ pro otevřená okna (když se ukázala uložená stránka a ze sítě mezitím přišla jiná) */
async function notify(){for(const c of await self.clients.matchAll({type:"window"}))try{c.postMessage({type:"sw-new"})}catch(e){}}
self.addEventListener("fetch",e=>{
  const req=e.request,u=new URL(req.url);
  if(req.method!=="GET"||u.origin!==location.origin)return;
  if(u.pathname.includes("/vendor/")){e.respondWith(caches.open(VCACHE).then(c=>c.match(req).then(h=>h||fetch(req).then(r=>{if(good(r))c.put(req,r.clone());return r}))));return}
  /* stránky (index, finanční plán, dotazník): síť s krátkým čekáním (1 s), jinak uložená verze – síť ji mezitím obnoví */
  if(req.mode==="navigate"||req.destination==="iframe"||/\.html?$|\/$/.test(u.pathname)){
    const name=store(req.url);
    e.respondWith((async()=>{
      const cached=await caches.match(req)||await caches.match(req,{ignoreSearch:true});
      const n=net(req,name);
      if(!cached)return n.catch(()=>req.mode==="navigate"?caches.match("./index.html").then(r=>r||Response.error()):Response.error());
      const t=new Promise(res=>setTimeout(()=>res(null),1000));
      const r=await Promise.race([n.catch(()=>null),t]);
      if(r&&r.ok)return r;
      const old=cached.clone();
      e.waitUntil(n.then(async x=>{if(good(x)&&await x.clone().text()!==await old.text())return notify()}).catch(()=>{}));
      return cached})());
    return}
  /* data (sazby hypoték …): síť, bez ní uložená verze */
  if(/\.json$/.test(u.pathname)){e.respondWith(net(req,RCACHE).catch(()=>caches.match(req,{ignoreSearch:true})));return}
  /* soubory appky (skripty s ?v=, ikony, obrázky): hned z mezipaměti, na pozadí se obnoví (stale-while-revalidate) */
  e.respondWith((async()=>{
    const cached=await caches.match(req);
    const n=net(req,store(req.url));
    if(cached){e.waitUntil(n.catch(()=>{}));return cached}
    return n.catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||Response.error()))})());
});
/* push notifikace (prostředník worker/push.js): zobrazit a po klepnutí otevřít / přepnout na Pipeline */
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={t:"Pipeline",b:e.data?e.data.text():""}}
  e.waitUntil(self.registration.showNotification(d.t||"Pipeline",{body:d.b||"",icon:"icon-192.png?v=2",badge:"icon-192.png?v=2",tag:d.tag||undefined,data:{u:d.u||"./"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const u=new URL((e.notification.data&&e.notification.data.u)||"./",self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{const c=cs.find(x=>x.url.startsWith(self.registration.scope));
    if(c){c.focus();try{c.postMessage({type:"push-open",u})}catch(x){}return}return self.clients.openWindow(u)}))});
