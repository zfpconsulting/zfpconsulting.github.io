/* Krátké odkazy poradců (/termin/<kód>/ = jen rezervace, /dotaznik/<kód>/ = dotazník): plná stránka dotazníku s nastavením poradce
   zapečeným uvnitř (bez přesměrování – jinak by iMessage/WhatsApp vzaly náhled z cílové stránky a ne logo a obrázek).
   Spuštění: node tools/short-links.mjs   ·   kontrola v CI: node tools/short-links.mjs --check (selže, když stránky nejsou aktuální) */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
const R=new URL("..",import.meta.url).pathname;
const src=readFileSync(R+"pipeline/dotaznik.html","utf8"),cfg=JSON.parse(readFileSync(R+"tools/short-links.json","utf8"));
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
const check=process.argv.includes("--check");let bad=0;
for(const a of cfg){for(const kind of ["termin","dotaznik"]){
  const only=kind==="termin",dir=`${kind}/${a.code}/`,url="https://zfpconsulting.github.io/"+dir;
  const h=new URLSearchParams({v:"1",to:a.to,k:a.k,p:a.p});if(only)h.set("m","r");
  const b64=Buffer.from(h.toString(),"utf8").toString("base64");
  const title=only?`Rezervace konzultace – ${a.p}`:`Vstupní dotazník – ${a.p}`;
  const desc=only?"Vyberte si termín konzultace – osobně v Brně (Trnitá 500/9) nebo online. ZFP Consulting":"Podklady k finančnímu plánu – vyplnění zabere asi 15 minut, odpovědi se šifrují. ZFP Consulting";
  const og=`<meta property="og:type" content="website">
<meta property="og:site_name" content="ZFP Consulting">
<meta property="og:locale" content="cs_CZ">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://zfpconsulting.github.io/og/${kind}-2.jpg">
<meta property="og:image:secure_url" content="https://zfpconsulting.github.io/og/${kind}-2.jpg">
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
if(bad){console.log("Spusť node tools/short-links.mjs a ulož změny.");process.exit(1)}
