/* Databáze smluv (jen admin) – offline načtení detailu smlouvy z portálu NN Stela (PDF) do tabulky:
   Jméno a příjmení · Pojistné · Odkupné · Datum technického počátku.
   PDF se čte přímo v prohlížeči (vendor/pdf.min.mjs), nic se nenahrává na server. Řádky se ukládají jen do localStorage
   tohoto zařízení (klíč db_rows_v1) – nesynchronizují se s Google Diskem ani s Firestore.
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
  for(const l of sec){const m=reName.exec(l);if(m){rec.name=clean(m[1]);break}}
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

/* text z PDF: řádky podle svislé polohy, uvnitř řádku podle vodorovné (nezávisí na pořadí v obsahu PDF) */
async function pdfText(file){
  const lib=await import(BASE+"vendor/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc=BASE+"vendor/pdf.worker.min.mjs";
  const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,enableXfa:false}).promise;
  let out="";
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
.dbx .db-empty{padding:28px 12px;text-align:center;color:var(--label2);font-size:14.5px;line-height:1.5}
.dbx .db-note{font-size:12.5px;color:var(--label2);line-height:1.5;margin:12px 0 0}
`;

/* ================= modul ================= */
function mount(root,opts={}){
  if(!document.getElementById("dbxCss")){const s=document.createElement("style");s.id="dbxCss";s.textContent=CSS;document.head.append(s)}
  const toast=opts.toast||(m=>console.log(m));
  const ls=opts.ls||{get:k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}};
  let rows=(ls.get(LS)||[]).filter(r=>r&&typeof r==="object");
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
  const bCsv=h("button",{type:"button",class:"db-btn",onclick:()=>exportCsv()},"Export CSV");
  const bClr=h("button",{type:"button",class:"db-btn danger",onclick:()=>{if(rows.length&&confirm("Smazat celou databázi ("+rows.length+" smluv) z tohoto zařízení?")){rows=[];persist();msg=null;draw()}}},"Smazat vše");
  top.append(title,bImp,bCsv,bClr);
  const search=h("input",{type:"search",class:"db-search",placeholder:"Hledat podle jména…",autocomplete:"off","aria-label":"Hledat v databázi"});
  search.addEventListener("input",()=>{q=search.value;drawTable()});
  const msgBox=h("div",{});
  const tblBox=h("div",{});
  const note=h("p",{class:"db-note"},"PDF se čtou přímo v tomhle zařízení a nikam se neposílají. Řádky zůstávají jen v tomto prohlížeči (nesynchronizují se s Google Diskem); při odhlášení se smažou. Stejnou smlouvu stačí nahrát znovu – řádek se aktualizuje.");
  box.append(top,search,msgBox,tblBox,note);

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
    if(!rows.length){tblBox.replaceChildren(h("div",{class:"db-empty"},"Zatím prázdno.",h("br"),"Nahraj PDF s detailem smlouvy ze Stely (nebo je sem přetáhni) – přečtu z nich jméno, pojistné, odkupné a datum technického počátku."));return}
    if(!list.length){tblBox.replaceChildren(h("div",{class:"db-empty"},"Nic nenalezeno."));return}
    const head=h("tr",{},COLS.map(([k,t,n])=>h("th",{class:n?"num":"",onclick:()=>{if(sortK===k)sortDir=-sortDir;else{sortK=k;sortDir=1}drawTable()},"aria-sort":sortK===k?(sortDir>0?"ascending":"descending"):"none"},t,sortK===k?h("span",{class:"ar"},sortDir>0?"▲":"▼"):null)),h("th",{}));
    const body=list.map(r=>h("tr",{},COLS.map(([k,,n])=>h("td",{class:n?"num":""},cell(r,k))),
      h("td",{class:"x"},h("button",{type:"button",title:"Smazat řádek","aria-label":"Smazat řádek "+(r.name||""),onclick:()=>{if(confirm("Smazat řádek"+(r.name?" „"+r.name+"“":"")+"?")){rows=rows.filter(x=>x!==r);persist();drawTable()}}},"×"))));
    tblBox.replaceChildren(h("div",{class:"db-wrap"},h("table",{},h("thead",{},head),h("tbody",{},body))));
  }
  function drawMsg(){
    msgBox.replaceChildren(...(msg?msg.map(m=>h("div",{class:"db-msg"+(m.warn?" warn":"")},m.t)):[]));
  }
  function draw(){drawMsg();drawTable()}

  const LBL={name:"jméno",premium:"pojistné",surrender:"odkupné",start:"datum technického počátku"};
  async function importFiles(files){
    const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name)||f.type==="application/pdf");
    if(!pdfs.length){toast("Vyber PDF soubory");return}
    let added=0,updated=0;const out=[];
    for(const f of pdfs){
      let res;
      try{res=parseStela(await pdfText(f))}catch(e){out.push({warn:true,t:f.name+": PDF se nepodařilo přečíst"});continue}
      if(!res.ok){out.push({warn:true,t:f.name+": nevypadá to jako detail smlouvy ze Stely – nic jsem nenašel"});continue}
      const r=res.rec,ex=r.key&&rows.find(x=>x.key===r.key);
      if(ex){for(const k of["name","premium","surrender","start","asOf"])if(r[k]!=null&&r[k]!=="")ex[k]=r[k];updated++}
      else{rows.push({id:uid(),key:r.key,name:r.name,premium:r.premium,surrender:r.surrender,start:r.start,asOf:r.asOf,added:Date.now()});added++}
      if(res.missing.length)out.push({warn:true,t:f.name+": chybí "+res.missing.map(k=>LBL[k]).join(", ")+" – doplň ručně v tabulce (oranžová pole)"});
    }
    persist();
    out.unshift({t:"Načteno "+(added+updated)+" z "+pdfs.length+" PDF"+(added+updated?" ("+(added?added+" nových":"")+(added&&updated?", ":"")+(updated?updated+" aktualizovaných":"")+")":"")+"."});
    msg=out;draw();
  }
  fileI.addEventListener("change",async()=>{const fs=[...fileI.files];fileI.value="";if(fs.length)await importFiles(fs)});
  let dragN=0;
  box.addEventListener("dragenter",e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes("Files")){dragN++;box.classList.add("drop");e.preventDefault()}});
  box.addEventListener("dragover",e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes("Files"))e.preventDefault()});
  box.addEventListener("dragleave",()=>{dragN=Math.max(0,dragN-1);if(!dragN)box.classList.remove("drop")});
  box.addEventListener("drop",e=>{e.preventDefault();dragN=0;box.classList.remove("drop");if(e.dataTransfer&&e.dataTransfer.files.length)importFiles(e.dataTransfer.files)});

  draw();
  return{refresh:()=>{rows=(ls.get(LS)||[]).filter(r=>r&&typeof r==="object");draw()},importFiles,rows:()=>rows};
}

window.Databaze={mount,math:{parseStela,parseNum,toCsv,czDate,kc}};
})();
