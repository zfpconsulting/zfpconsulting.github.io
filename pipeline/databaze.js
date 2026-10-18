/* Databáze smluv (jen admin) – offline načtení detailu smlouvy z portálu NN Stela (PDF) do tabulky:
   Jméno a příjmení · Pojistné · Odkupné · Datum technického počátku (+ všechny další údaje z PDF v řádku na pozadí, viz MAP).
   PDF se čte přímo v prohlížeči (vendor/pdf.min.mjs), nic se nenahrává na server ani k AI. Řádky se ukládají jen do localStorage
   tohoto zařízení (klíč db_rows_v1), samotná PDF do IndexedDB tohoto zařízení (pp_dbpdf) – nesynchronizují se s Google Diskem ani s Firestore.
   Tlačítko „+“ (nebo výběr více řádků) založí v pipeline „Nový lead“ se všemi údaji a PDF smlouvy přiloží jako soubor k leadu
   – teprve tím se kontakt dostane do pipeline (a synchronizuje se jako každý jiný lead).
   Samostatný modul: Databaze.mount(kontejner, {toast, ls}) · čistá logika v Databaze.math (testy: tests/databaze.run.mjs). */
(()=>{
"use strict";
const BASE=(()=>{try{return (document.currentScript&&document.currentScript.src||location.href).replace(/[^/]*$/,"")}catch(e){return ""}})();
const LS="db_rows_v1";

/* ================= parsování textu detailu smlouvy ================= */
const clean=s=>String(s??"").replace(/[   ]/g," ").replace(/[ \t]+/g," ").trim();
/* regulární výraz z popisku tolerantní k diakritice (pdf.js občas vrací text bez ní, Stela ji má) */
const lab=t=>t.split("").map(c=>{
  if(c===" ")return "\\s+";
  const b=c.normalize("NFD")[0];
  return b!==c?"["+c+b+"]":c.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}).join("");
const NUM="(\\d{1,3}(?: \\d{3})+|\\d+)(?:[.,](\\d{1,2}))?";
const toNum=(i,d)=>+(String(i).replace(/ /g,"")+(d?"."+d:""));
const iso=(d,m,y)=>{d=+d;m=+m;y=+y;return y>1900&&m>=1&&m<=12&&d>=1&&d<=31?y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0"):""};

/* jméno vždy „Jméno Příjmení“ bez kapitálek: Stela píše „NOVÁKOVÁ Jana“ → „Jana Nováková“ (tituly zůstávají vpředu, „Ph.D.“ vzadu) */
const TIT=/^(ing|mgr|bc|mudr|mvdr|judr|phdr|rndr|paeddr|doc|prof|ingarch|dis|ph\.?d|csc|mba|bba|ll\.?m)\.?,?$/i;
const cap1=w=>w.split(/([-'’])/).map(p=>/^[-'’]$/.test(p)?p:p.charAt(0).toLocaleUpperCase("cs")+p.slice(1).toLocaleLowerCase("cs")).join("");
function niceName(raw){
  const t=clean(raw).split(" ").filter(Boolean);if(!t.length)return "";
  const isUp=w=>/\p{L}{2,}/u.test(w)&&w===w.toLocaleUpperCase("cs")&&w!==w.toLocaleLowerCase("cs");
  const pre=[],post=[],sur=[],giv=[];
  t.forEach((w,i)=>{if(TIT.test(w.replace(/\./g,"")+"")||TIT.test(w)){(/^(ph|csc|mba|bba|ll|dis)/i.test(w)&&i>0?post:pre).push(w);return}(isUp(w)?sur:giv).push(w)});
  const words=sur.length&&giv.length?giv.concat(sur):sur.length?sur:giv;
  const fixed=words.map(w=>isUp(w)||w===w.toLocaleLowerCase("cs")?cap1(w):w);
  return pre.concat(fixed,post).join(" ").replace(/\s+,/g,",");
}
/* vstup: text po řádcích (levý i pravý sloupec Stely leží na jednom řádku). Výstup: {rec, found, missing, ok} */
function parseStela(raw){
  const lines=String(raw||"").split(/\n/).map(clean).filter(Boolean);
  const text=lines.join("\n");
  const rec={key:"",name:"",premium:null,surrender:null,start:"",asOf:""};
  const found=[],missing=[];

  /* jméno: jen sekce „Pojistník“ (ne pojištěná osoba) – mezi popiskem a „Trvalé bydliště“ */
  const iSec=lines.findIndex(l=>new RegExp("^"+lab("Pojistník")+"$","i").test(l));
  const iEnd=lines.findIndex((l,i)=>i>iSec&&new RegExp("^"+lab("Údaje o pojištění")+"$","i").test(l));
  const sec=iSec>=0?lines.slice(iSec+1,iEnd>iSec?iEnd:lines.length):lines;
  const reName=new RegExp("^"+lab("Jméno a příjmení")+"\\s*(.*?)\\s*(?:"+lab("Trvalé bydliště")+".*)?$","i");
  for(const l of sec){const m=reName.exec(l);if(m){rec.name=niceName(m[1]);break}}
  rec.name?found.push("name"):missing.push("name");

  /* pojistné: „Pojistné 500 Kč“ (částka za platební frekvenci smlouvy) */
  const mp=new RegExp("(?:^|\\s)"+lab("Pojistné")+"\\s+"+NUM+"\\s*K[čc]","i").exec(text);
  if(mp){rec.premium=toNum(mp[1],mp[2]);found.push("premium")}else missing.push("premium");

  /* odkupné: „Hodnota odkupného: 123456,78 Kč“ */
  const mo=new RegExp(lab("Hodnota odkupného")+"\\s*:?\\s*"+NUM+"\\s*K[čc]","i").exec(text);
  if(mo){rec.surrender=toNum(mo[1],mo[2]);found.push("surrender")}else missing.push("surrender");

  /* datum technického počátku: datum musí stát hned za popiskem na stejném řádku (jinak je hodnota ve Stele prázdná) */
  const re=new RegExp(lab("Datum technického počátku")+"\\s*(\\d{1,2})\\s*\\.\\s*(\\d{1,2})\\s*\\.\\s*(\\d{4})","i");
  for(const l of lines){const m=re.exec(l);if(m){rec.start=iso(m[1],m[2],m[3]);break}}
  rec.start?found.push("start"):missing.push("start");

  /* klíč smlouvy (kvůli opakovanému nahrání) a datum platnosti dat – do tabulky se nezobrazují */
  const mk=/cntID=(\d{5,})/i.exec(text)||new RegExp("^.*"+lab("Detail smlouvy")+"\\s*\\n[^\\n]*?(\\d{7,})\\s*$","im").exec(text);
  if(mk)rec.key=mk[1];
  const ma=new RegExp(lab("Platnost dat")+"\\s*:?\\s*(\\d{1,2})\\s*\\.\\s*(\\d{1,2})\\s*\\.\\s*(\\d{4})","i").exec(text);
  if(ma)rec.asOf=iso(ma[1],ma[2],ma[3]);

  /* nevypadá to jako detail smlouvy ze Stely, když chybí všechno, nebo aspoň odkupné i pojistné */
  const ok=found.length>0&&(rec.premium!=null||rec.surrender!=null);
  return{rec,found,missing,ok};
}

/* ================= všechny údaje z PDF: vzorec „odkud → kam“ =================
   [klíč, sekce v PDF, popisek v PDF, kam v pipeline] – stejná tabulka se ukazuje v záložce („Odkud se co bere“). */
const MAP=[
  ["jmeno","Pojistník","Jméno a příjmení","Lead → Jméno (Jméno Příjmení)"],
  ["zdroj","—","—","Lead → Zdroj: Databáze"],
  ["telefon","Pojistník","Telefon","Lead → Telefon"],
  ["email","Pojistník","Email / E-mail","Lead → E-mail"],
  ["narozen","Pojistník","Datum narození","jen v Databázi"],
  ["bydliste","Pojistník","Trvalé bydliště","jen v Databázi"],
  ["adresa","Pojistník","Kontaktní adresa","jen v Databázi"],
  ["produkt","Hlavička","„2010 - ZFP DŮCHOD - číslo“","jen v Databázi"],
  ["cislo","Hlavička / odkaz","číslo smlouvy (cntID)","párování v Databázi · historie leadu"],
  ["pojistne","Údaje o pojištění","Pojistné","Databáze (tabulka)"],
  ["frekvence","Údaje o pojištění","Frekvence placení","jen v Databázi"],
  ["zpusob","Údaje o pojištění","Způsob placení","jen v Databázi"],
  ["indexace","Údaje o pojištění","Indexace","jen v Databázi"],
  ["sepsani","Údaje o pojištění","Datum sepsání smlouvy","jen v Databázi"],
  ["pocatek","Údaje o pojištění","Datum počátku pojištění","jen v Databázi"],
  ["techPocatek","Údaje o pojištění","Datum technického počátku","Databáze (tabulka)"],
  ["konec","Údaje o pojištění","Datum konce pojištění","jen v Databázi"],
  ["pojistena","Pojištěná osoba","Jméno a příjmení","jen v Databázi"],
  ["pojistenaNar","Pojištěná osoba","Datum narození","jen v Databázi"],
  ["investice","Podílový účet","Hodnota investice","jen v Databázi"],
  ["odkupne","Podílový účet","Hodnota odkupného","Databáze (tabulka)"],
  ["asOf","Patička","Platnost dat","jen v Databázi"],
  ["pdf","—","celé PDF smlouvy","Lead → Dokumenty"]];
const L_POJ=["Jméno a příjmení","Trvalé bydliště","Datum narození","Kontaktní adresa","Telefon","Mobil","E-mail","Email","Rodné číslo","Číslo OP","Státní příslušnost"];
const L_UDAJE=["Pojistné","Datum sepsání smlouvy","Frekvence placení","Datum počátku pojištění","Způsob placení","Datum technického počátku","Indexace","Datum zaevidování v systému","Datum konce pojištění","Stav smlouvy","Konec pojištění"];
/* hodnota za popiskem až po další známý popisek na stejném řádku (Stela má dva sloupce vedle sebe) */
function pick(lines,label,all){
  const any=new RegExp("(?:^|\\s)("+all.map(lab).join("|")+")\\s*:?","gi"),me=new RegExp("^"+lab(label)+"$","i");
  for(const l of lines){const hits=[];let m;any.lastIndex=0;while((m=any.exec(l)))hits.push({s:m.index+(m[0].length-m[0].replace(/^\s+/,"").length),e:m.index+m[0].length,t:m[1]});
    const i=hits.findIndex(x=>me.test(x.t.trim()));if(i<0)continue;
    return clean(l.slice(hits[i].e,i+1<hits.length?hits[i+1].s:l.length)).replace(/^:\s*/,"")}
  return "";
}
function section(lines,start,ends){const re=t=>new RegExp("^"+lab(t)+"$","i");
  const i=lines.findIndex(l=>re(start).test(l));if(i<0)return null;
  let j=lines.findIndex((l,k)=>k>i&&ends.some(e=>re(e).test(l)));return lines.slice(i+1,j>i?j:lines.length)}
const dateIso=v=>{const m=/(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/.exec(v||"");return m?iso(m[1],m[2],m[3]):""};
const moneyOf=v=>{const m=new RegExp(NUM+"\\s*K[čc]","i").exec(v||"");return m?toNum(m[1],m[2]):null};
function parseStelaFull(raw){
  const base=parseStela(raw),lines=String(raw||"").split(/\n/).map(clean).filter(Boolean),text=lines.join("\n");
  const SEC=["Pojistník","Údaje o pojištění","Pojištěná osoba","Podílový účet","Pojištění","Rizika","Platby"];
  const pj=section(lines,"Pojistník",SEC.filter(x=>x!=="Pojistník"))||[],ud=section(lines,"Údaje o pojištění",SEC.filter(x=>x!=="Údaje o pojištění"))||lines,po=section(lines,"Pojištěná osoba",SEC.filter(x=>x!=="Pojištěná osoba"))||[];
  const r=base.rec,I={jmeno:r.name,cislo:r.key,pojistne:r.premium,techPocatek:r.start,odkupne:r.surrender,asOf:r.asOf};
  I.telefon=pick(pj,"Telefon",L_POJ)||pick(pj,"Mobil",L_POJ);I.email=pick(pj,"Email",L_POJ)||pick(pj,"E-mail",L_POJ);
  if(I.email&&!/@/.test(I.email))I.email="";if(I.telefon&&!/\d{3}/.test(I.telefon))I.telefon="";
  I.narozen=dateIso(pick(pj,"Datum narození",L_POJ));I.bydliste=pick(pj,"Trvalé bydliště",L_POJ);I.adresa=pick(pj,"Kontaktní adresa",L_POJ);
  I.frekvence=pick(ud,"Frekvence placení",L_UDAJE);I.zpusob=pick(ud,"Způsob placení",L_UDAJE);I.indexace=pick(ud,"Indexace",L_UDAJE);
  I.sepsani=dateIso(pick(ud,"Datum sepsání smlouvy",L_UDAJE));I.pocatek=dateIso(pick(ud,"Datum počátku pojištění",L_UDAJE));I.konec=dateIso(pick(ud,"Datum konce pojištění",L_UDAJE)||pick(ud,"Konec pojištění",L_UDAJE));
  I.pojistena=pick(po,"Jméno a příjmení",L_POJ);I.pojistenaNar=dateIso(pick(po,"Datum narození",L_POJ));
  const mi=new RegExp(lab("Hodnota investice")+"\\s*:?\\s*"+NUM+"\\s*K[čc]","i").exec(text);I.investice=mi?toNum(mi[1],mi[2]):null;
  const mh=/^\s*\d{2,5}\s*-\s*(.+?)\s*-\s*(\d{6,})\s*$/m.exec(text);if(mh){I.produkt=clean(mh[1]);if(!I.cislo)I.cislo=mh[2]}else I.produkt="";
  Object.keys(I).forEach(k=>{if(I[k]===""||I[k]==null)delete I[k]});
  return Object.assign(base,{info:I});
}
/* poznámka k leadu ze všech údajů smlouvy (jedna osoba může mít víc smluv) */
const fmtD=s=>czDate(s);
function leadNote(list){
  const a=list[0].info||{},row0=list[0];
  const out=["Z Databáze smluv (NN Stela) – "+czDate(new Date().toISOString().slice(0,10))];
  const who=[a.jmeno||row0.name,a.narozen?"nar. "+fmtD(a.narozen):""].filter(Boolean).join(", ");if(who)out.push("Pojistník: "+who);
  if(a.bydliste)out.push("Trvalé bydliště: "+a.bydliste);if(a.adresa&&a.adresa!==a.bydliste)out.push("Kontaktní adresa: "+a.adresa);
  list.forEach(r=>{const I=r.info||{};out.push("");
    out.push("Smlouva "+(I.cislo||r.key||"")+(I.produkt?" · "+I.produkt:""));
    const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
    const p=[r.premium!=null?"Pojistné "+kc(r.premium):"",I.frekvence||"",I.zpusob||"",I.indexace?"indexace "+I.indexace:""].filter(Boolean).join(" · ");if(p)out.push(cap(p));
    const d=[I.sepsani?"sepsáno "+fmtD(I.sepsani):"",I.pocatek?"počátek "+fmtD(I.pocatek):"",r.start?"technický počátek "+fmtD(r.start):"",I.konec?"konec "+fmtD(I.konec):""].filter(Boolean).join(" · ");if(d)out.push(cap(d));
    if(I.pojistena&&I.pojistena!==(a.jmeno||row0.name))out.push("Pojištěná osoba: "+I.pojistena+(I.pojistenaNar?", nar. "+fmtD(I.pojistenaNar):""));
    const v=[I.investice!=null?"hodnota investice "+kc(I.investice):"",r.surrender!=null?"odkupné "+kc(r.surrender):""].filter(Boolean).join(" · ");if(v)out.push(v.charAt(0).toUpperCase()+v.slice(1)+(r.asOf?" (k "+fmtD(r.asOf)+")":""))});
  return out.join("\n");
}

/* ================= PDF smluv jen v tomto zařízení (IndexedDB) ================= */
const pdfStore=(()=>{let p=null;const open=()=>p||(p=new Promise(res=>{try{const r=indexedDB.open("pp_dbpdf",1);r.onupgradeneeded=()=>r.result.createObjectStore("pdf");r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null)}catch(e){res(null)}}));
  const run=(mode,fn)=>open().then(db=>new Promise(res=>{if(!db)return res(null);try{const tx=db.transaction("pdf",mode),rq=fn(tx.objectStore("pdf"));let v=null;if(rq)rq.onsuccess=()=>{v=rq.result};tx.oncomplete=()=>res(v);tx.onerror=tx.onabort=()=>res(null)}catch(e){res(null)}}));
  return{get:id=>run("readonly",s=>s.get(id)),put:(id,b)=>run("readwrite",s=>s.put(b,id)),del:id=>run("readwrite",s=>s.delete(id)),clear:()=>run("readwrite",s=>s.clear())}})();

/* text z PDF: řádky podle svislé polohy, uvnitř řádku podle vodorovné (nezávisí na pořadí v obsahu PDF) */
/* jeden sdílený worker pro celé dávkové nahrání (dřív vznikal worker na každé PDF a zůstával naživu → u stovek PDF zasekla stránka) */
let sharedWorker=null;
function releaseWorker(){if(sharedWorker){try{sharedWorker.destroy()}catch(e){}sharedWorker=null}}
async function pdfText(file){
  const lib=await import(BASE+"vendor/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc=BASE+"vendor/pdf.worker.min.mjs";
  if(!sharedWorker){try{sharedWorker=new lib.PDFWorker({name:"databaze"})}catch(e){sharedWorker=null}}
  const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),worker:sharedWorker||undefined,isEvalSupported:false,enableXfa:false}).promise;
  let out="";
  try{
    for(let p=1;p<=doc.numPages;p++){
      const c=await(await doc.getPage(p)).getTextContent();
      const its=c.items.filter(it=>it.str&&it.str.trim()&&it.transform).map(it=>({s:it.str,x:it.transform[4],y:it.transform[5],w:it.width||0}));
      its.sort((a,b)=>b.y-a.y||a.x-b.x);
      const rows=[];
      for(const it of its){const r=rows[rows.length-1];if(r&&Math.abs(r.y-it.y)<=3)r.items.push(it);else rows.push({y:it.y,items:[it]})}
      for(const r of rows){
        r.items.sort((a,b)=>a.x-b.x);
        let line="",end=null;
        for(const it of r.items){line+=(end!==null&&it.x-end<=0.5?"":" ")+it.s;end=it.x+it.w}
        out+=line.trim()+"\n";
      }
    }
  }finally{try{await doc.destroy()}catch(e){}}
  return out;
}

/* ================= formát ================= */
const nf=new Intl.NumberFormat("cs-CZ",{minimumFractionDigits:0,maximumFractionDigits:2});
const kc=n=>n==null||!isFinite(n)?"":nf.format(n)+" Kč";
const parseNum=s=>{const t=String(s??"").replace(/[\s  ]/g,"").replace(/Kč/gi,"").replace(",",".");if(t==="")return null;const n=+t;return isFinite(n)&&n>=0?n:NaN};
const fold=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const czDate=s=>{const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(s||"");return m?m[3]+"."+m[2]+"."+m[1]:""};
const csvCell=v=>{let s=String(v??"");if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
const toCsv=rows=>"﻿"+["Jméno a příjmení;Pojistné;Odkupné;Datum technického počátku"].concat(rows.map(r=>[r.name,r.premium==null?"":String(r.premium).replace(".",","),r.surrender==null?"":String(r.surrender).replace(".",","),czDate(r.start)].map(csvCell).join(";"))).join("\r\n");

/* ================= vzhled ================= */
const CSS=`
.dbx{font-family:var(--font,-apple-system,system-ui,sans-serif);color:var(--label);background:var(--bg2,#fff);border-radius:16px;box-shadow:var(--card-shadow);padding:16px 18px 18px;margin-bottom:22px}
.dbx.drop{outline:2px dashed var(--orange);outline-offset:-6px}
.dbx .db-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.dbx .db-top h3{margin:0;font-size:17px;font-weight:700;flex:1 1 auto}
.dbx .db-btn{height:40px;padding:0 14px;border-radius:10px;border:1.5px solid var(--sep);background:var(--bg2,#fff);color:var(--label);font:inherit;font-size:14.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.dbx .db-btn.pri{background:var(--orange);border-color:var(--orange);color:#fff}
.dbx .db-btn.danger{color:var(--red);border-color:var(--red)}
.dbx .db-btn:disabled{opacity:.45;cursor:default}
.dbx .db-search{width:100%;box-sizing:border-box;height:42px;border:1px solid var(--sep);border-radius:10px;background:var(--bg,#f2f2f7);color:var(--label);font:inherit;font-size:16px;padding:0 12px;margin-bottom:12px}
.dbx .db-msg{font-size:13.5px;line-height:1.45;border-radius:10px;padding:9px 12px;margin:0 0 12px;background:var(--bg,#f2f2f7)}
.dbx .db-prog{font-size:13.5px;line-height:1.45;border-radius:10px;padding:9px 12px;margin:0 0 12px;background:var(--bg,#f2f2f7);color:var(--label2)}
.dbx .db-msg.warn{background:var(--orange-soft,rgba(255,149,0,.14))}
.dbx .db-wrap{overflow:auto;border:1px solid var(--sep);border-radius:12px}
.dbx table{border-collapse:collapse;width:100%;min-width:640px;font-size:14.5px}
.dbx th{position:sticky;top:0;background:var(--bg,#f2f2f7);text-align:left;font-size:12.5px;font-weight:600;color:var(--label2);padding:10px 10px;white-space:nowrap;cursor:pointer;user-select:none;border-bottom:1px solid var(--sep)}
.dbx th.num,.dbx td.num{text-align:right}
.dbx th .ar{color:var(--orange);margin-left:4px}
.dbx td{padding:3px 4px;border-bottom:1px solid var(--sep)}
.dbx tr:last-child td{border-bottom:0}
.dbx td input{width:100%;box-sizing:border-box;height:38px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--label);font:inherit;font-size:14.5px;padding:0 8px}
.dbx td.num input{text-align:right;font-variant-numeric:tabular-nums}
.dbx td input:hover{border-color:var(--sep)}
.dbx td input:focus{outline:2px solid var(--tint);outline-offset:-1px;background:var(--bg2,#fff)}
.dbx td input.miss{background:var(--orange-soft,rgba(255,149,0,.14))}
.dbx td.x{width:44px;text-align:center}
.dbx td.x button{border:0;background:none;color:var(--label2);font-size:20px;line-height:1;cursor:pointer;padding:6px 10px;border-radius:8px}
.dbx td.x button:hover{color:var(--red)}
.dbx tfoot td{padding:11px 12px;font-weight:700;background:var(--bg,#f2f2f7);border-top:1px solid var(--sep);border-bottom:0;font-variant-numeric:tabular-nums;white-space:nowrap}
.dbx tfoot td.num{text-align:right}
.dbx tfoot .db-sub{font-weight:400;font-size:12.5px;color:var(--label2)}
.dbx .db-empty{padding:28px 12px;text-align:center;color:var(--label2);font-size:14.5px;line-height:1.5}
.dbx .db-note{font-size:12.5px;color:var(--label2);line-height:1.5;margin:12px 0 0}
.dbx td:not(.num) input{text-align:left}
.dbx th.a{text-align:center;cursor:default}
.dbx td.c,.dbx th.c{width:40px;text-align:center;padding-left:8px;padding-right:2px;cursor:default}
.dbx td.c input,.dbx th.c input{width:19px;height:19px;accent-color:var(--orange);cursor:pointer;margin:0;vertical-align:middle}
.dbx td.a{width:52px;text-align:center;white-space:nowrap}
.dbx .db-plus{width:34px;height:34px;border-radius:50%;border:0;background:var(--orange);color:#fff;font-size:21px;font-weight:600;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dbx .db-plus:hover{filter:brightness(1.08)}
.dbx .db-in{height:30px;border-radius:999px;border:1px solid var(--green,#34C759);background:none;color:var(--green,#34C759);font:inherit;font-size:12.5px;font-weight:600;padding:0 10px;cursor:pointer;white-space:nowrap}
.dbx tr.sel td{background:var(--orange-soft,rgba(255,149,0,.10))}
.dbx details.db-map{margin:14px 0 0;font-size:13px;color:var(--label2)}
.dbx details.db-map summary{cursor:pointer;font-weight:600;color:var(--label)}
.dbx .db-mapg{display:grid;grid-template-columns:minmax(110px,.8fr) minmax(150px,1.1fr) minmax(150px,1.2fr);margin-top:8px;border:1px solid var(--sep);border-radius:10px;overflow:hidden;font-size:12.5px}
.dbx .db-mapg>*{padding:5px 9px;border-bottom:1px solid var(--sep)}
.dbx .db-mapg>b{background:var(--bg,#f2f2f7);font-weight:600;color:var(--label2)}
.dbx .db-mapg>span{color:var(--label)}
`;

/* ================= modul ================= */
function mount(root,opts={}){
  if(!document.getElementById("dbxCss")){const s=document.createElement("style");s.id="dbxCss";s.textContent=CSS;document.head.append(s)}
  const toast=opts.toast||(m=>console.log(m));
  const ls=opts.ls||{get:k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
  const load=()=>{const L=(ls.get(LS)||[]).filter(r=>r&&typeof r==="object");let ch=false;L.forEach(r=>{const n=niceName(r.name);if(r.name&&n!==r.name){r.name=n;ch=true}});if(ch)ls.set(LS,L);return L};
  let rows=load();
  let q="",sortK="name",sortDir=1,msg=null;
  const persist=()=>{if(ls.set(LS,rows)===false)toast("Nepodařilo se uložit – plné úložiště prohlížeče")};
  const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);

  const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==undefined&&v!==null&&v!==false)e.setAttribute(k,v===true?"":v)}for(const k of kids.flat(3)){if(k==null||k===false)continue;e.append(k.nodeType?k:document.createTextNode(String(k)))}return e};

  const box=h("div",{class:"dbx"});
  root.replaceChildren(box);
  const fileI=h("input",{type:"file",accept:".pdf,application/pdf",multiple:true,hidden:true});
  box.append(fileI);
  const top=h("div",{class:"db-top"});
  const title=h("h3",{});
  const bImp=h("button",{type:"button",class:"db-btn pri",onclick:()=>fileI.click()},"Nahrát PDF ze Stely");
  const canLead=typeof opts.addLeads==="function";
  const sel=new Set();
  const bLead=h("button",{type:"button",class:"db-btn pri",hidden:!canLead,onclick:()=>toPipeline([...sel].map(id=>rows.find(r=>r.id===id)).filter(Boolean))},"＋ Do pipeline");
  const bCsv=h("button",{type:"button",class:"db-btn",onclick:()=>exportCsv()},"Export CSV");
  const bClr=h("button",{type:"button",class:"db-btn danger",onclick:()=>{if(rows.length&&confirm("Smazat celou databázi ("+rows.length+" smluv) z tohoto zařízení?")){rows=[];sel.clear();pdfStore.clear();persist();msg=null;draw()}}},"Smazat vše");
  top.append(title,bImp,bLead,bCsv,bClr);
  const search=h("input",{type:"search",class:"db-search",placeholder:"Hledat podle jména…",autocomplete:"off","aria-label":"Hledat v databázi"});
  search.addEventListener("input",()=>{q=search.value;drawTable()});
  const msgBox=h("div",{});
  const tblBox=h("div",{});
  const note=h("p",{class:"db-note"},"PDF se čtou přímo v tomhle zařízení a nikam se neposílají (ani k AI). Řádky i PDF zůstávají jen v tomto prohlížeči (nesynchronizují se s Google Diskem); při odhlášení se smažou. Stejnou smlouvu stačí nahrát znovu – řádek se aktualizuje."+(canLead?" Teprve tlačítkem ＋ se kontakt přesune do pipeline jako „Nový lead“ se zdrojem Databáze (jméno, telefon, e-mail a PDF smlouvy v dokumentech, poznámky se nepíšou) a od té chvíle se synchronizuje jako každý jiný lead.":""));
  const map=h("details",{class:"db-map"},h("summary",{},"Odkud se co bere (vzorec čtení PDF)"),
    h("div",{class:"db-mapg"},h("b",{},"Sekce v PDF"),h("b",{},"Popisek v PDF"),h("b",{},"Kam"),MAP.map(([,a,b,c])=>[h("span",{},a),h("span",{},b),h("span",{},c)])),
    h("p",{class:"db-note"},"Jméno se vždy převede na „Jméno Příjmení“ (bez kapitálek). Hodnota se bere za popiskem až po další popisek na stejném řádku (Stela má dva sloupce vedle sebe). Jméno jen ze sekce Pojistník. Rodné číslo se záměrně nepřebírá. Víc smluv stejného člověka (stejné jméno + datum narození) = jeden lead."));
  box.append(top,search,msgBox,tblBox,note,map);

  const COLS=[["name","Jméno a příjmení",false],["premium","Pojistné",true],["surrender","Odkupné",true],["start","Datum technického počátku",false]];

  function exportCsv(){
    if(!rows.length)return;
    const a=h("a",{href:URL.createObjectURL(new Blob([toCsv(sorted(rows))],{type:"text/csv;charset=utf-8"})),download:"databaze-smluv.csv"});
    document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
  }
  function sorted(list){
    const k=sortK;
    return list.slice().sort((a,b)=>{
      const x=a[k],y=b[k],ex=x==null||x==="",ey=y==null||y==="";
      if(ex||ey)return ex&&ey?0:ex?1:-1;           /* prázdné vždy na konec */
      return (typeof x==="number"?x-y:String(x).localeCompare(String(y),"cs"))*sortDir;
    });
  }
  function save(r,k,v){r[k]=v;persist()}

  function cell(r,k){
    const inp=h("input",{type:k==="start"?"date":"text",autocomplete:"off","aria-label":COLS.find(c=>c[0]===k)[1]+" – "+(r.name||"řádek")});
    const money=k==="premium"||k==="surrender";
    if(money)inp.setAttribute("inputmode","decimal");
    const show=()=>{inp.value=money?kc(r[k]):(r[k]||"");inp.classList.toggle("miss",r[k]==null||r[k]==="");inp.placeholder=r[k]==null||r[k]===""?"doplnit":""};
    show();
    if(money)inp.addEventListener("focus",()=>{inp.value=r[k]==null?"":String(r[k]).replace(".",",");inp.select()});
    inp.addEventListener("change",()=>{
      if(money){const n=parseNum(inp.value);if(Number.isNaN(n)){toast("Zadej částku číslem");show();return}save(r,k,n)}
      else save(r,k,k==="name"?clean(inp.value):inp.value);
      show();
    });
    inp.addEventListener("blur",show);
    if(k==="surrender"&&r.asOf)inp.title="Hodnota k "+czDate(r.asOf)+" (Platnost dat ve Stele)";
    return inp;
  }
  function drawTable(){
    const f=fold(q).split(/\s+/).filter(Boolean);
    const list=sorted(rows.filter(r=>{const n=fold(r.name);return f.every(w=>n.includes(w))}));
    title.textContent="Databáze"+(rows.length?" · "+rows.length+(rows.length===1?" smlouva":rows.length<5?" smlouvy":" smluv"):"");
    bCsv.disabled=bClr.disabled=!rows.length;search.hidden=!rows.length;
    [...sel].forEach(id=>{if(!rows.some(r=>r.id===id))sel.delete(id)});
    bLead.disabled=!sel.size||busy;bLead.textContent=sel.size?"＋ Do pipeline ("+sel.size+")":"＋ Do pipeline";
    if(!rows.length){tblBox.replaceChildren(h("div",{class:"db-empty"},"Zatím prázdno.",h("br"),"Nahraj PDF s detailem smlouvy ze Stely (nebo je sem přetáhni) – přečtu z nich jméno, pojistné, odkupné a datum technického počátku."));return}
    if(!list.length){tblBox.replaceChildren(h("div",{class:"db-empty"},"Nic nenalezeno."));return}
    const inP=r=>!!(r.leadId&&(!opts.leadExists||opts.leadExists(r.leadId)));
    const vis=list.filter(r=>!inP(r)).map(r=>r.id),allOn=vis.length&&vis.every(id=>sel.has(id));
    const ca=h("input",{type:"checkbox","aria-label":"Vybrat vše, co ještě není v pipeline",title:"Vybrat vše, co ještě není v pipeline"});ca.checked=!!allOn;ca.indeterminate=!allOn&&vis.some(id=>sel.has(id));
    ca.addEventListener("change",()=>{vis.forEach(id=>ca.checked?sel.add(id):sel.delete(id));drawTable()});
    const head=h("tr",{},canLead?h("th",{class:"c"},ca):null,COLS.map(([k,t,n])=>h("th",{class:n?"num":"",onclick:()=>{if(sortK===k)sortDir=-sortDir;else{sortK=k;sortDir=1}drawTable()},"aria-sort":sortK===k?(sortDir>0?"ascending":"descending"):"none"},t,sortK===k?h("span",{class:"ar"},sortDir>0?"▲":"▼"):null)),canLead?h("th",{class:"a",title:"Do pipeline"},"Lead"):null,h("th",{}));
    const body=list.map(r=>{const cb=h("input",{type:"checkbox","aria-label":"Vybrat "+(r.name||"řádek")});cb.checked=sel.has(r.id);
      cb.addEventListener("change",()=>{cb.checked?sel.add(r.id):sel.delete(r.id);drawTable()});
      const inPipe=r.leadId&&(!opts.leadExists||opts.leadExists(r.leadId));
      const act=!canLead?null:h("td",{class:"a"},inPipe?h("button",{type:"button",class:"db-in",title:"Otevřít lead v pipeline",onclick:()=>opts.openLead&&opts.openLead(r.leadId)},"✓ lead")
        :h("button",{type:"button",class:"db-plus",title:"Do pipeline jako Nový lead","aria-label":"Do pipeline: "+(r.name||""),onclick:()=>toPipeline([r])},"+"));
      const nm=cell(r,"name");
      return h("tr",{class:sel.has(r.id)?"sel":""},canLead?h("td",{class:"c"},cb):null,COLS.map(([k,,n])=>h("td",{class:n?"num":""},k==="name"?nm:cell(r,k))),act,
      h("td",{class:"x"},h("button",{type:"button",title:"Smazat řádek","aria-label":"Smazat řádek "+(r.name||""),onclick:()=>{if(confirm("Smazat řádek"+(r.name?" „"+r.name+"“":"")+"?")){rows=rows.filter(x=>x!==r);sel.delete(r.id);pdfStore.del(r.id);persist();drawTable()}}},"×")))});
    /* součet odkupného zobrazených řádků (při hledání jen vyhledané); smlouvy bez odkupného se nepočítají, ale je to vidět */
    const withS=list.filter(r=>typeof r.surrender==="number"&&isFinite(r.surrender)),no=list.length-withS.length;
    const sum=Math.round(withS.reduce((a,r)=>a+r.surrender,0)*100)/100;
    const foot=h("tfoot",{},h("tr",{class:"db-total"},
      h("td",{},"Celkem"+(f.length?" (vyhledané)":""),no?h("span",{class:"db-sub"}," · "+no+" bez odkupného nezapočteno"):null),
      h("td",{}),h("td",{class:"num"},kc(sum)),h("td",{}),h("td",{}),canLead?h("td",{}):null));
    if(canLead)foot.firstChild.prepend(h("td",{}));
    tblBox.replaceChildren(h("div",{class:"db-wrap"},h("table",{},h("thead",{},head),h("tbody",{},body),foot)));
  }
  function drawMsg(){
    msgBox.replaceChildren(...(msg?msg.map(m=>h("div",{class:"db-msg"+(m.warn?" warn":"")},m.t)):[]));
  }
  function draw(){drawMsg();drawTable()}

  /* do pipeline jako „Nový lead“: víc smluv stejného člověka (jméno + datum narození) = jeden lead; PDF jdou do Dokumentů leadu */
  async function toPipeline(list){
    if(!canLead||busy)return;list=list.filter(r=>!(r.leadId&&(!opts.leadExists||opts.leadExists(r.leadId))));
    if(!list.length){toast("Vybrané kontakty už v pipeline jsou");return}
    const noName=list.filter(r=>!clean(r.name));if(noName.length){toast("Doplň jméno u "+noName.length+" "+(noName.length===1?"řádku":"řádků")+" (oranžové pole)");return}
    const key=r=>fold(clean(r.name))+"|"+((r.info||{}).narozen||"");
    const G=new Map();list.forEach(r=>{const k=key(r);if(!G.has(k))G.set(k,[]);G.get(k).push(r)});
    /* jméno už v pipeline je (stejný člověk) → přidat k němu, ne zakládat znovu: navázat přes řádek, který už lead má */
    const groups=[];for(const g of G.values()){const sib=rows.find(x=>x.leadId&&key(x)===key(g[0])&&(!opts.leadExists||opts.leadExists(x.leadId)));
      const I=g[0].info||{},files=[];for(const r of g){const b=await pdfStore.get(r.id);if(b)files.push(b instanceof File?b:new File([b],r.pdf||("Smlouva_"+(r.key||r.id)+".pdf"),{type:"application/pdf"}))}
      groups.push({rows:g,name:niceName(g[0].name),phone:I.telefon||"",email:I.email||"",contracts:g.map(r=>(r.info||{}).cislo||r.key||""),files,existing:sib?sib.leadId:(opts.findLead?opts.findLead(clean(g[0].name),I.telefon||""):null)||null})}
    const ex=groups.filter(g=>g.existing).length;
    if(list.length>1&&!confirm("Založit v pipeline "+(groups.length-ex)+" "+(groups.length-ex===1?"nový lead":groups.length-ex<5?"nové leady":"nových leadů")+(ex?" a "+ex+"× doplnit smlouvu k existujícímu":"")+"? (fáze Nový lead, zdroj Databáze, PDF smluv do dokumentů)"))return;
    busy=true;bLead.disabled=true;bLead.textContent="Zakládám…";
    let ok=0,bad=0,files=0,miss=0;
    try{for(let i=0;i<groups.length;i++){const g=groups[i];
      msgBox.replaceChildren(h("div",{class:"db-prog"},"Do pipeline "+(i+1)+" / "+groups.length+"…"));
      try{const id=await opts.addLeads(g);if(!id)throw 0;g.rows.forEach(r=>{const cur=rows.find(x=>x.id===r.id)||r;cur.leadId=id;sel.delete(r.id)});ok++;files+=g.files.length;miss+=g.rows.length-g.files.length}catch(e){console.warn(e);bad++}
      persist()}}
    finally{busy=false}
    msg=[{t:"V pipeline: "+ok+" "+(ok===1?"lead":ok<5?"leady":"leadů")+" ve fázi Nový lead"+(files?" · "+files+" PDF v dokumentech":"")+"."}];
    if(miss)msg.push({warn:true,t:miss+"× bez PDF – smlouva byla nahraná dřív, než se PDF začala ukládat. Nahraj ji znovu a PDF se doplní."});
    if(bad)msg.push({warn:true,t:"Nepodařilo se založit "+bad+"× – zkus to znovu."});
    draw();
  }
  const LBL={name:"jméno",premium:"pojistné",surrender:"odkupné",start:"datum technického počátku"};
  let busy=false;
  const cap=(arr,n)=>arr.length>n?[...arr.slice(0,n),"… a dalších "+(arr.length-n)]:arr;
  async function importFiles(files){
    if(busy){toast("Import ještě běží – počkej, až doběhne");return}
    const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name)||f.type==="application/pdf");
    if(!pdfs.length){toast("Vyber PDF soubory");return}
    busy=true;bImp.disabled=true;
    let added=0,updated=0;const bad=[],miss=[];
    try{
      for(let i=0;i<pdfs.length;i++){
        const f=pdfs[i];
        bImp.textContent="Čtu "+(i+1)+" / "+pdfs.length+"…";
        msgBox.replaceChildren(h("div",{class:"db-prog"},"Zpracovávám PDF "+(i+1)+" z "+pdfs.length+"…"));
        await new Promise(r=>setTimeout(r,0));          /* ať se průběh stihne vykreslit */
        let res;
        try{res=parseStelaFull(await pdfText(f))}catch(e){bad.push(f.name);continue}
        if(!res.ok){bad.push(f.name);continue}
        const r=res.rec,ex=r.key&&rows.find(x=>x.key===r.key);let row;
        if(ex){for(const k of["name","premium","surrender","start","asOf"])if(r[k]!=null&&r[k]!=="")ex[k]=r[k];ex.info=Object.assign({},ex.info||{},res.info);row=ex;updated++}
        else{row={id:uid(),key:r.key,name:r.name,premium:r.premium,surrender:r.surrender,start:r.start,asOf:r.asOf,info:res.info,added:Date.now()};rows.push(row);added++}
        row.pdf=f.name;await pdfStore.put(row.id,f);
        if(res.missing.length)miss.push({name:f.name,fields:res.missing});
        if(i%20===19){persist();drawTable()}             /* průběžně uložit i ukázat, ať se nic neztratí */
      }
    }finally{releaseWorker();persist();busy=false;bImp.disabled=false;bImp.textContent="Nahrát PDF ze Stely"}
    const out=[{t:"Načteno "+(added+updated)+" z "+pdfs.length+" PDF"+(added+updated?" ("+(added?added+" nových":"")+(added&&updated?", ":"")+(updated?updated+" aktualizovaných":"")+")":"")+"."}];
    if(bad.length)out.push({warn:true,t:"Nerozpoznáno "+bad.length+"× (není to detail smlouvy ze Stely, nebo se PDF nepodařilo přečíst): "+cap(bad,5).join(", ")});
    if(miss.length&&miss.length<=3)miss.forEach(m=>out.push({warn:true,t:m.name+": chybí "+m.fields.map(k=>LBL[k]).join(", ")+" – doplň ručně v tabulce (oranžová pole)"}));
    else if(miss.length){const c={};miss.forEach(m=>m.fields.forEach(k=>c[k]=(c[k]||0)+1));
      out.push({warn:true,t:"U "+miss.length+" smluv chybí údaje ("+Object.entries(c).map(([k,n])=>LBL[k]+" u "+n).join(", ")+") – doplň ručně v tabulce (oranžová pole)."})}
    msg=out;draw();
  }
  fileI.addEventListener("change",async()=>{const fs=[...fileI.files];fileI.value="";if(fs.length)await importFiles(fs)});
  let dragN=0;
  box.addEventListener("dragenter",e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes("Files")){dragN++;box.classList.add("drop");e.preventDefault()}});
  box.addEventListener("dragover",e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes("Files"))e.preventDefault()});
  box.addEventListener("dragleave",()=>{dragN=Math.max(0,dragN-1);if(!dragN)box.classList.remove("drop")});
  box.addEventListener("drop",e=>{e.preventDefault();dragN=0;box.classList.remove("drop");if(e.dataTransfer&&e.dataTransfer.files.length)importFiles(e.dataTransfer.files)});

  draw();
  return{refresh:()=>{if(busy)return;rows=load();draw()},importFiles,toPipeline,rows:()=>rows};
}

window.Databaze={mount,math:{parseStela,parseStelaFull,leadNote,niceName,parseNum,toCsv,czDate,kc},MAP};
})();
