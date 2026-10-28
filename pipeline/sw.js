const CACHE="pipeline-v176", VCACHE="pipeline-vendor-v1";
const CORE=["./","./index.html","./manifest.webmanifest","./icon-192.png?v=2","./icon-512.png?v=2","./apple-touch-icon.png?v=2","./favicon-48.png?v=2","./fincalc.js?v=11","./duchod.js?v=9","./uvery.js?v=3","./databaze.js?v=8","./photoedit.js?v=2","./dmy.js?v=1","./docs.js?v=4","./fp.html?v=82","./dotaznik.html?v=23","./nnrs.js?v=1","./advimg.js?v=1","./dzcrypto.js?v=2","./pushcrypto.js?v=1"];
/* knihovny pro náhled souborů (PDF, Word, Excel) mají vlastní cache, která se při vydání nové verze appky nemaže ani nestahuje znovu */
const VENDOR=["./vendor/pdf.min.mjs","./vendor/pdf.worker.min.mjs","./vendor/mammoth.browser.min.js","./vendor/read-excel-file.min.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));caches.open(VCACHE).then(c=>Promise.all(VENDOR.map(u=>c.match(u).then(h=>h||c.add(u))))).catch(()=>{});self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==VCACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin)return;
  if(u.pathname.includes("/vendor/")){e.respondWith(caches.open(VCACHE).then(c=>c.match(e.request).then(h=>h||fetch(e.request).then(r=>{if(r.ok&&!r.redirected&&r.type==="basic")c.put(e.request,r.clone());return r}))));return}
  /* ukládá se jen skutečná odpověď webu – ne přesměrování na přihlášení (Cloudflare Access), jinak by se místo appky uložila přihlašovací stránka */
  const net=fetch(e.request.url,{cache:"no-cache"}).then(r=>{if(r.ok&&!r.redirected&&r.type==="basic"){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}return r});
  const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),3500));
  e.respondWith(Promise.race([net,timeout]).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("./index.html"))));
});
/* push notifikace (prostředník worker/push.js): zobrazit a po klepnutí otevřít / přepnout na Pipeline */
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={t:"Pipeline",b:e.data?e.data.text():""}}
  e.waitUntil(self.registration.showNotification(d.t||"Pipeline",{body:d.b||"",icon:"icon-192.png?v=2",badge:"icon-192.png?v=2",tag:d.tag||undefined,data:{u:d.u||"./"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const u=new URL((e.notification.data&&e.notification.data.u)||"./",self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{const c=cs.find(x=>x.url.startsWith(self.registration.scope));
    if(c){c.focus();try{c.postMessage({type:"push-open",u})}catch(x){}return}return self.clients.openWindow(u)}))});
