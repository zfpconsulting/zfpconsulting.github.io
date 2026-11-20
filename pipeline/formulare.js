/* Formuláře – volné dopisy a žádosti klienta na instituce (výpověď smlouvy, změna, posunutí počátku …).
   Samostatný modul: Formulare.mount(kontejner, {clients, toast, ls, sign})
   clients() → [{id,name,rec,lead,phone,…}] (clientEntries z Pipeline); údaje klienta se berou z karty, jdou ale přepsat ručně.
   Nic se nikam neodesílá: výstup je náhled A4, tisk / uložení do PDF a kopie textu. */
(function(){
"use strict";

/* Adresy jen ověřené / běžně veřejné; kde si nejsem jistý, zůstává prázdné a doplníš ručně (adresa jde vždy upravit). */
const INST=[
 {n:"Allianz pojišťovna, a. s.",a:"Ke Štvanici 656/3\n186 00 Praha 8"},
 {n:"Generali Česká pojišťovna a. s.",a:"Spálená 75/16\n113 04 Praha 1"},
 {n:"Kooperativa pojišťovna, a. s., Vienna Insurance Group",a:"Brněnská 634\n664 42 Modřice"},
 {n:"NN Životní pojišťovna N.V.",a:"Křižíkova 2430/34a\n186 00 Praha 8"},
 {n:"Slavia pojišťovna a. s.",a:"Revoluční 1/655\n110 15 Praha 1"},
 {n:"UNIQA pojišťovna, a. s.",a:"Evropská 136\n160 12 Praha 6"},
 {n:"ČSOB Pojišťovna, a. s.",a:"Masarykovo náměstí 1458\n530 02 Pardubice"},
 {n:"Conseq Investment Management, a. s.",a:"Rybná 682/14\n110 05 Praha 1"},
 {n:"NN penzijní společnost, a. s.",a:""},
 {n:"Allianz penzijní společnost, a. s.",a:""},
 {n:"ZFP Investments, investiční společnost, a. s.",a:""}
];
const TYPES=[
 {k:"vyp",t:"Ukončení smlouvy",title:"Žádost o výpověď smlouvy",odk:true},
 {k:"navaz",t:"Ukončení smlouvy v návaznosti",title:"Žádost o výpověď smlouvy v návaznosti na novou smlouvu",odk:true},
 {k:"zmena",t:"Žádost o změnu smlouvy",title:"Žádost o změnu smlouvy",odk:false},
 {k:"posun",t:"Žádost o posunutí počátku smlouvy",title:"Žádost o posunutí počátku smlouvy",odk:false}
];
const ROLES=["Pojistník a pojištěný","Pojistník","Pojištěný","Klient","Investor","Účastník","Vlastní…"];
const MES=["ledna","února","března","dubna","května","června","července","srpna","září","října","listopadu","prosince"];
const LS_STATE="frm_state_v1",LS_CUSTOM="frm_custom_v1";

const todayISO=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
function dlong(iso){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||"");return m?(+m[3])+". "+MES[+m[2]-1]+" "+m[1]:(iso||"")}
function dshort(v){v=String(v||"").trim();const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v);return m?(+m[3])+". "+(+m[2])+". "+m[1]:v}
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

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

/* ----- text dopisu (jedna pravda pro náhled, tisk i kopii) ----- */
function build(s){
  const T=TYPES.find(x=>x.k===s.typ)||TYPES[0];
  const cn=s.cnum.trim()||"XXXXXXXXXX";
  const kdy=s.kdy?dlong(s.kdy):"";
  const body=[];
  if(s.typ==="vyp")body.push("žádám o výpověď smlouvy č. "+cn+" "+(kdy?"k datu "+kdy+".":"k co nejbližšímu datu."));
  else if(s.typ==="navaz"){
    body.push("žádám o výpověď smlouvy č. "+cn+" "+(kdy?"k datu "+kdy:"k co nejbližšímu možnému datu")+", a to v návaznosti na uzavření nové smlouvy"+(s.nova.trim()?" ("+s.nova.trim()+")":"")+".");
    body.push("Prosím o potvrzení přijetí výpovědi a data ukončení smlouvy.");
  }else if(s.typ==="zmena"){
    body.push("žádám o změnu smlouvy č. "+cn+(kdy?" s účinností od "+kdy:"")+".");
    body.push(s.popis.trim()||"Požadovaná změna: …");
    body.push("Prosím o potvrzení provedené změny.");
  }else{
    body.push("žádám o posunutí počátku smlouvy č. "+cn+" na "+(kdy||"datum …")+".");
    if(s.popis.trim())body.push(s.popis.trim());
    body.push("Prosím o potvrzení nového data počátku.");
  }
  let odk=null;
  if(T.odk&&s.odk){
    odk=["Případné odkupné či přeplatek prosím zašlete na:","Číslo účtu: "+(s.ucet.trim()||"XXXXXXXXXX")];
    if(s.vs.trim())odk.push("VS: "+s.vs.trim());
    if(s.ss.trim())odk.push("SS: "+s.ss.trim());
  }
  const role=s.role==="Vlastní…"?(s.roleX||"").trim():s.role;
  const ident=[role,(s.birth?"nar. "+dshort(s.birth):""),(s.addr?"trvale bytem "+s.addr.replace(/\n+/g,", "):"")].filter(Boolean).join(", ");
  return {title:T.title,body,odk,ident,date:dlong(s.date),
    rcpt:[s.inst.trim()].concat(s.iaddr.split("\n").map(x=>x.trim()).filter(Boolean)),
    from:(s.addr||"").split("\n").map(x=>x.trim()).filter(Boolean).join(", ")};
}
function plain(s){
  const b=build(s),L=[];
  L.push(s.name,b.from,"",b.rcpt.join("\n"),"");if(s.reg)L.push("DOPORUČENĚ");L.push(b.date,"",b.title,"","Dobrý den,","");
  b.body.forEach((p,i)=>{L.push((i===0?"":"")+p)});
  if(b.odk){L.push("");L.push(...b.odk)}
  L.push("","S pozdravem","","______________________",s.name,b.ident);
  return L.join("\n").replace(/\n{3,}/g,"\n\n");
}
function letterHTML(s){
  const b=build(s);
  const para=b.body.map(p=>"<p>"+esc(p)+"</p>").join("");
  const odk=b.odk?"<p>"+b.odk.map(esc).join("<br>")+"</p>":"";
  return '<div class="fl-head"><div class="fl-name">'+esc(s.name||"Jméno klienta")+'</div><div class="fl-from">'+esc(b.from)+'</div></div>'
   +'<div class="fl-rcpt">'+b.rcpt.map(esc).join("<br>")+'</div>'
   +'<div class="fl-meta"><b>'+(s.reg?"DOPORUČENĚ":"")+'</b><span>'+esc(b.date)+'</span></div>'
   +'<h2 class="fl-title">'+esc(b.title)+'</h2>'
   +'<p>Dobrý den,</p>'+para+odk
   +'<p class="fl-sp">S pozdravem</p><div class="fl-sig"></div>'
   +'<div class="fl-who"><b>'+esc(s.name||"")+'</b><br>'+esc(b.ident)+'</div>';
}
const PAPER_CSS=`
.fl-paper{box-sizing:border-box;width:210mm;min-height:297mm;padding:22mm 24mm;background:#fff;color:#111;font:11pt/1.5 -apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif}
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

function mount(root,opts){
  opts=opts||{};
  const ls=opts.ls||{get:()=>null,set:()=>{}};
  const toast=opts.toast||(()=>{});
  const getClients=()=>{try{return opts.clients()||[]}catch(e){return[]}};
  let custom=[];try{custom=ls.get(LS_CUSTOM)||[];if(!Array.isArray(custom))custom=[]}catch(e){custom=[]}
  let S={cid:"",name:"",addr:"",birth:"",role:ROLES[0],roleX:"",inst:INST[0].n,iaddr:INST[0].a,typ:"vyp",cnum:"",kdy:"",nova:"",popis:"",odk:false,ucet:"",vs:"",ss:"",reg:true,date:todayISO()};
  try{const o=ls.get(LS_STATE);if(o&&typeof o==="object")S=Object.assign(S,o,{date:todayISO()})}catch(e){}

  const css=document.createElement("style");
  css.textContent=PAPER_CSS+`
  .frm{display:grid;grid-template-columns:minmax(300px,420px) 1fr;gap:16px;align-items:start}
  @media(max-width:900px){.frm{grid-template-columns:1fr}}
  .frm .card{padding:14px;display:flex;flex-direction:column;gap:10px}
  .frm label.f{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-s);color:var(--ink-2)}
  .frm label.f input,.frm label.f select,.frm label.f textarea{font:inherit;color:var(--ink)}
  .frm .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .frm .frow{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .frm .row2>label.f{min-width:0}.frm .row2 input,.frm label.f input,.frm label.f textarea,.frm label.f select{min-width:0;width:100%;box-sizing:border-box}
  .frm .frow>label{flex:1}
  .frm .pst{font-size:var(--fs-s)}
  .frm .pst.ok{color:var(--ink-2)} .frm .pst.bad{color:var(--accent-text);font-weight:600}
  .frm-prev{overflow:auto;background:var(--line);border-radius:12px;padding:12px}
  .frm-prev .fit{transform-origin:top left}
  .frm-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  `;
  root.textContent="";root.append(css);

  const wrap=document.createElement("div");wrap.className="frm";root.append(wrap);
  const left=document.createElement("div");left.className="card";
  const right=document.createElement("div");wrap.append(left,right);
  const bar=document.createElement("div");bar.className="frm-bar";
  const prevBox=document.createElement("div");prevBox.className="frm-prev";
  const fit=document.createElement("div");fit.className="fit";
  const paper=document.createElement("div");paper.className="fl-paper";
  fit.append(paper);prevBox.append(fit);right.append(bar,prevBox);

  const refs={};
  function field(label,key,o){
    o=o||{};const l=document.createElement("label");l.className="f";l.append(document.createTextNode(label));
    const i=o.area?document.createElement("textarea"):document.createElement("input");
    if(o.area)i.rows=o.rows||2;if(o.type)i.type=o.type;if(o.ph)i.placeholder=o.ph;
    i.value=S[key]||"";i.addEventListener("input",()=>{S[key]=i.value;if(o.on)o.on();upd()});
    l.append(i);refs[key]=i;if(o.wrapRef)o.wrapRef(l);return l;
  }
  function select(label,key,items,on){
    const l=document.createElement("label");l.className="f";l.append(document.createTextNode(label));
    const s=document.createElement("select");items.forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;s.append(o)});
    s.value=S[key];s.addEventListener("change",()=>{S[key]=s.value;if(on)on();upd()});l.append(s);refs[key]=s;return l;
  }

  /* klient */
  const cliSel=select("Klient","cid",[["","— bez klienta (vyplním ručně) —"]],()=>pickClient(S.cid));
  function fillClients(){
    const s=refs.cid,cur=S.cid;s.textContent="";
    const o0=document.createElement("option");o0.value="";o0.textContent="— bez klienta (vyplním ručně) —";s.append(o0);
    getClients().slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"cs")).forEach(e=>{const o=document.createElement("option");o.value=e.id;o.textContent=e.name;s.append(o)});
    s.value=[...s.options].some(o=>o.value===cur)?cur:"";
  }
  function pickClient(id){
    const e=getClients().find(x=>x.id===id);if(!e){return}
    const rec=e.rec||{},lead=e.lead||{};
    let birth=rec.birth||lead.birth||"";
    if(!birth&&opts.birthOf){try{birth=opts.birthOf(e)||""}catch(x){}}
    S.name=e.name||"";S.addr=rec.address||lead.address||"";S.birth=birth;
    ["name","addr","birth"].forEach(k=>{refs[k].value=S[k]||""});
    const miss=[!S.addr&&"adresa",!S.birth&&"datum narození"].filter(Boolean);
    if(miss.length)toast("V kartě klienta chybí: "+miss.join(", ")+" – doplň tady ručně");
  }
  /* instituce */
  const instAll=()=>INST.concat(custom);
  const instSel=select("Instituce","inst",[],()=>{const x=instAll().find(i=>i.n===S.inst);if(x){S.iaddr=x.a;refs.iaddr.value=x.a}else if(S.inst==="__new"){S.inst="";S.iaddr="";refs.iaddr.value="";refs.instN.hidden=false;refs.instN.querySelector("input").focus()}});
  function fillInst(){
    const s=refs.inst,cur=S.inst;s.textContent="";
    instAll().forEach(i=>{const o=document.createElement("option");o.value=i.n;o.textContent=i.n+(i.a?"":" (bez adresy)");s.append(o)});
    const o=document.createElement("option");o.value="__new";o.textContent="+ Jiná instituce…";s.append(o);
    s.value=instAll().some(i=>i.n===cur)?cur:instAll()[0].n;
    if(s.value!==cur&&cur&&cur!=="__new"){}
  }
  const instN=document.createElement("label");instN.className="f";instN.hidden=true;refs.instN=instN;
  instN.append(document.createTextNode("Název nové instituce"));
  {const i=document.createElement("input");i.placeholder="např. Česká spořitelna, a. s.";i.addEventListener("input",()=>{S.inst=i.value;upd()});instN.append(i)}

  const typSel=select("Co je to za žádost","typ",TYPES.map(t=>[t.k,t.t]),()=>{syncVis()});
  const kdyF=field("K datu","kdy",{type:"date"});
  const novaF=field("Nová smlouva (nepovinné, např. „č. 123, Conseq“)","nova");
  const popisF=field("Popis","popis",{area:true,rows:3});
  const cnumF=field("Číslo smlouvy","cnum",{ph:"XXXXXXXXXX"});
  /* odkupné */
  const odk=document.createElement("div");odk.className="frow";
  {const l=document.createElement("label");l.textContent="Odkupné / přeplatek poslat na účet";const c=document.createElement("input");c.type="checkbox";c.className="switch";c.setAttribute("role","switch");c.checked=!!S.odk;c.addEventListener("change",()=>{S.odk=c.checked;syncVis();upd()});refs.odk=c;odk.append(l,c)}
  const ucetF=field("Číslo účtu","ucet",{ph:"123456789/0800"});
  const ucetSt=document.createElement("div");ucetSt.className="pst";
  const vsF=field("VS","vs"),ssF=field("SS","ss");
  const vsss=document.createElement("div");vsss.className="row2";vsss.append(vsF,ssF);
  const odkBox=document.createElement("div");odkBox.style.cssText="display:flex;flex-direction:column;gap:10px";odkBox.append(ucetF,ucetSt,vsss);
  /* doporučeně */
  const reg=document.createElement("div");reg.className="frow";
  {const l=document.createElement("label");l.textContent="Doporučeně";const c=document.createElement("input");c.type="checkbox";c.className="switch";c.setAttribute("role","switch");c.checked=!!S.reg;c.addEventListener("change",()=>{S.reg=c.checked;upd()});reg.append(l,c)}
  const roleSel=select("Postavení klienta","role",ROLES.map(r=>[r,r]),()=>syncVis());
  const roleXF=field("Vlastní text","roleX");

  const hClient=document.createElement("b");hClient.textContent="Klient";
  const hInst=document.createElement("b");hInst.textContent="Instituce a žádost";
  const hOdk=document.createElement("b");hOdk.textContent="Výstup";
  left.append(hClient,cliSel,field("Jméno a příjmení (i s titulem)","name"),field("Adresa trvalého bydliště","addr",{area:true}),
    field("Datum narození","birth",{ph:"1990-01-31 nebo 31. 1. 1990"}),roleSel,roleXF,
    hInst,instSel,instN,field("Adresa instituce","iaddr",{area:true,rows:3}),typSel,cnumF,kdyF,novaF,popisF,odk,odkBox,
    hOdk,reg,field("Datum dopisu","date",{type:"date"}));
  const note=document.createElement("p");note.className="hint";
  note.textContent="Adresu instituce před odesláním zkontroluj – každá pojišťovna má jiné doručovací místo pro výpovědi.";
  left.append(note);

  function syncVis(){
    const T=TYPES.find(x=>x.k===S.typ)||TYPES[0];
    kdyF.firstChild.textContent=S.typ==="posun"?"Nový počátek smlouvy":S.typ==="zmena"?"Změna od":"K datu (prázdné = nejbližší možné)";
    novaF.hidden=S.typ!=="navaz";
    popisF.hidden=!(S.typ==="zmena"||S.typ==="posun");
    popisF.firstChild.textContent=S.typ==="zmena"?"Co se má změnit":"Poznámka (nepovinné)";
    odk.hidden=!T.odk;odkBox.hidden=!(T.odk&&S.odk);
    roleXF.hidden=S.role!=="Vlastní…";
  }
  function btn(t,cls,fn){const b=document.createElement("button");b.type="button";b.className="btn "+cls;b.textContent=t;b.addEventListener("click",fn);return b}
  function printLetter(){
    const f=document.createElement("iframe");f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0";document.body.append(f);
    const d=f.contentWindow.document;
    d.open();d.write('<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>'+esc(build(S).title+" – "+(S.name||""))+'</title><style>@page{size:A4;margin:0}html,body{margin:0}'+PAPER_CSS+'.fl-paper{min-height:0;height:296mm;overflow:hidden}</style></head><body><div class="fl-paper">'+letterHTML(S)+'</div></body></html>');d.close();
    setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print()}catch(e){toast("Tisk se nepodařilo spustit")}setTimeout(()=>f.remove(),60000)},250);
  }
  async function copyText(){
    const t=plain(S);
    try{await navigator.clipboard.writeText(t);toast("Text dopisu zkopírován")}catch(e){const a=document.createElement("textarea");a.value=t;document.body.append(a);a.select();try{document.execCommand("copy");toast("Text dopisu zkopírován")}catch(x){toast("Kopírování se nepovedlo")}a.remove()}
  }
  function saveInst(){
    const n=S.inst.trim();if(!n||INST.some(i=>i.n===n))return toast("Instituce je už v nabídce");
    const a=S.iaddr.trim();const ex=custom.find(i=>i.n===n);
    if(ex)ex.a=a;else custom.push({n,a});
    try{ls.set(LS_CUSTOM,custom)}catch(e){}
    fillInst();refs.inst.value=n;refs.instN.hidden=true;toast("Instituce uložena do nabídky");
  }
  bar.append(btn("Tisk / PDF","primary",printLetter),btn("Kopírovat text","",copyText),btn("Uložit instituci do nabídky","",saveInst),btn("Nový dopis","",()=>{
    ["cnum","kdy","nova","popis","ucet","vs","ss"].forEach(k=>{S[k]="";refs[k].value=""});S.odk=false;refs.odk.checked=false;syncVis();upd()}));

  function scale(){
    const w=prevBox.clientWidth-24;if(w<=0)return;
    const k=Math.min(1,w/(210*3.7795));fit.style.transform="scale("+k+")";
    fit.style.width="210mm";prevBox.style.height=Math.ceil(paper.offsetHeight*k+24)+"px";
  }
  function upd(){
    paper.innerHTML=letterHTML(S);
    const c=ucetCheck(S.ucet);ucetSt.className="pst "+c.st;ucetSt.textContent=c.msg;
    const keep=Object.assign({},S);delete keep.date;try{ls.set(LS_STATE,keep)}catch(e){}
    scale();
  }
  window.addEventListener("resize",scale);
  fillClients();fillInst();
  /* uložený stav → hodnoty polí */
  Object.keys(refs).forEach(k=>{const r=refs[k];if(r&&"value" in r&&r.type!=="checkbox"&&S[k]!=null&&k!=="instN")r.value=S[k]});
  if(S.inst&&!instAll().some(i=>i.n===S.inst)){S.inst=INST[0].n;S.iaddr=INST[0].a;refs.inst.value=S.inst;refs.iaddr.value=S.iaddr}
  syncVis();upd();
  return {refreshClients(){fillClients();scale()},state:()=>Object.assign({},S),text:()=>plain(S),build:()=>build(S)};
}
window.Formulare={mount,_test:{build,plain,ucetCheck,dlong,dshort}};
})();
