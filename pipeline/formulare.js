/* Formuláře – žádosti klienta na instituce (výpovědi, změny, převody).
   Dvě cesty (první volba v záložce):
     • Oficiální formulář – PDF stažené z webů institucí (formulare/index.json, generuje ../tools/formulare.py); kde má PDF
       vyplnitelná pole, předvyplní se údaji klienta (pdf-lib + písmo s diakritikou, vše v prohlížeči, nic se nikam neposílá);
       u PDF bez polí se údaje dopíší do stránky za popisky (pozice „ov“ v index.json).
     • Volnou formou – dopis A4 (výpověď, výpověď v návaznosti, změna, posunutí počátku, odkup), tisk / PDF a kopie textu.
   Samostatný modul: Formulare.mount(kontejner, {clients, toast, ls, birthOf, advisors})
   advisors() → {firm:{name,seat,ico}, list:[{id,short,name,ico,code,phone,email}]} – poradci do sekce obchodní zástupce /
   zprostředkovatel (v appce z šifrovaného bloku, protože obsahují osobní údaje); ve formuláři se vybírá, kdo smlouvu vede.
   clients() → [{id,name,rec,lead,phone,products,…}] (clientEntries z Pipeline); údaje klienta jdou vždy přepsat ručně.
   Rodné číslo se neukládá (jen v paměti, dokud je záložka otevřená). */
(function(){
"use strict";

const SELF=(document.currentScript&&document.currentScript.src)||"";
const BASE=SELF?new URL(".",SELF).href:new URL(".",location.href).href;

/* ---------- konstanty ---------- */
const GROUPS=[["poj","Pojišťovny"],["ps","Penzijní společnosti"],["inv","Investice"]];
const KIND={vyp:"Výpověď / ukončení",navaz:"Výpověď v návaznosti",prevod:"Převod k jiné společnosti",zmena:"Změna smlouvy"};
const TYPES=[
 {k:"vyp",t:"Výpověď",g:["poj","ps","inv"]},
 {k:"navaz",t:"V návaznosti",g:["poj"]},
 {k:"odkup",t:"Odkup",g:["inv"]},
 {k:"zmena",t:"Změna",g:["poj","ps","inv"]},
 {k:"posun",t:"Posun počátku",g:["poj"]}
];
const ROLE_DEF={poj:"Pojistník",ps:"Účastník",inv:"Investor"};
const ROLES=["Pojistník a pojištěný","Pojistník","Pojištěný","Účastník","Investor","Klient","Vlastní…"];
const MES=["ledna","února","března","dubna","května","června","července","srpna","září","října","listopadu","prosince"];
const LS_STATE="frm_state_v2",LS_OLD="frm_state_v1",LS_CUSTOM="frm_custom_v1";
/* záloha, kdyby se index.json nenačetl (offline) – volná forma pak pořád funguje */
const FALLBACK_INST=[
 {id:"allianz",n:"Allianz pojišťovna, a. s.",short:"Allianz",group:"poj",addr:"Ke Štvanici 656/3\n186 00 Praha 8"},
 {id:"generali",n:"Generali Česká pojišťovna a. s.",short:"Generali ČP",group:"poj",addr:"P. O. BOX 305\n659 05 Brno"},
 {id:"uniqa",n:"UNIQA pojišťovna, a. s.",short:"UNIQA",group:"poj",addr:"Evropská 810/136\n160 00 Praha 6"},
 {id:"koop",n:"Kooperativa pojišťovna, a. s., Vienna Insurance Group",short:"Kooperativa",group:"poj",addr:"Centrum zákaznické podpory\nBrněnská 634\n664 42 Modřice"},
 {id:"cpp",n:"Česká podnikatelská pojišťovna, a. s., Vienna Insurance Group",short:"ČPP",group:"poj",addr:"P. O. BOX 28\n664 42 Modřice"},
 {id:"csob",n:"ČSOB Pojišťovna, a. s., člen holdingu ČSOB",short:"ČSOB Pojišťovna",group:"poj",addr:"Masarykovo náměstí 1458\n530 02 Pardubice"},
 {id:"nn",n:"NN Životní pojišťovna N.V., pobočka pro Českou republiku",short:"NN",group:"poj",addr:"Nádražní 344/25\n150 00 Praha 5"}
];

/* ---------- drobné pomocníky ---------- */
const todayISO=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
function dlong(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||"");return m?(+m[3])+". "+MES[+m[2]-1]+" "+m[1]:(iso||"")}
function dshort(v){v=String(v||"").trim();const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v);return m?(+m[3])+". "+(+m[2])+". "+m[1]:v}
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fold=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const T=s=>String(s==null?"":s).trim();

/* číslo účtu: [předčíslí-]číslo/kód banky, modulo 11 – jen měkké upozornění (nikdy nebrání tisku) */
function ucetCheck(s){
  s=String(s||"").replace(/\s+/g,"");if(!s)return {st:"",msg:""};
  if(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(s))return {st:"ok",msg:"IBAN – formát nekontroluji"};
  const m=/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s);
  if(!m)return {st:"bad",msg:"Čekám tvar předčíslí-číslo/kód banky (např. 123456789/0800)"};
  const P=[10,5,8,4,2,1],N=[6,3,7,9,10,5,8,4,2,1];
  const sum=(d,w)=>{d=d.padStart(w.length,"0");let t=0;for(let i=0;i<w.length;i++)t+=(+d[i])*w[i];return t};
  const ok=sum(m[1]||"0",P)%11===0&&sum(m[2],N)%11===0;
  return ok?{st:"ok",msg:"Číslo účtu sedí (kontrolní součet)"}:{st:"bad",msg:"Číslo účtu neprošlo kontrolou – zkontroluj překlep"};
}
function parseAcc(s){
  s=String(s||"").replace(/\s+/g,"");
  const m=/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s);
  return m?{pre:m[1]||"",num:m[2],bank:m[3],iban:""}:{pre:"",num:s,bank:"",iban:/^[A-Z]{2}\d{2}/i.test(s)?s:""};
}
/* „Ing. Jana Nováková, Ph.D.“ → {first:"Jana", last:"Nováková", tb:"Ing.", ta:"Ph.D."} (jméno v pipeline je „Jméno Příjmení“) */
function splitName(full){
  let s=T(full),ta="";const c=s.indexOf(",");if(c>0){ta=T(s.slice(c+1));s=T(s.slice(0,c))}
  const w=s.split(/\s+/).filter(Boolean),tb=[];
  while(w.length>2&&/\.$/.test(w[0]))tb.push(w.shift());
  while(w.length>2&&/\.$/.test(w[w.length-1]))ta=(w.pop()+" "+ta).trim();
  if(w.length===2&&/\.$/.test(w[0]))tb.push(w.shift());
  return {first:w.length>1?w.slice(0,-1).join(" "):(w[0]||""),last:w.length>1?w[w.length-1]:"",tb:tb.join(" "),ta};
}
/* „Květinová 5, 602 00 Brno“ / „Květinová 5\n602 00 Brno“ → ulice, č. p., PSČ, obec */
function parseAddr(a){
  const parts=String(a||"").split(/[\n,]+/).map(T).filter(Boolean);
  let psc="",city="",street="",cp="";const rest=[];
  for(const p of parts){
    const only=/^(\d{3})\s?(\d{2})$/.exec(p);               /* „62500“ samo – formát Brno, část, ulice č., PSČ */
    if(only&&!psc){psc=only[1]+" "+only[2];continue}
    const m=/^(\d{3})\s?(\d{2})\s+(.+)$/.exec(p)||/^(.+?)\s+(\d{3})\s?(\d{2})$/.exec(p);
    if(m&&!psc){if(/^\d/.test(p)){psc=m[1]+" "+m[2];city=T(m[3])}else{city=T(m[1]);psc=m[2]+" "+m[3]}}else rest.push(p);
  }
  const NUM=/^(.*?)\s+(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/;
  let si=rest.findIndex(x=>NUM.test(x));if(si<0)si=0;
  const s0=rest[si]||"";const mm=NUM.exec(s0);
  if(mm){street=mm[1];cp=mm[2]}else street=s0;
  if(!city&&rest.length>1)city=si>0?rest[0]:rest[rest.length-1];
  return {street,cp,streetcp:T(street+" "+cp),psc,city,line:parts.join(", ")};
}

/* ---------- text dopisu (jedna pravda pro náhled, tisk i kopii) ---------- */
function instOf(S,list){return list.find(i=>i.id===S.inst)||null}
function build(S,list){
  const I=instOf(S,list)||{n:S.instName||"",group:S.instGroup||"poj",addr:S.iaddr||""};
  const g=I.group||"poj";
  const typ=TYPES.some(t=>t.k===S.typ&&t.g.includes(g))?S.typ:"vyp";
  const cn=T(S.cnum)||"XXXXXXXXXX";const kdy=S.kdy?dlong(S.kdy):"";
  const sml=g==="poj"?"pojistné smlouvy":"smlouvy";
  const body=[];let title;
  if(typ==="vyp"){
    title=g==="inv"?"Žádost o ukončení smlouvy":"Žádost o výpověď smlouvy";
    body.push((g==="inv"?"žádám o ukončení smlouvy č. ":"žádám o výpověď "+sml+" č. ")+cn+" "+(kdy?"k datu "+kdy+".":"k nejbližšímu možnému datu."));
    body.push("Prosím o potvrzení přijetí "+(g==="inv"?"žádosti":"výpovědi")+" a data ukončení smlouvy.");
  }else if(typ==="navaz"){
    title="Žádost o výpověď smlouvy v návaznosti na novou smlouvu";
    const nw=T(S.cnumNew);
    body.push("žádám o výpověď pojistné smlouvy č. "+cn+" "+(kdy?"k datu "+kdy:"k nejbližšímu možnému datu")+", a to v návaznosti na uzavření nové pojistné smlouvy"+(nw?" č. "+nw:"")+" u Vaší pojišťovny.");
    body.push("Prosím o potvrzení přijetí výpovědi a data ukončení smlouvy.");
  }else if(typ==="odkup"){
    title="Žádost o odkup podílových listů";
    body.push("žádám o odkup "+(T(S.popis)?T(S.popis):"všech podílových listů")+" evidovaných na smlouvě č. "+cn+(kdy?" k datu "+kdy:"")+" a o výplatu prostředků na níže uvedený účet.");
  }else if(typ==="zmena"){
    title="Žádost o změnu smlouvy";
    body.push("žádám o změnu "+sml+" č. "+cn+(kdy?" s účinností od "+kdy:"")+".");
    body.push(T(S.popis)||"Požadovaná změna: …");
    body.push("Prosím o potvrzení provedené změny.");
  }else{
    title="Žádost o posunutí počátku smlouvy";
    body.push("žádám o posunutí počátku pojistné smlouvy č. "+cn+" na "+(kdy||"datum …")+".");
    if(T(S.popis))body.push(T(S.popis));
    body.push("Prosím o potvrzení nového data počátku.");
  }
  let odk=null;
  const pay=typ==="odkup"||((typ==="vyp"||typ==="navaz")&&(g==="poj"||g==="ps")&&S.odk===true);
  if(pay){
    const what=typ==="odkup"?"Prostředky z odkupu":g==="ps"?"Odbytné":"Případné odkupné";
    odk=[what+" prosím zašlete na:","Číslo účtu: "+(T(S.ucet)||"XXXXXXXXXX")];
    if(T(S.vs))odk.push("VS: "+T(S.vs));
    if(T(S.ss))odk.push("SS: "+T(S.ss));
  }
  const role=S.role==="Vlastní…"?T(S.roleX):S.role;
  const ident=[role,(S.birth?"nar. "+dshort(S.birth):""),(S.addr?"trvale bytem "+S.addr.replace(/\n+/g,", "):"")].filter(Boolean).join(", ");
  return {typ,title,body,odk,ident,date:dlong(S.date),
    rcpt:[T(I.n)].concat(String(S.iaddr||"").split("\n").map(T).filter(Boolean)).filter(Boolean),
    from:(S.addr||"").split("\n").map(T).filter(Boolean).join(", ")};
}
function plain(S,list){
  const b=build(S,list),L=[];
  L.push(S.name,b.from,"",b.rcpt.join("\n"),"");if(S.reg)L.push("DOPORUČENĚ");L.push(b.date,"",b.title,"","Dobrý den,","");
  b.body.forEach(p=>L.push(p));
  if(b.odk){L.push("");L.push(...b.odk)}
  L.push("","S pozdravem","","______________________",S.name,b.ident);
  return L.join("\n").replace(/\n{3,}/g,"\n\n");
}
function letterHTML(S,list){
  const b=build(S,list);
  return '<div class="fl-head"><div class="fl-name">'+esc(S.name||"Jméno klienta")+'</div><div class="fl-from">'+esc(b.from)+'</div></div>'
   +'<div class="fl-rcpt">'+b.rcpt.map(esc).join("<br>")+'</div>'
   +'<div class="fl-meta"><b>'+(S.reg?"DOPORUČENĚ":"")+'</b><span>'+esc(b.date)+'</span></div>'
   +'<h2 class="fl-title">'+esc(b.title)+'</h2>'
   +'<p>Dobrý den,</p>'+b.body.map(p=>"<p>"+esc(p)+"</p>").join("")+(b.odk?"<p>"+b.odk.map(esc).join("<br>")+"</p>":"")
   +'<p class="fl-sp">S pozdravem</p><div class="fl-sig"></div>'
   +'<div class="fl-who"><b>'+esc(S.name||"")+'</b><br>'+esc(b.ident)+'</div>';
}
const PAPER_CSS=`
.fl-paper{box-sizing:border-box;width:210mm;min-height:297mm;padding:22mm 24mm;background:#fff;color:#111;font:11pt/1.5 -apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:0}
.fl-paper p{margin:0 0 12pt}
.fl-head{margin-bottom:26mm}
.fl-name{font-size:26pt;font-weight:600;color:#8c8c8c;line-height:1.15}
.fl-from{font-size:9pt;color:#8c8c8c;margin-top:2pt}
.fl-rcpt{margin-bottom:12mm;line-height:1.45}
.fl-meta{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12mm}
.fl-meta b{letter-spacing:.04em}
.fl-title{font-size:12pt;font-weight:700;text-decoration:underline;margin:0 0 12pt}
.fl-sp{margin-top:16pt}
.fl-sig{width:60mm;height:16mm;border-bottom:1px solid #111;margin-bottom:6pt}
.fl-who{font-size:10.5pt}
`;

/* ---------- údaje pro oficiální PDF ---------- */
/* klíče formuláře bez dílčích přípon („cnum@3“ → cnum, „date@d“ → date; placedate = místo + datum) */
function fkeys(form){const k=new Set();Object.values(form.fill||{}).forEach(v=>{v=String(v).split("@")[0];if(v==="placedate"){k.add("place");k.add("date")}else k.add(v)});return k}
/* výplata na účet: pojišťovny a PS jen když je odkupné / odbytné, investice vždy (výtěžek odkupu jde na účet) */
const payOn=(form,g,S)=>(form.kind==="vyp"||form.kind==="navaz")&&(((g==="poj"||g==="ps")&&S.odk===true)||g==="inv");
/* údaje poradce: adv = {firm, p} (vybraný poradce) nebo null = nevyplňovat */
function advVals(adv){
  if(!adv||!adv.p)return {};const f=adv.firm||{},p=adv.p;
  return {advfirm:T(f.name),advseat:T(f.seat),advico:T(f.ico),advname:T(p.name),advicop:T(p.ico),advcode:T(p.code),advphone:T(p.phone),advemail:T(p.email)};
}
function values(S,form,inst,adv){
  const n=splitName(S.name),a=parseAddr(S.addr),acc=parseAcc(S.ucet),keys=fkeys(form);
  const g=(inst&&inst.group)||"poj";
  const tit=[n.tb,n.ta].filter(Boolean).join(" ");
  const V={
    cnum:T(S.cnum),surname:n.last,firstname:n.first,title:tit,
    fullname:T([n.tb,n.first,n.last].filter(Boolean).join(" ")+(n.ta?", "+n.ta:"")),
    fullnameRev:T([n.last,n.first].filter(Boolean).join(" ")+(tit?", "+tit:"")),
    rc:T(S.rc),birth:dshort(S.birth),rcbirth:T(S.rc)||dshort(S.birth),
    street:a.street,streetcp:a.streetcp,cp:a.cp,city:a.city,psc:a.psc,addr:a.line,
    phone:T(S.phone),email:T(S.email),date:dshort(todayISO()),place:""
  };
  V.placedate=[V.place,V.date].filter(Boolean).join(", ");
  Object.assign(V,advVals(adv));
  if(payOn(form,g,S)){
    V.accpre=acc.pre;V.bank=acc.bank;
    V.account=acc.iban||((keys.has("accpre")?"":(acc.pre?acc.pre+"-":""))+acc.num+(keys.has("bank")||!acc.bank?"":"/"+acc.bank));
    V.vs=T(S.vs);V.ss=T(S.ss);
  }
  if(keys.has("newcnum")&&T(S.cnumNew))V.newcnum=T(S.cnumNew);
  return V;
}
/* hodnota pro klíč, i dílčí: „cnum@3“ = 4. znak (políčka po jednom znaku), „date@d|m|y“ = den / měsíc / rok */
function pick(V,key){
  const i=key.indexOf("@");if(i<0)return V[key]||"";
  const base=key.slice(0,i),sub=key.slice(i+1),v=String(V[base]||"");if(!v)return "";
  if(/^[dmy]$/.test(sub)){const m=/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(v);if(!m)return "";return sub==="d"?m[1].padStart(2,"0"):sub==="m"?m[2].padStart(2,"0"):m[3]}
  /* „3/8“ = 4. znak z posledních 8 (předtištěná předpona čísla smlouvy se tak přeskočí, když ji zadáš celou) */
  const m=/^(\d+)(?:\/(\d+))?$/.exec(sub);if(!m)return "";
  let c=v.replace(/[\s-]+/g,"");if(m[2]&&c.length>+m[2])c=c.slice(-m[2]);
  return c.charAt(+m[1])||"";
}
const baseKey=k=>{k=String(k).split("@")[0];return k};
const KEYLAB={cnum:"číslo smlouvy",newcnum:"nová smlouva",surname:"příjmení",firstname:"jméno",fullname:"jméno a příjmení",fullnameRev:"příjmení a jméno",title:"titul",rc:"rodné číslo",birth:"datum narození",rcbirth:"RČ / datum narození",street:"ulice",streetcp:"ulice a č. p.",cp:"č. p.",city:"obec",psc:"PSČ",addr:"adresa",phone:"telefon",email:"e-mail",account:"číslo účtu",accpre:"předčíslí",bank:"kód banky",vs:"VS",ss:"SS",date:"datum",place:"místo",placedate:"místo a datum",
  advfirm:"obchodní zástupce",advseat:"sídlo zástupce",advico:"IČO zástupce",advname:"poradce",advicop:"IČO poradce",advcode:"kód poradce",advphone:"telefon poradce",advemail:"e-mail poradce"};

/* ---------- líné načítání knihoven ---------- */
const libs={};
function loadScript(src){return new Promise((ok,ko)=>{const s=document.createElement("script");s.src=src;s.onload=ok;s.onerror=()=>ko(new Error("Nepodařilo se načíst "+src));document.head.append(s)})}
async function pdfLib(){
  if(!libs.lib){libs.lib=(async()=>{
    if(!window.PDFLib)await loadScript(BASE+"vendor/pdf-lib.min.js");
    if(!window.fontkit)await loadScript(BASE+"vendor/fontkit.umd.min.js");
    const font=await (await fetch(BASE+"vendor/LiberationSans-Regular.ttf")).arrayBuffer();
    return {PDFLib:window.PDFLib,fontkit:window.fontkit,font};
  })();libs.lib.catch(()=>{libs.lib=null})}
  return libs.lib;
}
async function pdfJs(){
  if(!libs.js){libs.js=(async()=>{const lib=await import(BASE+"vendor/pdf.min.mjs");lib.GlobalWorkerOptions.workerSrc=BASE+"vendor/pdf.worker.min.mjs";return lib})();libs.js.catch(()=>{libs.js=null})}
  return libs.js;
}
const fileCache=new Map();
function getFile(f){if(!fileCache.has(f)){const p=fetch(BASE+"formulare/"+f).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.arrayBuffer()});fileCache.set(f,p);p.catch(()=>fileCache.delete(f))}return fileCache.get(f)}
/* hodnota do pole s omezenou délkou (hřebínková pole na RČ, PSČ…) */
function fit(field,v,key){
  let max,comb=false;try{max=field.getMaxLength();comb=field.isCombed()}catch(e){}
  /* datum do hřebínku: 07.03.1985 / 07031985 (políčka po jednom znaku musí sedět) */
  const dm=/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(v);
  if(dm&&comb&&max&&(key==="date"||key==="birth"||key==="rcbirth")){const d=dm[1].padStart(2,"0"),m=dm[2].padStart(2,"0");
    return max>=10?d+"."+m+"."+dm[3]:max>=8?d+m+dm[3]:(d+m+dm[3].slice(2)).slice(0,max)}
  if(!max||v.length<=max)return v;
  const s=v.replace(/[\s/]/g,"");if(s.length<=max)return s;
  /* hřebínkové datum s předtištěnými tečkami: „21. 11. 2026“ → „21112026“, případně „211126“ */
  if(key==="date"||key==="birth"||key==="rcbirth"){const m=/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(v);if(m){const d=m[1].padStart(2,"0")+m[2].padStart(2,"0");if((d+m[3]).length<=max)return d+m[3];if((d+m[3].slice(2)).length<=max)return d+m[3].slice(2)}}
  if(key==="psc"||key==="rc"||key==="cnum")return s.slice(0,max);
  return v.slice(0,max);
}
async function fillPdf(form,S,inst,adv){
  const [{PDFLib,fontkit,font},bytes]=await Promise.all([pdfLib(),getFile(form.file)]);
  const doc=await PDFLib.PDFDocument.load(bytes.slice(0),{ignoreEncryption:true,updateMetadata:false});
  const done=[];
  if(form.fill){
    doc.registerFontkit(fontkit);
    const V=values(S,form,inst,adv);let emb=null,touched=[];
    const mark=key=>{const b=baseKey(key);(b==="placedate"?["place","date"]:[b]).forEach(x=>{if(!done.includes(x))done.push(x)})};
    const acro=Object.keys(form.fill).some(n=>n.charAt(0)!=="@");
    const f=acro?doc.getForm():null;if(f)try{f.deleteXFA()}catch(e){}
    for(const [name,key] of Object.entries(acro?form.fill:{})){
      if(name.charAt(0)==="@")continue;
      const v=pick(V,key);if(!v)continue;
      let fld;try{fld=f.getTextField(name)}catch(e){continue}
      try{fld.setText(fit(fld,v,baseKey(key)));touched.push(fld);mark(key)}catch(e){continue}
      /* některá PDF (Kooperativa) pole schovávají, dokud skript ve formuláři nezaškrtne volbu – vyplněné pole ukázat */
      try{fld.acroField.getWidgets().forEach(w=>{if(w.hasFlag&&w.hasFlag(PDFLib.AnnotationFlags.Hidden))w.clearFlag(PDFLib.AnnotationFlags.Hidden)})}catch(e){}
    }
    if(touched.length){
      try{emb=await doc.embedFont(font,{subset:true})}catch(e){}
      for(const fld of touched){try{emb?fld.updateAppearances(emb):fld.defaultUpdateAppearances&&fld.defaultUpdateAppearances()}catch(e){}}
    }
    /* PDF bez vyplnitelných polí: text se dopíše za popisek na pozici z index.json (ov) */
    if(Array.isArray(form.ov)&&form.ov.length){
      const pages=doc.getPages();
      for(const o of form.ov){
        const key=form.fill[o.n];const v=key&&pick(V,key);const pg=pages[o.p];if(!v||!pg)continue;
        if(!emb)try{emb=await doc.embedFont(font,{subset:true})}catch(e){break}
        let size=o.s||10;while(size>6&&emb.widthOfTextAtSize(v,size)>o.w)size-=.5;
        try{pg.drawText(v,{x:o.x,y:o.y,size,font:emb,color:PDFLib.rgb(.07,.07,.1)});mark(key)}catch(e){}
      }
    }
  }
  return {bytes:await doc.save({updateFieldAppearances:false}),done};
}

/* ---------- mount ---------- */
function mount(root,opts){
  opts=opts||{};
  const ls=opts.ls||{get:()=>null,set:()=>{}};
  const toast=opts.toast||(()=>{});
  const getClients=()=>{try{return opts.clients()||[]}catch(e){return[]}};
  let custom=[];try{custom=ls.get(LS_CUSTOM)||[];if(!Array.isArray(custom))custom=[]}catch(e){custom=[]}
  let CAT={inst:FALLBACK_INST,forms:[],updated:""},catState="loading";
  /* poradci (kdo smlouvu vede) – vybraný se propíše do sekce obchodní zástupce / zprostředkovatel */
  const advData=()=>{try{const a=opts.advisors&&opts.advisors();return a&&Array.isArray(a.list)&&a.list.length?a:null}catch(e){return null}};
  const advOf=()=>{const a=advData();if(!a||S.adv==="none")return null;return {firm:a.firm||{},p:a.list.find(x=>x.id===S.adv)||a.list[0]}};
  const instList=()=>CAT.inst.concat(custom.map((c,i)=>({id:"x:"+c.n,n:c.n,short:c.n,group:c.g||"poj",addr:c.a||"",custom:true})));

  let S={mode:"off",cid:"",name:"",addr:"",birth:"",phone:"",email:"",rc:"",inst:"allianz",iaddr:FALLBACK_INST[0].addr,formId:"",ffilter:"all",
    typ:"vyp",cnum:"",cnumNew:"",kdy:"",popis:"",role:"Pojistník",roleX:"",odk:false,adv:"",ucet:"",vs:"",ss:"",reg:true,date:todayISO(),fdate:todayISO(),place:""};
  try{
    let o=ls.get(LS_STATE);
    if(!o){const v1=ls.get(LS_OLD);if(v1&&typeof v1==="object"){o=Object.assign({},v1,{mode:"vol",cnumNew:v1.nova||""});const hit=FALLBACK_INST.find(i=>i.n===v1.inst);o.inst=hit?hit.id:(v1.inst?"x:"+v1.inst:"allianz");delete o.nova}}
    if(o&&typeof o==="object")S=Object.assign(S,o,{date:todayISO(),fdate:todayISO(),rc:""});
  }catch(e){}

  /* ----- styl (jen tokeny design systému) ----- */
  const css=document.createElement("style");
  css.textContent=PAPER_CSS+`
  .frm2{display:grid;gap:var(--sp-4)}
  .frm2 .frm-top{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap}
  .frm2 .frm-top .seg{flex:1 1 320px;max-width:520px}
  .frm2 .frm-top .seg>button{min-height:36px;font-size:var(--fs-m)}
  .frm2 .frm-top .upd{font-size:var(--fs-s);color:var(--ink-2)}
  .frm2 .frm-grid{display:grid;grid-template-columns:minmax(320px,440px) minmax(0,1fr);gap:var(--sp-5);align-items:start}
  @media(max-width:960px){.frm2 .frm-grid{grid-template-columns:1fr}}
  .frm2 .frm-col{display:grid;gap:var(--sp-5);min-width:0}
  .frm2 .blk{display:grid;gap:var(--sp-2);min-width:0}
  .frm2 .group .frow>label{width:40%;font-size:var(--fs-m);color:var(--ink)}
  .frm2 .group .frow input[type=date]{text-align:right;min-height:var(--h-m)}
  .frm2 .group .frow.col textarea{min-height:52px}
  .frm2 .frow .pst{font-size:var(--fs-s);color:var(--ink-2)} .frm2 .frow .pst.bad{color:var(--accent-text);font-weight:600}
  .frm2 .frow.sub{min-height:0;padding-top:0;padding-bottom:var(--sp-2)} .frm2 .frow.sub::before{display:none}
  .frm2 .frow .seg{margin-left:auto}
  .frm2 .ipick{padding:var(--sp-3) var(--sp-4) var(--sp-4);display:grid;gap:var(--sp-3)}
  .frm2 .ipick .gh{font-size:var(--fs-xs);font-weight:600;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:-4px}
  .frm2 .ipick .chips{gap:6px}
  .frm2 .ipick .chip[aria-pressed="true"]{background:var(--ink);color:var(--canvas)}
  .frm2 .ipick .chip .n{font-size:var(--fs-xs);opacity:.7;font-variant-numeric:tabular-nums}
  .frm2 .mine{display:flex;gap:6px;flex-wrap:wrap;padding:0 var(--sp-1)}
  .frm2 .mine .chip{background:var(--accent-soft);color:var(--accent-text)}
  .frm2 .flist .row-btn{align-items:center}
  .frm2 .flist .row-btn.on{background:var(--accent-soft)}
  .frm2 .flist .row-btn.on .t{color:var(--accent-text);font-weight:600}
  .frm2 .flist .t{white-space:normal;line-height:1.3}
  .frm2 .flist .end{display:flex;gap:6px;align-items:center}
  .frm2 .note{padding:var(--sp-4);display:grid;gap:var(--sp-3);justify-items:start}
  .frm2 .note p{margin:0;color:var(--ink-2);font-size:var(--fs-m);line-height:1.45}
  .frm2 .pv{position:sticky;top:var(--sp-3);display:grid;gap:var(--sp-3);min-width:0}
  .frm2 .pv-bar{display:flex;gap:var(--sp-2);flex-wrap:wrap;align-items:center}
  .frm2 .pv-bar .sp{flex:1}
  .frm2 .pv-box{background:var(--fill);border-radius:var(--r-l);padding:var(--sp-3);overflow:auto;max-height:calc(100vh - 170px);min-height:220px}
  @media(max-width:960px){.frm2 .pv{position:static}.frm2 .pv-box{max-height:none}}
  .frm2 .pv-box .fit{transform-origin:top left}
  .frm2 .pv-box .fl-paper{box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}
  .frm2 .pv-pages{display:grid;gap:var(--sp-3);justify-items:center}
  .frm2 .pv-pages canvas{display:block;max-width:100%;height:auto;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}
  .frm2 .pv-empty{display:grid;place-items:center;text-align:center;min-height:240px;color:var(--ink-2);font-size:var(--fs-m);padding:var(--sp-5);line-height:1.45}
  .frm2 .pv-meta{display:grid;gap:4px}
  .frm2 .pv-meta .chips{gap:6px}
  .frm2 .dim{color:var(--ink-3)}
  `;
  root.textContent="";root.append(css);

  /* ----- DOM helper ----- */
  function h(tag,attrs,...kids){
    const e=document.createElement(tag);
    if(attrs)for(const [k,v] of Object.entries(attrs)){
      if(v==null||v===false)continue;
      if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(k==="html")e.innerHTML=v;else e.setAttribute(k,v===true?"":v);
    }
    for(const c of kids.flat())if(c!=null&&c!==false)e.append(c.nodeType?c:document.createTextNode(c));
    return e;
  }
  const sechead=(t,extra)=>h("div",{class:"section-head"},h("h3",{text:t}),extra||null);
  /* údaje zadané ve formuláři se rovnou uloží do karty vybraného klienta (rodné číslo se neukládá) */
  const CLIENT_KEYS=["addr","birth","phone","email"];
  function pushToClient(key){
    if(!S.cid||!opts.saveClient)return;
    try{Promise.resolve(opts.saveClient(S.cid,{key,value:T(S[key])})).then(id=>{if(id&&id!==S.cid){S.cid=id;save();if(refs.fillClients)refs.fillClients()}}).catch(()=>{})}catch(e){}
  }
  function save(){const keep=Object.assign({},S);delete keep.rc;delete keep.date;delete keep.fdate;try{ls.set(LS_STATE,keep)}catch(e){}}
  /* řádek s popiskem vlevo a polem vpravo (iOS list); col = popisek nad polem */
  function frow(label,key,o){
    o=o||{};const id="frm-"+key+"-"+Math.random().toString(36).slice(2,7);
    const i=o.area?h("textarea",{id,rows:o.rows||2,placeholder:o.ph||"",class:"autoh"}):h("input",{id,type:o.type||"text",placeholder:o.ph||"",inputmode:o.im||null,autocomplete:"off"});
    i.value=S[key]||"";
    i.addEventListener("input",()=>{S[key]=i.value;if(o.on)o.on();changed(o.light)});
    if(CLIENT_KEYS.includes(key))i.addEventListener("change",()=>pushToClient(key));
    const r=h("div",{class:"frow"+(o.area?" col":"")},h("label",{for:id,text:label}),i);
    r.input=i;return r;
  }
  function segOf(items,cur,on,o){
    const s=h("div",{class:"seg"+(o&&o.block?" seg--block":""),role:"tablist","aria-label":(o&&o.label)||null});
    items.forEach(([v,t])=>{const b=h("button",{type:"button",role:"tab","aria-selected":String(v===cur),text:t,onclick:()=>{[...s.children].forEach(x=>x.setAttribute("aria-selected",String(x===b)));on(v)}});b.dataset.v=v;s.append(b)});
    return s;
  }
  function btn(t,cls,fn,o){const b=h("button",{type:"button",class:"btn "+cls,text:t,onclick:fn});if(o&&o.title)b.title=o.title;return b}

  /* ----- kostra ----- */
  const wrap=h("div",{class:"frm2"});root.append(wrap);
  const upd=h("span",{class:"upd"});
  const modeSeg=segOf([["off","Oficiální formulář"],["vol","Volnou formou"]],S.mode,v=>{S.mode=v;save();renderAll()},{block:true,label:"Druh žádosti"});
  wrap.append(h("div",{class:"frm-top"},modeSeg,upd));
  const grid=h("div",{class:"frm-grid"});wrap.append(grid);
  const col=h("div",{class:"frm-col"}),pv=h("div",{class:"pv"});grid.append(col,pv);

  let pvState={url:null,blob:null,ver:0,busy:false,done:[],err:""};
  const refs={};

  /* ===== Klient ===== */
  function clientBlock(){
    const sel=h("select",{id:"frm-cid","aria-label":"Klient"});
    const fill=()=>{sel.textContent="";sel.append(h("option",{value:"",text:"— bez klienta (vyplním ručně) —"}));
      getClients().slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"cs")).forEach(e=>sel.append(h("option",{value:e.id,text:e.name})));
      sel.value=[...sel.options].some(o=>o.value===S.cid)?S.cid:""};
    fill();refs.fillClients=fill;
    sel.addEventListener("change",()=>{S.cid=sel.value;pickClient(S.cid)});
    const g=h("div",{class:"group"},
      h("div",{class:"frow"},h("label",{for:"frm-cid",text:"Klient"}),sel),
      frow("Jméno a příjmení","name",{ph:"i s titulem"}),
      frow("Adresa trvalého bydliště","addr",{area:true,ph:"Brno, Starý Lískovec, Krymská 379/15, 62500"}),
      frow("Datum narození","birth",{ph:"31. 1. 1990"}),
      S.mode==="off"?frow("Rodné číslo","rc",{ph:"neukládá se",im:"numeric"}):null,
      S.mode==="off"?frow("Telefon","phone",{type:"tel"}):null,
      S.mode==="off"?frow("E-mail","email",{type:"email"}):null);
    const mine=myContracts();
    return h("div",{class:"blk"},sechead("Klient"),g,mine);
  }
  function myContracts(){
    const e=getClients().find(x=>x.id===S.cid);if(!e)return null;
    const P=(e.products||[]).filter(p=>p&&(p.company||p.no)&&p.status!=="ended");if(!P.length)return null;
    return h("div",{class:"mine","aria-label":"Smlouvy klienta"},P.slice(0,8).map(p=>h("button",{type:"button",class:"chip",title:"Vybrat instituci a číslo smlouvy",onclick:()=>{
      const hit=matchInst(p.company);if(hit){S.inst=hit.id;S.iaddr=hit.addr||"";S.formId=""}
      if(p.no)S.cnum=String(p.no);save();renderAll();toast("Smlouva vybrána"+(hit?"":" – instituci vyber ručně"));
    }},(p.company||p.type||"Smlouva")+(p.no?" · "+p.no:""))));
  }
  function matchInst(company){
    const c=fold(company);if(!c)return null;
    const L=CAT.inst;
    const pref=[["allianz penz","allianzps"],["allianz","allianz"],["generali penz","genps"],["ceska pojist","generali"],["generali","generali"],["uniqa penz","uniqaps"],["uniqa","uniqa"],["kooperativ","koop"],["cpp","cpp"],["podnikatelsk","cpp"],["csob penz","csobps"],["csob","csob"],["nn penz","nnps"],["nn ","nn"],["conseq penz","conseqps"],["conseq","conseq"],["ceska sporitelna","csps"],["kb penz","kbps"],["rentea","rentea"],["zfp inv","zfpi"],["zfpi","zfpi"],["zfp realit","zfpi"]];
    for(const [k,id] of pref)if((c+" ").includes(k))return L.find(i=>i.id===id)||null;
    if(c==="nn")return L.find(i=>i.id==="nn");
    return L.find(i=>fold(i.short)===c||fold(i.n).startsWith(c))||null;
  }
  function pickClient(id){
    const e=getClients().find(x=>x.id===id);
    if(!e){renderAll();return}
    const rec=e.rec||{},lead=e.lead||{};
    let birth=rec.birth||lead.birth||"";
    if(!birth&&opts.birthOf){try{birth=opts.birthOf(e)||""}catch(x){}}
    S.name=e.name||"";S.addr=rec.address||lead.address||"";S.birth=dshort(birth);S.phone=e.phone||rec.phone||lead.phone||"";S.email=rec.email||lead.email||"";S.rc="";
    const miss=[!S.addr&&"adresa",!S.birth&&"datum narození"].filter(Boolean);
    if(miss.length)toast("V kartě klienta chybí: "+miss.join(", ")+" – doplň tady ručně");
    save();renderAll();
  }

  /* ===== Instituce ===== */
  function instBlock(){
    const L=instList(),counts={};CAT.forms.forEach(f=>{counts[f.inst]=(counts[f.inst]||0)+1});
    const pick=h("div",{class:"card ipick"});
    GROUPS.forEach(([g,t])=>{
      const items=L.filter(i=>(i.group||"poj")===g);if(!items.length)return;
      pick.append(h("div",{class:"gh",text:t}),h("div",{class:"chips"},items.map(i=>{
        const b=h("button",{type:"button",class:"chip","aria-pressed":String(S.inst===i.id),title:i.n,onclick:()=>selectInst(i.id)},i.short||i.n,
          S.mode==="off"?h("span",{class:"n",text:counts[i.id]?String(counts[i.id]):"–"}):null);
        return b;
      })));
    });
    const blk=h("div",{class:"blk"},sechead("Instituce"),pick);
    if(S.mode==="vol"){
      const I=instOf(S,L);
      const g=h("div",{class:"group"});
      if(S.inst==="__new"){
        const nm=frow("Název instituce","instName",{ph:"např. Česká spořitelna, a. s."});g.append(nm);
        const gsel=segOf([["poj","Pojišťovna"],["ps","Penzijní"],["inv","Investiční"]],S.instGroup||"poj",v=>{S.instGroup=v;save();renderAll()});
        g.append(h("div",{class:"frow"},h("label",{text:"Typ"}),gsel));
      }
      g.append(frow("Adresa instituce","iaddr",{area:true,rows:3}));
      const acts=h("div",{class:"chips",style:"padding:0 4px"},
        h("button",{type:"button",class:"chip","aria-pressed":String(S.inst==="__new"),onclick:()=>{S.inst="__new";S.instName="";S.iaddr="";save();renderAll()}},"+ Jiná instituce"),
        S.inst==="__new"?btn("Uložit do nabídky","btn--ghost btn--s",saveInst):null,
        I&&I.custom?btn("Odebrat z nabídky","btn--ghost btn--s",()=>{custom=custom.filter(c=>"x:"+c.n!==S.inst);try{ls.set(LS_CUSTOM,custom)}catch(e){}S.inst="allianz";S.iaddr=FALLBACK_INST[0].addr;save();renderAll()}):null);
      blk.append(g,acts,h("p",{class:"hint",style:"margin:0 4px",text:"Adresu před odesláním zkontroluj – výpovědi chodí na korespondenční adresu instituce."}));
    }
    return blk;
  }
  function selectInst(id){
    const I=instList().find(i=>i.id===id);if(!I)return;
    const prevG=(instOf(S,instList())||{}).group;
    S.inst=id;S.iaddr=I.addr||"";S.formId="";
    if(I.group!==prevG&&ROLE_DEF[I.group]&&S.role!=="Vlastní…")S.role=ROLE_DEF[I.group];
    if(!TYPES.some(t=>t.k===S.typ&&t.g.includes(I.group||"poj")))S.typ="vyp";
    save();renderAll();
  }
  function saveInst(){
    const n=T(S.instName);if(!n)return toast("Doplň název instituce");
    if(instList().some(i=>i.n===n&&!i.custom))return toast("Instituce je už v nabídce");
    const ex=custom.find(i=>i.n===n);
    if(ex){ex.a=T(S.iaddr);ex.g=S.instGroup||"poj"}else custom.push({n,a:T(S.iaddr),g:S.instGroup||"poj"});
    try{ls.set(LS_CUSTOM,custom)}catch(e){}
    S.inst="x:"+n;save();renderAll();toast("Instituce uložena do nabídky");
  }

  /* ===== Oficiální: výběr formuláře ===== */
  function formsOf(id){return CAT.forms.filter(f=>f.inst===id)}
  function curForm(){return CAT.forms.find(f=>f.id===S.formId&&f.inst===S.inst)||null}
  function formBlock(){
    const I=instOf(S,instList());const F=formsOf(S.inst);
    const blk=h("div",{class:"blk"},sechead("Formulář"));
    if(catState==="loading"){blk.append(h("div",{class:"card note"},h("p",{text:"Načítám seznam formulářů…"})));return blk}
    if(catState==="error"){blk.append(h("div",{class:"card note"},h("p",{text:"Seznam formulářů se nepodařilo načíst – zkontroluj připojení. Volná forma funguje i offline."}),btn("Napsat volnou formou","btn--secondary",()=>{S.mode="vol";save();renderAll()})));return blk}
    if(!F.length){
      blk.append(h("div",{class:"card note"},h("p",{text:(I&&I.note)||"Pro tuhle instituci nemám oficiální formulář."}),
        btn("Napsat volnou formou","btn--secondary",()=>{S.mode="vol";S.typ="vyp";save();renderAll()})));
      return blk;
    }
    const kinds=[...new Set(F.map(f=>f.kind==="navaz"?"vyp":f.kind))];
    if(kinds.length>1){
      const order=[["all","Vše"],["vyp","Výpověď"],["zmena","Změna"],["prevod","Převod"]].filter(([k])=>k==="all"||kinds.includes(k));
      if(!order.some(([k])=>k===S.ffilter))S.ffilter="all";
      blk.append(segOf(order,S.ffilter,v=>{S.ffilter=v;save();renderAll()},{block:true,label:"Druh formuláře"}));
    }
    const shown=F.filter(f=>S.ffilter==="all"||(f.kind==="navaz"?"vyp":f.kind)===S.ffilter);
    const list=h("div",{class:"group flist"});
    shown.forEach(f=>{
      const n=f.fill?fkeys(f).size:0;
      const sub=[KIND[f.kind]||"",f.pages?f.pages+" str.":"",f.file.endsWith(".docx")?"Word":""].filter(Boolean).join(" · ");
      const tag=f.file.endsWith(".docx")?"Word":f.fill?"předvyplním":"k tisku";
      const r=h("button",{type:"button",class:"row row-btn"+(f.id===S.formId?" on":""),"aria-current":f.id===S.formId?"true":null,onclick:()=>{S.formId=f.id;save();renderAll();if(window.matchMedia&&matchMedia("(max-width:960px)").matches)requestAnimationFrame(()=>pv.scrollIntoView({behavior:"smooth",block:"start"}))}},
        h("span",{class:"main"},h("div",{class:"t",text:f.t}),h("div",{class:"s",text:sub})),
        h("span",{class:"end"},h("span",{class:"chip--tag"+(f.fill?" chip chip--accent":" chip"),text:tag})),
        h("svg",{class:"ico chev",viewBox:"0 0 24 24","aria-hidden":"true",html:'<path d="m9 6 6 6-6 6"/>'}));
      r.dataset.id=f.id;list.append(r);
    });
    blk.append(list);
    if(I&&I.note)blk.append(h("p",{class:"hint",style:"margin:0 4px",text:I.note}));
    return blk;
  }
  /* údaje, které se propíšou do vybraného PDF */
  function dataBlock(){
    const f=curForm();if(!f||!f.fill)return null;
    const I=instOf(S,instList())||{};const keys=fkeys(f);
    const g=h("div",{class:"group"});
    g.append(frow(f.kind==="prevod"?"Vypovídaná smlouva č.":"Číslo smlouvy","cnum",{ph:"XXXXXXXXXX"}));
    if(keys.has("newcnum"))g.append(frow("Nová smlouva č.","cnumNew",{ph:f.kind==="prevod"?"smlouva u nové společnosti":"převod odkupného na novou smlouvu"}));
    const payable=(f.kind==="vyp"||f.kind==="navaz")&&["poj","ps","inv"].includes(I.group)&&["account","accpre","bank","vs","ss"].some(k=>keys.has(k));
    if(payable)odkRows(g,I.group);
    const AD=advData();
    if(AD&&[...keys].some(k=>k.startsWith("adv"))){
      const cur=S.adv==="none"?"none":(AD.list.some(x=>x.id===S.adv)?S.adv:AD.list[0].id);
      g.append(h("div",{class:"frow col"},h("label",{text:"Poradce (obchodní zástupce)"}),
        segOf(AD.list.map(x=>[x.id,x.short||x.name]).concat([["none","Nevyplňovat"]]),cur,v=>{S.adv=v;save();renderAll()},{block:true,label:"Poradce"})));
      const sel=advOf();
      if(sel)g.append(h("div",{class:"frow sub"},h("span",{class:"lab"}),h("span",{class:"pst",text:[sel.p.name,sel.p.code&&"kód "+sel.p.code,sel.p.phone].filter(Boolean).join(" · ")})));
    }
    return h("div",{class:"blk"},sechead("Údaje do formuláře"),g);
  }
  /* „Je tam odkupné?“ + platební údaje (VS/SS jen když jsou vyplněné) */
  function odkRows(g,grp){
    const inv=grp==="inv";
    if(!inv){
      const q=grp==="ps"?"Vyplatit odbytné na účet?":"Je tam odkupné?";
      g.append(h("div",{class:"frow"},h("label",{text:q}),segOf([["ano","Ano"],["ne","Ne"]],S.odk?"ano":"ne",v=>{S.odk=v==="ano";save();renderAll()},{label:q})));
    }
    if(inv||S.odk){
      const u=frow("Číslo účtu","ucet",{ph:"123456789/0800",on:()=>chk()});
      const st=h("div",{class:"pst"});
      const chk=()=>{const c=ucetCheck(S.ucet);st.className="pst "+c.st;st.textContent=c.msg};chk();
      g.append(u,h("div",{class:"frow sub"},h("span",{class:"lab"}),st),frow("Variabilní symbol","vs",{im:"numeric",ph:"nepovinné"}),frow("Specifický symbol","ss",{im:"numeric",ph:"nepovinné"}));
    }
  }

  /* ===== Volná forma ===== */
  function letterBlocks(){
    const I=instOf(S,instList());const gr=(I&&I.group)||S.instGroup||"poj";
    const types=TYPES.filter(t=>t.g.includes(gr));
    if(!types.some(t=>t.k===S.typ))S.typ="vyp";
    const g=h("div",{class:"group"});
    g.append(h("div",{class:"frow col"},h("label",{text:"Co klient žádá"}),segOf(types.map(t=>[t.k,t.t]),S.typ,v=>{S.typ=v;save();renderAll()},{block:true,label:"Typ žádosti"})));
    g.append(frow(S.typ==="navaz"?"Vypovídaná smlouva č.":"Číslo smlouvy","cnum",{ph:"XXXXXXXXXX"}));
    if(S.typ==="navaz")g.append(frow("Nová smlouva č.","cnumNew",{ph:"u stejné pojišťovny"}));
    const kl=S.typ==="posun"?"Nový počátek":S.typ==="zmena"?"Změna od":"K datu";
    g.append(frow(kl,"kdy",{type:"date"}));
    if(S.typ==="vyp"||S.typ==="navaz"||S.typ==="odkup")g.append(h("div",{class:"frow sub"},h("span",{class:"lab"}),h("span",{class:"pst",text:"Prázdné = k nejbližšímu možnému datu"})));
    if(S.typ==="zmena")g.append(frow("Co se má změnit","popis",{area:true,rows:3}));
    if(S.typ==="posun")g.append(frow("Poznámka","popis",{area:true,rows:2,ph:"nepovinné"}));
    if(S.typ==="odkup")g.append(frow("Co odkoupit","popis",{ph:"všech podílových listů"}));
    const rs=h("select",{id:"frm-role"});ROLES.forEach(r=>rs.append(h("option",{value:r,text:r})));rs.value=ROLES.includes(S.role)?S.role:"Klient";
    rs.addEventListener("change",()=>{S.role=rs.value;save();renderAll()});
    g.append(h("div",{class:"frow"},h("label",{for:"frm-role",text:"Postavení klienta"}),rs));
    if(S.role==="Vlastní…")g.append(frow("Vlastní text","roleX"));
    const out=[h("div",{class:"blk"},sechead("Žádost"),g)];
    if((S.typ==="vyp"||S.typ==="navaz")&&(gr==="poj"||gr==="ps")){
      const og=h("div",{class:"group"});odkRows(og,gr);
      out.push(h("div",{class:"blk"},sechead(gr==="ps"?"Odbytné":"Odkupné"),og));
    }else if(S.typ==="odkup"){
      const og=h("div",{class:"group"});
      const u=frow("Číslo účtu","ucet",{ph:"123456789/0800",on:()=>chk()});const st=h("div",{class:"pst"});
      const chk=()=>{const c=ucetCheck(S.ucet);st.className="pst "+c.st;st.textContent=c.msg};chk();
      og.append(u,h("div",{class:"frow sub"},h("span",{class:"lab"}),st),frow("Variabilní symbol","vs",{im:"numeric",ph:"nepovinné"}),frow("Specifický symbol","ss",{im:"numeric",ph:"nepovinné"}));
      out.push(h("div",{class:"blk"},sechead("Výplata"),og));
    }
    const reg=h("input",{type:"checkbox",class:"switch",role:"switch",id:"frm-reg"});reg.checked=!!S.reg;
    reg.addEventListener("change",()=>{S.reg=reg.checked;changed()});
    const og2=h("div",{class:"group"},h("div",{class:"frow"},h("label",{for:"frm-reg",text:"Doporučeně"}),h("span",{style:"flex:1"}),reg));
    out.push(h("div",{class:"blk"},sechead("Výstup"),og2));
    return out;
  }

  /* ===== Náhled ===== */
  let fitEl=null,paperEl=null;
  function renderPreview(){
    pv.textContent="";
    if(S.mode==="vol"){
      const bar=h("div",{class:"pv-bar"},
        btn("Tisk / PDF","btn--primary",printLetter),
        btn("Kopírovat text","btn--secondary",copyText),
        h("span",{class:"sp"}),
        btn("Nový dopis","btn--ghost btn--s",newLetter));
      paperEl=h("div",{class:"fl-paper",html:letterHTML(S,instList())});
      fitEl=h("div",{class:"fit"},paperEl);
      pv.append(bar,h("div",{class:"pv-box",id:"frm-pvbox"},fitEl));
      requestAnimationFrame(scale);
      return;
    }
    const f=curForm();
    if(!f){
      const F=formsOf(S.inst);
      pv.append(h("div",{class:"pv-box"},h("div",{class:"pv-empty",text:catState==="loading"?"Načítám…":F.length?"Vyber formulář vlevo – ukážu ho tady předvyplněný.":"Tahle instituce oficiální formulář nemá – přepni na Volnou formou."})));
      return;
    }
    const isDoc=f.file.endsWith(".docx");
    const bar=h("div",{class:"pv-bar"});
    if(f.fill){bar.append(btn("Stáhnout vyplněné PDF","btn--primary",()=>download(f)),btn("Otevřít","btn--secondary",()=>openPdf(f)))}
    else bar.append(h("a",{class:"btn btn--primary",href:BASE+"formulare/"+f.file,target:"_blank",rel:"noopener",download:isDoc?"":null,text:isDoc?"Stáhnout Word":"Otevřít PDF"}));
    bar.append(h("span",{class:"sp"}));
    if(f.fill)bar.append(h("a",{class:"btn btn--ghost btn--s",href:BASE+"formulare/"+f.file,target:"_blank",rel:"noopener",text:"Prázdný"}));
    bar.append(h("a",{class:"btn btn--ghost btn--s",href:f.web||f.src,target:"_blank",rel:"noopener",text:"Web instituce"}));
    const box=h("div",{class:"pv-box",id:"frm-pvbox"});
    const pages=h("div",{class:"pv-pages"});box.append(pages);
    const meta=h("div",{class:"pv-meta"});
    pv.append(bar,box,meta);
    refs.pages=pages;refs.meta=meta;
    if(isDoc){pages.append(h("div",{class:"pv-empty",text:"Formulář je ve Wordu – stáhni ho a vyplň."}));metaInfo(f);return}
    regen(f,true);
  }
  function metaInfo(f){
    const m=refs.meta;if(!m)return;m.textContent="";
    if(f.fill){
      const all=[...fkeys(f)];
      const done=pvState.done;
      if(pvState.err)m.append(h("p",{class:"hint",text:"Předvyplnit se nepodařilo ("+pvState.err+") – otevři prázdný formulář."}));
      else m.append(h("p",{class:"hint",text:done.length?"Předvyplněno: "+done.map(k=>KEYLAB[k]||k).join(", ")+". Zkontroluj a zbytek doplň v PDF nebo rukou.":"Zatím není co předvyplnit – vyber klienta nebo doplň údaje."}));
      const missing=all.filter(k=>!done.includes(k)&&!["accpre","bank","newcnum","account","vs","ss","place"].includes(k)&&!k.startsWith("adv"));
      if(missing.length&&done.length)m.append(h("p",{class:"hint dim",text:"Formulář umí i: "+missing.map(k=>KEYLAB[k]||k).join(", ")+" – doplň vlevo."}));
    }else m.append(h("p",{class:"hint",text:"Formulář nemá vyplnitelná pole – vytiskni ho a vyplň rukou."}));
    m.append(h("p",{class:"hint dim",text:"Staženo z webu instituce"+(f.got?" "+dshort(f.got):"")+". Před odesláním mrkni, jestli nevyšla novější verze."}));
  }
  let regenT=null;
  function regen(f,now){
    clearTimeout(regenT);
    regenT=setTimeout(()=>doRegen(f),now?0:450);
  }
  async function doRegen(f){
    const ver=++pvState.ver;pvState.err="";
    const pages=refs.pages;if(!pages)return;
    if(!pages.childElementCount)pages.append(h("div",{class:"pv-empty",text:"Připravuji formulář…"}));
    let out;
    try{out=f.fill?await fillPdf(f,S,instOf(S,instList()),advOf()):{bytes:new Uint8Array(await getFile(f.file)),done:[]}}
    catch(e){
      if(ver!==pvState.ver)return;
      pvState.err=(e&&e.message)||"chyba";pvState.done=[];metaInfo(f);
      try{out={bytes:new Uint8Array(await getFile(f.file)),done:[]}}catch(x){pages.textContent="";pages.append(h("div",{class:"pv-empty",text:"Formulář se nepodařilo načíst – zkontroluj připojení."}));return}
    }
    if(ver!==pvState.ver)return;
    if(pvState.url)URL.revokeObjectURL(pvState.url);
    pvState.blob=new Blob([out.bytes],{type:"application/pdf"});pvState.url=URL.createObjectURL(pvState.blob);pvState.done=out.done;pvState.form=f.id;
    metaInfo(f);
    try{await drawPages(out.bytes,ver)}catch(e){if(ver===pvState.ver){pages.textContent="";pages.append(h("div",{class:"pv-empty",text:"Náhled se nepodařilo vykreslit – PDF otevři tlačítkem nahoře."}))}}
  }
  async function drawPages(bytes,ver){
    const lib=await pdfJs();
    const doc=await lib.getDocument({data:bytes.slice(0),isEvalSupported:false}).promise;
    const pages=refs.pages;if(ver!==pvState.ver||!pages)return;
    const W=Math.max(280,Math.min(pages.clientWidth||600,900));const dpr=Math.min(2,window.devicePixelRatio||1);
    const frag=[];
    for(let i=1;i<=doc.numPages;i++){
      const p=await doc.getPage(i);const v0=p.getViewport({scale:1});const sc=W/v0.width;const vp=p.getViewport({scale:sc*dpr});
      const c=h("canvas",{width:Math.round(vp.width),height:Math.round(vp.height),"aria-label":"Strana "+i});c.style.width=Math.round(vp.width/dpr)+"px";
      await p.render({canvasContext:c.getContext("2d"),viewport:vp,annotationMode:lib.AnnotationMode?lib.AnnotationMode.ENABLE:1}).promise;
      if(ver!==pvState.ver)return;frag.push(c);
    }
    pages.textContent="";pages.append(...frag);
    try{doc.destroy()}catch(e){}
  }
  function fname(f){return (f.t.replace(/[\\/:*?"<>|]+/g," ").slice(0,60)+(S.name?" – "+S.name:"")).trim()+".pdf"}
  async function ensureCurrent(f){
    if(pvState.form===f.id&&pvState.url&&!regenT)return true;
    clearTimeout(regenT);regenT=null;await doRegen(f);return !!pvState.url;
  }
  async function download(f){
    if(!await ensureCurrent(f))return toast("PDF se nepodařilo připravit");
    const a=h("a",{href:pvState.url,download:fname(f)});document.body.append(a);a.click();a.remove();
    toast("Vyplněný formulář stažen");
  }
  async function openPdf(f){
    const w=window.open("","_blank");
    if(!await ensureCurrent(f)){if(w)w.close();return toast("PDF se nepodařilo připravit")}
    if(w)w.location.href=pvState.url;else location.href=pvState.url;
  }

  /* ----- dopis: tisk, kopie, nový ----- */
  function printLetter(){
    const f=document.createElement("iframe");f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0";document.body.append(f);
    const d=f.contentWindow.document;
    d.open();d.write('<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>'+esc(build(S,instList()).title+" – "+(S.name||""))+'</title><style>@page{size:A4;margin:0}html,body{margin:0}'+PAPER_CSS+'.fl-paper{min-height:0;height:296mm;overflow:hidden}</style></head><body><div class="fl-paper">'+letterHTML(S,instList())+'</div></body></html>');d.close();
    setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print()}catch(e){toast("Tisk se nepodařilo spustit")}setTimeout(()=>f.remove(),60000)},250);
  }
  async function copyText(){
    const t=plain(S,instList());
    try{await navigator.clipboard.writeText(t);toast("Text dopisu zkopírován")}catch(e){const a=document.createElement("textarea");a.value=t;document.body.append(a);a.select();try{document.execCommand("copy");toast("Text dopisu zkopírován")}catch(x){toast("Kopírování se nepovedlo")}a.remove()}
  }
  function newLetter(){["cnum","cnumNew","kdy","popis","ucet","vs","ss"].forEach(k=>{S[k]=""});S.odk=false;save();renderAll()}

  function scale(){
    if(!fitEl||!paperEl||!fitEl.isConnected)return;
    const box=fitEl.parentElement;const w=box.clientWidth-24;if(w<=0)return;
    const k=Math.min(1,w/(210*3.7795));fitEl.style.transform="scale("+k+")";fitEl.style.width="210mm";
    fitEl.style.height=Math.ceil(paperEl.offsetHeight*k)+"px";
  }
  /* změna v poli: náhled se překreslí bez přestavby formuláře (fokus zůstane) */
  function changed(light){
    save();
    if(S.mode==="vol"){if(paperEl){paperEl.innerHTML=letterHTML(S,instList());scale()}return}
    const f=curForm();if(f&&f.fill&&refs.pages)regen(f);
  }
  function renderAll(){
    [...modeSeg.children].forEach(b=>b.setAttribute("aria-selected",String(b.dataset.v===S.mode)));
    upd.textContent=S.mode==="off"&&CAT.updated?"Formuláře aktualizovány "+dshort(CAT.updated):"";
    col.textContent="";
    col.append(clientBlock(),instBlock());
    if(S.mode==="off"){col.append(formBlock());const d=dataBlock();if(d)col.append(d)}
    else col.append(...letterBlocks());
    col.querySelectorAll("textarea.autoh").forEach(t=>{const fit=()=>{t.style.height="auto";t.style.height=t.scrollHeight+"px"};t.addEventListener("input",fit);requestAnimationFrame(fit)});
    renderPreview();
  }
  window.addEventListener("resize",()=>{scale()});

  /* katalog formulářů */
  fetch(BASE+"formulare/index.json",{cache:"no-cache"}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(j=>{
    if(j&&Array.isArray(j.inst)&&Array.isArray(j.forms)){CAT=j;catState="ok"}else catState="error";
    if(!instOf(S,instList()))S.inst="allianz";
    renderAll();
  }).catch(()=>{catState="error";renderAll()});
  if(!instOf(S,instList())&&S.inst!=="__new"&&!String(S.inst).startsWith("x:"))S.inst="allianz";
  renderAll();

  return {
    refreshClients(){if(refs.fillClients)refs.fillClients();scale()},
    state:()=>Object.assign({},S),
    text:()=>plain(S,instList()),
    build:()=>build(S,instList()),
    catalog:()=>CAT,
    filled:()=>({done:pvState.done.slice(),url:pvState.url,form:pvState.form,err:pvState.err}),
    _fill:(form)=>fillPdf(form,S,instOf(S,instList()),advOf())
  };
}
window.Formulare={mount,_test:{build,plain,ucetCheck,dlong,dshort,splitName,parseAddr,parseAcc,values}};
})();
