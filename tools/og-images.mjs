/* Náhledové obrázky odkazů (og:image, 1200×630) – každý poradce má v obrázku své jméno, bez jména jsou obecné (pro dlouhý odkaz).
   Spuštění: node tools/og-images.mjs   → og/termin.jpg, og/dotaznik.jpg (bez jména) + og/termin-<kód>.jpg, og/dotaznik-<kód>.jpg pro každého v tools/short-links.json
   Vyžaduje Playwright s Chromiem (jako testy) a písmo Inter. Obrázky se commitují; short-links.mjs na ně odkazuje. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
const R=new URL("..",import.meta.url).pathname;
let pw;try{pw=await import("playwright")}catch{pw=await import(process.env.PLAYWRIGHT_MODULE||"/opt/node22/lib/node_modules/playwright/index.mjs")}
const logo=readFileSync(R+"pipeline/zfp-consulting-logo-white.svg","utf8");
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
const ICON={
  termin:`<path d="M8 3v4M16 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M9 15.5l2.2 2.2L15.5 13.2"/>`,
  dotaznik:`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14.5l2.2 2.2L15.5 12.2"/>`};
const TITLE={termin:"Rezervace<br>konzultace",dotaznik:"Vstupní<br>dotazník"};
const html=(kind,name)=>`<!doctype html><meta charset="utf-8"><style>
html,body{margin:0}body{width:1200px;height:630px;background:#000;position:relative;overflow:hidden;font-family:Inter,"Inter Display",Arial,sans-serif}
.glow{position:absolute;inset:0;background:radial-gradient(ellipse 230px 135px at 50% 100%,rgba(243,117,32,.125),rgba(243,117,32,0) 100%),radial-gradient(ellipse 520px 300px at 50% 0,rgba(255,255,255,.028),rgba(255,255,255,0) 100%)}
.bm{position:absolute;left:983px;top:0}
.bar{position:absolute;left:0;right:0;bottom:0;height:7px;background:#f37520}
.logo{position:absolute;left:436px;top:91px;width:328px;height:163px}.logo svg{display:block;width:100%;height:100%}
h1{position:absolute;left:0;right:0;top:299px;margin:0;text-align:center;color:#fff;font-weight:800;font-size:82px;line-height:85px;letter-spacing:-.008em}
.who{position:absolute;left:0;right:0;top:501px;display:flex;justify-content:center;align-items:center;gap:17px;color:#dfdfdf;font-weight:600;font-size:31.4px}
.who svg{width:33px;height:33px;fill:none;stroke:#f37520;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
</style><div class="glow"></div>
<svg class="bm" width="144" height="223" viewBox="0 0 144 223"><polygon points="0,0 144,0 144,223 72,149 0,223" fill="#221004"/></svg>
<div class="logo">${logo}</div><h1>${TITLE[kind]}</h1>
${name?`<div class="who"><svg viewBox="0 0 24 24">${ICON[kind]}</svg><span>${esc(name)}</span></div>`:""}<div class="bar"></div>`;
const jobs=[];
for(const kind of ["termin","dotaznik"]){jobs.push([`og/${kind}.jpg`,kind,""]);
  for(const a of JSON.parse(readFileSync(R+"tools/short-links.json","utf8")))jobs.push([`og/${kind}-${a.code}.jpg`,kind,a.p])}
const only=process.argv[2];
const b=await pw.chromium.launch(process.env.PW_EXECUTABLE?{executablePath:process.env.PW_EXECUTABLE}:{});
const pg=await b.newPage({viewport:{width:1200,height:630}});
mkdirSync(R+"og",{recursive:true});
for(const [f,kind,name] of jobs){if(only&&!f.includes(only))continue;await pg.setContent(html(kind,name));await pg.evaluate(()=>document.fonts.ready);
  writeFileSync(R+f,await pg.screenshot({type:"jpeg",quality:90}));console.log("zapsáno",f)}
await b.close();
