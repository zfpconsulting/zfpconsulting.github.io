/* Finanční matematika – kalkulačka Úvěr / Investice / Renta (vzhled podle kalkulačky ZFP, s vodoznakem ZFP Consulting).
   Samostatný modul: FinCalc.mount(kontejner, {store, toast}) · čistá matematika ve FinCalc.math (testy: tests/fincalc.run.mjs).
   Konvence výpočtu: vklady/splátky/renty na konci každého měsíce; roční sazba se při jiné frekvenci připisování
   převádí na ekvivalentní měsíční ((1+r/m)^(m/12)−1). */
(()=>{
"use strict";
const PER={m:12,q:4,h:2,y:1};
const FREQ=[["m","Měsíční"],["q","Čtvrtletní"],["h","Pololetní"],["y","Roční"]];

/* ================= matematika ================= */
const iMonth=(rate,f)=>{const r=(+rate||0)/100,m=PER[f]||12;return Math.pow(1+r/m,m/12)-1};
const grow=(i,n)=>Math.pow(1+i,n);
const ann=(i,n)=>Math.abs(i)<1e-12?n:(Math.pow(1+i,n)-1)/i;
/* zůstatek / hodnota po n měsících */
const valueAt=(mode,v,n)=>{const i=iMonth(v.rate,v.freq),g=grow(i,n),a=ann(i,n);
  return mode==="inv"?v.pv*g+v.pmt*a:v.pv*g-v.pmt*a};
/* rovnice ve tvaru R(v)=0 */
const resid=(mode,v)=>{const n=v.years*12,b=valueAt(mode,v,n);return mode==="loan"?b:(v.fv||0)-b};
const FIELDS={
  inv:["pv","pmt","fv","years","rate"],
  loan:["pv","pmt","years","rate"],
  renta:["pv","pmt","years","rate","fv"]
};
function bisect(f,lo,hi,it=200){let flo=f(lo),fhi=f(hi);if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0)return null;
  for(let k=0;k<it;k++){const mid=(lo+hi)/2,fm=f(mid);if(!isFinite(fm))return null;if(fm===0)return mid;if(flo*fm<0){hi=mid;fhi=fm}else{lo=mid;flo=fm}}
  return (lo+hi)/2}
/* dopočítá pole `key`; vrací {ok,val} nebo {ok:false,err} */
function solve(mode,vals,key){
  const v={...vals};
  for(const k of FIELDS[mode])if(k!==key&&!(isFinite(v[k])))return{ok:false,err:"Vyplň všechny hodnoty."};
  if(key!=="years"&&!(v.years>0))return{ok:false,err:"Doba musí být delší než 0 let."};
  let val;
  if(key==="pv"||key==="pmt"||key==="fv"){
    const r0=resid(mode,{...v,[key]:0}),r1=resid(mode,{...v,[key]:1}),d=r1-r0;
    if(Math.abs(d)<1e-15)return{ok:false,err:"Hodnotu nelze dopočítat."};
    val=-r0/d;
  }else if(key==="years"){
    val=bisect(y=>resid(mode,{...v,years:y}),1/120,300);
    if(val==null)return{ok:false,err:mode==="loan"?"Splátka nepokryje ani úroky – úvěr by se nikdy nesplatil.":mode==="renta"?"S touto rentou kapitál nikdy neklesne na zadaný zůstatek.":"Cílové hodnoty se s těmito vklady nedosáhne."};
  }else if(key==="rate"){
    val=bisect(r=>resid(mode,{...v,rate:r}),-99,1000);
    if(val==null)return{ok:false,err:"Pro tyto hodnoty neexistuje žádná sazba, která by vyšla."};
  }
  if(!isFinite(val))return{ok:false,err:"Hodnotu nelze dopočítat."};
  if(key!=="rate"&&val<-0.5){
    const msg={inv:{pv:"Jednorázový vklad by vyšel záporný – měsíční investice sama dorovná víc než cílovou hodnotu.",pmt:"Měsíční investice by vyšla záporná – cílovou hodnotu přesáhne už samotný jednorázový vklad.",fv:"Konečná hodnota by vyšla záporná."},
      loan:{pv:"Výše úvěru by vyšla záporná.",pmt:"Splátka by vyšla záporná."},
      renta:{pv:"Potřebný kapitál by vyšel záporný – zůstatek na konci je příliš nízký.",pmt:"Renta by vyšla záporná – požadovaný zůstatek na konci je vyšší, než kolik kapitál vydělá.",fv:"Kapitál se vyčerpá dřív – zůstatek na konci by byl záporný. Sniž rentu nebo dobu výplaty."}}[mode][key];
    return{ok:false,err:msg||"Hodnota by vyšla záporná."};
  }
  return{ok:true,val:Math.max(val,key==="rate"?val:0)};
}
/* průběh po měsících pro graf + souhrny */
function series(mode,v){
  const N=v.years*12,pts=[],steps=Math.floor(N+1e-9),ms=[];
  for(let k=0;k<=steps;k++)ms.push(k);if(N-steps>1e-6)ms.push(N);
  for(const k of ms){const b=valueAt(mode,v,k);
    pts.push({x:k/12,a:mode==="loan"?Math.max(0,b):b,b:mode==="inv"?v.pv+v.pmt*k:v.pmt*k})}
  return pts;
}
function totals(mode,v){const n=v.years*12;
  if(mode==="inv")return{deposited:v.pv+v.pmt*n,final:v.fv,gain:v.fv-(v.pv+v.pmt*n)};
  if(mode==="loan")return{paid:v.pmt*n,interest:v.pmt*n-v.pv};
  return{paid:v.pmt*n,rest:v.fv};
}

/* ================= hypotéka: LTV, vlastní zdroje, potřebný příjem, aktuální sazby ================= */
/* limity LTV podle ČNB (závazné): 80 %, žadatel do 36 let 90 %, investiční nemovitost 70 % */
const LTV_TYPES=[["own","Vlastní bydlení",80],["young","Do 36 let",90],["inv","Investiční",70]];
const ltvLimit=t=>(LTV_TYPES.find(x=>x[0]===t)||LTV_TYPES[0])[2];
const FIXES=[1,3,5,10];
/* záloha pro offline / první spuštění; aktuální data čte appka ze sazby.json (týdně ho obnovuje GitHub Action tools/sazby.mjs) */
const RATES_SEED={source:"Swiss Life Hypoindex",period:"2026-09",url:"https://www.swisslifeselect.cz/content/dam/sls-cz/pro-media/hypoindex/hypoindex-092026/TZ_Swiss%20Life_Hypoindex_ZARI_2026.pdf",
  index:5.51,fix:{1:{a:5.29,b:5.58},3:{a:5.27,b:5.58},5:{a:5.51,b:5.82},10:{a:5.99,b:6.24}}};
let RATES=RATES_SEED;
/* sazba pro fixaci a LTV: sloupec a = LTV do 80 %, b = nad 80 %; chybí-li jeden sloupec, vezme se druhý */
function liveRate(fix,ltv,R=RATES){const row=R&&R.fix&&(R.fix[fix]||R.fix[String(fix)]);if(!row)return null;
  const hi=isFinite(ltv)&&ltv>80,r=hi?(row.b??row.a):(row.a??row.b);return isFinite(r)?{rate:r,band:hi&&row.b!=null?"nad 80 %":"do 80 %"}:null}
const MONTHS=["leden","únor","březen","duben","květen","červen","červenec","srpen","září","říjen","listopad","prosinec"];
const periodTxt=p=>{const m=/^(\d{4})-(\d{2})$/.exec(p||"");return m?MONTHS[+m[2]-1]+" "+m[1]:String(p||"")};
/* stáří dat v měsících vůči dnešku (Hypoindex vychází k 5. pracovnímu dni měsíce) */
const periodAge=(p,now=new Date())=>{const m=/^(\d{4})-(\d{2})$/.exec(p||"");return m?(now.getFullYear()-+m[1])*12+now.getMonth()+1-+m[2]:99};
/* LTV, vlastní zdroje a potřebný čistý příjem domácnosti (DSTI = všechny splátky / čistý měs. příjem; DTI = dluh / čistý roční příjem) */
function loanInfo(v){
  const price=+v.price>0?+v.price:0,pv=+v.pv||0,limit=ltvLimit(v.ltvType);
  const ltv=price>0?pv/price*100:NaN,own=price>0?price-pv:NaN;
  const dsti=(+v.dsti>0?+v.dsti:40)/100,dti=+v.dti>0?+v.dti:8;
  const needDsti=((+v.pmt||0)+(+v.other||0))/dsti,needDti=pv/dti/12;
  const need=isFinite(v.pmt)?Math.max(needDsti,needDti):NaN;
  const warn=[];
  if(price>0&&pv>price)warn.push("Úvěr je vyšší než cena nemovitosti.");
  else if(price>0&&ltv>limit+1e-9)warn.push(`LTV ${fmtPct(ltv)} překračuje limit ČNB ${limit} % pro tento typ – banka úvěr v této výši poskytne jen výjimečně. Pro limit je potřeba úvěr max. ${fmtKc(price*limit/100)} (vlastní zdroje aspoň ${fmtKc(price*(1-limit/100))}).`);
  return{price,own,ltv,limit,needDsti,needDti,need,binding:needDti>needDsti?"dti":"dsti",warn};
}
/* RPSN podle zákona o spotřebitelském úvěru: roční sazba X, při které se současná hodnota všech plateb klienta (splátky + měsíční
   poplatky, diskontované (1+X)^(t/12)) rovná skutečně vyplacené částce (úvěr − jednorázové poplatky). Předpoklad: sazba platí celou dobu. */
function rpsn(v){const pv=+v.pv,pmt=+v.pmt,n=Math.round((+v.years||0)*12),fo=+v.feeOnce||0,fm=+v.feeMonth||0;
  if(!(pv>0)||!(pmt>0)||!(n>0)||!(pv-fo>0))return NaN;
  const f=X=>{const q=Math.pow(1+X,-1/12);let s=0,d=1;for(let k=1;k<=n;k++){d*=q;s+=(pmt+fm)*d}return s-(pv-fo)};
  const r=bisect(f,-0.5,5);return r==null?NaN:r*100}

/* ================= formátování ================= */
const nf0=new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:0});
const nf2=new Intl.NumberFormat("cs-CZ",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtKc=n=>isFinite(n)?nf0.format(Math.round(n)).replace(/ /g," ")+" Kč":"–";
const fmtNum=n=>isFinite(n)?nf0.format(Math.round(n)).replace(/ /g," "):"";
const fmtPct=n=>isFinite(n)?nf2.format(n)+" %":"–";
const yrsTxt=y=>{if(!isFinite(y))return"–";const r=Math.round(y*10)/10;if(Math.abs(r-Math.round(r))>1e-9)return nf2.format(r).replace(/0$/,"")+" roku";
  const k=Math.round(r);return k+" "+(k===1?"rok":k>=2&&k<=4?"roky":"let")};
const fmtYearsIn=y=>{if(!isFinite(y))return"";const r=Math.round(y*100)/100;return Number.isInteger(r)?String(r):nf2.format(r)};
const parseNum=s=>{const t=String(s??"").replace(/[\s ]/g,"").replace(/Kč|%|let|roky|rok|roku/gi,"").replace(",",".");if(t==="")return NaN;return +t};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ================= definice režimů ================= */
const MODES={
  loan:{t:"Úvěr",chart:"Vývoj zůstatku úvěru",sa:"Zůstatek úvěru",sb:"Splaceno celkem",def:{pv:3000000,pmt:16000,years:30,rate:5,fv:0,freq:"m",price:3750000,ltvType:"own",live:false,fix:5,other:0,dsti:40,dti:8,feeOnce:5000,feeMonth:0},calc:"pmt",
    f:{price:{l:"Cena nemovitosti (CZK)",st:50000,h:"Kupní cena / odhad zástavy. Z ní a výše úvěru se dopočítají vlastní zdroje (akontace) a LTV. 0 = bez nemovitosti (spotřebitelský úvěr)."},
       other:{l:"Ostatní splátky domácnosti (CZK/měs.)",st:500,h:"Splátky jiných úvěrů, leasingů a limity karet – banka je započítá do DSTI."},
       dsti:{l:"Limit DSTI (%)",st:1,h:"Kolik % čistého příjmu smí jít na všechny splátky. ČNB doporučuje 40 % (nezávazně), banky interně často 45–50 %."},
       dti:{l:"Limit DTI (násobek ročního příjmu)",st:0.5,h:"Kolikanásobek čistého ročního příjmu smí dluh činit. ČNB doporučuje 8 (nezávazně), u investičních hypoték je max. 7."},
       feeOnce:{l:"Jednorázové poplatky (CZK)",st:500,h:"Zpracování úvěru, odhad nemovitosti, poplatek za čerpání… Započítají se do RPSN."},
       feeMonth:{l:"Měsíční poplatky (CZK/měs.)",st:50,h:"Vedení úvěrového účtu, povinné pojištění nemovitosti nebo schopnosti splácet, pokud je banka vyžaduje. Započítají se do RPSN."},
       pv:{l:"Výše úvěru (CZK)",st:50000,h:"Kolik si půjčujete."},
       pmt:{l:"Měsíční splátka (CZK)",st:500,h:"Pravidelná splátka na konci každého měsíce (anuita)."},
       years:{l:"Splatnost (počet let)",st:1,h:"Za jak dlouho bude úvěr splacen."},
       rate:{l:"Úroková sazba p.a. (%)",st:0.1,h:"Roční úroková sazba úvěru."}},
    tiles:v=>{const t=totals("loan",v),L=loanInfo(v),out=[];
      if(L.price>0)out.push(["Cena nemovitosti",fmtKc(L.price)],["Vlastní zdroje (akontace)",fmtKc(L.own)],["LTV",fmtPct(L.ltv)]);
      out.push(["Výše úvěru",fmtKc(v.pv)],["Měsíční splátka",fmtKc(v.pmt)],["Úroková sazba p.a."+(v.live?" (aktuální)":""),fmtPct(v.rate)],["RPSN",fmtPct(rpsn(v))],["Splatnost",yrsTxt(v.years)],["Celkem zaplatíte",fmtKc(t.paid)],["Přeplatek na úrocích",fmtKc(t.interest)],["Potřebný čistý příjem / měs.",fmtKc(L.need)]);
      return out},
    help:"Graf ukazuje, jak klesá dlužná částka, a kolik už bylo na splátkách zaplaceno celkem."},
  inv:{t:"Investice",chart:"Vývoj hodnoty investice",sa:"Hodnota investice",sb:"Vloženo celkem",def:{pv:100000,pmt:5000,fv:0,years:20,rate:6,freq:"m"},calc:"fv",
    f:{pv:{l:"Jednorázový vklad (CZK)",st:10000,h:"Částka, kterou vložíte hned na začátku."},
       pmt:{l:"Pravidelná měsíční investice (CZK)",st:500,h:"Částka, kterou investujete na konci každého měsíce."},
       fv:{l:"Konečná hodnota investice (CZK)",st:10000,h:"Hodnota investice na konci doby investování."},
       years:{l:"Splatnost (počet let)",st:1,h:"Jak dlouho se bude investovat."},
       rate:{l:"Zhodnocení p.a. (%)",st:0.25,h:"Očekávané průměrné roční zhodnocení. Minulé výnosy nejsou zárukou budoucích."}},
    tiles:v=>{const t=totals("inv",v);return[["Jednorázový vklad",fmtKc(v.pv)],["Pravidelná měs. inv.",fmtKc(v.pmt)],["Zhodnocení p.a.",fmtPct(v.rate)],["Splatnost",yrsTxt(v.years)],["Celkem vložíte",fmtKc(t.deposited)],["Konečná hodnota inv.",fmtKc(t.final)]]},
    help:"Graf ukazuje, jak roste hodnota investice oproti penězům, které do ní celkem vložíte. Rozdíl mezi křivkami je výnos."},
  renta:{t:"Renta",chart:"Vývoj hodnoty kapitálu",sa:"Hodnota kapitálu",sb:"Vyplaceno celkem",def:{pv:3000000,pmt:15000,years:20,rate:4,fv:0,freq:"m"},calc:"pmt",
    f:{pv:{l:"Naspořená částka (CZK)",st:50000,h:"Kapitál na začátku výplaty renty."},
       pmt:{l:"Měsíční renta (CZK)",st:500,h:"Částka vyplácená na konci každého měsíce."},
       years:{l:"Doba výplaty (počet let)",st:1,h:"Jak dlouho se bude renta vyplácet."},
       rate:{l:"Zhodnocení p.a. (%)",st:0.25,h:"Očekávané průměrné roční zhodnocení kapitálu během výplaty."},
       fv:{l:"Zůstatek na konci (CZK)",st:50000,h:"Kolik má z kapitálu zůstat po poslední výplatě (0 = renta kapitál vyčerpá)."}},
    tiles:v=>{const t=totals("renta",v);return[["Naspořená částka",fmtKc(v.pv)],["Měsíční renta",fmtKc(v.pmt)],["Zhodnocení p.a.",fmtPct(v.rate)],["Doba výplaty",yrsTxt(v.years)],["Celkem vyplaceno",fmtKc(t.paid)],["Zůstatek na konci",fmtKc(t.rest)]]},
    help:"Graf ukazuje, jak se kapitál postupně čerpá rentou, a kolik už bylo celkem vyplaceno."}
};
const ORDER=["loan","inv","renta"];

/* ================= grafika ================= */
const ICON={
  flag:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5v13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3.8 2h9.2l-2.2 3.4L13 8.8H3.8z" fill="currentColor"/></svg>',
  help:'<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6a6.2 6.2 0 1 0 0 12.4c.6 0 1.2-.1 1.8-.3l2.9 1.1-.6-2.6A6.2 6.2 0 0 0 8 1.6z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.8.6-.8 1.1v.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11" r=".8" fill="currentColor"/></svg>',
  pen:'<svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.2l3 3-8.4 8.4-3.6.6.6-3.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.3 3.7l3 3" stroke="currentColor" stroke-width="1.4"/></svg>',
  dbl:'<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 3 8l5 5M13 3 8 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu:'<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};
/* logo ZFP Consulting (vodoznak i hlavička) – proporce podle oficiálního loga: „ZFP“ tmavě šedé, vlajka s vykrojenou
   špičkou vyšší než písmena, „CONSULTING“ světleji šedé přes celou šířku; textLength drží přesné šířky v každém písmu */
function zfpLogo({x=0,y=0,s=1,gray="#4f5052",gray2="#7d8183",orange="#F37520",op=1}={}){
  return `<g transform="translate(${x} ${y}) scale(${s})" opacity="${op}">
  <text x="0" y="79" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="80" textLength="152" lengthAdjust="spacingAndGlyphs" style="fill:${gray}">ZFP</text>
  <path d="M165 0H222V94L193.5 64L165 94Z" style="fill:${orange}"/>
  <text x="0" y="123" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="35" textLength="222" lengthAdjust="spacingAndGlyphs" style="fill:${gray2}">CONSULTING</text></g>`}
const LOGO_W=222,LOGO_H=124;

/* vodoznak v grafu: wm = {t:"zfp"|"img"|"text"|"none", img,iw,ih, txt, op (průhlednost 0–1), sz (velikost, 1 = výchozí)} */
const WM_DEF={t:"zfp",op:.3,sz:1,txt:""};
function wmSVG(wm,{cx,cy,W,H,c}){
  const p={...WM_DEF,...wm},base=Math.min(170,Math.max(104,W*.17))*p.sz,op=Math.min(1,Math.max(0,+p.op||0));
  if(p.t==="none")return"";
  if(p.t==="img"&&p.img){let bw=base*1.1,bh=bw*(p.ih||1)/(p.iw||1);const mh=H*.7;if(bh>mh){bw*=mh/bh;bh=mh}
    return `<image class="fc-wm" href="${p.img}" x="${(cx-bw/2).toFixed(1)}" y="${(cy-bh/2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" opacity="${op}" preserveAspectRatio="xMidYMid meet"/>`}
  if(p.t==="text"&&p.txt.trim()){const fs=Math.min(base*1.6/Math.max(4,p.txt.trim().length)*1.9,base*.42);
    return `<text class="fc-wm" x="${cx.toFixed(1)}" y="${(cy+fs*.35).toFixed(1)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs.toFixed(1)}" opacity="${op}" style="fill:${c.wmGray}">${esc(p.txt.trim())}</text>`}
  const ws=base/LOGO_W;return zfpLogo({x:cx-LOGO_W*ws/2,y:cy-LOGO_H*ws/2,s:ws,gray:c.wmGray,gray2:c.wmGray2,orange:c.wmOrange,op});
}
/* nahraný obrázek vodoznaku: zmenšit na max. 600 px, PNG kvůli průhlednosti */
function readWmImage(file){return new Promise((res,rej)=>{const r=new FileReader();r.onerror=rej;r.onload=()=>{const i=new Image();i.onerror=rej;i.onload=()=>{
  const k=Math.min(1,600/Math.max(i.naturalWidth,i.naturalHeight)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.naturalWidth*k));c.height=Math.max(1,Math.round(i.naturalHeight*k));
  c.getContext("2d").drawImage(i,0,0,c.width,c.height);res({img:c.toDataURL("image/png"),iw:c.width,ih:c.height})};i.src=r.result};r.readAsDataURL(file)})}

/* graf: a = hlavní křivka (zelená s výplní), b = šedá plocha */
function chartSVG(pts,{w=900,h=440,c,labelA,labelB,wm=true}){
  const pl=74,pr=16,pt=16,pb=34,W=w-pl-pr,H=h-pt-pb;
  if(!pts.length)return"";
  const xs=pts.map(p=>p.x),X1=xs[xs.length-1]||1;
  const all=pts.flatMap(p=>[p.a,p.b]);let lo=Math.min(...all),hi=Math.max(...all);if(hi-lo<1){hi=lo+1}
  const sx=x=>pl+x/X1*W,sy=y=>pt+(hi-y)/(hi-lo)*H;
  const ticks=[0,1,2,3,4,5].map(k=>lo+(hi-lo)*k/5);
  const pxYear=W/X1,yearStep=[1,2,5,10,20,50].find(st=>st*pxYear>=28)||100;
  const xt=[];for(let yv=0;yv<=X1+1e-9;yv+=yearStep)xt.push(yv);
  /* e = průběh animace 0…1: body rostou od spodní osy na své místo */
  const base=pt+H,path=(key,e=1)=>pts.map((p,k)=>(k?"L":"M")+sx(p.x).toFixed(2)+" "+(base+(sy(p[key])-base)*e).toFixed(2)).join("");
  const area=(key,e=1)=>path(key,e)+`L${sx(X1).toFixed(2)} ${base.toFixed(2)}L${pl} ${base.toFixed(2)}Z`;
  const gid="fcg"+Math.random().toString(36).slice(2,8);
  let s=`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(labelA)} a ${esc(labelB)} v čase" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;font-family:Arial,Helvetica,sans-serif">
  <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${c.a};stop-opacity:.22"/><stop offset="1" style="stop-color:${c.a};stop-opacity:.02"/></linearGradient></defs>`;
  ticks.forEach(t=>{const y=sy(t).toFixed(2);s+=`<line x1="${pl}" x2="${pl+W}" y1="${y}" y2="${y}" style="stroke:${c.grid};stroke-width:1"/><text x="${pl-12}" y="${(+y+4).toFixed(2)}" text-anchor="end" font-size="12" style="fill:${c.txt}">${fmtNum(t)}</text>`});
  xt.forEach(t=>{s+=`<text x="${sx(t).toFixed(2)}" y="${pt+H+22}" text-anchor="middle" font-size="12" style="fill:${c.txt}">${Math.round(t)}</text>`});
  s+=`<path class="fc-aa" d="${area("a")}" fill="url(#${gid})"/>`;
  s+=`<path class="fc-ab" d="${area("b")}" style="fill:${c.b};opacity:.9"/>`;
  if(wm)s+=wmSVG(wm,{cx:pl+W/2,cy:pt+H/2,W,H,c});
  s+=`<path class="fc-la" d="${path("a")}" style="fill:none;stroke:${c.a};stroke-width:3.2;stroke-linejoin:round;stroke-linecap:round"/>`;
  s+=`<g class="fc-hover" style="display:none"><line class="fc-hx" y1="${pt}" y2="${pt+H}" style="stroke:${c.txt};stroke-width:1;stroke-dasharray:3 3"/><circle class="fc-ha" r="5.5" style="fill:${c.a};stroke:${c.ring};stroke-width:2"/></g>`;
  s+=`<rect class="fc-hit" x="${pl}" y="${pt}" width="${W}" height="${H}" fill="transparent"/></svg>`;
  return {svg:s,sx,sy,pl,W,X1,frame:e=>({la:path("a",e),aa:area("a",e),ab:area("b",e)})};
}

/* ================= CSS ================= */
const CSS=`
.fc{--fc-navy:#111111;--fc-orange:#F37520;--fc-green:#F37520;--fc-area:#e4e6e9;--fc-tile:#f0f2f5;--fc-line:#d5d9df;--fc-calc:#e3e8ef;--fc-flagc:#F37520;--fc-txt:#6b7280;--fc-grid:#e9ebee;--fc-logo1:#4f5052;--fc-logo2:#7d8183;
  font-family:Roboto,var(--font,-apple-system,system-ui,sans-serif);color:var(--fc-navy);background:var(--bg2,#fff);border-radius:16px;box-shadow:var(--card-shadow);overflow:hidden;margin-bottom:28px;letter-spacing:0}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .fc{--fc-navy:#f2f4f7;--fc-area:#3a3d42;--fc-tile:#2c2c2e;--fc-line:#48484a;--fc-calc:#2a3442;--fc-txt:#a1a1aa;--fc-grid:#3a3a3c;--fc-green:#F37520;--fc-logo1:#e5e5e7;--fc-logo2:#a1a1a6}}
:root[data-theme="dark"] .fc{--fc-navy:#f2f4f7;--fc-area:#3a3d42;--fc-tile:#2c2c2e;--fc-line:#48484a;--fc-calc:#2a3442;--fc-txt:#a1a1aa;--fc-grid:#3a3a3c;--fc-green:#F37520;--fc-logo1:#e5e5e7;--fc-logo2:#a1a1a6}
:where(.fc) button{font:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0}
.fc-head{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--fc-line)}
.fc-logo svg{display:block;height:36px;width:auto}
.fc-title{text-align:center;font-size:16px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fc-acts{display:flex;align-items:center;gap:10px}
.fc-btn{height:36px;padding:0 12px;border-radius:8px;border:1.5px solid var(--fc-navy);font-size:14.5px;font-weight:500;white-space:nowrap}
.fc-btn.pri{background:var(--fc-orange);border-color:var(--fc-orange);color:#fff}
.fc-ico{width:34px;height:34px;display:grid;place-items:center;border-radius:8px}
.fc-body{display:flex;min-height:560px}
.fc-tabs{display:flex;flex-direction:column;background:var(--fc-tile);flex:none;width:54px}
.fc-tabs button{writing-mode:vertical-rl;transform:rotate(180deg);padding:30px 0;width:54px;font-size:15px;color:var(--fc-navy);border-left:2px solid transparent}
.fc-tabs button[aria-selected="true"]{background:var(--bg2,#fff);font-weight:700;border-left-color:var(--fc-orange)}
.fc-par{flex:none;width:320px;padding:16px 16px 24px;box-shadow:4px 0 10px -6px rgba(0,0,0,.18);position:relative;z-index:1;background:var(--bg2,#fff)}
.fc-par.min{width:52px;padding-inline:8px}
.fc-par.min .fc-pin{display:none}
.fc-ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.fc-ph h3{margin:0;font-size:19px;font-weight:700}
.fc-par.min .fc-ph h3{display:none}
.fc-coll{width:30px;height:30px;display:grid;place-items:center;color:var(--fc-navy);border-radius:6px}
.fc-par.min .fc-coll{transform:rotate(180deg)}
.fc-f{margin-bottom:12px}
.fc-fl{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--fc-txt);margin-bottom:7px;position:relative}
.fc-flag{color:var(--fc-navy);display:grid;place-items:center;width:22px;height:22px;flex:none;border-radius:4px}
.fc-f.calc .fc-flag{color:var(--fc-flagc)}
.fc-q{color:var(--fc-navy);display:inline-grid;place-items:center;width:20px;height:20px}
.fc-hp{position:absolute;left:28px;top:100%;margin-top:4px;z-index:5;background:var(--fc-navy);color:var(--bg2,#fff);font-size:13px;line-height:1.4;padding:8px 10px;border-radius:8px;max-width:260px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
.fc-in{display:flex;align-items:center;height:50px;border:1px solid var(--fc-line);border-radius:6px;background:var(--bg2,#fff)}
.fc-in button{width:44px;height:100%;font-size:22px;line-height:1;color:var(--fc-navy);flex:none}
.fc-in input{flex:1;min-width:0;border:none;background:transparent;text-align:center;font:inherit;font-size:16px;color:var(--fc-navy);outline:none;height:100%}
.fc-f.calc .fc-in{background:var(--fc-calc);border-color:var(--fc-calc)}
.fc-f.calc .fc-in button{color:var(--fc-txt);opacity:.6;cursor:default}
.fc-f.err .fc-in{border-color:var(--red,#F37520)}
.fc-sel{width:100%;height:50px;border:1px solid var(--fc-line);border-radius:6px;background:var(--bg2,#fff);color:var(--fc-navy);font:inherit;font-size:16px;padding:0 14px;appearance:auto}
.fc-errm{color:var(--red,#F37520);font-size:13.5px;line-height:1.4;margin:4px 0 0}
.fc-f.lock .fc-in{background:var(--fc-calc);border-color:var(--fc-calc)}
.fc-f.lock .fc-in button{opacity:.4;cursor:default}
.fc-flag[disabled]{opacity:.35;cursor:default}
.fc-chk{display:flex;align-items:center;gap:10px;font-size:14.5px;color:var(--fc-navy);font-weight:600;cursor:pointer;margin-bottom:8px;min-height:30px}
.fc-chk input{width:20px;height:20px;accent-color:var(--fc-orange);margin:0}
.fc-src{font-size:12.5px;line-height:1.4;color:var(--fc-txt);margin:6px 0 0}
.fc-src a{color:inherit}
.fc-sub{font-size:15px;margin:20px 0 10px;padding-top:12px;border-top:1px solid var(--fc-line)}
.fc-note{font-size:13.5px;line-height:1.45;color:var(--fc-txt);margin:10px 0 0;padding:9px 11px;background:var(--fc-tile);border-radius:8px}
.fc-note b{color:var(--fc-navy)}
.fc-note.warn{background:transparent;border:1px solid var(--fc-orange);color:var(--fc-navy)}
.fc-main{flex:1;min-width:0;padding:22px 26px 26px;container-type:inline-size}
.fc-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:22px}
.fc-tile{background:var(--fc-tile);border-radius:10px;padding:12px 14px;min-width:0}
.fc-tile .k{font-size:13.5px;color:var(--fc-navy);margin-bottom:4px;line-height:1.25}
.fc-tile .v{font-size:18px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
@container (max-width:1040px){.fc-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
@container (max-width:520px){.fc-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.fc-ch{display:flex;align-items:center;gap:12px;margin-bottom:10px;position:relative}
.fc-ch h2{margin:0;font-size:19px;font-weight:700}
.fc-ch button{color:var(--fc-navy);width:26px;height:26px;display:grid;place-items:center}
.fc-ch .fc-hp{left:0}
.fc-chart{position:relative}
.fc-tip{position:absolute;pointer-events:none;background:var(--bg2,#fff);color:var(--fc-navy);font-size:13px;padding:8px 11px;border-radius:8px;white-space:nowrap;box-shadow:0 6px 22px rgba(0,0,0,.18);transform:translate(-50%,calc(-100% - 12px));font-variant-numeric:tabular-nums;line-height:1.5;z-index:3}
.fc-tip i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.fc-leg{display:flex;gap:26px;justify-content:flex-start;padding-left:40px;margin-top:12px;font-size:13px;color:var(--fc-txt)}
.fc-leg span{display:flex;align-items:center;gap:6px}
.fc-leg i{width:13px;height:13px;border-radius:50%;display:inline-block}
.fc-empty{display:grid;place-items:center;height:300px;color:var(--fc-txt);font-size:15px;text-align:center;padding:20px}
.fc-menu{position:absolute;right:14px;top:56px;z-index:20;background:var(--bg2,#fff);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.25);min-width:280px;max-width:calc(100vw - 32px);max-height:60vh;overflow:auto;padding:6px 0}
.fc-menu h4{margin:6px 14px 6px;font-size:12px;color:var(--fc-txt);text-transform:uppercase;letter-spacing:.03em;font-weight:500}
.fc-mi{display:flex;align-items:center;gap:10px;padding:9px 14px}
.fc-mi .t{flex:1;min-width:0}
.fc-mi .t b{display:block;font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fc-mi .t small{color:var(--fc-txt);font-size:12.5px}
.fc-mi .del{color:var(--red,#F37520);font-size:13px}
.fc-mi.cur b{color:var(--fc-orange)}
.fc-wm{padding:2px 14px 12px;display:grid;gap:10px;border-top:1px solid var(--fc-line);margin-top:6px}
.fc-wm h4{margin:10px 0 0!important}
.fc-wseg{display:grid;grid-template-columns:repeat(4,1fr);background:var(--fc-tile);border-radius:8px;padding:2px}
.fc-wseg button{font-size:13px!important;padding:6px 4px!important;border-radius:6px}
.fc-wseg button[aria-pressed="true"]{background:var(--bg2,#fff);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.fc-wrow{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--fc-txt)}
.fc-wrow span{width:92px;flex:none}
.fc-wrow input[type=range]{flex:1;min-width:0}
.fc-wrow input[type=text]{flex:1;min-width:0;height:34px;border:1px solid var(--fc-line);border-radius:6px;padding:0 10px;font:inherit;font-size:14px;background:var(--bg2,#fff);color:var(--fc-navy)}
.fc-wimg{display:flex;align-items:center;gap:10px}
.fc-wimg img{width:56px;height:40px;object-fit:contain;background:var(--fc-tile);border-radius:6px}
.fc-wimg button{color:var(--tint,#F37520);font-size:14px!important;font-weight:500}
.fc-wnote{font-size:12px;color:var(--fc-txt);margin:0}
.fc-wrapH{position:relative}
@media (max-width:860px){
  .fc-head{grid-template-columns:auto 1fr auto;gap:10px}
  .fc-title{text-align:right}
  .fc-acts{grid-column:1/-1;order:3;gap:8px}
  .fc-acts .fc-btn{flex:1 1 0;min-width:0;padding:0 6px;overflow:hidden;text-overflow:ellipsis}
  .fc-body{flex-direction:column}
  .fc-tabs{flex-direction:row;width:auto}
  .fc-tabs button{writing-mode:horizontal-tb;transform:none;padding:12px 0;flex:1;width:auto;border-left:none;border-bottom:2px solid transparent}
  .fc-tabs button[aria-selected="true"]{border-bottom-color:var(--fc-orange)}
  .fc-par,.fc-par.min{width:auto;box-shadow:none;border-bottom:1px solid var(--fc-line);padding:16px}
  .fc-par.min .fc-pin{display:none}
  .fc-par.min .fc-ph h3{display:block}
  .fc-coll{transform:rotate(90deg)}
  .fc-par.min .fc-coll{transform:rotate(-90deg)}
  .fc-par.min .fc-ph{margin-bottom:0}
  .fc-main{padding:18px 16px}
  .fc-tile{padding:10px 12px}
  .fc-tile .k{font-size:12.5px}
  .fc-tile .v{font-size:16px}
  .fc-title{white-space:normal;font-size:15px;line-height:1.25}
  .fc-leg{padding-left:0;justify-content:center}
}`;

/* ================= UI ================= */
function mount(root,opts={}){
  if(!document.getElementById("fcCss")){const st=document.createElement("style");st.id="fcCss";st.textContent=CSS;document.head.append(st)}
  const store=opts.store||null,toast=opts.toast||(m=>console.log(m));
  const LS="fc_draft_v1";
  const fresh=()=>({id:null,name:"",clientId:"",clientName:"",mode:"inv",titles:{},m:Object.fromEntries(ORDER.map(k=>[k,{v:{...MODES[k].def},calc:MODES[k].calc}]))});
  /* úložiště rozpracované kalkulace – Pipeline předává svoje (odděluje prezentační/čistý režim a maže se při odhlášení) */
  const ls=opts.ls||{get:k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  let st=ls.get(LS);
  if(!st||!st.m||!ORDER.every(k=>st.m[k]))st=fresh();
  /* starší uložené kalkulace nemají nová pole úvěru (cena nemovitosti, bonita…) – doplnit výchozí */
  const fill=s=>{ORDER.forEach(k=>{s.m[k].v={...MODES[k].def,...s.m[k].v}});return s};
  fill(st);
  /* aktuální sazby hypoték (sazby.json vedle appky); když se nenačtou, zůstane záloha v kódu */
  if(opts.rates)RATES=opts.rates;
  else if(typeof fetch==="function")fetch(opts.ratesUrl||"sazby.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.fix){RATES=j;if(st.mode==="loan"&&cur().v.live)refresh()}}).catch(()=>{});
  let saved=[],help=null,menuOpen=false,minPar=false,lastRes=null;
  const persist=()=>ls.set(LS,st);
  /* vodoznak: sdílí se mezi zařízeními přes úložiště Pipeline (fcprefs/main), jinak jen v tomto zařízení */
  let wm={...WM_DEF,...(ls.get("fc_wm_v1")||{})};
  const wmDoc=store&&store.doc?store.doc("fcprefs/main"):null;
  const saveWm=()=>{ls.set("fc_wm_v1",wm);if(wmDoc)wmDoc.set({wm}).catch(()=>{})};
  if(wmDoc&&wmDoc.onSnapshot)wmDoc.onSnapshot(d=>{const n=d.exists&&d.data()&&d.data().wm;if(n&&JSON.stringify(n)!==JSON.stringify(wm)){wm={...WM_DEF,...n};ls.set("fc_wm_v1",wm);if(menuOpen&&!root.querySelector(".fc-menu").contains(document.activeElement))draw();else if(lastRes)drawChart()}});
  if(store)store.collection("fincalc").onSnapshot(s=>{saved=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));if(menuOpen)draw()});

  const cur=()=>st.m[st.mode];
  /* klienti z Pipeline pro přiřazení kalkulace (opts.clients = funkce → [{id,name}]) */
  const clientList=()=>{try{return typeof opts.clients==="function"?(opts.clients()||[]):[]}catch(e){return[]}};
  function compute(){lastRes=computeFor(st.mode);return lastRes}
  function computeFor(mode){
    const M=MODES[mode],c=st.m[mode],v={...c.v};
    const live=mode==="loan"&&v.live;
    if(live&&c.calc==="rate")c.calc="pmt";
    let r,lr=null;
    for(let it=0;it<3;it++){
      if(live){lr=liveRate(v.fix,loanInfo(v).ltv);if(lr){v.rate=lr.rate;c.v.rate=lr.rate}}
      r=solve(mode,v,c.calc);
      if(r.ok){v[c.calc]=c.calc==="years"?r.val:c.calc==="rate"?r.val:Math.round(r.val*100)/100;c.v[c.calc]=v[c.calc]}
      if(!live||c.calc!=="pv"||!r.ok)break;
      const nr=liveRate(v.fix,loanInfo(v).ltv);if(!nr||!lr||nr.rate===lr.rate)break;
    }
    if(live&&!lr)r={ok:false,err:"Aktuální sazba pro tuto fixaci není k dispozici – vypni „Aktuální úroková sazba“ a zadej ji ručně."};
    return {ok:r.ok,err:r.err,v,M,lr};
  }
  function fieldVal(k,v){if(!isFinite(v))return"";if(k==="rate"||k==="dsti")return nf2.format(v)+" %";if(k==="dti")return fmtYearsIn(v);if(k==="years")return fmtYearsIn(v);return fmtNum(v)}

  /* jedno číselné pole; pole mimo FIELDS (cena nemovitosti, bonita) nemají vlajku – nedopočítávají se */
  function fieldHTML(k,res){
    const M=MODES[st.mode],c=cur(),solv=FIELDS[st.mode].includes(k),lock=st.mode==="loan"&&k==="rate"&&c.v.live;
    const f=M.f[k],isC=k===c.calc;
    return `<div class="fc-f${isC?" calc":""}${lock?" lock":""}${isC&&!res.ok?" err":""}" data-k="${k}">
            <div class="fc-fl">${solv?`<button type="button" class="fc-flag" data-a="flag" data-k="${k}" title="${isC?"Tato hodnota se dopočítává":lock?"Aktuální sazba se nedopočítává":"Dopočítat tuto hodnotu"}" aria-label="Dopočítat: ${esc(f.l)}" aria-pressed="${isC}"${lock?" disabled":""}>${ICON.flag}</button>`:`<span class="fc-flag" aria-hidden="true"></span>`}<span>${esc(f.l)}</span><button type="button" class="fc-q" data-a="help" data-k="${k}" aria-label="Nápověda">${ICON.help}</button>${help===k?`<div class="fc-hp">${esc(f.h)}</div>`:""}</div>
            <div class="fc-in"><button type="button" data-a="dec" data-k="${k}" aria-label="Snížit" ${isC||lock?"disabled":""}>−</button><input data-k="${k}" inputmode="decimal" autocomplete="off" aria-label="${esc(f.l)}" value="${isC&&!res.ok?"–":fieldVal(k,c.v[k])}" ${isC||lock?"disabled":""}><button type="button" data-a="inc" data-k="${k}" aria-label="Zvýšit" ${isC||lock?"disabled":""}>+</button></div></div>`
  }
  function loanNotes(res){
    const v=res.v,L=loanInfo(v),out=[];
    if(res.ok)out.push(`<p class="fc-note">Potřebný čistý příjem domácnosti: <b>${fmtKc(L.need)}</b> měsíčně – rozhoduje ${L.binding==="dti"?`DTI ${nf2.format(v.dti).replace(/,00$/,"")} (úvěr max. ${nf2.format(v.dti).replace(/,00$/,"")}× roční příjem)`:`DSTI ${nf2.format(v.dsti).replace(/,00$/,"")} % (splátky max. ${nf2.format(v.dsti).replace(/,00$/,"")} % příjmu)`}. Příjmy spolužadatelů se sčítají.</p>`);
    L.warn.forEach(w=>out.push(`<p class="fc-note warn" role="status">${esc(w)}</p>`));
    return out.join("");
  }
  function rateSrc(res){
    const c=cur();if(!c.v.live)return"";const R=RATES,lr=res.lr,old=periodAge(R.period)>2;
    const rp=res.ok?rpsn(res.v):NaN;
    return `${lr?`Sazba ${fmtPct(lr.rate)}${isFinite(rp)?` · <b>RPSN ${fmtPct(rp)}</b>`:""} = průměrná nabídková sazba, fixace ${c.v.fix} ${c.v.fix===1?"rok":c.v.fix<5?"roky":"let"}, LTV ${lr.band}. `:""}Zdroj: <a href="${esc(R.url||"https://www.hypoindex.cz/")}" target="_blank" rel="noopener">${esc(R.source||"Swiss Life Hypoindex")}</a>, ${esc(periodTxt(R.period))}.${old?` <b>Data jsou starší než 2 měsíce – zkontroluj aktualizaci sazeb.</b>`:""}`;
  }
  /* panel Parametry: u úvěru navíc cena nemovitosti, typ (limit LTV), aktuální sazba a bonita */
  function parHTML(res){
    const c=cur();
    const freq=`<div class="fc-f"><div class="fc-fl"><span>Frekvence připisování úroku</span></div><select class="fc-sel" data-a="freq" aria-label="Frekvence připisování úroku">${FREQ.map(([k,t])=>`<option value="${k}"${c.v.freq===k?" selected":""}>${t}</option>`).join("")}</select></div>`;
    if(st.mode!=="loan")return FIELDS[st.mode].map(k=>fieldHTML(k,res)).join("")+freq;
    return fieldHTML("price",res)
      +`<div class="fc-f"><div class="fc-fl"><span>Účel / limit LTV</span></div><select class="fc-sel" data-x="ltvType" aria-label="Účel úvěru">${LTV_TYPES.map(([k,t,l])=>`<option value="${k}"${c.v.ltvType===k?" selected":""}>${esc(t)} – LTV ${l} %</option>`).join("")}</select></div>`
      +["pv","pmt","years","rate"].map(k=>fieldHTML(k,res)).join("")
      +`<div class="fc-f fc-live"><label class="fc-chk"><input type="checkbox" data-x="live"${c.v.live?" checked":""}> Aktuální úroková sazba</label>
        ${c.v.live?`<select class="fc-sel" data-x="fix" aria-label="Délka fixace">${FIXES.map(f=>`<option value="${f}"${+c.v.fix===f?" selected":""}>Fixace ${f} ${f===1?"rok":f<5?"roky":"let"}</option>`).join("")}</select><p class="fc-src">${rateSrc(res)}</p>`:""}</div>`
      +freq+`<h4 class="fc-sub">Poplatky (do RPSN)</h4>`+["feeOnce","feeMonth"].map(k=>fieldHTML(k,res)).join("")
      +`<h4 class="fc-sub">Bonita</h4>`+["other","dsti","dti"].map(k=>fieldHTML(k,res)).join("");
  }
  function draw(){
    const res=compute(),M=MODES[st.mode],c=cur();persist();
    const title="Finanční matematika - "+(st.name||"Koncept")+(st.clientName&&st.clientName!==st.name?" · "+st.clientName:"");
    root.innerHTML=`<div class="fc"><div class="fc-wrapH">
      <div class="fc-head"><div class="fc-logo"><svg viewBox="0 0 ${LOGO_W} ${LOGO_H}" role="img" aria-label="ZFP Consulting">${zfpLogo({gray:"var(--fc-logo1)",gray2:"var(--fc-logo2)"})}</svg></div>
        <div class="fc-title" title="${esc(title)}">${esc(title)}</div>
        <div class="fc-acts"><button class="fc-btn" data-a="save" type="button">Uložit</button><button class="fc-btn" data-a="pdf" type="button">Stáhnout PDF</button><button class="fc-btn pri" data-a="new" type="button">Nová kalkulace</button></div>
          <button class="fc-ico" data-a="menu" type="button" aria-label="Uložené kalkulace a vodoznak" title="Uložené kalkulace a vodoznak">${ICON.menu}</button></div>
      ${menuOpen?menuHTML():""}</div>
      <div class="fc-body">
        <div class="fc-tabs" role="tablist" aria-label="Typ výpočtu">${ORDER.map(k=>`<button type="button" role="tab" data-a="mode" data-k="${k}" aria-selected="${k===st.mode}">${MODES[k].t}</button>`).join("")}</div>
        <div class="fc-par${minPar?" min":""}"><div class="fc-ph"><h3>Parametry</h3><button class="fc-coll" type="button" data-a="coll" aria-label="${minPar?"Rozbalit":"Sbalit"} parametry">${ICON.dbl}</button></div>
          <div class="fc-pin">${parHTML(res)}
            <p class="fc-errm" role="alert"${res.ok?" hidden":""}>${res.ok?"":esc(res.err)}</p>
            <div class="fc-notes">${st.mode==="loan"?loanNotes(res):""}</div>
          </div></div>
        <div class="fc-main">
          <div class="fc-tiles">${tilesHTML()}</div>
          <div class="fc-ch"><h2>${esc(st.titles[st.mode]||M.chart)}</h2><button type="button" data-a="help" data-k="_chart" aria-label="Nápověda ke grafu">${ICON.help}</button><button type="button" data-a="ctitle" aria-label="Upravit název grafu" title="Upravit název grafu">${ICON.pen}</button>${help==="_chart"?`<div class="fc-hp">${esc(M.help)}</div>`:""}</div>
          <div class="fc-chart" id="fcChart"></div>
          <div class="fc-leg"><span><i style="background:var(--fc-green)"></i>${esc(M.sa)}</span><span><i style="background:var(--fc-area)"></i>${esc(M.sb)}</span></div>
        </div></div></div>`;
    drawChart();
  }
  function tilesHTML(){const {ok,v,M}=lastRes,c=cur();return (ok?M.tiles(v):M.tiles({...v,[c.calc]:NaN})).map(([k,x])=>`<div class="fc-tile"><div class="k">${esc(k)}</div><div class="v">${esc(x)}</div></div>`).join("")}
  /* přepočet bez překreslení formuláře (aby při psaní nezmizel kurzor) */
  function refresh(){
    const res=compute(),c=cur();persist();
    root.querySelectorAll(".fc-f[data-k]").forEach(f=>{const k=f.dataset.k,isC=k===c.calc,inp=f.querySelector("input");
      f.classList.toggle("err",isC&&!res.ok);
      if(inp&&document.activeElement!==inp)inp.value=isC&&!res.ok?"–":fieldVal(k,c.v[k])});
    const em=root.querySelector(".fc-errm");if(em){em.hidden=res.ok;em.textContent=res.ok?"":res.err}
    const tl=root.querySelector(".fc-tiles");if(tl)tl.innerHTML=tilesHTML();
    const nt=root.querySelector(".fc-notes");if(nt)nt.innerHTML=st.mode==="loan"?loanNotes(res):"";
    const sr=root.querySelector(".fc-src");if(sr)sr.innerHTML=rateSrc(res);
    drawChart();
  }
  const scrColors=()=>({a:"var(--fc-green)",b:"var(--fc-area)",grid:"var(--fc-grid)",txt:"var(--fc-txt)",ring:"var(--bg2,#fff)",wmGray:"var(--fc-logo1)",wmGray2:"var(--fc-logo2)",wmOrange:"#F37520",wmOp:.3});
  let anim=0,lastSig="";
  function drawChart(){
    const box=root.querySelector("#fcChart");if(!box)return;
    const {ok,v,M}=lastRes;
    if(!ok){box.innerHTML=`<div class="fc-empty">${esc(lastRes.err)}</div>`;return}
    const pts=series(st.mode,v),w=Math.max(320,Math.round(box.clientWidth||900)),h=Math.round(Math.min(480,Math.max(280,w*0.5)));
    const ch=chartSVG(pts,{w,h,c:scrColors(),labelA:M.sa,labelB:M.sb,wm});
    box.innerHTML=ch.svg;
    /* animace jen při změně zadání nebo režimu (ne při změně velikosti okna): křivky vyrostou od spodní osy */
    const sig=st.mode+JSON.stringify(v);cancelAnimationFrame(anim);
    if(sig!==lastSig&&!matchMedia("(prefers-reduced-motion: reduce)").matches){
      const els={la:box.querySelector(".fc-la"),aa:box.querySelector(".fc-aa"),ab:box.querySelector(".fc-ab")},t0=performance.now(),D=900;
      const step=now=>{const p=Math.min(1,(now-t0)/D),e=1-Math.pow(1-p,3),f=ch.frame(e);for(const k in els)els[k].setAttribute("d",f[k]);if(p<1)anim=requestAnimationFrame(step)};
      step(t0);
    }
    lastSig=sig;
    const svg=box.querySelector("svg"),hit=svg.querySelector(".fc-hit"),hg=svg.querySelector(".fc-hover"),hx=svg.querySelector(".fc-hx"),ha=svg.querySelector(".fc-ha");
    let tip=null;
    const move=e=>{const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*w/r.width,x=Math.max(0,Math.min(ch.X1,(px-ch.pl)/ch.W*ch.X1));
      let best=pts[0];for(const p of pts)if(Math.abs(p.x-x)<Math.abs(best.x-x))best=p;
      const X=ch.sx(best.x),Y=ch.sy(best.a);hg.style.display="";hx.setAttribute("x1",X);hx.setAttribute("x2",X);ha.setAttribute("cx",X);ha.setAttribute("cy",Y);
      if(!tip){tip=document.createElement("div");tip.className="fc-tip";box.append(tip)}
      const mo=Math.round(best.x*12),yy=Math.floor(mo/12),mm=mo%12;
      tip.innerHTML=`<b>${yy} ${yy===1?"rok":yy>=2&&yy<=4?"roky":"let"}${mm?` ${mm} měs.`:""}</b><br><i style="background:var(--fc-green)"></i>${esc(M.sa)}: <b>${fmtKc(best.a)}</b><br><i style="background:var(--fc-area)"></i>${esc(M.sb)}: <b>${fmtKc(best.b)}</b>`;
      tip.style.left=Math.max(90,Math.min(r.width-90,X*r.width/w))+"px";tip.style.top=(Y*r.height/h)+"px"};
    const leave=()=>{hg.style.display="none";if(tip){tip.remove();tip=null}};
    hit.addEventListener("pointermove",move);hit.addEventListener("pointerdown",move);hit.addEventListener("pointerleave",leave);
  }
  function menuHTML(){
    const CL=clientList(),cid=st.clientId||"";
    const cli=opts.clients?`<div class="fc-wm"><h4>Klient</h4><select class="fc-sel" data-x="client" aria-label="Přiřadit ke klientovi"><option value="">— bez klienta —</option>${cid&&!CL.some(c=>c.id===cid)?`<option value="${esc(cid)}" selected>${esc(st.clientName||"klient")}</option>`:""}${CL.map(c=>`<option value="${esc(c.id)}"${c.id===cid?" selected":""}>${esc(c.name)}</option>`).join("")}</select><p class="fc-wnote">Uložená kalkulace úvěru se u klienta objeví ve finančním plánu jako slajd „Plánujeme hypotéku“.</p></div>`:"";
    return `<div class="fc-menu" role="menu">${cli}<h4>Uložené kalkulace</h4>${saved.length?saved.map(s=>`<div class="fc-mi${s.id===st.id?" cur":""}"><button type="button" class="t" data-a="load" data-id="${esc(s.id)}" style="text-align:left"><b>${esc(s.name||"Bez názvu")}</b><small>${esc(MODES[s.mode]?.t||"")}${s.clientName?" · "+esc(s.clientName):""} · ${s.updatedAt?new Date(s.updatedAt).toLocaleDateString("cs-CZ"):""}</small></button><button type="button" class="del" data-a="delsaved" data-id="${esc(s.id)}">Smazat</button></div>`).join(""):`<div class="fc-mi"><span class="t"><small>${store?"Zatím nic uloženého. Kalkulaci uložíš tlačítkem Uložit.":"Ukládání tu není k dispozici."}</small></span></div>`}${wmHTML()}</div>`;
  }
  function wmHTML(){
    const T=[["zfp","ZFP"],["img","Obrázek"],["text","Text"],["none","Žádný"]];
    return `<div class="fc-wm"><h4>Vodoznak v grafu a PDF</h4>
      <div class="fc-wseg" role="group" aria-label="Typ vodoznaku">${T.map(([k,t])=>`<button type="button" data-a="wmt" data-k="${k}" aria-pressed="${wm.t===k}">${t}</button>`).join("")}</div>
      ${wm.t==="img"?`<div class="fc-wimg">${wm.img?`<img src="${wm.img}" alt="Nahraný vodoznak">`:""}<button type="button" data-a="wmpick">${wm.img?"Nahrát jiný obrázek":"Nahrát obrázek (logo)…"}</button></div><p class="fc-wnote">Nejlépe PNG s průhledným pozadím.</p>`:""}
      ${wm.t==="text"?`<label class="fc-wrow"><span>Text</span><input type="text" data-w="txt" maxlength="40" placeholder="např. tvoje jméno" value="${esc(wm.txt)}"></label>`:""}
      ${wm.t!=="none"?`<label class="fc-wrow"><span>Průhlednost</span><input type="range" data-w="op" min="0.05" max="0.8" step="0.01" value="${wm.op}" aria-label="Viditelnost vodoznaku"></label>
      <label class="fc-wrow"><span>Velikost</span><input type="range" data-w="sz" min="0.5" max="2.2" step="0.05" value="${wm.sz}" aria-label="Velikost vodoznaku"></label>`:""}
    </div>`;
  }
  /* --- změny hodnot --- */
  function setField(k,val){const c=cur();if(k===c.calc)return;c.v[k]=val;refresh()}
  function stepField(k,dir){const c=cur(),f=MODES[st.mode].f[k];let v=+c.v[k];if(!isFinite(v))v=0;
    let nv=Math.round((v+dir*f.st)/f.st)*f.st;if(k==="rate")nv=Math.round(nv*100)/100;
    if(k!=="rate")nv=clampF(k,Math.max(k==="years"?1:0,nv));setField(k,nv)}

  root.addEventListener("click",async e=>{
    const b=e.target.closest("[data-a]");
    if(!b){if(e.target.closest(".fc-menu"))return;if(help||menuOpen){help=null;menuOpen=false;draw()}return}
    const a=b.dataset.a,k=b.dataset.k;
    if(a!=="help"&&a!=="menu"&&help){help=null}
    if(a==="mode"){st.mode=k;help=null;draw()}
    else if(a==="flag"){const c=cur();if(st.mode==="loan"&&k==="rate"&&c.v.live){toast("Při aktuální sazbě se sazba nedopočítává");return}if(c.calc!==k){if(!lastRes.ok)c.v[c.calc]=MODES[st.mode].def[c.calc]||0;c.calc=k;draw()}}
    else if(a==="inc"||a==="dec")stepField(k,a==="inc"?1:-1);
    else if(a==="help"){help=help===k?null:k;draw()}
    else if(a==="coll"){minPar=!minPar;draw()}
    else if(a==="ctitle"){const t=prompt("Název grafu",st.titles[st.mode]||MODES[st.mode].chart);if(t!=null){st.titles[st.mode]=t.trim()||undefined;draw()}}
    else if(a==="new"){const keep=st.mode;st=fresh();st.mode=keep;menuOpen=false;draw();toast("Nová kalkulace")}
    else if(a==="menu"){menuOpen=!menuOpen;draw()}
    else if(a==="wmt"){wm.t=k;saveWm();draw();if(k==="img"&&!wm.img)pickWm()}
    else if(a==="wmpick")pickWm();
    else if(a==="save")save();
    else if(a==="pdf")pdf();
    else if(a==="load"){const s=saved.find(x=>x.id===b.dataset.id);if(s){const f=fresh();st={...f,...JSON.parse(JSON.stringify(s.state||{})),id:s.id,name:s.name,clientId:s.clientId||"",clientName:s.clientName||""};ORDER.forEach(m=>{if(!st.m[m])st.m[m]=f.m[m]});fill(st);menuOpen=false;draw();toast("Načteno: "+(s.name||"kalkulace"))}}
    else if(a==="delsaved"){const s=saved.find(x=>x.id===b.dataset.id);if(s&&confirm(`Smazat uloženou kalkulaci „${s.name||"Bez názvu"}“?`)){await store.doc("fincalc/"+s.id).delete();if(st.id===s.id){st.id=null;st.name=""}draw()}}
  });
  /* výběr souboru musí běžet přímo z kliknutí (iPhone) */
  function pickWm(){const inp=document.createElement("input");inp.type="file";inp.accept="image/*";inp.style.display="none";root.append(inp);
    inp.addEventListener("change",async()=>{const f=inp.files&&inp.files[0];inp.remove();if(!f)return;
      try{Object.assign(wm,await readWmImage(f),{t:"img"});saveWm();draw();toast("Vodoznak nahrán")}catch(err){toast("Obrázek se nepodařilo načíst")}});
    inp.click()}
  root.addEventListener("input",e=>{const t=e.target;if(!t.dataset||!t.dataset.w)return;const k=t.dataset.w;wm[k]=k==="txt"?t.value:+t.value;ls.set("fc_wm_v1",wm);if(lastRes&&lastRes.ok)drawChart()});
  root.addEventListener("change",e=>{
    const t=e.target;
    if(t.dataset&&t.dataset.w){saveWm();return}
    if(t.matches("select[data-a=freq]")){cur().v.freq=t.value;refresh();return}
    if(t.dataset&&t.dataset.x==="client"){st.clientId=t.value;st.clientName=t.value?(clientList().find(c=>c.id===t.value)||{}).name||st.clientName:"";persist();draw();return}
    if(t.dataset&&t.dataset.x){const c=cur(),x=t.dataset.x;
      if(x==="live"){c.v.live=t.checked;if(t.checked&&c.calc==="rate")c.calc="pmt";if(!t.checked)c.v.rate=lastRes&&isFinite(lastRes.v.rate)?lastRes.v.rate:c.v.rate}
      else if(x==="fix")c.v.fix=+t.value;else c.v[x]=t.value;
      draw();return}
    if(t.matches("input[data-k]")){const k=t.dataset.k,v=parseNum(t.value);if(isFinite(v))setField(k,clampF(k,v));t.value=fieldVal(k,cur().v[k])}
  });
  const clampF=(k,v)=>k==="years"?Math.max(1/12,v):k==="rate"?v:k==="dsti"?Math.min(100,Math.max(1,v)):k==="dti"?Math.max(0.5,v):Math.max(0,v);
  root.addEventListener("input",e=>{const t=e.target;if(!t.matches("input[data-k]"))return;const k=t.dataset.k,v=parseNum(t.value);if(isFinite(v))setField(k,clampF(k,v))});
  root.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("input[data-k]"))e.target.blur();if(e.key==="Escape"&&(help||menuOpen)){help=null;menuOpen=false;draw()}});
  root.addEventListener("focusin",e=>{const t=e.target;if(t.matches("input[data-k]")){const k=t.dataset.k,v=cur().v[k];t.value=k==="rate"||k==="dsti"?(isFinite(v)?nf2.format(v):""):fieldVal(k,v);try{t.select()}catch(_){}}});

  async function save(){
    if(!store){toast("Ukládání tu není k dispozici");return}
    const name=prompt("Název kalkulace (např. jméno klienta)",st.name||st.clientName||"");if(name==null)return;
    const nm=name.trim()||"Bez názvu";const state=JSON.parse(JSON.stringify({mode:st.mode,titles:st.titles,m:st.m}));
    const doc={name:nm,mode:st.mode,state,clientId:st.clientId||"",clientName:st.clientName||"",updatedAt:Date.now()};
    /* úvěr přiřazený ke klientovi: hotová čísla pro slajd ve finančním plánu (FP je nepřepočítává z kalkulačky) */
    if(st.mode==="loan"){const h=loanSnap();if(h)doc.hypo=h}
    if(st.id&&saved.some(s=>s.id===st.id))await store.doc("fincalc/"+st.id).set(doc);
    else{const r=await store.collection("fincalc").add(doc);st.id=r.id}
    st.name=nm;draw();toast("Kalkulace uložena");
  }
  function loanSnap(){const r=computeFor("loan");if(!r.ok)return null;const v=r.v,L=loanInfo(v);
    return {price:L.price,own:isFinite(L.own)?L.own:0,ltv:isFinite(L.ltv)?Math.round(L.ltv*100)/100:null,pv:v.pv,pmt:Math.round(v.pmt),years:v.years,rate:v.rate,rpsn:Math.round(rpsn(v)*100)/100,
      fix:v.live?+v.fix:null,live:!!v.live,src:v.live?`${RATES.source||"Swiss Life Hypoindex"} (${periodTxt(RATES.period)})`:"",feeOnce:+v.feeOnce||0,feeMonth:+v.feeMonth||0,other:+v.other||0,dsti:+v.dsti,dti:+v.dti,need:Math.round(L.need)}}
  function pdf(){
    const res=lastRes;if(!res.ok){toast("Nejdřív oprav zadání – "+res.err);return}
    const M=MODES[st.mode],v=res.v,c=cur();
    const pts=series(st.mode,v);
    const ch=chartSVG(pts,{w:900,h:430,c:{a:"#F37520",b:"#e4e6e9",grid:"#e9ebee",txt:"#6b7280",ring:"#fff",wmGray:"#4f5052",wmGray2:"#7d8183",wmOrange:"#F37520",wmOp:.3},labelA:M.sa,labelB:M.sb,wm});
    const params=FIELDS[st.mode].map(k=>[M.f[k].l.replace(/ \((CZK|%|počet let)\)/,""),k==="rate"?fmtPct(v[k]):k==="years"?yrsTxt(v[k]):fmtKc(v[k]),k===c.calc]);
    params.push(["Frekvence připisování úroku",(FREQ.find(f=>f[0]===v.freq)||FREQ[0])[1],false]);
    let notes="";
    if(st.mode==="loan"){const L=loanInfo(v),pc=x=>nf2.format(x).replace(/,00$/,"");
      if(v.live&&res.lr)params.splice(params.findIndex(p=>p[0].startsWith("Úroková sazba"))+1,0,["Zdroj sazby",`${RATES.source||"Swiss Life Hypoindex"} (${periodTxt(RATES.period)}), fixace ${v.fix} ${v.fix===1?"rok":v.fix<5?"roky":"let"}, LTV ${res.lr.band}`,false]);
      if(L.price>0)params.unshift(["Cena nemovitosti",fmtKc(L.price),false],["Vlastní zdroje (akontace)",fmtKc(L.own),false],["LTV",`${fmtPct(L.ltv)} (limit ${L.limit} %)`,false]);
      params.splice(params.findIndex(p=>p[0].startsWith("Úroková sazba"))+1,0,["RPSN",`${fmtPct(rpsn(v))} (poplatky ${fmtKc(+v.feeOnce||0)} jednorázově, ${fmtKc(+v.feeMonth||0)} měsíčně)`,false]);
      params.push(["Ostatní splátky domácnosti",fmtKc(+v.other||0),false],["Limit DSTI / DTI",`${pc(v.dsti)} % / ${pc(v.dti)}×`,false],["Potřebný čistý příjem domácnosti / měs.",fmtKc(L.need),false]);
      notes=L.warn.map(w=>`<p class="w">${esc(w)}</p>`).join("")}
    const d=new Date().toLocaleDateString("cs-CZ");
    const html=`<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${esc(M.t)} – ${esc(st.name||"Koncept")} – ${d}</title><style>
      @page{size:A4;margin:14mm}body{font:13px/1.45 Roboto,Arial,Helvetica,sans-serif;color:#111111;margin:0;padding:24px}
      .hd{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #F37520;padding-bottom:12px;margin-bottom:18px}
      .hd h1{font-size:20px;margin:0}.hd small{color:#6b7280}
      .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 20px}.t{background:#f0f2f5;border-radius:8px;padding:10px 14px}.t .k{font-size:12px}.t .v{font-size:17px;font-weight:700}
      table{border-collapse:collapse;width:100%;margin-bottom:6px}td{padding:7px 4px;border-bottom:1px solid #e5e7eb}td:last-child{text-align:right;font-weight:600}tr.c td{color:#F37520}
      h2{font-size:16px;margin:18px 0 8px}.leg{display:flex;gap:22px;font-size:12px;color:#6b7280;margin-top:6px}.leg i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px}
      .w{border:1px solid #F37520;border-radius:6px;padding:8px 10px;margin:8px 0}.ft{margin-top:18px;font-size:11px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:8px}
      @media print{body{padding:0}}</style></head><body>
      <div class="hd"><div><h1>Finanční matematika – ${esc(M.t)}</h1><small>${esc(st.name||"Koncept")} · ${d}</small></div><svg width="133" height="74" viewBox="0 0 ${LOGO_W} ${LOGO_H}">${zfpLogo()}</svg></div>
      <div class="tiles">${M.tiles(v).map(([k,x])=>`<div class="t"><div class="k">${esc(k)}</div><div class="v">${esc(x)}</div></div>`).join("")}</div>
      <h2>Parametry</h2><table>${params.map(([k,x,isC])=>`<tr${isC?' class="c"':""}><td>${esc(k)}${isC?" (dopočteno)":""}</td><td>${esc(x)}</td></tr>`).join("")}</table>
      ${notes}<h2>${esc(st.titles[st.mode]||M.chart)}</h2>${ch.svg}
      <div class="leg"><span><i style="background:#F37520"></i>${esc(M.sa)}</span><span><i style="background:#d9dce0"></i>${esc(M.sb)}</span></div>
      <div class="ft">Výpočet je orientační a slouží pouze pro informaci. ${st.mode==="loan"?"Skutečné splátky závisí na podmínkách věřitele; potřebný příjem je odhad podle zadaných limitů DSTI/DTI, každá banka posuzuje bonitu vlastní metodikou.":"Výnosy nejsou zaručeny, hodnota investice může kolísat."} Vklady, splátky a výplaty se počítají na konci každého měsíce. © ZFP Consulting</div>
      <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`;
    const w=window.open("","_blank");if(!w){toast("Prohlížeč zablokoval nové okno – povol vyskakovací okna");return}
    w.document.open();w.document.write(html);w.document.close();
  }
  /* graf závisí jen na šířce – změna výšky (např. delší panel parametrů u úvěru) ho nepřekresluje, jinak by utnula animaci */
  let rT=null,rW=0;const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(en=>{const w=Math.round(en[0].contentRect.width);if(w===rW)return;rW=w;clearTimeout(rT);rT=setTimeout(()=>{if(lastRes)drawChart()},120)}):null;
  if(ro)ro.observe(root);
  draw();
  return{redraw:draw,state:()=>st};
}

window.FinCalc={mount,math:{iMonth,valueAt,solve,series,totals,FIELDS,loanInfo,liveRate,periodAge,ltvLimit,rpsn},rates:()=>RATES,fmt:{fmtKc,yrsTxt,parseNum},logo:{svg:zfpLogo,w:LOGO_W,h:LOGO_H}};
})();
