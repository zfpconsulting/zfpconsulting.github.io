/* Finanční matematika – kalkulačka Úvěr / Investice / Renta (vzhled podle kalkulačky ZFP, s vodoznakem ZFP Consulting).
   Samostatný modul: FinCalc.mount(kontejner, {store, toast, ls, clients, ensure, fpProd}) · čistá matematika ve FinCalc.math (testy: tests/fincalc.run.mjs).
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
/* renta se změnami v čase: v.zmeny = [{po: roky od začátku výplaty, renta: nová měsíční renta}] – od měsíce po*12+1 se vyplácí nová částka */
const zmenyOf=v=>(Array.isArray(v.zmeny)?v.zmeny:[]).map(z=>({m:Math.round((+z.po||0)*12),r:+z.renta})).filter(z=>z.m>0&&isFinite(z.r)&&z.r>=0).sort((a,b)=>a.m-b.m);
/* úseky výplaty do n měsíců: [{od, do, r}] */
function rentaSeg(v,n){const Z=zmenyOf(v),out=[];let od=0,r=+v.pmt||0;
  for(const z of Z){if(z.m>=n)break;if(z.m>od){out.push({od,do:z.m,r});od=z.m}r=z.r}
  out.push({od,do:n,r});return out}
const paidTo=(v,n)=>rentaSeg(v,n).reduce((s,x)=>s+x.r*(x.do-x.od),0);
/* vstupní poplatek investice (podíl 0–1): strhává se z každého vkladu, jako ve FP */
const feeOf=v=>v&&v.feeOn?Math.min(0.99,Math.max(0,(+v.fee||0)/100)):0;
/* zůstatek / hodnota po n měsících */
const valueAt=(mode,v,n)=>{const i=iMonth(v.rate,v.freq),g=grow(i,n),a=ann(i,n);
  if(mode==="renta"&&zmenyOf(v).length)return v.pv*g-rentaSeg(v,n).reduce((s,x)=>s+x.r*ann(i,x.do-x.od)*grow(i,n-x.do),0);
  return mode==="inv"?(v.pv*g+v.pmt*a)*(1-feeOf(v)):v.pv*g-v.pmt*a};
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
    pts.push({x:k/12,a:mode==="loan"?Math.max(0,b):b,b:mode==="inv"?v.pv+v.pmt*k:mode==="renta"?paidTo(v,k):v.pmt*k})}
  return pts;
}
function totals(mode,v){const n=v.years*12;
  if(mode==="inv"){const d=v.pv+v.pmt*n;return{deposited:d,fee:d*feeOf(v),final:v.fv,gain:v.fv-d}}
  if(mode==="loan")return{paid:v.pmt*n,interest:v.pmt*n-v.pv};
  return{paid:paidTo(v,n),rest:v.fv};
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
/* „po 5 letech“ → „6. roku“ (měsíc po*12+1) */
const zmTxt=m=>m%12===0?(m/12+1)+". roku":yrsTxt(m/12)+" od začátku";
const fmtYearsIn=y=>{if(!isFinite(y))return"";const r=Math.round(y*100)/100;return Number.isInteger(r)?String(r):nf2.format(r)};
const parseNum=s=>{const t=String(s??"").replace(/[\s ]/g,"").replace(/Kč|%|let|roky|rok|roku/gi,"").replace(",",".");if(t==="")return NaN;return +t};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ================= zhodnocení dle finančního plánu =================
   Zrcadlí výpočet ve FP (fp.html → FPE): alokace akcie/dluhopisy/hotovost podle horizontu (tabulka „Pro dosažení cíle“,
   mezi body lineární interpolace), výnos složky = průměr čistých výnosů produktů ve složce (výchozí produkty z Pipeline → settings.fpProd),
   hotovost = spořicí účet 2 % nominálně; reálně = nominálně − inflace 3 %. Renta (čerpání) = reálný výnos při čerpání 4,5 % jako ve FP.
   Při změně čísel ve FPE (DEFAULT_SET, PRODUKTY, ALOK) uprav i tady. Složené roční úročení (FP počítá (1+r)^(1/12)). */
const FP_ALOK={0:[0,0,100],5:[29,62,9],10:[54,43,3],15:[74,24,2],20:[85,13,2],25:[90,8,2],30:[93,7,0]};
const FP_SET={inflace:0.03,hotovost_nom:0.02,renta_r:0.045};
/* čistý výnos p.a. (výnos − správa) produktů FP */
const FP_NET=(()=>{const o={cq_akc:.10,cq_dip:.10,cq_dluh:.048,zfpi:.0515,wi_rez:.035-.005,wi_konz:.06-.0199,wi_dluh:.05-.0099,wi_vyv:.075-.0199,wi_dyn:.09-.0199,premium:.07,zfpf:.08,auv:.05};
  ["sp500","svetove","evropa","rozvojove","dividendove","technologicke","zdravotnictvi","ziva","px","blockchain"].forEach(k=>o["wi_"+k]=.10-.0199);return o})();
const FP_DEF_MIX={mixA:[{k:"cq_akc",w:100}],mixD:[{k:"zfpi",w:50},{k:"cq_dluh",w:50}]};
function fpAlok(y){y=Math.max(0,Math.min(30,+y||0));const k=Object.keys(FP_ALOK).map(Number);
  for(let i=0;i<k.length-1;i++){const a=k[i],b=k[i+1];if(y>=a&&y<=b){const t=(y-a)/(b-a),A=Math.round(FP_ALOK[a][0]+t*(FP_ALOK[b][0]-FP_ALOK[a][0])),D=Math.round(FP_ALOK[a][1]+t*(FP_ALOK[b][1]-FP_ALOK[a][1]));return[A,D,100-A-D]}}
  return FP_ALOK[30]}
/* průměrný čistý výnos složky z mixu [{k,w}]; neznámé produkty (modelová portfolia) se přeskočí, prázdný mix → výchozí produkty */
function fpClassR(mix,def){const L=(Array.isArray(mix)?mix:[]).filter(x=>FP_NET[x.k]!=null&&+x.w>0),use=L.length?L:def;
  const t=use.reduce((s,x)=>s+(+x.w),0);return use.reduce((s,x)=>s+FP_NET[x.k]*(+x.w),0)/t}
/* zhodnocení p.a. v % podle FP: mode "inv" = podle horizontu (let), "renta" = výnos při čerpání; real = v dnešních cenách */
function fpRate(mode,years,real,prod){
  const S=FP_SET;
  if(mode==="renta"){const r=S.renta_r;return{rate:(real?r:r+S.inflace)*100,nom:(r+S.inflace)*100,real:r*100,alok:null}}
  const a=fpAlok(years),rA=fpClassR(prod&&prod.mixA,FP_DEF_MIX.mixA),rD=fpClassR(prod&&prod.mixD,FP_DEF_MIX.mixD);
  const nom=(a[0]*rA+a[1]*rD+a[2]*S.hotovost_nom)/100,rl=nom-S.inflace;
  return{rate:(real?rl:nom)*100,nom:nom*100,real:rl*100,alok:a,rA:rA*100,rD:rD*100}}

const zhLbl=v=>"Zhodnocení p.a."+(v.fp?(v.fpReal!==false?" (dle FP, reálně)":" (dle FP)"):"");

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
  inv:{t:"Investice",chart:"Vývoj hodnoty investice",sa:"Hodnota investice",sb:"Vloženo celkem",def:{pv:100000,pmt:5000,fv:0,years:20,rate:6,freq:"m",fp:false,fpReal:true,feeOn:false,fee:3},calc:"fv",
    f:{pv:{l:"Jednorázový vklad (CZK)",st:10000,h:"Částka, kterou vložíte hned na začátku."},
       pmt:{l:"Pravidelná měsíční investice (CZK)",st:500,h:"Částka, kterou investujete na konci každého měsíce."},
       fv:{l:"Konečná hodnota investice (CZK)",st:10000,h:"Hodnota investice na konci doby investování."},
       years:{l:"Splatnost (počet let)",st:1,h:"Jak dlouho se bude investovat."},
       rate:{l:"Zhodnocení p.a. (%)",st:0.25,h:"Očekávané průměrné roční zhodnocení. Minulé výnosy nejsou zárukou budoucích."},
       fee:{l:"Vstupní poplatek (%)",st:0.5,h:"Strhává se z každého vkladu (jednorázového i pravidelného) – do investice jde vklad bez poplatku. Výchozí 3 % jako ve finančním plánu."}},
    tiles:v=>{const t=totals("inv",v);return[["Jednorázový vklad",fmtKc(v.pv)],["Pravidelná měs. inv.",fmtKc(v.pmt)],[zhLbl(v),fmtPct(v.rate)],["Splatnost",yrsTxt(v.years)],
      v.feeOn?[`Celkem vložíte (z toho poplatek ${fmtPct(+v.fee||0)} = ${fmtKc(t.fee).replace(/\s/g,"\u00a0")})`,fmtKc(t.deposited)]:["Celkem vložíte",fmtKc(t.deposited)],["Konečná hodnota inv.",fmtKc(t.final)]]},
    help:"Graf ukazuje, jak roste hodnota investice oproti penězům, které do ní celkem vložíte. Rozdíl mezi křivkami je výnos."},
  renta:{t:"Renta",chart:"Vývoj hodnoty kapitálu",sa:"Hodnota kapitálu",sb:"Vyplaceno celkem",def:{pv:3000000,pmt:15000,years:20,rate:4,fv:0,freq:"m",fp:false,fpReal:true},calc:"pmt",
    f:{pv:{l:"Naspořená částka (CZK)",st:50000,h:"Kapitál na začátku výplaty renty."},
       pmt:{l:"Měsíční renta (CZK)",st:500,h:"Částka vyplácená na konci každého měsíce."},
       years:{l:"Doba výplaty (počet let)",st:1,h:"Jak dlouho se bude renta vyplácet."},
       rate:{l:"Zhodnocení p.a. (%)",st:0.25,h:"Očekávané průměrné roční zhodnocení kapitálu během výplaty."},
       fv:{l:"Zůstatek na konci (CZK)",st:50000,h:"Kolik má z kapitálu zůstat po poslední výplatě (0 = renta kapitál vyčerpá)."}},
    tiles:v=>{const t=totals("renta",v),Z=zmenyOf(v).filter(z=>z.m<v.years*12);return[["Naspořená částka",fmtKc(v.pv)],[Z.length?"Měsíční renta na začátku":"Měsíční renta",fmtKc(v.pmt)],...Z.map(z=>["Renta od "+zmTxt(z.m),fmtKc(z.r)]),[zhLbl(v),fmtPct(v.rate)],["Doba výplaty",yrsTxt(v.years)],["Celkem vyplaceno",fmtKc(t.paid)],["Zůstatek na konci",fmtKc(t.rest)]]},
    help:"Graf ukazuje, jak se kapitál postupně čerpá rentou, a kolik už bylo celkem vyplaceno. Změny renty v čase (např. nižší renta po přiznání státního důchodu) se přidávají v Parametrech."}
};
const ORDER=["loan","inv","renta"];

/* ================= grafika ================= */
/* ikony: liniové SVG z appky (window.ICON z index.html), vlastní jen vlajka, nápověda, tužka a sbalení; záloha pro samostatné testy */
const ICL={
  flag:'<path d="M5.5 21V4"/><path class="fl" d="M5.5 4.5h12l-2.6 4.2 2.6 4.3h-12z"/>',
  help:'<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.1"/>',
  pen:'<path d="M15.5 4.5l4 4L8.5 19.5l-5 1 1-5z"/><path d="M13.5 6.5l4 4"/>',
  dbl:'<path d="M11.5 6l-6 6 6 6M18.5 6l-6 6 6 6"/>',
  more:'<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>'
};
const APPI=()=>typeof ICON==="object"&&ICON?ICON:{};   /* const ICON z index.html není vlastností window – čte se jako globální jméno */
const ico=n=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+(["flag","help","pen","dbl","search"].includes(n)?ICL[n]:(APPI()[n]||ICL[n]||""))+'</svg>';
/* jediné potvrzení appky (confirmSheet z index.html); v samostatných testech modulu záloha přes window.confirm */
const ask_=(t,o)=>typeof window.confirmSheet==="function"?window.confirmSheet(t,o):Promise.resolve(window.confirm(t));
/* logo ZFP Consulting (vodoznak i hlavička) – proporce podle oficiálního loga: „ZFP“ tmavě šedé, vlajka s vykrojenou
   špičkou vyšší než písmena, „CONSULTING“ světleji šedé přes celou šířku; textLength drží přesné šířky v každém písmu */
function zfpLogo({x=0,y=0,s=1,gray="#4f5052",gray2="#7d8183",orange="#E8571A",op=1}={}){
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
/* jen rozvržení – barvy, písmo, tlačítka, pole, přepínače a dlaždice jsou globální komponenty z index.html (.card .btn .seg .field .switch .tile …) */
const CSS=`
.fc{overflow:visible;margin-bottom:var(--sp-5);font-variant-numeric:tabular-nums}
.fc-wrapH{position:relative}
.fc-top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--sp-2) var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line);container-type:inline-size}
.fc-cs{position:relative;flex:1 1 260px;min-width:0;max-width:440px}
.fc-lbl{display:block;font-size:var(--fs-s);color:var(--ink-2);margin:0 0 var(--sp-1)}
.fc-cur{font-size:var(--fs-xs);color:var(--ink-2);margin:var(--sp-1) 0 0;min-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fc-cur b{color:var(--accent-text);font-weight:600}
.fc-acts{display:flex;align-items:center;gap:var(--sp-2);margin-left:auto;padding-bottom:20px}
/* vyskakovací seznamy a menu = .group s řádky; modul jen umisťuje */
.fc-pop{position:absolute;z-index:30;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);box-shadow:var(--shadow-pop);overflow:auto}
.fc-csw{position:relative}
.fc-cl{left:0;right:0;top:calc(100% + 4px);max-height:320px}
.fc-cl .row-btn.on{background:var(--fill)}
.fc-cl .row .end{font-size:var(--fs-s);color:var(--accent-text);font-weight:600}
.fc-menu{right:var(--sp-3);top:calc(100% - 6px);width:320px;max-width:calc(100vw - 32px);max-height:70vh;padding:var(--sp-3) 0 var(--sp-2)}
.fc-menu .section-head{margin:0 var(--sp-4) var(--sp-2)}
.fc-menu .group{border:0;border-radius:0;border-block:1px solid var(--line)}
.fc-mi.cur .t{color:var(--accent-text)}
.fc-mi .main .t,.fc-mi .main .s{display:block}
.fc-wm{padding:var(--sp-4) var(--sp-4) var(--sp-2);display:grid;gap:var(--sp-3)}
.fc-wm .section-head{margin:0}
.fc-wrow{display:flex;align-items:center;gap:var(--sp-3);font-size:var(--fs-s);color:var(--ink-2)}
.fc-wrow>span{width:84px;flex:none}
.fc-wrow input[type=range]{flex:1;min-width:0;accent-color:var(--accent)}
.fc-wimg{display:flex;align-items:center;gap:var(--sp-3)}
.fc-wimg img{width:56px;height:40px;object-fit:contain;background:var(--fill);border-radius:var(--r-s)}
.fc-ask{right:var(--sp-3);top:calc(100% - 6px);width:360px;max-width:calc(100vw - 32px);padding:var(--sp-4);display:grid;gap:var(--sp-3)}
.fc-ask p{margin:0;font-size:var(--fs-m);line-height:1.4}
.fc-ask div{display:flex;flex-wrap:wrap;gap:var(--sp-2);justify-content:flex-end}
.fc-modes{padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--line)}
.fc-mi .main{text-align:left;min-height:40px;display:flex;flex-direction:column;justify-content:center}
.fc-body{display:grid;grid-template-columns:320px minmax(0,1fr);min-height:560px}
.fc-par{padding:var(--sp-4);border-right:1px solid var(--line);min-width:0}
.fc-par.min{width:auto}
.fc-body.min{grid-template-columns:64px minmax(0,1fr)}
.fc-par.min .fc-pin,.fc-par.min .fc-ph h3{display:none}
.fc-ph{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-2);margin-bottom:var(--sp-3)}
.fc-ph h3{margin:0;font-size:var(--fs-l);font-weight:600}
.fc-par.min .fc-coll .ico{transform:rotate(180deg)}
.fc-f{margin-bottom:var(--sp-3)}
.fc-fl{display:flex;align-items:center;gap:var(--sp-1);font-size:var(--fs-s);color:var(--ink-2);margin-bottom:var(--sp-1);position:relative;min-height:36px}
.fc-fl>span:not(.fc-flag){flex:1;min-width:0}
.fc-flag{color:var(--ink-3)}
.fc-flag[aria-pressed="true"]{color:var(--accent)}
.fc-flag[aria-pressed="true"] .fl{fill:currentColor}
.fc-flag.none{visibility:hidden}
.fc-hp{position:absolute;left:0;top:100%;margin-top:2px;z-index:5;background:var(--ink);color:var(--canvas);font-size:var(--fs-s);line-height:1.4;padding:var(--sp-2) var(--sp-3);border-radius:var(--r-s);max-width:280px;box-shadow:var(--shadow-pop)}
/* krokovací pole = .field s tlačítky −/+ */
.fc-in.field{display:flex;align-items:center;padding:0 4px}
.fc-in input{flex:1;min-width:0;border:0;background:transparent;text-align:center;font:inherit;font-size:16px;color:var(--ink);outline:none;height:calc(var(--h-m) - 2px);font-variant-numeric:tabular-nums}
.fc-in .icon-btn{font-size:20px;line-height:1}
.fc-f.calc .fc-in,.fc-f.lock .fc-in{background:var(--fill);border-color:transparent}
.fc-f.calc .fc-in input{font-weight:600;color:var(--accent-text);-webkit-text-fill-color:var(--accent-text);opacity:1}
.fc-f.lock .fc-in input{color:var(--ink-2);-webkit-text-fill-color:var(--ink-2);opacity:1}
.fc-f.err .fc-in{border-color:var(--accent)}
.fc-errm{color:var(--accent-text);font-size:var(--fs-s);line-height:1.4;margin:var(--sp-1) 0 0}
.fc-sw{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3);font-size:var(--fs-m);font-weight:500;cursor:pointer;min-height:var(--h-m)}
.fc-src{margin-top:var(--sp-2)}
.fc-src a{color:inherit}
.fc-live select{margin-top:var(--sp-1)}
.fc-par .section-head{margin:var(--sp-5) 0 var(--sp-2);padding-top:var(--sp-3);border-top:1px solid var(--line)}
.fc-zm{display:grid;grid-template-columns:1fr 1.4fr auto;gap:var(--sp-2);align-items:end;margin-bottom:var(--sp-2)}
.fc-zm label{display:grid;gap:var(--sp-1);font-size:var(--fs-xs);color:var(--ink-2);min-width:0}
.fc-zm .icon-btn{margin-bottom:4px}
.fc-note{font-size:var(--fs-s);line-height:1.45;color:var(--ink-2);margin:var(--sp-3) 0 0;padding:var(--sp-2) var(--sp-3);background:var(--fill);border-radius:var(--r-s)}
.fc-note b{color:var(--ink)}
.fc-note.warn{background:var(--accent-soft);color:var(--ink)}
.fc-main{min-width:0;padding:var(--sp-5) var(--sp-5) var(--sp-5);container-type:inline-size}
.fc-main .tiles{margin-bottom:var(--sp-5)}
.fc .tile .v{font-size:var(--fs-xl);white-space:nowrap}
@container (min-width:700px){.fc-main .tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
.fc-ch{display:flex;align-items:center;gap:var(--sp-1);margin-bottom:var(--sp-2);position:relative}
.fc-ch h2{margin:0 var(--sp-1) 0 0;font-size:var(--fs-l);font-weight:600;min-width:0}
.fc-chart{position:relative}
.fc-tip{position:absolute;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--line);font-size:var(--fs-s);padding:var(--sp-2) var(--sp-3);border-radius:var(--r-s);white-space:nowrap;box-shadow:var(--shadow-pop);transform:translate(-50%,calc(-100% - 12px));line-height:1.5;z-index:3}
.fc-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:0}
.fc-dot.a{background:var(--accent)}.fc-dot.b{background:var(--line);box-shadow:inset 0 0 0 1px var(--ink-3)}
.fc-leg{display:flex;flex-wrap:wrap;gap:var(--sp-5);padding-left:40px;margin-top:var(--sp-3);font-size:var(--fs-s);color:var(--ink-2)}
@media (max-width:860px){
  .fc-top{padding:var(--sp-3) var(--sp-4)}
  .fc-cs{flex-basis:100%;max-width:none}
  .fc-acts{width:100%;margin:0;padding:0}
  .fc-acts .btn{flex:1 1 auto;padding:0 var(--sp-2)}
  .fc-long{display:none}
  .fc-body,.fc-body.min{grid-template-columns:minmax(0,1fr);min-height:0}
  .fc-par,.fc-par.min{border-right:0;border-bottom:1px solid var(--line)}
  .fc-par.min .fc-ph h3{display:block}
  .fc-modes .seg{display:grid;width:100%}
  .fc-coll .ico{transform:rotate(90deg)}
  .fc-par.min .fc-coll .ico{transform:rotate(-90deg)}
  .fc-par.min .fc-ph{margin-bottom:var(--sp-3)}
  .fc-main{padding:var(--sp-4)}
  .fc-main .tiles{margin-inline:calc(-1 * var(--sp-4));padding-inline:var(--sp-4)}
  .fc-main .tiles>.tile{width:auto;min-width:136px;max-width:220px}
  .fc .tile .v{font-size:var(--fs-l)}
  .fc-leg{padding-left:0;justify-content:center}
}`;

/* ================= UI ================= */
function mount(root,opts={}){
  if(!document.getElementById("fcCss")){const st=document.createElement("style");st.id="fcCss";st.textContent=CSS;document.head.append(st)}
  const store=opts.store||null,toast=opts.toast||(m=>console.log(m));
  const LS="fc_draft_v1";
  const fresh=()=>({id:null,name:"",clientId:"",clientName:"",base:"",mode:"inv",titles:{},m:Object.fromEntries(ORDER.map(k=>[k,{v:{...MODES[k].def,...(k==="renta"?{zmeny:[]}:{})},calc:MODES[k].calc}]))});
  /* úložiště rozpracované kalkulace – Pipeline předává svoje (odděluje prezentační/čistý režim a maže se při odhlášení) */
  const ls=opts.ls||{get:k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  let st=ls.get(LS);
  if(!st||!st.m||!ORDER.every(k=>st.m[k]))st=fresh();
  /* starší uložené kalkulace nemají nová pole úvěru (cena nemovitosti, bonita…) – doplnit výchozí */
  const fill=s=>{ORDER.forEach(k=>{s.m[k].v={...MODES[k].def,...s.m[k].v};const v=s.m[k].v;if(k!=="loan"&&v.fp&&!v.fq2)v.freq="y";v.fq2=1;if(k==="loan")v.freq="m"});/* dřív se při FP vždy úročilo ročně – uložené kalkulace dostanou roční úročení, dál jde změnit */const r=s.m.renta.v;r.zmeny=Array.isArray(r.zmeny)?r.zmeny.map(z=>({po:+z.po||0,renta:+z.renta||0})):[];return s};
  fill(st);
  /* starší rozpracovaná kalkulace bez st.base: uložená = čistá, jinak se při „Nová kalkulace“ zeptá */
  if(st.base===undefined)st.base=st.id?"":"?";
  /* aktuální sazby hypoték (sazby.json vedle appky); když se nenačtou, zůstane záloha v kódu */
  if(opts.rates)RATES=opts.rates;
  else if(typeof fetch==="function")fetch(opts.ratesUrl||"sazby.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.fix){RATES=j;if(st.mode==="loan"&&cur().v.live)refresh()}}).catch(()=>{});
  let saved=[],help=null,menuOpen=false,minPar=false,lastRes=null,ask=false,csHi=0;
  const persist=()=>ls.set(LS,st);
  /* vodoznak: sdílí se mezi zařízeními přes úložiště Pipeline (fcprefs/main), jinak jen v tomto zařízení */
  let wm={...WM_DEF,...(ls.get("fc_wm_v1")||{})};
  const wmDoc=store&&store.doc?store.doc("fcprefs/main"):null;
  const saveWm=()=>{ls.set("fc_wm_v1",wm);if(wmDoc)wmDoc.set({wm}).catch(()=>{})};
  if(wmDoc&&wmDoc.onSnapshot)wmDoc.onSnapshot(d=>{const n=d.exists&&d.data()&&d.data().wm;if(n&&JSON.stringify(n)!==JSON.stringify(wm)){wm={...WM_DEF,...n};ls.set("fc_wm_v1",wm);if(menuOpen&&!root.querySelector(".fc-menu").contains(document.activeElement))draw();else if(lastRes)drawChart()}});
  if(store)store.collection("fincalc").onSnapshot(s=>{saved=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));if(menuOpen)draw();else{const b=root.querySelector("#fc_cl");if(b&&!b.hidden)csList()}});

  const cur=()=>st.m[st.mode];
  /* výchozí produkty FP z Pipeline (settings.fpProd: mixA / mixD) – kvůli výnosu akciové a dluhopisové složky */
  const fpProd=()=>{try{return typeof opts.fpProd==="function"?opts.fpProd():opts.fpProd||null}catch(e){return null}};
  const fpOn=mode=>mode!=="loan"&&!!st.m[mode].v.fp;
  /* klienti a leady z Pipeline pro přiřazení kalkulace (opts.clients = funkce → položky jako u Důchodové kalkulačky:
     {id,name,rec?,lead?,leadOnly?,prospect?}); klíč = id klienta, lead bez klienta „lead_<id>“ – stejně jako duchod.js */
  const clientList=()=>{try{return typeof opts.clients==="function"?(opts.clients()||[]).slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"","cs")):[]}catch(e){return[]}};
  const keyOf=e=>e.rec?e.rec.id:e.leadOnly&&e.lead?"lead_"+e.lead.id:e.id;
  const keysOf=e=>{const k=[keyOf(e)];if(e.lead&&e.lead.id&&!e.leadOnly)k.push("lead_"+e.lead.id);if(e.rec&&e.rec.leadId)k.push("lead_"+e.rec.leadId);return k};
  const entryOf=id=>id?clientList().find(e=>keysOf(e).includes(id)):null;
  const fold=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  /* neuložená změna: podpis zadání vs. stav po posledním uložení / načtení / nové kalkulaci (st.base) */
  const sig=()=>JSON.stringify({m:st.m,t:st.titles,c:st.clientId||""});
  const dirty=()=>st.base!==sig();
  function compute(){lastRes=computeFor(st.mode);if(st.base===""||st.base==null)st.base=sig();return lastRes}
  function computeFor(mode){
    const M=MODES[mode],c=st.m[mode],v={...c.v};
    if(mode==="loan")v.freq=c.v.freq="m"; /* úvěr: úrok se připisuje vždy měsíčně */
    const live=mode==="loan"&&v.live,fp=fpOn(mode);
    if(live&&c.calc==="rate")c.calc="pmt";
    if(fp){if(c.calc==="rate")c.calc=mode==="inv"?"fv":"pmt"}
    let r,lr=null,fr=null;
    /* zhodnocení dle FP: sazba závisí na době investice – při dopočtu doby se iteruje, dokud se doba neustálí */
    if(fp){const real=v.fpReal!==false,P=fpProd();
      for(let it=0;it<30;it++){fr=fpRate(mode,v.years,real,P);v.rate=fr.rate;c.v.rate=fr.rate;
        r=solve(mode,v,c.calc);if(!r.ok||c.calc!=="years")break;
        const ny=r.val;if(Math.abs(ny-v.years)<1e-6){v.years=ny;break}v.years=ny}
      if(r.ok){v[c.calc]=c.calc==="years"?r.val:Math.round(r.val*100)/100;c.v[c.calc]=v[c.calc]}
      return {ok:r.ok,err:r.err,v,M,lr,fr};
    }
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
  function fieldVal(k,v){if(!isFinite(v))return"";if(k==="rate"||k==="dsti"||k==="fee")return nf2.format(v)+" %";if(k==="dti")return fmtYearsIn(v);if(k==="years")return fmtYearsIn(v);return fmtNum(v)}

  /* jedno číselné pole; pole mimo FIELDS (cena nemovitosti, bonita) nemají vlajku – nedopočítávají se */
  function fieldHTML(k,res){
    const M=MODES[st.mode],c=cur(),solv=FIELDS[st.mode].includes(k),lock=k==="rate"&&(st.mode==="loan"?!!c.v.live:fpOn(st.mode));
    const f=M.f[k],isC=k===c.calc;
    return `<div class="fc-f${isC?" calc":""}${lock?" lock":""}${isC&&!res.ok?" err":""}" data-k="${k}">
            <div class="fc-fl">${solv?`<button type="button" class="icon-btn icon-btn--plain fc-flag" data-a="flag" data-k="${k}" title="${isC?"Tato hodnota se dopočítává":lock?(st.mode==="loan"?"Aktuální sazba se nedopočítává":"Zhodnocení dle FP se nedopočítává"):"Dopočítat tuto hodnotu"}" aria-label="Dopočítat: ${esc(f.l)}" aria-pressed="${isC}"${lock?" disabled":""}>${ico("flag")}</button>`:`<span class="icon-btn icon-btn--plain fc-flag none" aria-hidden="true"></span>`}<span>${esc(f.l)}</span><button type="button" class="icon-btn icon-btn--plain fc-q" data-a="help" data-k="${k}" aria-label="Nápověda" aria-expanded="${help===k}">${ico("help")}</button>${help===k?`<div class="fc-hp" role="note">${esc(f.h)}</div>`:""}</div>
            <div class="field fc-in"><button type="button" class="icon-btn icon-btn--plain" data-a="dec" data-k="${k}" aria-label="Snížit" ${isC||lock?"disabled":""}>−</button><input data-k="${k}" inputmode="decimal" autocomplete="off" aria-label="${esc(f.l)}" value="${isC&&!res.ok?"–":fieldVal(k,c.v[k])}" ${isC||lock?"disabled":""}><button type="button" class="icon-btn icon-btn--plain" data-a="inc" data-k="${k}" aria-label="Zvýšit" ${isC||lock?"disabled":""}>+</button></div></div>`
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
  /* zhodnocení dle finančního plánu – vysvětlivka, odkud sazba je */
  function fpSrc(res){const c=cur();if(!fpOn(st.mode))return"";const fr=res.fr||fpRate(st.mode,c.v.years,c.v.fpReal!==false,fpProd()),real=c.v.fpReal!==false;
    if(st.mode==="renta")return `Výnos při čerpání renty jako ve FP: <b>${fmtPct(real?fr.real:fr.nom)}</b> ${real?`reálně (${fmtPct(fr.nom)} nominálně − inflace ${fmtPct(FP_SET.inflace*100)}). Částky jsou v dnešních cenách.`:`nominálně (${fmtPct(fr.real)} reálně + inflace ${fmtPct(FP_SET.inflace*100)}).`}`;
    const a=fr.alok;
    return `Alokace pro ${yrsTxt(res.v.years)}: akcie ${a[0]} % (${fmtPct(fr.rA)}), dluhopisy ${a[1]} % (${fmtPct(fr.rD)})${a[2]?`, hotovost ${a[2]} % (${fmtPct(FP_SET.hotovost_nom*100)})`:""} → ${real?`${fmtPct(fr.nom)} nominálně − inflace ${fmtPct(FP_SET.inflace*100)} = <b>${fmtPct(fr.real)} reálně</b>. Částky jsou v dnešních cenách (jako cíle ve FP).`:`<b>${fmtPct(fr.nom)} nominálně</b>.`} Úročení: ${((FREQ.find(f=>f[0]===c.v.freq)||FREQ[0])[1]).toLowerCase()}${c.v.freq==="y"?" (jako ve FP)":""}.`}
  function fpHTML(res){const c=cur(),on=!!c.v.fp;
    return `<div class="fc-f fc-live"><label class="fc-sw">Zhodnocení dle finančního plánu<input type="checkbox" class="switch" role="switch" data-x="fp"${on?" checked":""}></label>
      ${on?`<select class="field" data-x="fpReal" aria-label="Reálně nebo nominálně"><option value="1"${c.v.fpReal!==false?" selected":""}>Reálně – v dnešních cenách</option><option value="0"${c.v.fpReal===false?" selected":""}>Nominálně</option></select><p class="hint fc-src fc-fpsrc">${fpSrc(res)}</p>`:""}</div>`}
  /* vstupní poplatek investice – checkbox + nastavitelné % (výchozí 3 %) */
  function feeHTML(res){const c=cur(),on=!!c.v.feeOn;
    return `<div class="fc-f fc-live"><label class="fc-sw">Vstupní poplatek<input type="checkbox" class="switch" role="switch" data-x="feeOn"${on?" checked":""}></label></div>${on?fieldHTML("fee",res):""}`}
  /* renta: změny výše v čase – po kolika letech od začátku výplaty přijde nová měsíční renta (libovolný počet) */
  function zmNotes(){const c=cur(),v=c.v,Z=v.zmeny||[];
    return (Z.some(z=>+z.po>=+v.years)?`<p class="fc-note warn">Změna po skončení výplaty (${yrsTxt(v.years)}) se nepočítá.</p>`:"")+(Z.length&&c.calc==="pmt"?`<p class="fc-note">Dopočítává se renta na začátku; změny platí v zadané výši.</p>`:"")}
  function zmenyHTML(){const v=cur().v,Z=v.zmeny||[];
    return `<h4 class="section-head">Změna renty v čase</h4>${Z.map((z,i)=>`<div class="fc-zm" data-i="${i}">
      <label><span>Po (letech)</span><input class="field" data-z="po" data-i="${i}" inputmode="decimal" autocomplete="off" value="${fmtYearsIn(z.po)}" aria-label="Po kolika letech od začátku"></label>
      <label><span>Nová renta (CZK/měs.)</span><input class="field" data-z="renta" data-i="${i}" inputmode="decimal" autocomplete="off" value="${fmtNum(z.renta)}" aria-label="Nová měsíční renta"></label>
      <button type="button" class="icon-btn icon-btn--plain" data-a="zdel" data-k="${i}" aria-label="Odebrat změnu" title="Odebrat změnu">${ico("x")}</button></div>`).join("")}
      <div class="fc-zn">${zmNotes()}</div>
      <button type="button" class="btn btn--ghost btn--s" data-a="zadd">+ Přidat změnu renty</button>`}
  /* panel Parametry: u úvěru navíc cena nemovitosti, typ (limit LTV), aktuální sazba a bonita */
  function parHTML(res){
    const c=cur();
    const fq=c.v.freq;
    const freq=`<div class="fc-f"><div class="fc-fl"><span>Frekvence připisování úroku</span></div><select class="field" data-a="freq" aria-label="Frekvence připisování úroku">${FREQ.map(([k,t])=>`<option value="${k}"${fq===k?" selected":""}>${t}</option>`).join("")}</select></div>`;
    if(st.mode==="renta")return FIELDS.renta.map(k=>fieldHTML(k,res)).join("")+fpHTML(res)+freq+zmenyHTML();
    if(st.mode!=="loan")return FIELDS[st.mode].map(k=>fieldHTML(k,res)).join("")+fpHTML(res)+feeHTML(res)+freq;
    return fieldHTML("price",res)
      +`<div class="fc-f"><div class="fc-fl"><span>Účel / limit LTV</span></div><select class="field" data-x="ltvType" aria-label="Účel úvěru">${LTV_TYPES.map(([k,t,l])=>`<option value="${k}"${c.v.ltvType===k?" selected":""}>${esc(t)} – LTV ${l} %</option>`).join("")}</select></div>`
      +["pv","pmt","years","rate"].map(k=>fieldHTML(k,res)).join("")
      +`<div class="fc-f fc-live"><label class="fc-sw">Aktuální úroková sazba<input type="checkbox" class="switch" role="switch" data-x="live"${c.v.live?" checked":""}></label>
        ${c.v.live?`<select class="field" data-x="fix" aria-label="Délka fixace">${FIXES.map(f=>`<option value="${f}"${+c.v.fix===f?" selected":""}>Fixace ${f} ${f===1?"rok":f<5?"roky":"let"}</option>`).join("")}</select><p class="hint fc-src">${rateSrc(res)}</p>`:""}</div>`
      +`<h4 class="section-head">Poplatky (do RPSN)</h4>`+["feeOnce","feeMonth"].map(k=>fieldHTML(k,res)).join("")
      +`<h4 class="section-head">Bonita</h4>`+["other","dsti","dti"].map(k=>fieldHTML(k,res)).join("");
  }
  function draw(){
    const res=compute(),M=MODES[st.mode],c=cur();persist();
    root.innerHTML=`<div class="card fc"><div class="fc-wrapH">
      <div class="fc-top">${opts.clients?`<div class="fc-cs"><label class="fc-lbl" for="fc_cq">Klient</label><div class="fc-csw"><label class="field field--search">${ico("search")}<input id="fc_cq" type="search" role="combobox" aria-autocomplete="list" aria-controls="fc_cl" aria-expanded="false" autocomplete="off" spellcheck="false" placeholder="Hledat klienta nebo lead…" value="${esc(cliName())}"></label><div id="fc_cl" class="fc-pop fc-cl" role="listbox" hidden></div></div><p class="fc-cur">${curHTML()}</p></div>`:`<p class="fc-cur fc-cs">${curHTML()}</p>`}
        <div class="fc-acts"><button class="btn btn--secondary" data-a="save" type="button" title="${st.clientId?"Uložit ke klientovi "+esc(cliName()):"Uložit kalkulaci"}">Uložit${st.clientId?`<span class="fc-long"> ke klientovi</span>`:""}</button><button class="btn btn--secondary" data-a="pdf" type="button"><span class="fc-long">Stáhnout </span>PDF</button><button class="btn btn--primary" data-a="new" type="button">Nová<span class="fc-long"> kalkulace</span></button><button class="icon-btn" data-a="menu" type="button" aria-haspopup="menu" aria-expanded="${menuOpen}" aria-label="Uložené kalkulace a vodoznak" title="Uložené kalkulace a vodoznak">${ico("more")}</button></div></div>
      ${menuOpen?menuHTML():""}${ask?askHTML():""}</div>
      <div class="fc-modes"><div class="seg fc-tabs" role="tablist" aria-label="Typ výpočtu">${ORDER.map(k=>`<button type="button" role="tab" data-a="mode" data-k="${k}" aria-selected="${k===st.mode}">${MODES[k].t}</button>`).join("")}</div></div>
      <div class="fc-body${minPar?" min":""}">
        <div class="fc-par${minPar?" min":""}"><div class="fc-ph"><h3>Parametry</h3><button class="icon-btn icon-btn--plain fc-coll" type="button" data-a="coll" aria-label="${minPar?"Rozbalit":"Sbalit"} parametry" aria-expanded="${!minPar}">${ico("dbl")}</button></div>
          <div class="fc-pin">${parHTML(res)}
            <p class="fc-errm" role="alert"${res.ok?" hidden":""}>${res.ok?"":esc(res.err)}</p>
            <div class="fc-notes">${st.mode==="loan"?loanNotes(res):""}</div>
          </div></div>
        <div class="fc-main">
          <div class="tiles fc-tiles">${tilesHTML()}</div>
          <div class="fc-ch"><h2>${esc(st.titles[st.mode]||M.chart)}</h2><button type="button" class="icon-btn icon-btn--plain" data-a="help" data-k="_chart" aria-label="Nápověda ke grafu" aria-expanded="${help==="_chart"}">${ico("help")}</button><button type="button" class="icon-btn icon-btn--plain" data-a="ctitle" aria-label="Upravit název grafu" title="Upravit název grafu">${ico("pen")}</button>${help==="_chart"?`<div class="fc-hp" role="note">${esc(M.help)}</div>`:""}</div>
          <div class="fc-chart" id="fcChart"></div>
          <div class="fc-leg"><span><i class="fc-dot a"></i>${esc(M.sa)}</span><span><i class="fc-dot b"></i>${esc(M.sb)}</span></div>
        </div></div></div>`;
    drawChart();
  }
  function tilesHTML(){const {ok,v,M}=lastRes,c=cur();return (ok?M.tiles(v):M.tiles({...v,[c.calc]:NaN})).map(([k,x])=>`<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(x)}</div></div>`).join("")}
  /* přepočet bez překreslení formuláře (aby při psaní nezmizel kurzor) */
  function refresh(){
    const res=compute(),c=cur();persist();
    root.querySelectorAll(".fc-f[data-k]").forEach(f=>{const k=f.dataset.k,isC=k===c.calc,inp=f.querySelector("input");
      f.classList.toggle("err",isC&&!res.ok);
      if(inp&&document.activeElement!==inp)inp.value=isC&&!res.ok?"–":fieldVal(k,c.v[k])});
    const em=root.querySelector(".fc-errm");if(em){em.hidden=res.ok;em.textContent=res.ok?"":res.err}
    const tl=root.querySelector(".fc-tiles");if(tl)tl.innerHTML=tilesHTML();
    const nt=root.querySelector(".fc-notes");if(nt)nt.innerHTML=st.mode==="loan"?loanNotes(res):"";
    const sr=root.querySelector(".fc-src:not(.fc-fpsrc)");if(sr)sr.innerHTML=rateSrc(res);
    const fs=root.querySelector(".fc-fpsrc");if(fs)fs.innerHTML=fpSrc(res);
    const zn=root.querySelector(".fc-zn");if(zn)zn.innerHTML=zmNotes();
    drawChart();
  }
  /* barvy grafu z tokenů appky: oranžová křivka, šedá plocha, mřížka --line, popisky --ink-2, logo šedé */
  const scrColors=()=>({a:"var(--accent)",b:"var(--line)",grid:"var(--line)",txt:"var(--ink-2)",ring:"var(--surface)",wmGray:"var(--ink-2)",wmGray2:"var(--ink-3)",wmOrange:"var(--accent)",wmOp:.3});
  let anim=0,lastSig="";
  function drawChart(){
    const box=root.querySelector("#fcChart");if(!box)return;
    const {ok,v,M}=lastRes;
    if(!ok){box.innerHTML=`<p class="empty">${esc(lastRes.err)}</p>`;return}
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
      tip.innerHTML=`<b>${yy} ${yy===1?"rok":yy>=2&&yy<=4?"roky":"let"}${mm?` ${mm} měs.`:""}</b><br><i class="fc-dot a"></i>${esc(M.sa)}: <b>${fmtKc(best.a)}</b><br><i class="fc-dot b"></i>${esc(M.sb)}: <b>${fmtKc(best.b)}</b>`;
      tip.style.left=Math.max(90,Math.min(r.width-90,X*r.width/w))+"px";tip.style.top=(Y*r.height/h)+"px"};
    const leave=()=>{hg.style.display="none";if(tip){tip.remove();tip=null}};
    hit.addEventListener("pointermove",move);hit.addEventListener("pointerdown",move);hit.addEventListener("pointerleave",leave);
  }
  function menuHTML(){
    return `<div class="fc-pop fc-menu" role="menu"><h4 class="section-head">Uložené kalkulace</h4><div class="group">${saved.length?saved.map(s=>`<div class="row fc-mi${s.id===st.id?" cur":""}"><button type="button" class="main" data-a="load" data-id="${esc(s.id)}" role="menuitem"><div class="t">${esc(s.name||"Bez názvu")}</div><div class="s">${esc(MODES[s.mode]?.t||"")}${s.clientName?" · "+esc(s.clientName):""} · ${s.updatedAt?new Date(s.updatedAt).toLocaleDateString("cs-CZ"):""}</div></button><button type="button" class="btn btn--danger btn--s" data-a="delsaved" data-id="${esc(s.id)}">Smazat</button></div>`).join(""):`<p class="empty">${store?"Zatím nic uloženého. Kalkulaci uložíš tlačítkem Uložit – vyber nahoře klienta a uloží se k němu.":"Ukládání tu není k dispozici."}</p>`}</div>${wmHTML()}</div>`;
  }
  /* jméno vybraného klienta / leadu (i když už v seznamu není) */
  function cliName(){if(!st.clientId)return"";const e=entryOf(st.clientId);return e?e.name||"":st.clientName||"klient"}
  function curHTML(){
    const sv=st.id&&saved.find(x=>x.id===st.id);
    if(sv)return `Uloženo: <b>${esc(sv.name||"kalkulace")}</b>${dirty()?" · neuložené změny":""}`;
    return st.clientId?(st.mode==="loan"?"Uložený úvěr se u klienta objeví ve finančním plánu (slajd „Plánujeme hypotéku“).":"Neuloženo – uloží se ke klientovi jedním klikem."):"Bez klienta – jen výpočet.";
  }
  function askHTML(){return `<div class="fc-pop fc-ask" role="alertdialog" aria-label="Neuložená kalkulace"><p>Kalkulace má neuložené změny. Začít novou?</p><div><button type="button" class="btn btn--secondary" data-a="askno">Zpět</button><button type="button" class="btn btn--secondary" data-a="asksave">Uložit a nová</button><button type="button" class="btn btn--danger is-armed" data-a="askyes">Zahodit</button></div></div>`}
  /* výběr klienta: vyhledávání bez diakritiky po slovech (jako Důchodová kalkulačka) */
  function csList(){
    const inp=root.querySelector("#fc_cq"),box=root.querySelector("#fc_cl");if(!inp||!box)return;
    const q=inp.value===cliName()?"":inp.value,words=fold(q).split(/\s+/).filter(Boolean);
    const its=clientList().filter(e=>{const n=fold(e.name);return words.every(w=>n.includes(w))}).slice(0,40);
    csHi=Math.min(csHi,its.length);
    box.innerHTML=`<button type="button" role="option" data-a="cpick" data-id="" class="row row-btn${csHi===0?" on":""}" aria-selected="${csHi===0}"><span class="main s">Bez klienta (jen výpočet)</span></button>`+
      (its.length?its.map((e,i)=>{const n=saved.filter(x=>x.clientId&&keysOf(e).includes(x.clientId)).length;
        return `<button type="button" role="option" data-a="cpick" data-id="${esc(keyOf(e))}" class="row row-btn${csHi===i+1?" on":""}" aria-selected="${csHi===i+1}"><span class="main"><span class="t">${esc(e.name||"Bez jména")}</span>${e.leadOnly&&e.prospect?`<span class="s">${esc(e.prospect)}</span>`:""}</span>${n?`<span class="end">${n} ${n===1?"uložená":n<5?"uložené":"uložených"}</span>`:""}</button>`}).join("")
        :`<p class="empty">Žádný klient neodpovídá „${esc(q)}“</p>`);
    box.hidden=false;inp.setAttribute("aria-expanded","true");
  }
  function csClose(){const box=root.querySelector("#fc_cl");if(box)box.hidden=true;const inp=root.querySelector("#fc_cq");if(inp){inp.setAttribute("aria-expanded","false");if(document.activeElement!==inp)inp.value=cliName()}}
  function cpick(id){
    const e=entryOf(id);st.clientId=id||"";st.clientName=e?e.name||"":"";
    /* jiný klient než u načtené uložené kalkulace → uloží se jako nová */
    const sv=st.id&&saved.find(x=>x.id===st.id);if(sv&&(sv.clientId||"")!==st.clientId){st.id=null;st.name=""}
    persist();draw();
  }
  function wmHTML(){
    const T=[["zfp","ZFP"],["img","Obrázek"],["text","Text"],["none","Žádný"]];
    return `<div class="fc-wm"><h4 class="section-head">Vodoznak v grafu a PDF</h4>
      <div class="seg seg--block" role="group" aria-label="Typ vodoznaku">${T.map(([k,t])=>`<button type="button" data-a="wmt" data-k="${k}" aria-pressed="${wm.t===k}">${t}</button>`).join("")}</div>
      ${wm.t==="img"?`<div class="fc-wimg">${wm.img?`<img src="${wm.img}" alt="Nahraný vodoznak">`:""}<button type="button" class="btn btn--secondary btn--s" data-a="wmpick">${wm.img?"Nahrát jiný obrázek":"Nahrát obrázek (logo)…"}</button></div><p class="hint">Nejlépe PNG s průhledným pozadím.</p>`:""}
      ${wm.t==="text"?`<label class="fc-wrow"><span>Text</span><input type="text" class="field" data-w="txt" maxlength="40" placeholder="např. tvoje jméno" value="${esc(wm.txt)}"></label>`:""}
      ${wm.t!=="none"?`<label class="fc-wrow"><span>Průhlednost</span><input type="range" data-w="op" min="0.05" max="0.8" step="0.01" value="${wm.op}" aria-label="Viditelnost vodoznaku"></label>
      <label class="fc-wrow"><span>Velikost</span><input type="range" data-w="sz" min="0.5" max="2.2" step="0.05" value="${wm.sz}" aria-label="Velikost vodoznaku"></label>`:""}
    </div>`;
  }
  /* --- změny hodnot --- */
  function setField(k,val){const c=cur();if(k===c.calc)return;c.v[k]=val;refresh()}
  function stepField(k,dir){const c=cur(),f=MODES[st.mode].f[k];let v=+c.v[k];if(!isFinite(v))v=0;
    let nv=Math.round((v+dir*f.st)/f.st)*f.st;if(k==="rate"||k==="fee")nv=Math.round(nv*100)/100;
    if(k!=="rate")nv=clampF(k,Math.max(k==="years"?1:0,nv));setField(k,nv)}

  root.addEventListener("click",async e=>{
    const b=e.target.closest("[data-a]");
    if(!b){if(help&&!e.target.closest(".fc-cs")){help=null;draw()}return}
    const a=b.dataset.a,k=b.dataset.k;
    if(a!=="help"&&a!=="menu"&&help){help=null}
    if(a==="cpick"){cpick(b.dataset.id);return}
    if(a==="askno"){ask=false;draw();return}
    if(a==="askyes"){ask=false;newCalc();return}
    if(a==="asksave"){ask=false;if(await save())newCalc();return}
    if(a==="mode"){st.mode=k;help=null;draw()}
    else if(a==="flag"){const c=cur();if(st.mode==="loan"&&k==="rate"&&c.v.live){toast("Při aktuální sazbě se sazba nedopočítává");return}if(k==="rate"&&fpOn(st.mode)){toast("Při zhodnocení dle FP se zhodnocení nedopočítává");return}if(c.calc!==k){if(!lastRes.ok)c.v[c.calc]=MODES[st.mode].def[c.calc]||0;c.calc=k;draw()}}
    else if(a==="inc"||a==="dec")stepField(k,a==="inc"?1:-1);
    else if(a==="help"){help=help===k?null:k;draw()}
    else if(a==="coll"){minPar=!minPar;draw()}
    else if(a==="ctitle"){const t=prompt("Název grafu",st.titles[st.mode]||MODES[st.mode].chart);if(t!=null){st.titles[st.mode]=t.trim()||undefined;draw()}}
    else if(a==="new"){menuOpen=false;if(dirty()){ask=true;draw();const y=root.querySelector('[data-a="askyes"]');y&&y.focus()}else newCalc()}
    else if(a==="menu"){menuOpen=!menuOpen;ask=false;draw()}
    else if(a==="wmt"){wm.t=k;saveWm();draw();if(k==="img"&&!wm.img)pickWm()}
    else if(a==="wmpick")pickWm();
    else if(a==="zadd"){const v=cur().v,Z=v.zmeny||(v.zmeny=[]),last=Z[Z.length-1],po=last?Math.min(+v.years-1,(+last.po||0)+5):Math.max(1,Math.min(+v.years-1,Math.round(+v.years/2)));
      Z.push({po:Math.max(1/12,po),renta:Math.round((last?+last.renta:+lastRes.v.pmt||+v.pmt||0)/100)*100});draw()}
    else if(a==="zdel"){const Z=cur().v.zmeny||[];Z.splice(+k,1);draw()}
    else if(a==="save")save();
    else if(a==="pdf")pdf();
    else if(a==="load"){const s=saved.find(x=>x.id===b.dataset.id);if(s){const f=fresh();st={...f,...JSON.parse(JSON.stringify(s.state||{})),id:s.id,name:s.name,clientId:s.clientId||"",clientName:s.clientName||"",base:""};ORDER.forEach(m=>{if(!st.m[m])st.m[m]=f.m[m]});fill(st);menuOpen=false;draw();toast("Načteno: "+(s.name||"kalkulace"))}}
    else if(a==="delsaved"){const s=saved.find(x=>x.id===b.dataset.id);if(s&&await ask_(`Smazat uloženou kalkulaci „${s.name||"Bez názvu"}“?`,{okLabel:"Smazat",danger:true})){await store.doc("fincalc/"+s.id).delete();if(st.id===s.id){st.id=null;st.name=""}draw();toast("Kalkulace smazána")}}
  });
  /* nová kalkulace: klient zůstává vybraný (další výpočet pro stejného klienta), zadání se vrátí na výchozí */
  function newCalc(){const keep=st.mode,cid=st.clientId,cn=st.clientName;st=fresh();st.mode=keep;st.clientId=cid;st.clientName=cn;st.base="";menuOpen=false;draw();toast("Nová kalkulace")}
  /* menu, nápověda a potvrzení se zavírají Escapem a klikem kamkoli mimo (i mimo kalkulačku) */
  const closeAll=()=>{if(!(menuOpen||help||ask))return false;menuOpen=false;help=null;ask=false;draw();return true};
  document.addEventListener("pointerdown",e=>{if(!root.isConnected)return;const t=e.target,in_=sel=>t&&t.closest&&t.closest(sel);
    if(!in_(".fc-cs"))csClose();
    /* jen odebrat vyskakovací prvek (bez překreslení), aby se klik na jiné tlačítko neztratil */
    const drop=sel=>{const n=root.querySelector(sel);if(n)n.remove()};
    if(menuOpen&&!in_(".fc-menu")&&!in_('[data-a="menu"]')){menuOpen=false;drop(".fc-menu");const m=root.querySelector('[data-a="menu"]');m&&m.setAttribute("aria-expanded","false")}
    if(ask&&!in_(".fc-ask")&&!in_('[data-a="new"]')){ask=false;drop(".fc-ask")}
    if(help&&!root.contains(t)){help=null;drop(".fc-hp")}});
  document.addEventListener("keydown",e=>{if(e.key!=="Escape"||!root.isConnected)return;const wasM=menuOpen;if(closeAll()&&wasM){const m=root.querySelector('[data-a="menu"]');m&&m.focus()}});
  root.addEventListener("input",e=>{if(e.target.id==="fc_cq"){csHi=e.target.value.trim()?1:0;csList()}});
  root.addEventListener("focusin",e=>{if(e.target.id==="fc_cq"){try{e.target.select()}catch(_){}csHi=0;csList()}});
  root.addEventListener("focusout",e=>{if(e.target.id==="fc_cq")setTimeout(()=>{const cs=root.querySelector(".fc-cs");if(cs&&!cs.contains(document.activeElement))csClose()},150)});
  root.addEventListener("keydown",e=>{if(e.target.id!=="fc_cq")return;
    const btns=[...root.querySelectorAll("#fc_cl button[data-a=cpick]")];
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(root.querySelector("#fc_cl").hidden)csList();csHi=Math.max(0,Math.min(btns.length-1,csHi+(e.key==="ArrowDown"?1:-1)));csList();const on=root.querySelector("#fc_cl button.on");on&&on.scrollIntoView({block:"nearest"})}
    else if(e.key==="Enter"){e.preventDefault();const b=btns[csHi];if(b)cpick(b.dataset.id)}
    else if(e.key==="Escape"){e.stopPropagation();e.target.blur();csClose()}});
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
    if(t.dataset&&t.dataset.x){const c=cur(),x=t.dataset.x;
      if(x==="live"){c.v.live=t.checked;if(t.checked&&c.calc==="rate")c.calc="pmt";if(!t.checked)c.v.rate=lastRes&&isFinite(lastRes.v.rate)?lastRes.v.rate:c.v.rate}
      else if(x==="fp"){c.v.fp=t.checked;if(t.checked&&c.calc==="rate")c.calc=st.mode==="inv"?"fv":"pmt";if(t.checked)c.v.freq="y"}/* FP úročí ročně – výchozí, ale frekvence jde dál změnit */
      else if(x==="fpReal")c.v.fpReal=t.value==="1";
      else if(x==="feeOn"){c.v.feeOn=t.checked;if(!isFinite(+c.v.fee))c.v.fee=3}
      else if(x==="fix")c.v.fix=+t.value;else c.v[x]=t.value;
      draw();return}
    if(t.matches("input[data-z]")){const z=(cur().v.zmeny||[])[+t.dataset.i];if(z)t.value=t.dataset.z==="po"?fmtYearsIn(z.po):fmtNum(z.renta);refresh();return}
    if(t.matches("input[data-k]")){const k=t.dataset.k,v=parseNum(t.value);if(isFinite(v))setField(k,clampF(k,v));t.value=fieldVal(k,cur().v[k])}
  });
  const clampF=(k,v)=>k==="fee"?Math.min(99,Math.max(0,v)):k==="years"?Math.max(1/12,v):k==="rate"?v:k==="dsti"?Math.min(100,Math.max(1,v)):k==="dti"?Math.max(0.5,v):Math.max(0,v);
  root.addEventListener("input",e=>{const t=e.target;if(t.matches("input[data-z]")){const z=(cur().v.zmeny||[])[+t.dataset.i],v=parseNum(t.value);if(z&&isFinite(v)){z[t.dataset.z]=Math.max(0,v);refresh()}return}
    if(!t.matches("input[data-k]"))return;const k=t.dataset.k,v=parseNum(t.value);if(isFinite(v))setField(k,clampF(k,v))});
  root.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("input[data-k],input[data-z]"))e.target.blur()});
  root.addEventListener("focusin",e=>{const t=e.target;if(t.matches("input[data-k]")){const k=t.dataset.k,v=cur().v[k];t.value=k==="rate"||k==="dsti"||k==="fee"?(isFinite(v)?nf2.format(v):""):fieldVal(k,v);try{t.select()}catch(_){}}});

  /* uložení jedním klikem: název = typ kalkulace + klient (bez klienta + datum); klient z kalendáře / podepsaný lead se při tom založí (ensure) */
  let saving=false;
  async function save(){
    if(!store){toast("Ukládání tu není k dispozici");return false}
    if(saving)return false;saving=true;
    try{
    let cid=st.clientId||"",cn=st.clientName||"";
    const e=entryOf(cid);
    if(e){cn=e.name||cn;if(!e.rec&&!e.leadOnly&&typeof opts.ensure==="function"){const rec=await opts.ensure(e);if(rec&&rec.id)cid=rec.id}else cid=keyOf(e)}
    const nm=MODES[st.mode].t+" – "+(cn||new Date().toLocaleDateString("cs-CZ"));
    const state=JSON.parse(JSON.stringify({mode:st.mode,titles:st.titles,m:st.m}));
    const doc={name:nm,mode:st.mode,state,clientId:cid,clientName:cn,updatedAt:Date.now()};
    /* úvěr přiřazený ke klientovi: hotová čísla pro slajd ve finančním plánu (FP je nepřepočítává z kalkulačky) */
    if(st.mode==="loan"){const h=loanSnap();if(h)doc.hypo=h}
    /* stejná kalkulace (stejný klient i typ) se přepíše, jinak vznikne nová */
    const old=st.id&&saved.find(s=>s.id===st.id);
    if(old&&(old.clientId||"")===cid&&old.mode===st.mode)await store.doc("fincalc/"+st.id).set(doc);
    else{const r=await store.collection("fincalc").add(doc);st.id=r.id}
    st.name=nm;st.clientId=cid;st.clientName=cn;st.base=sig();draw();toast(cn?"Uloženo ke klientovi "+cn:"Kalkulace uložena");return true;
    }catch(err){toast("Nepodařilo se uložit");return false}finally{saving=false}
  }
  function loanSnap(){const r=computeFor("loan");if(!r.ok)return null;const v=r.v,L=loanInfo(v);
    return {price:L.price,own:isFinite(L.own)?L.own:0,ltv:isFinite(L.ltv)?Math.round(L.ltv*100)/100:null,pv:v.pv,pmt:Math.round(v.pmt),years:v.years,rate:v.rate,rpsn:Math.round(rpsn(v)*100)/100,
      fix:v.live?+v.fix:null,live:!!v.live,src:v.live?`${RATES.source||"Swiss Life Hypoindex"} (${periodTxt(RATES.period)})`:"",feeOnce:+v.feeOnce||0,feeMonth:+v.feeMonth||0,other:+v.other||0,dsti:+v.dsti,dti:+v.dti,need:Math.round(L.need)}}
  function pdf(){
    const res=lastRes;if(!res.ok){toast("Nejdřív oprav zadání – "+res.err);return}
    const M=MODES[st.mode],v=res.v,c=cur();
    const pts=series(st.mode,v);
    const ch=chartSVG(pts,{w:900,h:430,c:{a:"#E8571A",b:"#E6E6E8",grid:"#E6E6E8",txt:"#5C5C60",ring:"#fff",wmGray:"#5C5C60",wmGray2:"#8A8A8E",wmOrange:"#E8571A",wmOp:.3},labelA:M.sa,labelB:M.sb,wm});
    const params=FIELDS[st.mode].map(k=>[M.f[k].l.replace(/ \((CZK|%|počet let)\)/,""),k==="rate"?fmtPct(v[k]):k==="years"?yrsTxt(v[k]):fmtKc(v[k]),k===c.calc]);
    if(st.mode!=="loan")params.push(["Frekvence připisování úroku",(FREQ.find(f=>f[0]===v.freq)||FREQ[0])[1],false]);
    if(st.mode==="inv"&&v.feeOn){const t=totals("inv",v);params.push(["Vstupní poplatek",`${fmtPct(+v.fee||0)} z každého vkladu = ${fmtKc(t.fee)}`,false])}
    if(v.fp){const i=params.findIndex(p=>p[0].startsWith("Zhodnocení"));if(i>=0)params[i][0]=zhLbl(v);
      params.splice(i+1,0,["Zdroj zhodnocení",fpSrc(res).replace(/<[^>]+>/g,""),false])}
    if(st.mode==="renta")zmenyOf(v).filter(z=>z.m<v.years*12).forEach(z=>params.push(["Renta od "+zmTxt(z.m),fmtKc(z.r),false]));
    let notes="";
    if(st.mode==="loan"){const L=loanInfo(v),pc=x=>nf2.format(x).replace(/,00$/,"");
      if(v.live&&res.lr)params.splice(params.findIndex(p=>p[0].startsWith("Úroková sazba"))+1,0,["Zdroj sazby",`${RATES.source||"Swiss Life Hypoindex"} (${periodTxt(RATES.period)}), fixace ${v.fix} ${v.fix===1?"rok":v.fix<5?"roky":"let"}, LTV ${res.lr.band}`,false]);
      if(L.price>0)params.unshift(["Cena nemovitosti",fmtKc(L.price),false],["Vlastní zdroje (akontace)",fmtKc(L.own),false],["LTV",`${fmtPct(L.ltv)} (limit ${L.limit} %)`,false]);
      params.splice(params.findIndex(p=>p[0].startsWith("Úroková sazba"))+1,0,["RPSN",`${fmtPct(rpsn(v))} (poplatky ${fmtKc(+v.feeOnce||0)} jednorázově, ${fmtKc(+v.feeMonth||0)} měsíčně)`,false]);
      params.push(["Ostatní splátky domácnosti",fmtKc(+v.other||0),false],["Limit DSTI / DTI",`${pc(v.dsti)} % / ${pc(v.dti)}×`,false],["Potřebný čistý příjem domácnosti / měs.",fmtKc(L.need),false]);
      notes=L.warn.map(w=>`<p class="w">${esc(w)}</p>`).join("")}
    const d=new Date().toLocaleDateString("cs-CZ");
    const html=`<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${esc(M.t)} – ${esc(st.clientName||st.name||"Koncept")} – ${d}</title><style>
      @page{size:A4;margin:14mm}body{font:13px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,Arial,sans-serif;color:#1A1A1A;margin:0;padding:24px}
      .hd{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #E8571A;padding-bottom:12px;margin-bottom:18px}
      .hd h1{font-size:20px;margin:0}.hd small{color:#5C5C60}
      .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 20px}.t{background:#F4F4F5;border-radius:8px;padding:10px 14px}.t .k{font-size:12px;color:#5C5C60}.t .v{font-size:17px;font-weight:700}
      table{border-collapse:collapse;width:100%;margin-bottom:6px}td{padding:7px 4px;border-bottom:1px solid #E6E6E8}td:last-child{text-align:right;font-weight:600}tr.c td{color:#C2410C}
      h2{font-size:16px;margin:18px 0 8px}.leg{display:flex;gap:22px;font-size:12px;color:#5C5C60;margin-top:6px}.leg i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px}
      .w{border:1px solid #E8571A;border-radius:8px;padding:8px 10px;margin:8px 0}.ft{margin-top:18px;font-size:11px;color:#5C5C60;border-top:1px solid #E6E6E8;padding-top:8px}
      @media print{body{padding:0}}</style></head><body>
      <div class="hd"><div><h1>Finanční matematika – ${esc(M.t)}</h1><small>${esc(st.clientName||st.name||"Koncept")} · ${d}</small></div><svg width="133" height="74" viewBox="0 0 ${LOGO_W} ${LOGO_H}">${zfpLogo()}</svg></div>
      <div class="tiles">${M.tiles(v).map(([k,x])=>`<div class="t"><div class="k">${esc(k)}</div><div class="v">${esc(x)}</div></div>`).join("")}</div>
      <h2>Parametry</h2><table>${params.map(([k,x,isC])=>`<tr${isC?' class="c"':""}><td>${esc(k)}${isC?" (dopočteno)":""}</td><td>${esc(x)}</td></tr>`).join("")}</table>
      ${notes}<h2>${esc(st.titles[st.mode]||M.chart)}</h2>${ch.svg}
      <div class="leg"><span><i style="background:#E8571A"></i>${esc(M.sa)}</span><span><i style="background:#E6E6E8"></i>${esc(M.sb)}</span></div>
      <div class="ft">Výpočet je orientační a slouží pouze pro informaci. ${st.mode==="loan"?"Skutečné splátky závisí na podmínkách věřitele; potřebný příjem je odhad podle zadaných limitů DSTI/DTI, každá banka posuzuje bonitu vlastní metodikou.":"Výnosy nejsou zaručeny, hodnota investice může kolísat."} Vklady, splátky a výplaty se počítají na konci každého měsíce. © ZFP Consulting</div>
      <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`;
    const w=window.open("","_blank");if(!w){toast("Prohlížeč zablokoval nové okno – povol vyskakovací okna");return}
    w.document.open();w.document.write(html);w.document.close();
  }
  /* graf závisí jen na šířce – změna výšky (např. delší panel parametrů u úvěru) ho nepřekresluje, jinak by utnula animaci */
  let rT=null,rW=0;const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(en=>{const w=Math.round(en[0].contentRect.width);if(w===rW)return;rW=w;clearTimeout(rT);rT=setTimeout(()=>{if(lastRes)drawChart()},120)}):null;
  if(ro)ro.observe(root);
  draw();
  return{redraw:draw,state:()=>st,refreshClients(){const b=root.querySelector("#fc_cl");if(b&&!b.hidden)csList();else csClose()}};
}

window.FinCalc={mount,math:{iMonth,valueAt,solve,series,totals,rentaSeg,FIELDS,loanInfo,liveRate,periodAge,ltvLimit,rpsn,fpRate,fpAlok,FP_NET,FP_SET},rates:()=>RATES,fmt:{fmtKc,yrsTxt,parseNum},logo:{svg:zfpLogo,w:LOGO_W,h:LOGO_H}};
})();
