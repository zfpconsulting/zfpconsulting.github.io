/* Krátké odkazy poradců (/termin/<kód>/ = jen rezervace, /dotaznik/<kód>/ = dotazník): plná stránka dotazníku s nastavením poradce
   zapečeným uvnitř (bez přesměrování – jinak by iMessage/WhatsApp vzaly náhled z cílové stránky a ne logo a obrázek).
   Spuštění: node tools/short-links.mjs   ·   kontrola v CI: node tools/short-links.mjs --check (selže, když stránky nejsou aktuální)
   Nový poradce: node tools/short-links.mjs --add "<jeho dlouhý odkaz na dotazník>" <kód>
     → přidá ho do tools/short-links.json, vyrobí obrázek náhledu s jeho jménem (tools/og-images.mjs), sestaví /termin/<kód>/ a /dotaznik/<kód>/
       a doplní seznam krátkých odkazů v Pipeline (DZ_SHORT). Dlouhý odkaz si poradce zkopíruje v Pipeline (Dotazník / Rezervace → Kopírovat odkaz). */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {execFileSync} from "node:child_process";
const R=new URL("..",import.meta.url).pathname;
const src=readFileSync(R+"pipeline/dotaznik.html","utf8"),CFG=R+"tools/short-links.json",cfg=JSON.parse(readFileSync(CFG,"utf8"));
const ai=process.argv.indexOf("--add");
if(ai>=0){const link=process.argv[ai+1]||"",code=(process.argv[ai+2]||"").toLowerCase();
  if(!/^[a-z0-9-]{1,24}$/.test(code))throw new Error("kód: 1–24 znaků a-z, 0-9, pomlčka");
  const h=new URLSearchParams((link.split("#")[1]||"").replace(/^#/,""));
  if(!h.get("to")||!h.get("k")||!h.get("p"))throw new Error("v odkazu chybí údaje (to, k, p) – použij DLOUHÝ odkaz z Pipeline (po přihlášení Googlem)");
  if(cfg.some(a=>a.code===code||a.k===h.get("k")))throw new Error("tenhle kód nebo poradce už v short-links.json je");
  const a={code,to:h.get("to"),k:h.get("k"),p:h.get("p")};for(const [x,y] of [["bk","b"],["e","e"],["t","t"]])if(h.get(y))a[x]=h.get(y);
  cfg.push(a);writeFileSync(CFG,"[\n"+cfg.map(x=>"  "+JSON.stringify(x)).join(",\n")+"\n]\n");
  execFileSync("node",[R+"tools/og-images.mjs",code],{stdio:"inherit"});console.log("přidán poradce "+a.p+" ("+code+")")}
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
const check=process.argv.includes("--check");let bad=0;
for(const a of cfg){for(const kind of ["termin","dotaznik"]){
  const only=kind==="termin",dir=`${kind}/${a.code}/`,url="https://zfpconsulting.github.io/"+dir;
  const h=new URLSearchParams({v:"1",to:a.to,k:a.k,p:a.p});if(a.bk)h.set("b",a.bk);if(a.e)h.set("e",a.e);if(a.t)h.set("t",a.t);if(only)h.set("m","r");
  const b64=Buffer.from(h.toString(),"utf8").toString("base64");
  if(!existsSync(R+`og/${kind}-${a.code}.jpg`))throw new Error(`chybí og/${kind}-${a.code}.jpg – spusť node tools/og-images.mjs`);
  const title=only?`Rezervace konzultace – ${a.p}`:`Vstupní dotazník – ${a.p}`;
  const desc=only?"Vyberte si termín konzultace – osobně v Brně (Trnitá 500/9) nebo online. ZFP Consulting":"Podklady k finančnímu plánu – vyplnění zabere asi 15 minut, odpovědi se šifrují. ZFP Consulting";
  const og=`<meta property="og:type" content="website">
<meta property="og:site_name" content="ZFP Consulting">
<meta property="og:locale" content="cs_CZ">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://zfpconsulting.github.io/og/${kind}-${a.code}.jpg">
<meta property="og:image:secure_url" content="https://zfpconsulting.github.io/og/${kind}-${a.code}.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)} · ZFP Consulting">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">`;
  let s=src.replace(/<title>[^<]*<\/title>/,`<title>${esc(title)} | ZFP Consulting</title>`)
    .replace(/<!--og-->[\s\S]*?<!--\/og-->/,og)
    .replace(/(src|srcset)="(zfp-(?:consulting-)?logo(?:-white)?\.svg|dzcrypto\.js[^"]*)"/g,'$1="/pipeline/$2"')
    .replace('<script src="/pipeline/dzcrypto.js',`<script>window.DZ_LINK=decodeURIComponent(escape(atob("${b64}")));</script>\n<script src="/pipeline/dzcrypto.js`);
  s="<!-- SESTAVENO z pipeline/dotaznik.html (node tools/short-links.mjs) – neupravovat ručně -->\n"+s;
  if(!s.includes("window.DZ_LINK=")||!s.includes(`og:url" content="${url}"`))throw new Error("sestavení selhalo: "+dir);
  const f=R+dir+"index.html";
  if(check){if(!existsSync(f)||readFileSync(f,"utf8")!==s){console.log("✗ neaktuální: "+dir);bad++}else console.log("✓ "+dir)}
  else{mkdirSync(R+dir,{recursive:true});writeFileSync(f,s);console.log("zapsáno "+dir)}
}}
/* seznam krátkých odkazů v Pipeline (DZ_SHORT) = tools/short-links.json */
{const f=R+"pipeline/index.html",t=readFileSync(f,"utf8"),line="const DZ_SHORT="+JSON.stringify(cfg.map(a=>({c:a.code,k:a.k})))+";",n=t.replace(/const DZ_SHORT=\[.*?\];/,()=>line);
  if(!/const DZ_SHORT=\[.*?\];/.test(t))throw new Error("v pipeline/index.html chybí DZ_SHORT");
  if(check){if(n!==t){console.log("✗ neaktuální: DZ_SHORT v pipeline/index.html");bad++}else console.log("✓ DZ_SHORT")}else if(n!==t){writeFileSync(f,n);console.log("zapsáno DZ_SHORT")}}
if(bad){console.log("Spusť node tools/short-links.mjs a ulož změny.");process.exit(1)}
