/* Záložka Úvěry – hypotéky a úvěry klientů jako samostatný proces (podobně jako pipeline):
   dotazník se vším, co banky chtějí → orientační bonita (LTV, DSTI, DTI, věk, splatnost) → pořadí bank s důvody →
   podklady na míru → srovnání nabídek (3 modelace pro ZFPA) → průběh případu po fázích až po čerpání a hlídání fixace.
   Samostatný modul: Uvery.mount(kontejner, {store, toast, ls, clients, ensure, openClient, docsFor, saveProduct, sign})
   Čistá logika v Uvery.math (testy: tests/uvery.run.mjs). Pravidla bank = BANKS (stav k 10/2026, ze složky Hypo,
   metodických pokynů ZFPA, školení HypoUP a veřejných zdrojů); v appce jdou přepsat v „Parametry bank“ (kolekce uvcfg).
   Doporučení je orientační pořadí pro poradce – ZFPA neposkytuje radu dle § 85 ZSÚ, klientovi se předkládá přehled nabídek. */
(()=>{
"use strict";
const VERSION=1;

/* ================= drobnosti ================= */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>{if(v==null||v==="")return NaN;if(typeof v==="number")return v;const s=String(v).replace(/\s| |Kč|%/g,"").replace(",",".");return s===""?NaN:+s};
const n0=v=>{const x=num(v);return isFinite(x)?x:0};
const fmt0=n=>isFinite(n)?Math.round(n).toLocaleString("cs-CZ").replace(/ /g," "):"–";
const kc=n=>isFinite(n)?fmt0(n)+" Kč":"–";
const pct=(n,d=0)=>isFinite(n)?(Math.round(n*Math.pow(10,d))/Math.pow(10,d)).toLocaleString("cs-CZ",{minimumFractionDigits:d,maximumFractionDigits:d})+" %":"–";
const fmtR=n=>isFinite(n)?n.toLocaleString("cs-CZ",{minimumFractionDigits:2,maximumFractionDigits:2})+" %":"–";
const mil=n=>!isFinite(n)?"–":Math.abs(n)>=1e6?(Math.round(n/1e5)/10).toLocaleString("cs-CZ")+" mil. Kč":Math.abs(n)>=1e3?Math.round(n/1e3).toLocaleString("cs-CZ")+" tis. Kč":fmt0(n)+" Kč";
const pad=x=>String(x).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayStr=()=>ymd(new Date());
const addDaysStr=(s,n)=>{const d=new Date((s||todayStr())+"T12:00:00");d.setDate(d.getDate()+n);return ymd(d)};
const addMonthsStr=(s,n)=>{const d=new Date(s.slice(0,10)+"T12:00:00"),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return ymd(d)};
const dDiff=(a,b)=>Math.round((new Date(a.slice(0,10)+"T12:00:00")-new Date(b.slice(0,10)+"T12:00:00"))/864e5);
const fmtD=s=>{if(!s)return"";const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);return m?+m[3]+". "+ +m[2]+". "+m[1]:""};
const fmtDs=s=>{if(!s)return"";const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);return m?+m[3]+". "+ +m[2]+".":""};
const plural=(n,a,b,c)=>n===1?a:n>1&&n<5?b:c;
const fold=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
/* hledání v češtině: bez diakritiky, delší slova i v jiném tvaru (plomba → plombu, družstvo → družstevní nenajde, družstv- ano) */
const stemQ=q=>fold(q).trim().split(/\s+/).filter(Boolean).map(w=>w.length>=5?w.replace(/[aeiouy]+$/,""):w);
const hitQ=(text,q)=>{const W=stemQ(q);if(!W.length)return true;const t=fold(text);return W.every(w=>t.includes(w))};
const jeq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const newId=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4);
/* věk v celých letech k datu */
function ageAt(birth,at){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(birth||"");if(!m)return NaN;const d=new Date((at||todayStr())+"T12:00:00");let a=d.getFullYear()-+m[1];if(d.getMonth()+1<+m[2]||(d.getMonth()+1===+m[2]&&d.getDate()<+m[3]))a--;return a}
function getPath(o,p){return String(p).split(".").reduce((a,k)=>a==null?undefined:a[k],o)}
function setPath(o,p,v){const ks=String(p).split(".");let a=o;for(let i=0;i<ks.length-1;i++){const k=ks[i];if(a[k]==null||typeof a[k]!=="object")a[k]=/^\d+$/.test(ks[i+1])?[]:{};a=a[k]}a[ks[ks.length-1]]=v}

/* ================= číselníky ================= */
const TYPES=[["hypo","Hypotéka"],["amer","Americká hypotéka"],["ss","Úvěr ze stavebního spoření"],["spotr","Spotřebitelský úvěr"],["konsol","Konsolidace"],["podnik","Podnikatelský úvěr"]];
const TYPE_T=Object.fromEntries(TYPES);
const PURPOSES=[["koupe","Koupě"],["vystavba","Výstavba"],["pozvyst","Pozemek + výstavba"],["rekonstrukce","Rekonstrukce"],["refinancovani","Refinancování"],["vyporadani","Vypořádání (SJM, dědictví)"],["druzstvo","Družstevní podíl"],["jine","Jiný účel"]];
const PURP_T=Object.fromEntries(PURPOSES);
const PROPS=[["byt","Byt v osobním vlastnictví"],["rd","Rodinný dům"],["pozemek","Pozemek"],["rekreace","Rekreační objekt / chata"],["druzstevni","Družstevní byt"],["nebytovy","Ateliér / nebytový prostor"]];
const PROP_T=Object.fromEntries(PROPS);
const SELLERS=[["fo","Fyzická osoba"],["developer","Developer"],["pribuzny","Příbuzný"],["po","Firma"],["drazba","Dražba"]];
const COLLAT=[["kupovana","Kupovaná / financovaná nemovitost"],["jina","Jiná vlastní nemovitost"],["obe","Kupovaná + další nemovitost"],["treti","Nemovitost třetí osoby (např. rodičů)"]];
const BURDENS=[["vb","Věcné břemeno"],["pp","Předkupní právo"],["zastava","Zástava jiné banky"],["exekuce","Exekuce na prodávajícím"],["zaplava","Záplavová zóna"]];
const OWN_SRC=[["uspory","Úspory"],["prodej","Prodej nemovitosti"],["dar","Dar od rodiny"],["ss","Stavební spoření"],["investice","Investice"],["uver","Jiný úvěr"]];
const PRIORITIES=[["sazba","Nejnižší sazba"],["splatka","Nejnižší splátka"],["rychlost","Rychlost vyřízení"],["flex","Mimořádné splátky / flexibilita"],["vyse","Co nejvyšší úvěr"],["jednoduse","Jednoduché dokládání"],["online","Online proces a podpis"]];
const CITIZEN=[["cz","ČR"],["eu","EU / EHP"],["mimo","Mimo EU"]];
const RESID=[["trvaly","Trvalý pobyt"],["prechodny","Přechodný pobyt"]];
const MARITAL=[["svobodny","Svobodný/á"],["manzel","Ženatý / vdaná"],["rozveden","Rozvedený/á"],["vdovec","Vdovec / vdova"],["partner","Registrované partnerství"]];
const RELS=[["manzel","Manžel/ka"],["partner","Partner/ka (nesezdaní)"],["rodic","Rodič"],["dite","Dítě"],["jiny","Jiný vztah"]];
const OBORY=[["it","IT / software"],["svobodne","Svobodné povolání (advokát, lékař, architekt, daňový poradce)"],["sluzby","Služby (poradenství, marketing, reality)"],["remeslo","Řemeslo / stavebnictví"],["obchod","Obchod / výroba"],["jine","Jiné"]];
const DEBTS=[["hypo","Hypotéka"],["spotr","Spotřebitelský úvěr"],["kk","Kreditní karta"],["ko","Kontokorent"],["leasing","Leasing / splátky"],["vyzivne","Výživné (placené)"],["ruceni","Ručení za cizí úvěr"],["jine","Jiný závazek"]];
const DEBT_T=Object.fromEntries(DEBTS);

/* typy příjmů: pole formuláře [klíč, popisek, druh, volby/podmínka] – druh: kc (částka), n (číslo), sel, yn (ano/ne), date, t (text) */
const INC={
  zam:{t:"Zaměstnání (HPP)",f:[["castka","Čistý měsíční příjem","kc"],["smlouva","Pracovní smlouva","sel",[["neurcita","Na dobu neurčitou"],["urcita","Na dobu určitou"]]],["mesicu","U zaměstnavatele (měsíců)","n"],["zkusebni","Ve zkušební době","yn"],["vypoved","Ve výpovědní lhůtě","yn"],["bonus","Pravidelné prémie (Kč/rok, vyplacené 2×+)","kc"]]},
  dpc:{t:"Dohoda o pracovní činnosti",f:[["castka","Čistý měsíční příjem","kc"],["mesicu","Trvá (měsíců)","n"]]},
  dpp:{t:"Dohoda o provedení práce",f:[["castka","Čistý měsíční příjem","kc"],["mesicu","Trvá (měsíců)","n"]]},
  osvc:{t:"OSVČ",f:[["rezim","Jak daní","sel",[["pausal","Výdajový paušál"],["skutecne","Skutečné výdaje"],["pausaldan","Paušální daň"]]],["prijmy","Roční příjmy / obrat (ř. 101)","kc"],["vydaje","Roční výdaje (ř. 102)","kc",null,{rezim:"skutecne"}],["pausal","Výdajový paušál","sel",[["80","80 % (řemesla, zemědělství)"],["60","60 % (ostatní živnosti)"],["40","40 % (svobodná povolání)"],["30","30 % (pronájem majetku)"]],{rezim:"pausal"}],["pasmo","Pásmo paušální daně","sel",[["1","1. pásmo"],["2","2. pásmo"],["3","3. pásmo"]],{rezim:"pausaldan"}],["obor","Obor","sel",OBORY],["mesicu","Podniká (měsíců)","n"],["dp","Podaných přiznání z podnikání","n"]]},
  sro:{t:"Společník / jednatel s.r.o.",f:[["zisk","Zisk po zdanění za poslední rok","kc"],["podil","Podíl ve firmě (%)","n"],["vyplata","Zisk se vyplácí (podíl na zisku)","yn"],["odmena","Čistá mzda / odměna jednatele měsíčně","kc"],["mesicu","Firma funguje (měsíců)","n"]]},
  pronajem:{t:"Příjem z pronájmu",f:[["castka","Nájemné bez služeb měsíčně","kc"],["zdroj","Jak se doloží","sel",[["dp","Daňové přiznání (§ 9)"],["vypisy","Nájemní smlouva / výpisy"],["budouci","Budoucí nájem z kupované nemovitosti"]]]]},
  rodic:{t:"Mateřská / rodičovská",f:[["castka","Měsíčně","kc"],["do","Pobírá do","date"],["navrat","Vrátí se k zaměstnavateli","yn"]]},
  duchod:{t:"Důchod",f:[["druh","Druh","sel",[["starobni","Starobní"],["invalidni","Invalidní"],["vysluha","Výsluha (armáda, policie)"],["vdovsky","Vdovský / vdovecký"],["sirotci","Sirotčí"]]],["castka","Měsíčně","kc"]]},
  zahr:{t:"Příjem ze zahraničí",f:[["zeme","Země","sel",[["DE","Německo"],["AT","Rakousko"],["SK","Slovensko"],["PL","Polsko"],["EU","Jiná země EU / EHP"],["X","Mimo EU"]]],["castka","Čistý měsíčně v Kč","kc"],["mesicu","Pracuje tam (měsíců)","n"],["pendler","Bydlí v ČR a dojíždí","yn"]]},
  vyzivne:{t:"Výživné (přijímané)",f:[["castka","Měsíčně","kc"],["soud","Stanovené soudem","yn"]]},
  diety:{t:"Diety / cestovní náhrady",f:[["castka","Průměrně měsíčně","kc"],["mesicu","Pobírá pravidelně (měsíců)","n"]]},
  provize:{t:"Provize finančního poradce (ZFPA)",f:[["castka","Průměrné hrubé provize měsíčně","kc"],["mesicu","Spolupracuje se ZFPA (měsíců)","n"],["pausal","Daní výdajovým paušálem","yn"]]},
  jiny:{t:"Jiný příjem",f:[["castka","Čistý měsíčně","kc"],["popis","Co to je","t"]]}
};
const INC_MAIN=new Set(["zam","osvc","sro","duchod","zahr","provize","dpc"]);   /* ostatní jsou vedlejší – banky je berou nejvýš do poloviny celkového příjmu */

/* ================= parametry 2026 ================= */
const P26={
  slevaPoplatnik:30840,          /* sleva na poplatníka za rok (2026) */
  pausalDan:{1:9984,2:16745,3:27139},   /* měsíční platba paušální daně 2026 (orientačně) */
  pausalCap:{80:1600000,60:1200000,40:800000,30:600000},   /* strop výdajového paušálu */
  zm:{first:4470,adult:4040,single:4860,kid6:2480,kid15:3050,kid26:3490},   /* životní minimum (orientačně) */
  revolving:0.03                 /* kreditní karta a kontokorent: do splátek se počítá 3 % limitu měsíčně */
};

/* ================= fáze případu ================= */
const STAGES=[
  {k:"poptavka",t:"Poptávka",c:"var(--uv-g1)",sla:7,tasks:[["ucel","Zjistit účel, cenu a termín (rezervace / kupní smlouva)"],["schuzka","Domluvit schůzku (osobně / online)"],["seznam","Poslat klientovi, co si připravit"]]},
  {k:"analyza",t:"Analýza a dotazník",c:"var(--uv-o1)",sla:7,tasks:[["dotaznik","Vyplnit dotazník (příjmy, závazky, nemovitost)"],["registry","Souhlas s nahlédnutím do registrů (BRKI, NRKI, SOLUS)"],["zfpa","Karta klienta, souhlas GDPR, informační list (ZFPA) – řekni, koho zastupuješ a že nejde o radu dle § 85"],["aml","AML: identifikace, účel úvěru, původ vlastních zdrojů, politicky exponovaná osoba"],["bonita","Spočítat bonitu v HypoUP"],["proces","Vysvětlit klientovi postup a časovou osu"]]},
  {k:"nabidky",t:"Srovnání nabídek",c:"var(--uv-o2)",sla:7,tasks:[["hypoup","Výstup z HypoUP nebo 3 modelace (příloha záznamu ZFPA)"],["garance","Garance sazby / předschválení"],["volba","Klient vybral banku a fixaci"],["zaznam","Záznam o zprostředkování úvěru (verze 260424_FK)"]]},
  {k:"podklady",t:"Sběr podkladů",c:"var(--uv-o3)",sla:14,tasks:[["kompletni","Podklady kompletní (záložka Podklady)"],["overeni","Ověřit kopie proti originálům"],["odhad","Objednat odhad (u bytu často online)"]]},
  {k:"schvalovani",t:"Ve schvalování",c:"var(--uv-o4)",sla:10,tasks:[["podano","Žádost podána v bance"],["odhadOk","Odhad hotový – hodnota sedí na LTV"],["doplneni","Doplnit, co chce schvalovatel"],["schvaleno","Úvěr schválen"]]},
  {k:"smlouvy",t:"Podpis smluv",c:"var(--uv-o5)",sla:10,tasks:[["esis","ESIS (předsmluvní informace) předané s předstihem a vysvětlené"],["us","Úvěrová smlouva podepsána"],["zs","Zástavní smlouva podepsána (ověřené podpisy)"],["ks","Kupní smlouva a úschova podepsány"],["vklad","Návrh na vklad podán na katastr (správní poplatek 2 000 Kč)"]]},
  {k:"cerpani",t:"Podmínky čerpání",c:"var(--uv-o6)",sla:30,tasks:[["pojisteni","Pojištění nemovitosti s vinkulací pro banku"],["vlastni","Doložit zaplacení vlastních zdrojů"],["plomba","Výpis z KN s plombou / zapsanou zástavou"],["zadostC","Žádost o čerpání odeslána"]]},
  {k:"cerpano",t:"Načerpáno",c:"var(--uv-done)",sla:0,tasks:[["cerpanoD","Čerpání proběhlo"],["popodminky","Podmínky po čerpání (zápis zástavy, kolaudace…)"],["odevzdat","Odevzdat dokumentaci do ZFPA"],["ulozit","Uložit úvěr ke klientovi (hlídání fixace)"],["kryti","Nabídnout zajištění úvěru (ŽP) a pojištění nemovitosti"],["doporuceni","Požádat o doporučení"]]},
  {k:"odlozeno",t:"Odloženo",c:"var(--uv-g2)",sla:0,tasks:[]},
  {k:"zamitnuto",t:"Zamítnuto / lost",c:"var(--uv-g3)",sla:0,tasks:[]}
];
/* u spotřebitelských úvěrů a konsolidací jsou některé kroky jiné */
const TASKS_SPOTR={
  nabidky:[["srovnani","Srovnat 3 nabídky (sazba, RPSN, splatnost, odměna za splácení)"],["volba","Klient vybral úvěr"],["zaznam","Záznam o zprostředkování úvěru (verze 260424_FK)"]],
  podklady:[["kompletni","Doklad totožnosti + doložení příjmu (často PSD2 výpis)"],["smlouvyUv","Smlouvy / výpisy ke konsolidovaným úvěrům"]],
  schvalovani:[["podano","Žádost odeslána (portál banky)"],["schvaleno","Schváleno"]],
  smlouvy:[["predsml","Předsmluvní informace předané (RPSN, celková splatná částka)"],["us","Smlouva podepsána (často Bank iD / SMS)"]],
  cerpani:[["splaceni","Původní úvěry splacené (konsolidace)"],["kontrola","Zkontrolovat, že původní úvěry zmizely z registru"]],
  cerpano:[["cerpanoD","Peníze vyplacené"],["odevzdat","Odevzdat dokumentaci do ZFPA"],["kryti","Probrat rezervu a zajištění příjmu"],["doporuceni","Požádat o doporučení"]]
};
const ACTIVE=k=>!["cerpano","odlozeno","zamitnuto"].includes(k);
const STAGE=k=>STAGES.find(s=>s.k===k)||STAGES[0];
function stageTasks(c,k){const t=(c&&c.q&&c.q.typ)||"hypo";return (["spotr","konsol"].includes(t)&&TASKS_SPOTR[k])||STAGE(k).tasks}

/* ================= finanční matematika ================= */
/* anuitní splátka, zůstatek po m měsících, jistina z dané splátky */
function payment(L,ratePct,years){const n=Math.round(years*12);if(!(L>0)||!(n>0))return 0;const r=ratePct/1200;return r?L*r/(1-Math.pow(1+r,-n)):L/n}
function balanceAfter(L,ratePct,years,months){const P=payment(L,ratePct,years),r=ratePct/1200;if(!(L>0))return 0;if(!r)return Math.max(0,L-P*months);return Math.max(0,L*Math.pow(1+r,months)-P*(Math.pow(1+r,months)-1)/r)}
function principalFor(P,ratePct,years){const n=Math.round(years*12),r=ratePct/1200;if(!(P>0)||!(n>0))return 0;return r?P*(1-Math.pow(1+r,-n))/r:P*n}
/* náklady za dobu fixace: kolik klient zaplatí, kolik z toho jsou úroky a kolik zbude dlužit */
function fixCost(L,ratePct,years,fixYears){const m=Math.round(Math.min(fixYears||years,years)*12),P=payment(L,ratePct,years),B=balanceAfter(L,ratePct,years,m);return {payment:P,months:m,paid:P*m,interest:P*m-(L-B),balance:B}}

/* tržní sazby: Swiss Life Hypoindex (sazby.json vedle appky, týdně ho obnovuje GitHub Action); záloha = říjen 2026 */
let RATES={source:"Swiss Life Hypoindex",period:"2026-10",index:5.79,fix:{1:{a:5.42,b:5.71},3:{a:5.53,b:5.84},5:{a:5.84,b:6.15},10:{a:6.35,b:6.61}}};
const RATE_SPOTR=8.9;   /* orientační sazba spotřebitelského úvěru (bez odměny za řádné splácení) */
function marketRate(fix,ltv,R){R=R||RATES;const F=R&&R.fix||{};const col=ltv>80?"b":"a";
  const at=k=>F[k]?(F[k][col]!=null?F[k][col]:F[k].a):null;
  const ks=Object.keys(F).map(Number).sort((a,b)=>a-b);if(!ks.length)return 5.5;
  const f=+fix||5;if(at(f)!=null)return at(f);
  let lo=ks.filter(k=>k<=f).pop(),hi=ks.find(k=>k>=f);if(lo==null)return at(hi);if(hi==null)return at(lo);
  const a=at(lo),b=at(hi);return Math.round((a+(b-a)*(f-lo)/(hi-lo))*100)/100}

/* ================= příjmy ================= */
const OBOR_PAUSAL={it:60,svobodne:40,sluzby:60,remeslo:80,obchod:80,jine:60};
/* čistý měsíční příjem OSVČ z daňového základu (jak ho počítá většina bank z přiznání): základ − daň − sociální − zdravotní */
function osvcNet(i){
  const P=n0(i.prijmy);if(!(P>0))return 0;
  let V=0;const rez=i.rezim||"pausal";
  if(rez==="skutecne")V=n0(i.vydaje);
  else if(rez==="pausal"){const p=+(i.pausal||60);V=Math.min(P*p/100,P26.pausalCap[p]||Infinity)}
  else{const p=OBOR_PAUSAL[i.obor]||60;V=P*p/100}
  const ZD=Math.max(0,P-V);
  if(rez==="pausaldan")return Math.max(0,ZD/12-(P26.pausalDan[i.pasmo||"1"]||P26.pausalDan[1]));
  const tax=Math.max(0,0.15*ZD-P26.slevaPoplatnik),sp=0.292*0.55*ZD,zp=0.135*0.5*ZD;
  return Math.max(0,(ZD-tax-sp-zp)/12);
}
/* ZFPA provize jako OSVČ s paušálem 60 % (obecně) */
const provizeAsOsvc=i=>osvcNet({rezim:i.pausal===false||i.pausal==="ne"?"skutecne":"pausal",pausal:"60",prijmy:n0(i.castka)*12,vydaje:n0(i.castka)*12*0.6});
const yes=v=>v===true||v==="ano";

/* příjem jednoho řádku pro konkrétní banku (b = parametry banky); vrací {v, why, warn, ko} */
function incomeFor(i,b,ctx){
  const t=i.typ, I=b.inc||{}, out={v:0,why:"",warn:"",ko:""};
  const amt=n0(i.castka);
  if(t==="zam"){
    if(yes(i.vypoved)){out.ko="ve výpovědní lhůtě – příjem banka nevezme";return out}
    if(yes(i.zkusebni)&&!b.probation){out.warn="zkušební doba – projde jen výjimkou (kontinuita v oboru)";out.v=0;return out}
    out.v=amt*(I.zam??1)+n0(i.bonus)/12*(I.bonus??0.5);
    if(i.smlouva==="urcita")out.warn="smlouva na dobu určitou – doložit prodlužování / trvání";
    if(isFinite(num(i.mesicu))&&num(i.mesicu)<3&&!yes(i.zkusebni))out.warn=(out.warn?out.warn+"; ":"")+"krátce u zaměstnavatele";
    return out}
  if(t==="dpc"){const f=I.dpc??1;out.v=amt*f;if(!f)out.warn="DPČ tahle banka nezapočítá";else if(n0(i.mesicu)&&n0(i.mesicu)<3)out.warn="DPČ kratší než 3 měsíce";return out}
  if(t==="dpp"){const f=I.dpp??0;out.v=amt*f;if(!f)out.warn="DPP tahle banka nezapočítá";return out}
  if(t==="osvc"){
    const O=b.osvc||{dz:1};const months=n0(i.mesicu),dp=n0(i.dp),pd=i.rezim==="pausaldan";
    if(pd&&O.pausaldan===false){out.ko="paušální daň tahle banka nebere";return out}
    /* paušalisté nepodávají přiznání – rozhoduje délka podnikání a výpisy (obvykle 6 měsíců) */
    if(pd){const need=O.pdMinMonths??6;if(isFinite(num(i.mesicu))&&months<need){out.warn="paušální daň: chce aspoň "+need+" měsíců podnikání (výpisy)";out.v=0;return out}}
    else if(dp<(O.minDp??1)&&!(O.minMonths&&months>=O.minMonths)){out.warn="málo historie podnikání (chce "+(O.minDp??1)+" podané DP"+(O.minMonths?" nebo "+O.minMonths+" měsíců":"")+")";out.v=0;return out}
    const dz=osvcNet(i)*(O.dz??1);
    const obOk=O.obrat&&!(O.obratMaxLtv&&ctx.ltv>O.obratMaxLtv)&&!(O.obratMaxLoan&&ctx.loan>O.obratMaxLoan);
    const ob=obOk?n0(i.prijmy)/12*(O.obrat[i.obor||"jine"]??O.obrat.jine??0):0;
    /* paušální daň: podíl fakturace, který banka uzná (modelový paušalista 70 tis./měs.: ČSOB HB 38,5 – KB 40,3 – RB 41,2 – ČS a UCB 42 – mBank 49 tis.; E15 / Gepard Finance 6/2025); řemesla a obchod (paušál 80 %) polovina */
    const pdv=pd&&O.pdK?n0(i.prijmy)/12*O.pdK*((OBOR_PAUSAL[i.obor]||60)>=80?.5:1):0;
    out.v=Math.max(dz,ob,pdv);out.why=pdv>0&&out.v===pdv?"paušální daň – ~"+Math.round(O.pdK*((OBOR_PAUSAL[i.obor]||60)>=80?50:100))+" % fakturace":ob>dz?"obratová metoda":"z daňového základu";return out}
  if(t==="sro"){const z=n0(i.zisk)*(n0(i.podil)||100)/100/12;let f=yes(i.vyplata)?(b.sro??0.8):(b.sroNoPay??0);
    if(f&&b.sroMinPodil&&(n0(i.podil)||100)<b.sroMinPodil){f=0;out.warn="podíl na zisku bere až od "+b.sroMinPodil+" % podílu"}
    else if(f&&b.sroMinMonths&&isFinite(num(i.mesicu))&&num(i.mesicu)<b.sroMinMonths){f=0;out.warn="podíl na zisku bere až po "+Math.round(b.sroMinMonths/12)+" letech podnikání přes firmu"}
    out.v=z*f+n0(i.odmena);if(!f&&z>0&&!out.warn)out.warn=b.sro===0?"podíl na zisku ze s.r.o. tahle banka nebere (jen mzdu)":"nevyplácený zisk tahle banka nezapočítá";return out}
  if(t==="pronajem"){const f=i.zdroj==="budouci"?(I.pronajemBudouci??0):(I.pronajem??0.7);out.v=amt*f;if(!f)out.warn=i.zdroj==="budouci"?"budoucí nájem banka nezapočítá (jen u investičních produktů)":"nájem banka nezapočítá";return out}
  if(t==="rodic"){const end=i.do&&dDiff(i.do,todayStr());const f=I.rodic??1;
    if(end!=null&&end<180&&!yes(i.navrat)){out.v=0;out.warn="rodičovská brzy končí – bez návratu do práce se nepočítá";return out}
    out.v=amt*f;if(!f)out.warn="rodičovskou tahle banka nezapočítá";return out}
  if(t==="duchod"){const D=I.duchod||{};const f=D[i.druh||"starobni"]??1;out.v=amt*f;
    if(!f)out.warn=(i.druh==="vdovsky"?"vdovský":i.druh==="sirotci"?"sirotčí":"tento")+" důchod tahle banka nezapočítá";
    if(i.druh==="vdovsky"&&D.vdovskyJenSeStarobnim&&!ctx.hasStarobni){out.v=0;out.warn="vdovský důchod jen spolu se starobním"}
    return out}
  if(t==="zahr"){const Z=I.zahr||{};const f=Z[i.zeme||"EU"]??Z.EU??0;out.v=amt*f;if(!f)out.ko="příjem z "+(i.zeme==="X"?"ciziny mimo EU":"této země")+" tahle banka nebere";
    else if(f<1)out.warn="příjem ze zahraničí započte jen z "+Math.round(f*100)+" %";return out}
  if(t==="vyzivne"){const f=yes(i.soud)?(I.vyzivne??1):0;out.v=amt*f;if(!f)out.warn="výživné jen stanovené soudem";return out}
  if(t==="diety"){const f=I.diety??0;out.v=amt*f;if(!f)out.warn="diety tahle banka nezapočítá";return out}
  if(t==="provize"){const R=b.provize;if(R&&R.pct){const p=yes(i.pausal)||i.pausal==null?R.pct:(R.pctSkutecne??R.pct);out.v=Math.min(amt*p,R.cap||Infinity);out.why=R.note||"";
      if(R.minMonths&&n0(i.mesicu)<R.minMonths)out.warn="chce aspoň "+R.minMonths+" měsíců u ZFPA";return out}
    out.v=provizeAsOsvc(i);out.why="jako OSVČ (paušál 60 %)";return out}
  out.v=amt*(I.jiny??0);if(!(I.jiny))out.warn="jiný příjem jen individuálně";return out;
}

/* ================= případ: základní ukazatele ================= */
const isHypoLike=t=>["hypo","amer","ss"].includes(t);
function applicants(q){return (q.zad&&q.zad.length?q.zad:[{}])}
function householdZM(q){const zad=applicants(q),adults=Math.max(1,zad.filter(z=>z.dom!=="2").length),kids=n0(q.deti);
  const Z=P26.zm;return adults===1&&!kids?Z.single:Z.first+(adults-1)*Z.adult+kids*Z.kid15}
function debtsOf(q){let inst=0,bal=0,consol=0;(q.zav||[]).forEach(d=>{const s=n0(d.splatka),z=n0(d.zustatek),lim=n0(d.limit);
  if(yes(d.splatit)){consol+=z||lim;return}
  if(d.typ==="kk"||d.typ==="ko"){inst+=Math.max(s,lim*P26.revolving);bal+=lim||z;return}
  inst+=s;bal+=z});return {inst,bal,consol}}
function metrics(q,R){
  q=q||{};const t=q.typ||"hypo";
  const loan=n0(q.uver)||Math.max(0,n0(q.cena)-n0(q.vlastni));
  const price=n0(q.cena),val=n0(q.odhad)||price,extra=n0(q.zajHodnota);
  const zaj=q.zajisteni||"kupovana";
  const coll=t==="spotr"||t==="konsol"||t==="podnik"?0:(zaj==="jina"?extra:zaj==="obe"||zaj==="treti"?val+extra:val);
  const ltv=coll>0?loan/coll*100:NaN;
  const ages=applicants(q).map(z=>ageAt(z.narozen)).filter(isFinite);
  const oldest=ages.length?Math.max(...ages):NaN,youngest=ages.length?Math.min(...ages):NaN;
  const years=n0(q.splatnost)||(t==="amer"?20:t==="spotr"||t==="konsol"?8:t==="ss"?20:30);
  const fix=n0(q.fixace)||(t==="spotr"||t==="konsol"?years:5);
  const rate=t==="spotr"||t==="konsol"?RATE_SPOTR:marketRate(fix,ltv,R)+(t==="amer"?0.8:0);
  const pay=payment(loan,rate,years);
  const D=debtsOf(q);
  /* obecný příjem (bez specifik bank): hlavní příjmy celé, pronájem 70 %, DPP a jiné jen napůl */
  const gen={inc:{zam:1,dpc:1,dpp:.5,rodic:1,vyzivne:1,diety:.5,pronajem:.7,zahr:{DE:1,AT:1,SK:1,PL:1,EU:1,X:0},duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:.5},osvc:{dz:1,obrat:{it:.7,svobodne:.7,sluzby:.55,remeslo:.4,obchod:.3,jine:.4},minDp:0},sro:.8,probation:true};
  const income=incomeTotal(q,gen).total;
  const dsti=income>0?(pay+D.inst)/income*100:NaN;
  const dti=income>0?(loan+D.bal)/(income*12):NaN;
  const reserve=income-pay-D.inst-householdZM(q);
  return {t,loan,price,val,coll,ltv,ages,oldest,youngest,ageEnd:isFinite(oldest)?oldest+years:NaN,years,fix,rate,pay,debts:D,income,dsti,dti,reserve,
    invest:isInvest(q),ltvLimit:ltvLimit(q)};
}
/* investiční nemovitost (doporučení ČNB od 1. 4. 2026, praktické postupy 25. 3. 2026): koupě (i družstevního podílu, refinancování s navýšením)
   nemovitosti k pronájmu nebo 3. a další obytné nemovitosti; započtený budoucí nájem = vždy investiční. Výstavba, rekonstrukce a refinancování bez navýšení ne. */
function isInvest(q){if((q.typ||"hypo")!=="hypo")return false;const u=q.ucel||"koupe";
  if(applicants(q).some(z=>(z.prijmy||[]).some(i=>i&&i.typ==="pronajem"&&i.zdroj==="budouci")))return true;
  const scope=["koupe","pozvyst","druzstvo"].includes(u)||(u==="refinancovani"&&n0(q.navyseni)>0);
  return scope&&(yes(q.pronajem)||n0(q.nemovitosti)>=2)}
const hasHypo=q=>(q.zav||[]).some(d=>d&&d.typ==="hypo"&&!yes(d.splatit));
/* limit LTV dle ČNB: 80 %, do 36 let 90 % (manželům stačí jeden, nesezdaní oba), investiční koupě 70 %, americká 70 % */
function ltvLimit(q){const t=q.typ||"hypo";if(t==="amer")return 70;if(isInvest(q))return 70;
  const zad=applicants(q),ages=zad.map(z=>ageAt(z.narozen));
  if(!ages.some(isFinite))return 80;
  const young=a=>isFinite(a)&&a<36;
  const married=zad.length>1&&zad.slice(1).every(z=>z.vztah==="manzel");
  const ok=zad.length<=1||married?ages.some(young):ages.every(young);
  return ok?90:80}
/* součet příjmů za domácnost pro banku: vedlejší příjmy nejvýš do výše hlavních (polovina celku) */
function incomeTotal(q,b,M){
  const rows=[],ctx={hasStarobni:applicants(q).some(z=>(z.prijmy||[]).some(i=>i.typ==="duchod"&&(i.druh||"starobni")==="starobni")),ltv:M&&M.ltv,loan:M&&M.loan};
  let main=0,side=0;const warns=[],kos=[];
  applicants(q).forEach((z,zi)=>(z.prijmy||[]).forEach(i=>{if(!i||!i.typ)return;const r=incomeFor(i,b,ctx);rows.push({zi,typ:i.typ,...r});
    if(INC_MAIN.has(i.typ))main+=r.v;else side+=r.v;
    if(r.warn)warns.push((applicants(q).length>1?(z.jmeno||((zi+1)+". žadatel"))+": ":"")+INC[i.typ].t+" – "+r.warn);
    if(r.ko)kos.push((applicants(q).length>1?(z.jmeno||((zi+1)+". žadatel"))+": ":"")+INC[i.typ].t+" – "+r.ko)}));
  const sideCap=Math.min(side,main);if(side>sideCap)warns.push("vedlejší příjmy se počítají nejvýš do poloviny celku");
  return {total:main+sideCap,main,side:sideCap,rows,warns,kos}}

/* ================= štítky případu (na co se hodí která banka) ================= */
function caseTags(q,M){
  const t=new Set(),ty=q.typ||"hypo",u=q.ucel||"koupe",inc=applicants(q).flatMap(z=>z.prijmy||[]);
  const has=k=>inc.some(i=>i.typ===k);
  if(has("osvc"))t.add("osvc");if(inc.some(i=>i.typ==="osvc"&&i.rezim==="pausaldan"))t.add("pausaldan");
  if(has("sro"))t.add("sro");if(has("zahr"))t.add("zahranici");if(has("pronajem"))t.add("najem");if(has("dpp"))t.add("dpp");
  if(has("rodic"))t.add("rodic");if(has("provize"))t.add("provize");if(has("duchod"))t.add("duchod");
  if(applicants(q).some(z=>z.obc==="mimo"||z.obc==="eu"))t.add("cizinec");
  if(ty==="amer")t.add("amer");
  if(isHypoLike(ty)){
    if(["vystavba","pozvyst"].includes(u))t.add("vystavba");if(u==="rekonstrukce")t.add("rekonstrukce");if(u==="refinancovani")t.add("refin");
    if(u==="druzstvo"||q.predmet==="druzstevni")t.add("druzstvo");if(q.predmet==="pozemek"||u==="pozvyst")t.add("pozemek");
    if(q.prodavajici==="drazba")t.add("drazba");if(q.prodavajici==="pribuzny")t.add("pribuzny");if(q.prodavajici==="developer")t.add("developer");
    if(q.zajisteni==="treti")t.add("treti");if(M&&M.invest)t.add("invest");if(M&&M.ltv>80)t.add("ltv90");
    if(["A","B"].includes(q.penb))t.add("zelena");
  }
  if(M&&isFinite(M.oldest)&&M.oldest>=50)t.add("senior");
  if(q.termin&&dDiff(q.termin,todayStr())<=35)t.add("rychle");
  if(yes(q.predVkladem))t.add("predVkladem");if(n0(q.fixace)>=8)t.add("dlouhaFix");if((q.priority||[]).includes("online"))t.add("online");
  if(ty==="konsol"||(q.zav||[]).some(d=>yes(d.splatit)))t.add("konsolidace");
  return t;
}
const TAG_T={predVkladem:"čerpání před vkladem",dlouhaFix:"dlouhá fixace",online:"online proces",osvc:"OSVČ",pausaldan:"paušální daň",sro:"příjem ze s.r.o.",zahranici:"příjem ze zahraničí",najem:"příjem z pronájmu",dpp:"DPP",rodic:"rodičovská",provize:"provize ZFPA",duchod:"důchod",cizinec:"cizinec",amer:"americká hypotéka",vystavba:"výstavba",rekonstrukce:"rekonstrukce",refin:"refinancování",druzstvo:"družstevní byt",pozemek:"pozemek",drazba:"dražba",pribuzny:"koupě od příbuzného",developer:"developerský projekt",treti:"zástava třetí osoby",invest:"investiční nemovitost",ltv90:"LTV nad 80 %",zelena:"PENB A/B",senior:"starší žadatel",rychle:"spěchá",konsolidace:"konsolidace"};

/* ================= vyhodnocení jedné banky ================= */
/* sazba banky: vlastní tabulka (interpolace mezi fixacemi, které banka má; delší než max. fixace = nejdelší dostupná), jinak průměr Hypoindexu ± odchylka */
function ownRate(rates,fix){const ks=Object.keys(rates||{}).filter(k=>rates[k]!==""&&rates[k]!=null&&isFinite(+rates[k])).map(Number).sort((a,b)=>a-b);if(!ks.length)return null;
  if(ks.includes(fix))return +rates[fix];const lo=ks.filter(k=>k<fix).pop(),hi=ks.find(k=>k>fix);
  if(lo==null)return +rates[hi];if(hi==null)return +rates[lo];return +rates[lo]+(+rates[hi]-+rates[lo])*(fix-lo)/(hi-lo)}
/* spotřebitelský úvěr: parametry banky, u účelu „bydlení“ přednost mají parametry nezajištěného úvěru na bydlení (spotr.byd) */
function spotrOf(b,q){const S=b.spotr||{};return yes(q&&q.bydleni)&&S.byd?{...S,...S.byd,isByd:true}:{...S,isByd:false}}
function spotrRate(b,q,t,loan,years){const S=spotrOf(b,q);let r=t==="konsol"&&S.konsolTyp!=null?S.konsolTyp:S.isByd&&q&&q.bydUcel==="druz"&&S.typDruz!=null?S.typDruz:S.typ!=null?S.typ:(b.rateSpotr||RATE_SPOTR),w="";
  if(S.garMin&&!S.isByd&&(loan<S.garMin||years>S.garYears)){r=S.mimoGar||RATE_SPOTR;w="garantovaná sazba jen nad "+mil(S.garMin)+" na max. "+S.garYears+" let (s aktivním účtem) – jinak individuálně"}
  return {r:+r,w}}
function bankRate(b,fix,ltv,R,t,loan,q,years){
  if(t==="spotr"||t==="konsol")return Math.round(spotrRate(b,q||{},t,loan||0,years||8).r*100)/100;
  const f=b.maxFix?Math.min(+fix||5,b.maxFix):(+fix||5);
  let r;
  if(t==="amer"&&b.amerRate)r=+b.amerRate;
  else{const own=ownRate(b.rates,f);r=own!=null?own+(ltv>80?(b.ltv90add??0.2):0):marketRate(f,ltv,R)+(+b.rateAdj||0);if(t==="amer")r+=b.amerAdd??0.8}
  if(b.smallAdd&&loan>0&&loan<b.smallAdd.lt)r+=b.smallAdd.add;
  return Math.round(r*100)/100}
function evalBank(b,q,M,R){
  let t=q.typ||"hypo";const u=q.ucel||"koupe",prop=q.predmet||"byt";
  const res={id:b.id,name:b.name,b,ko:[],warn:[],plus:[],score:0,income:0,maxLoan:NaN,rate:NaN,pay:NaN,dsti:NaN,dti:NaN,years:M.years};
  if(b.off){res.ko.push("vypnuto v Parametrech bank");res.na=true;return res}
  if(!(b.types||[]).includes(t)){res.ko.push((TYPE_T[t]||"tenhle úvěr")+" – u téhle instituce přes ZFPA ne");res.na=true;return res}
  /* stavební spořitelny už hypotéky nedávají – u družstva, rekonstrukce a vypořádání nabídni jejich nezajištěný úvěr na bydlení */
  if(b.ended&&b.ended[t]){const bu=u==="druzstvo"||prop==="druzstevni"?"druz":u==="rekonstrukce"?"reko":u==="vyporadani"?"vyp":"";
    if(t==="hypo"&&bu&&b.spotr&&b.spotr.byd&&(b.types||[]).includes("spotr")){q={...q,typ:"spotr",bydleni:"ano",bydUcel:bu};t="spotr";res.swap=true;res.plus.push("místo hypotéky nezajištěný úvěr na bydlení – bez odhadu a katastru")}
    else{res.ko.push(b.ended[t]);return res}}
  /* BIDLI: nemovitost koupí bytové družstvo, člen platí nájem a po splacení úvěru družstva ji převede do vlastnictví */
  if(b.model==="druzstvo"){res.model=true;
    if(!["koupe","druzstvo"].includes(u)||t!=="hypo"){res.ko.push("jen koupě bydlení přes družstvo (ne výstavba, rekonstrukce ani refinancování)");return res}
    const own=n0(q.cena)>0?n0(q.vlastni)/n0(q.cena)*100:NaN;
    if(isFinite(own)&&own<19.5)res.ko.push("potřebuje aspoň 20 % vlastních zdrojů z ceny (teď "+pct(own,0)+")");
    if(yes(q.exekuce)||yes(q.insolvence))res.ko.push("exekuce / insolvence – družstvo nepřijme");
    res.plus.push("bez dokládání příjmů, i pro cizince a starší – řešení, když banky nepůjčí");
    res.warn.push("do splacení úvěru družstva klient není vlastník a nese riziko hospodaření družstva");
    res.warn.push("nájem a náklady nejsou veřejné – chtěj kalkulaci; úroky nejspíš nepůjdou odečíst z daní");
    if(q.registry==="problem")res.warn.push("záznam v registru – posoudí individuálně");
    return res}
  const P=b.purp||{},SP=t==="spotr"||t==="konsol";let S=null;
  if(isHypoLike(t)){
    if(u==="druzstvo"||prop==="druzstevni"){const other=["jina","treti","obe"].includes(q.zajisteni)&&n0(q.zajHodnota)>0;
      if(P.druzstvo)res.plus.push(P.druzstvo===true?"umí družstevní byt":P.druzstvo);
      else if(other&&P.druzstvoZastava!==false)res.plus.push("družstevní podíl se zástavou jiné nemovitosti");
      else res.ko.push("družstevní byt jen se zástavou jiné nemovitosti (zadej ji v Zajištění)")}
    if(prop==="rekreace"&&P.rekreace===false)res.ko.push("rekreační objekt nefinancuje");
    if(prop==="nebytovy"&&P.nebytovy===false)res.ko.push("ateliér / nebytový prostor nefinancuje");
    if(prop==="pozemek"&&P.pozemek===false)res.ko.push("samotný pozemek nefinancuje");
    if(q.prodavajici==="drazba"&&!P.drazba)res.ko.push("dražbu nefinancuje");
    if(q.zajisteni==="treti"&&P.treti===false)res.ko.push("zástavu nemovitosti třetí osoby nebere");
    if(u==="vyporadani"&&P.vyporadani===false)res.ko.push("vypořádání nefinancuje");
    if(t==="ss"&&b.kind!=="ss")res.ko.push("úvěr ze stavebního spoření je jen u stavebních spořitelen");
  }
  if(SP){S=spotrOf(b,q);const two=applicants(q).length>1;
    if(S.onlyByd&&!S.isByd)res.ko.push("jen účelově na bydlení (rekonstrukce, družstevní byt, vypořádání) – zaškrtni „Na bydlení“");
    const mx=t==="konsol"&&S.konsolMax?S.konsolMax:S.isByd&&q.bydUcel==="druz"&&S.maxDruz?S.maxDruz:two&&S.max2?S.max2:S.max;
    const mn=t==="konsol"&&S.konsolMin?S.konsolMin:S.min;
    if(mx&&M.loan>mx)res.ko.push("max. "+mil(mx)+(S.max2&&!two&&M.loan<=S.max2?" (jeden žadatel; se spolužadatelem "+mil(S.max2)+")":""));
    if(mn&&M.loan>0&&M.loan<mn)res.ko.push("min. "+mil(mn));
    if(S.onlyCz&&applicants(q).some(z=>(z.obc||"cz")!=="cz"))res.ko.push("jen občané ČR s trvalým pobytem");
    const nt=t==="konsol"?(S.konsolNote||S.note):S.note;if(nt)res.plus.push(nt);
    if(S.warn)res.warn.push(S.warn)}
  /* LTV */
  if(isHypoLike(t)&&isFinite(M.ltv)){
    const L=b.ltv||{};let lim=t==="amer"?(L.amer||70):M.invest?Math.min(70,L.inv||70):Math.min(M.ltvLimit,L.max||90);
    if(t!=="amer"&&!M.invest&&M.ltvLimit===90&&L.young>lim)lim=L.young;   /* výjimka ČNB (5 % objemu) – např. UniCredit do 36 let až 95 % */
    res.ltvLim=lim;
    if(M.ltv>lim+0.05){const need=M.loan-M.coll*lim/100;res.ko.push("LTV "+pct(M.ltv,1)+" > "+lim+" % – chybí ≈ "+mil(need)+" vlastních zdrojů nebo dozajištění")}
    else if(M.ltv>90.05)res.warn.push("LTV nad 90 % jen v rámci výjimky ČNB – individuální schválení a vyšší sazba")
  }
  if(b.minLoan&&M.loan&&M.loan<b.minLoan)res.ko.push("minimální úvěr "+mil(b.minLoan));
  if(b.maxLoan&&M.loan>b.maxLoan&&t!=="amer")res.ko.push("maximální úvěr "+mil(b.maxLoan));
  if(b.maxLoanAmer&&t==="amer"&&M.loan>b.maxLoanAmer)res.ko.push("americká hypotéka max. "+mil(b.maxLoanAmer));
  /* splatnost a věk */
  let years=M.years;const ab=["A","B"].includes(q.penb)&&b.maxYearsAB;let maxY=t==="amer"?(b.maxYearsAmer||20):SP?((t==="konsol"&&S.konsolYears)||(S.isByd&&q.bydUcel==="druz"&&S.yearsDruz)||S.years||b.maxYearsSpotr||10):(ab?b.maxYearsAB:(b.maxYears||30));
  const cap8=SP&&hasHypo(q)&&maxY>8&&!S.nzu;if(cap8)maxY=8;   /* doporučení ČNB: nezajištěný úvěr klientovi s hypotékou max. 8 let */
  if(years>maxY){if(!res.swap)res.warn.push(cap8?"klient splácí hypotéku – nezajištěný úvěr max. 8 let (doporučení ČNB), počítám s 8":"splatnost nejvýš "+maxY+" let – počítám s "+maxY);years=maxY}
  if(isFinite(M.oldest)&&b.maxAge){const yo=b.ageByYounger&&isFinite(M.youngest)?M.youngest:M.oldest;const allow=b.maxAge-yo;
    if(allow<Math.min(5,years))res.ko.push("věk: splatnost by vyšla jen "+Math.max(0,allow)+" let (max. "+b.maxAge+" let při splatnosti)");
    else if(allow<years){res.warn.push("kvůli věku splatnost max. "+allow+" let"+(b.ageByYounger?" (podle mladšího)":""));years=allow}
    else if(b.ageByYounger&&M.oldest+years>b.maxAge)res.plus.push("splatnost podle mladšího žadatele");}
  res.years=years;
  /* cizinci */
  applicants(q).forEach((z,zi)=>{const who=applicants(q).length>1?(z.jmeno||(zi+1)+". žadatel")+": ":"";const F=b.foreign||{};
    if(z.obc==="mimo"){if(z.pobyt!=="trvaly"&&!F.mimoPrechodny)res.ko.push(who+"cizinec mimo EU bez trvalého pobytu");else if(z.pobyt==="trvaly"&&F.mimoTrvaly===false)res.ko.push(who+"cizinec mimo EU");else if(F.note)res.plus.push(F.note)}
    if(z.obc==="eu"&&z.pobyt!=="trvaly"&&F.euPrechodny===false)res.warn.push(who+"občan EU s přechodným pobytem – individuálně")});
  /* registry, exekuce */
  if(q.registry==="problem")res.ko.push("negativní záznam v registru – nejdřív vyřešit / vysvětlit");
  if(yes(q.exekuce))res.ko.push("exekuce – úvěr neprojde");
  if(yes(q.insolvence))res.ko.push("insolvence – úvěr neprojde");
  /* příjmy a bonita */
  const IT=incomeTotal(q,b,M);res.income=IT.total;res.incRows=IT.rows;IT.kos.forEach(x=>res.ko.push(x));IT.warns.forEach(x=>res.warn.push(x));
  if(b.maxFix&&isHypoLike(t)&&M.fix>b.maxFix)res.warn.push("fixace nejvýš "+b.maxFix+" let – počítám s "+b.maxFix);
  res.rate=bankRate(b,M.fix,M.ltv,R,t,M.loan,q,years);res.pay=payment(M.loan,res.rate,years);
  if(SP){const sr=spotrRate(b,q,t,M.loan,years);if(sr.w)res.warn.push(sr.w)}
  const stressed=res.rate+(t==="spotr"||t==="konsol"?0:(b.stress??1));
  const dstiCap=(t==="spotr"||t==="konsol")?(b.dstiSpotr||b.dsti||50):(b.dsti||50);
  const dtiCap=M.invest?Math.min(7,b.dti||9):(b.dti||9);
  if(IT.total>0){
    res.dsti=(payment(M.loan,stressed,years)+M.debts.inst)/IT.total*100;res.dti=(M.loan+M.debts.bal)/(IT.total*12);
    const L1=principalFor(IT.total*dstiCap/100-M.debts.inst,stressed,years),L2=isHypoLike(t)?dtiCap*12*IT.total-M.debts.bal:Infinity;
    res.maxLoan=Math.max(0,Math.min(L1,L2));
    if(M.loan>0){
      if(M.loan>res.maxLoan*1.12)res.ko.push("bonita nestačí – max. ≈ "+mil(res.maxLoan));
      else if(M.loan>res.maxLoan)res.warn.push("bonita na hraně – max. ≈ "+mil(res.maxLoan));
      else if(res.maxLoan>M.loan*1.2)res.plus.push("bonita s rezervou – max. ≈ "+mil(res.maxLoan));}
    if(M.invest&&res.dti>7)res.ko.push("investiční nemovitost: DTI "+res.dti.toFixed(1).replace(".",",")+" > 7 (ČNB od 1. 4. 2026)");
    if(t==="amer"&&res.dti>7)res.warn.push("americká hypotéka se podle ČNB bere jako investiční, dokud se neprokáže opak – DTI "+res.dti.toFixed(1).replace(".",",")+" nad 7 nemusí projít");
  }else if(applicants(q).some(z=>(z.prijmy||[]).length))res.ko.push("žádný příjem, který by banka započítala");
  /* silné a slabé stránky banky pro tenhle případ */
  const tags=caseTags(q,M);
  if(b.ageSoft&&isFinite(M.oldest)&&M.oldest+years>b.ageSoft&&!tags.has("senior"))res.warn.push("věk při splatnosti nad "+b.ageSoft+" let – u téhle banky jen podle profese / s mladším spolužadatelem");
  Object.entries(b.good||{}).forEach(([k,v])=>{if(tags.has(k))res.plus.push(v)});
  Object.entries(b.bad||{}).forEach(([k,v])=>{if(tags.has(k))res.warn.push(v)});
  if((q.ucty||[]).includes(b.id))res.plus.push("klient tu má účet – prostor pro slevu");
  if(b.costly&&isHypoLike(t))res.warn.push(b.costly);
  if(b.noIncDocsLtv&&isHypoLike(t)&&isFinite(M.ltv)&&M.ltv<=b.noIncDocsLtv)res.plus.push("LTV do "+b.noIncDocsLtv+" % – příjmy není nutné dokládat (stačí výpis / prohlášení)");
  if(tags.has("zelena")&&b.green)res.plus.push(b.green);
  return res;
}
/* pořadí bank: vyřazené dolů, u ostatních skóre podle sazby, rezervy v bonitě, priorit klienta a specialit banky */
function recommend(q,banks,R){
  q=q||{};const M=metrics(q,R);
  const list=banks.map(b=>evalBank(b,q,M,R));
  const ok=list.filter(r=>!r.ko.length);
  const rates=ok.map(r=>r.rate).filter(isFinite),avg=rates.length?rates.reduce((a,b)=>a+b,0)/rates.length:NaN;
  const pr=new Set(q.priority||[]);
  list.forEach(r=>{if(r.ko.length){r.score=-100+(r.na?-50:0)-r.ko.length;return}
    const b=r.b;let s=50;
    if(isFinite(avg)&&isFinite(r.rate))s+=(avg-r.rate)*40*(pr.has("sazba")||pr.has("splatka")?1.6:1);
    if(isFinite(r.maxLoan)&&M.loan>0)s+=Math.max(-10,Math.min(12,(r.maxLoan/M.loan-1)*25))*(pr.has("vyse")?1.8:1);
    if(pr.has("rychlost"))s+=((b.speed||3)-3)*5;if(pr.has("flex"))s+=((b.flex||3)-3)*5;
    if(pr.has("jednoduse"))s+=((b.simple||3)-3)*5;if(pr.has("online"))s+=((b.online||3)-3)*5;
    if(pr.has("splatka")&&r.years>=M.years)s+=2;
    s+=r.plus.length*4-r.warn.length*7;
    if((q.nechce||[]).includes(b.id))s-=60;
    if(r.model)s-=25;          /* BIDLI je záchrana, ne první volba */
    r.score=Math.round(s)});
  list.sort((a,b)=>b.score-a.score);
  let rank=0;list.forEach(r=>{r.verdict=r.ko.length?"no":r.warn.length?"cond":"ok";if(!r.ko.length)r.rank=++rank;if((q.nechce||[]).includes(r.id)&&!r.ko.length)r.verdict="excl"});
  return {M,list,tags:caseTags(q,M),alts:alternatives(q,M,list)};
}
/* co dělat, když to nevychází */
function alternatives(q,M,list){
  const A=[],t=q.typ||"hypo",good=list.filter(r=>!r.ko.length);
  if(isHypoLike(t)&&isFinite(M.ltv)&&M.ltv>M.ltvLimit+0.05&&t!=="amer"){
    const need=M.loan-M.coll*M.ltvLimit/100;
    A.push("Chybí ≈ "+mil(need)+" do LTV "+M.ltvLimit+" %: dozajistit další nemovitostí (rodiče – po 3–5 letech jde vyvázat), přidat vlastní zdroje, nebo americkou hypotékou na jinou nemovitost. Dorovnání spotřebákem ČNB nedoporučuje (obcházení LTV) – banka ho započte do bonity a u investičních hypoték ho výslovně zakazuje.");
    if(M.ltvLimit===80&&applicants(q).length>1)A.push("Je-li jednomu z manželů do 36 let, platí limit 90 % – u nesezdaných musí být pod 36 oba.");
  }
  if(M.invest)A.push("Investiční nemovitost (ČNB od 1. 4. 2026): LTV max. 70 % a DTI max. 7. Netýká se výstavby, rekonstrukce ani refinancování.");
  const bon=list.filter(r=>r.ko.some(k=>/bonita/.test(k)));
  if(bon.length&&!good.length){A.push("Bonita: prodloužit splatnost na maximum (věk), přidat spolužadatele, splatit drobné úvěry a zrušit nevyužité kreditky / kontokorenty (počítá se 3 % limitu), u OSVČ zkusit banku s obratovou metodou.")}
  if(applicants(q).some(z=>(z.prijmy||[]).some(i=>i.typ==="zam"&&yes(i.zkusebni))))A.push("Zkušební doba: připrav odhad, kupní smlouvu i podklady a žádost pošli den po skončení zkušební doby (výjimky jen při kontinuitě – stejný obor, dlouho u předchozího zaměstnavatele).");
  if(q.ucel==="druzstvo"||q.predmet==="druzstevni")A.push("Družstevní byt: úvěr se stavební spořitelnou bez zajištění (RSTS úvěr na družstevní bydlení), předhypoteční úvěr u banky, která ho umí, nebo zástava jiné nemovitosti. Pro nové družstevní projekty BIDLI.");
  if(isFinite(M.oldest)&&M.oldest+M.years>70)A.push("Věk: kratší splatnost, nebo banka, která splatnost odvodí od mladšího žadatele (ten musí bonitou pokrýt aspoň půlku úvěru).");
  if(q.termin&&dDiff(q.termin,todayStr())<=35)A.push("Termín je blízko: vybírej banky s rychlým schválením a online odhadem a domluv prodloužení lhůty v rezervační smlouvě, ještě než ji klient podepíše.");
  if(q.registry==="problem"||yes(q.exekuce)||yes(q.insolvence))A.push("Registry / exekuce: nejdřív výpis z registrů (BRKI a NRKI přes kolikmam.cz, SOLUS). Záznam v BRKI/NRKI zůstává 4 roky po skončení smlouvy, v negativním SOLUSu 3 roky po zaplacení – starý zaplacený dluh vysvětli, čerstvé prodlení (3–6 měsíců) obvykle neprojde.");
  if(isHypoLike(t)&&q.ucel==="refinancovani")A.push("Refinancování: ČNB doporučuje neprodlužovat splatnost oproti původní smlouvě. Mimo konec fixace hlídej náklady předčasného splacení (u smluv od 9/2024 max. 0,25 % za každý započatý rok zbývající fixace, celkem max. 1 %); bez sankce jde splatit do 3 měsíců od oznámení nové sazby.");
  if(isHypoLike(t)&&q.ucel==="rekonstrukce"&&M.loan>0&&M.loan<=3500000)A.push("Rekonstrukce do 2,5–3,5 mil.: zvaž nezajištěný úvěr na bydlení (Buřinka – peníze do 2 dnů, fotky místo faktur; Rekopůjčka RSTS; Modrá pyramida; UniCredit PRESTO) – bez odhadu, vkladu a výmazu zástavy. Nad ~1,5 mil. srovnej s hypotékou, je levnější."+(q.predmet==="rd"?" Na úspory energií rodinného domu: bezúročný úvěr Nová zelená úsporám (dílčí renovace až 750 tis., komplexní až 2 mil.; od 19. 10. 2026 ČSOB, další banky během podzimu).":""));
  if(t==="spotr"||t==="konsol"){
    A.push("Klientovi ukazuj RPSN a celkovou zaplacenou částku, ne „sazbu od“. "+(t==="konsol"?"U konsolidace porovnej, kolik dnes zaplatí celkem a kolik po sloučení – delší splatnost často znamená víc zaplaceno (400 tis. na 9 let = ~544 tis.).":"U spotřebitelského úvěru má klient 14 dní na odstoupení bez udání důvodu."));
    if(hasHypo(q))A.push("Klient splácí hypotéku: nezajištěný úvěr nejvýš na 8 let (doporučení ČNB). U větší částky zvaž navýšení hypotéky / americkou hypotéku – nižší sazba, ale zástava a delší splatnost.");
  }
  if(t==="amer")A.push("Americká (neúčelová) hypotéka: ČNB předpokládá investiční účel (LTV 70 %, DTI 7), pokud banka neprokáže opak. Úroky nejdou odečíst z daní.");
  return A;
}

/* ================= podklady na míru ================= */
/* každý řádek: k = klíč stavu, g = skupina, t = text pro poradce, c = text pro klienta (bez c = jen interní / zajistí poradce) */
function docsList(q,bank){
  q=q||{};const L=[],t=q.typ||"hypo",u=q.ucel||"koupe",zad=applicants(q),multi=zad.length>1;
  const add=(k,g,txt,cli)=>{if(!L.some(x=>x.k===k))L.push({k,g,t:txt,c:cli===undefined?txt:cli})};
  const hypo=isHypoLike(t);
  zad.forEach((z,i)=>{const who=multi?" – "+(z.jmeno||(i+1)+". žadatel"):"";const p="z"+i+":";
    add(p+"op","Totožnost","Občanský průkaz"+(z.obc&&z.obc!=="cz"?" / pas + povolení k pobytu":"")+" a druhý doklad (řidičák, pas)"+who);
    if(z.stav==="rozveden")add(p+"rozvod","Totožnost","Rozsudek o rozvodu (vypořádání SJM, výživné)"+who);
    (z.prijmy||[]).forEach((x,j)=>{const P=p+x.typ+j+":";
      if(x.typ==="zam"){add(P+"pot","Příjmy","Potvrzení o příjmu na formuláři banky (obvykle max. 30 dní staré)"+who);add(P+"vyp","Příjmy","Výpisy z účtu, kam chodí výplata – poslední 3 měsíce"+who);
        if(x.smlouva==="urcita")add(P+"ps","Příjmy","Pracovní smlouva na dobu určitou + dodatky o prodloužení"+who)}
      else if(x.typ==="dpc"||x.typ==="dpp")add(P+"pot","Příjmy","Potvrzení o příjmu a smlouva o "+(x.typ==="dpc"?"DPČ":"DPP")+who);
      else if(x.typ==="osvc"){if(x.rezim==="pausaldan"){add(P+"vyp","Příjmy","Výpisy z podnikatelského účtu za 6 měsíců – musí být vidět příjmy z faktur a měsíční platby paušální daně"+who);add(P+"pe","Příjmy","Přehled příjmů (příjmová evidence) – u některých bank potvrzený účetní"+who)}
        else{add(P+"dp","Příjmy","Daňové přiznání za poslední 1–2 roky + potvrzení o podání (datová schránka / EPO) a doklad o zaplacení daně"+who);add(P+"vyp","Příjmy","Výpisy z podnikatelského účtu za 3–6 měsíců"+who)}
        add(P+"bez","Příjmy","Potvrzení o bezdlužnosti (FÚ, ČSSZ, zdravotní pojišťovna) – jen když ho banka chce"+who);add(P+"zr","Příjmy","Výpis ze živnostenského rejstříku (stáhnu sám)"+who,"")}
      else if(x.typ==="sro"){add(P+"dppo","Příjmy","Přiznání k dani z příjmů PO + rozvaha a výsledovka za 2 roky"+who);add(P+"or","Příjmy","Výpis z obchodního rejstříku (zajistím)"+who,"");
        if(yes(x.vyplata))add(P+"zisk","Příjmy","Rozhodnutí o rozdělení zisku a doklad o jeho výplatě"+who);if(n0(x.odmena))add(P+"pot","Příjmy","Potvrzení o příjmu jednatele / mzdový list"+who)}
      else if(x.typ==="pronajem")add(P+"naj","Příjmy",x.zdroj==="dp"?"Daňové přiznání s příjmy z pronájmu (§ 9)"+who:x.zdroj==="budouci"?"Nájemní smlouva / odhad nájemného ke kupované nemovitosti"+who:"Nájemní smlouvy + výpisy s příchozím nájmem (s poznámkou „nájemné“)"+who);
      else if(x.typ==="rodic")add(P+"rod","Příjmy","Rozhodnutí o rodičovském příspěvku (ÚP) / peněžité pomoci (ČSSZ)"+(yes(x.navrat)?" + potvrzení zaměstnavatele o návratu":"")+who);
      else if(x.typ==="duchod")add(P+"duch","Příjmy","Rozhodnutí o důchodu (poslední valorizace) + výpis s příchozím důchodem"+who);
      else if(x.typ==="zahr"){add(P+"zps","Příjmy","Pracovní smlouva v zahraničí (případně s překladem)"+who);add(P+"vyp","Příjmy","Výplatní pásky za 3–6 měsíců (Lohnzettel) a roční zúčtování"+who);add(P+"ucet","Příjmy","Výpisy z účtu s příchozí mzdou"+who)}
      else if(x.typ==="vyzivne")add(P+"roz","Příjmy","Rozsudek o výživném + výpisy s příchozími platbami"+who);
      else if(x.typ==="diety")add(P+"dt","Příjmy","Potvrzení zaměstnavatele o pravidelných dietách (formulář banky)"+who);
      else if(x.typ==="provize")add(P+"prov","Příjmy","Provizní sestavy ZFPA (12–24 měsíců) potvrzené centrálou + výpisy z účtu"+who);
      else if(x.typ==="jiny")add(P+"jiny","Příjmy","Doklad k příjmu: "+(x.popis||"jiný příjem")+who);
    });
  });
  if(t==="spotr"||t==="konsol"){
    if((q.zav||[]).some(d=>yes(d.splatit))||t==="konsol")add("konsol","Závazky","Smlouvy nebo poslední výpisy k úvěrům, které se splatí (číslo účtu a variabilní symbol)");
    if(yes(q.bydleni))add("bydu","Nemovitost",q.bydUcel==="druz"?"Smlouva o převodu členských práv / nájemní smlouva k družstevnímu bytu a potvrzení družstva":q.bydUcel==="vyp"?"Dohoda / rozsudek o vypořádání (SJM, spoluvlastnictví, dědictví)":"Rozpočet nebo nabídky firem – účel se dokládá (fakturami / fotkami) do 6–12 měsíců");
    add("psd2","Totožnost","Přístup do internetového bankovnictví (ověření přes Bankovní identitu / PSD2)");
  }
  (q.zav||[]).forEach((d,i)=>{if(yes(d.splatit)&&t!=="konsol")add("zav"+i,"Závazky","Vyčíslení zůstatku k doplacení: "+(DEBT_T[d.typ]||"úvěr")+(d.banka?" ("+d.banka+")":""))});
  if(hypo){
    const own=q.zajisteni==="jina"?"":"";
    if(u==="koupe"||u==="pozvyst"){
      if(q.prodavajici==="developer"){add("rez","Nemovitost","Rezervační smlouva / smlouva o smlouvě budoucí s developerem + platební kalendář");add("dev","Nemovitost","Výpis z OR developera, prohlášení vlastníka / stavební povolení (zajistím)","")}
      else if(q.prodavajici==="drazba"){add("drazba","Nemovitost","Dražební vyhláška, usnesení o příklepu, doklad o dražební jistotě")}
      else add("rez","Nemovitost","Rezervační smlouva (lhůty!) a návrh kupní smlouvy");
      if(q.prodavajici!=="drazba")add("uschova","Nemovitost","Návrh smlouvy o úschově (advokát / notář / banka)");
    }
    if(["vystavba","pozvyst"].includes(u)){add("povoleni","Nemovitost","Pravomocné povolení záměru (dříve stavební povolení) – banky ho chtějí před prvním čerpáním");add("pd","Nemovitost","Projektová dokumentace, položkový rozpočet a harmonogram stavby");add("sod","Nemovitost","Smlouva o dílo se stavební firmou, u svépomoci odborný stavební dozor");if(u==="pozvyst"||q.predmet==="pozemek")add("pozst","Nemovitost","Doklad, že je pozemek stavební (územní plán / vyjádření stavebního úřadu) a jak se napojí na sítě")}
    if(u==="rekonstrukce"){add("rozp","Nemovitost","Rozpočet rekonstrukce po položkách (7–10 položek s cenami) / nabídky firem");add("povoleni","Nemovitost","Stavební povolení nebo ohlášení (jen u změny stavby)")}
    if(u==="refinancovani"){add("refsml","Nemovitost","Smlouva o stávajícím úvěru + dodatky");add("refvyc","Nemovitost","Potvrzení o zůstatku úvěru / vyčíslení k datu splacení");add("refvyp","Nemovitost","Výpis splátek za posledních 12 měsíců (bez prodlení)");add("reffix","Nemovitost","Dopis banky o konci fixace / nové sazbě")}
    if(u==="vyporadani")add("vyp","Nemovitost","Rozsudek o rozvodu s doložkou právní moci + dohoda / rozsudek o vypořádání SJM (kdo přebírá dluh), případně dědické usnesení");
    if(u==="druzstvo"||q.predmet==="druzstevni"){add("druz","Nemovitost","Smlouva o převodu družstevního podílu (návrh), nájemní smlouva k bytu, stanovy a výpis z OR družstva");add("druzpot","Nemovitost","Potvrzení družstva o podílu a nedoplatcích")}
    if(q.predmet==="byt"&&u!=="refinancovani")add("svj","Nemovitost","Potvrzení správce domu (SVJ) o bezdlužnosti prodávajícího");
    add("lv","Nemovitost","List vlastnictví zastavované nemovitosti (stáhnu sám)","");
    add("odhad","Nemovitost","Podklady k odhadu: půdorys / prohlášení vlastníka, fotky, rok výstavby (byt často online odhad)");
    if(["A","B","C"].includes(q.penb)||q.prodavajici==="developer")add("penb","Nemovitost","Průkaz energetické náročnosti budovy (PENB) – kvůli zelené slevě");
    if(q.zajisteni==="treti"||q.zajisteni==="obe"||q.zajisteni==="jina")add("zajist","Nemovitost","Doklady k další zastavované nemovitosti (LV, podklady k odhadu)"+(q.zajisteni==="treti"?" + občanky zástavců (podpis zástavní smlouvy)":""));
    add("vlastni","Nemovitost","Doklad o vlastních zdrojích (výpis z účtu / stavebka / investice – kvůli AML)");
    const Z=q.zdroje||[];if(Z.includes("dar"))add("dar","Nemovitost","Darovací smlouva / potvrzení o daru a výpis, odkud peníze přišly");
    if(Z.includes("prodej"))add("prodej","Nemovitost","Kupní smlouva k prodávané nemovitosti a výpis s příchozí kupní cenou");
    if(Z.includes("investice"))add("inv","Nemovitost","Výpis z investiční platformy / prodeje (u kryptoměn historie transakcí a doklad o zdanění – peníze nech pár měsíců „odležet“ v Kč)");
    add("pojist","Čerpání","Pojištění nemovitosti s vinkulací ve prospěch banky (před čerpáním)");
    add("vklad","Čerpání","Návrh na vklad zástavního práva s potvrzením o podání na katastr (správní poplatek 2 000 Kč – kolky už nejdou)");
  }
  add("zfpa_karta","ZFPA (interní)","Karta klienta – záznam z jednání","");
  add("zfpa_gdpr","ZFPA (interní)","Souhlas se zpracováním osobních údajů (pokud ho ještě nemáš)","");
  add("zfpa_info","ZFPA (interní)","Informační list","");
  add("zfpa_zaznam","ZFPA (interní)","Záznam o zprostředkování úvěru (2026: verze 260424_FK)","");
  add("zfpa_srov","ZFPA (interní)","Výstup z HypoUP nebo 3 modelace / přehled zpracovaných nabídek","");
  add("zfpa_kopie","ZFPA (interní)","Kopie / náhled úvěrové smlouvy","");
  if(bank&&bank.docs)bank.docs.forEach((d,i)=>add("b_"+bank.id+"_"+i,"Specifika banky",bank.s+": "+d,""));
  return L;
}
/* text pro klienta: co ještě chybí (jen položky, které chystá klient) */
function clientDocsText(q,state,bank,sign){
  const miss=docsList(q,bank).filter(d=>d.c&&!(state&&state[d.k]&&state[d.k]!=="")).map(d=>"• "+d.c);
  if(!miss.length)return "";
  return "Dobrý den,\npro vyřízení úvěru prosím připravte:\n"+miss.join("\n")+(sign?"\n\n"+sign:"");
}

/* ================= vzhled (jen barvy ZFP: oranžová, černá, bílá, šedé) ================= */
const CSS=`
.uv{--uv-z:var(--accent);--uv-zs:var(--accent-soft);--uv-o1:rgba(232,87,26,.30);--uv-o2:rgba(232,87,26,.45);--uv-o3:rgba(232,87,26,.60);--uv-o4:rgba(232,87,26,.75);--uv-o5:rgba(232,87,26,.88);--uv-o6:#E8571A;--uv-done:var(--ink);--uv-g1:#8E8E93;--uv-g2:#AEAEB2;--uv-g3:#636366;
  --uv-card:var(--surface);--uv-bg:var(--canvas);--uv-l:var(--ink);--uv-l2:var(--ink-2,rgba(60,60,67,.6));--uv-l3:var(--ink-3,rgba(60,60,67,.3));--uv-sep:var(--line,rgba(60,60,67,.18));--uv-fill:var(--fill,rgba(120,120,128,.12));
  color:var(--uv-l);font-size:15px}
.uv *{box-sizing:border-box}
.uv button{font:inherit;color:inherit;cursor:pointer}
.uv input[type=checkbox]{accent-color:var(--uv-z);width:18px;height:18px;flex:none}
.uv details.uv-bank>summary{list-style:none;cursor:pointer}
.uv details.uv-bank>summary::-webkit-details-marker{display:none}
.uv details.uv-bank[open]>summary .uv-chev{transform:rotate(90deg)}
.uv-chev{display:inline-block;transition:transform .15s;color:var(--uv-l2);margin-left:2px}
.uv input,.uv select,.uv textarea{font:inherit;color:var(--uv-l);background:var(--uv-card);border:1px solid var(--uv-sep);border-radius:10px;padding:9px 11px;width:100%;min-width:0;outline:none}
.uv input:focus,.uv select:focus,.uv textarea:focus{border-color:var(--uv-z);box-shadow:0 0 0 3px var(--uv-zs)}
.uv textarea{min-height:70px;resize:vertical}
.uv .btn{border:1px solid var(--uv-sep);background:var(--uv-card);border-radius:10px;padding:8px 12px;font-weight:500;white-space:nowrap}
.uv .btn:hover{border-color:var(--uv-z)}
.uv .btn.pri{background:var(--uv-z);border-color:var(--uv-z);color:#fff}
.uv .btn.ghost{background:transparent;border-color:transparent;color:var(--uv-z);padding:8px 6px}
.uv .btn.sm{padding:5px 9px;font-size:13px;border-radius:8px}
.uv .btn[disabled]{opacity:.45;cursor:default}
.uv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
.uv-bar .uv-q{flex:1 1 200px;max-width:340px}
.uv-bar .sp{flex:1}
.uv-seg{display:inline-flex;gap:6px;flex-wrap:wrap}
.uv-seg button{border:0;background:var(--uv-card);border-radius:999px;padding:7px 13px;font-size:14px;color:var(--uv-z);font-weight:500;box-shadow:var(--card-shadow,none)}
.uv-seg button.on{background:var(--uv-z);color:#fff;font-weight:600}
.uv-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 14px}
.uv-tile{background:var(--uv-card);border-radius:14px;padding:11px 13px;box-shadow:var(--card-shadow,none)}
.uv-tile .k{font-size:12.5px;color:var(--uv-l2);display:flex;gap:6px;align-items:center}
.uv-tile .k i{width:8px;height:8px;border-radius:50%;background:var(--uv-z);display:inline-block}
.uv-tile .v{font-size:21px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}
.uv-tile .h{font-size:12px;color:var(--uv-l2);margin-top:2px}
.uv-tile.alert .v{color:var(--uv-z)}
.uv-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:10px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x proximity}
.uv-col{background:var(--uv-fill);border-radius:14px;padding:8px;min-height:120px;scroll-snap-align:start;display:flex;flex-direction:column;gap:7px}
.uv-col.drop{outline:2px dashed var(--uv-z);outline-offset:-2px}
.uv-colh{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;padding:2px 4px 4px}
.uv-colh .t{display:flex;gap:6px;align-items:center}
.uv-colh i{width:9px;height:9px;border-radius:50%;display:inline-block}
.uv-colh .n{color:var(--uv-l2);font-weight:500}
.uv-colm{font-size:12px;color:var(--uv-l2);padding:0 4px 2px;margin-top:-4px}
.uv-card{display:block;text-align:left;width:100%;border:0;background:var(--uv-card);border-radius:12px;padding:10px 11px;box-shadow:var(--card-shadow,0 1px 2px rgba(0,0,0,.05));border-left:3px solid var(--sc,var(--uv-z))}
.uv-card:hover{box-shadow:0 2px 10px rgba(0,0,0,.08)}
.uv-card .c1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.uv-card .c1 b{font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uv-card .amt{font-size:13px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.uv-card .c2{font-size:12.5px;color:var(--uv-l2);margin-top:2px}
.uv-card .c3{font-size:12.5px;margin-top:5px}
.uv-card .c3.late{color:var(--uv-z);font-weight:600}
.uv-pills{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.uv-pill{font-size:11.5px;border-radius:999px;padding:2px 8px;background:var(--uv-fill);color:var(--uv-l2);white-space:nowrap}
.uv-pill.o{background:var(--uv-zs);color:var(--uv-z);font-weight:600}
.uv-pill.solid{background:var(--uv-z);color:#fff;font-weight:600}
.uv-add{border:1px dashed var(--uv-sep);background:transparent;border-radius:12px;padding:9px;color:var(--uv-l2);font-size:13.5px}
.uv-empty{color:var(--uv-l2);font-size:13.5px;padding:8px 4px}
.uv-foot{font-size:12.5px;color:var(--uv-l2);line-height:1.5;margin:12px 2px 0}
.uv-box{background:var(--uv-card);border-radius:16px;padding:14px 16px;box-shadow:var(--card-shadow,none);margin:0 0 12px}
.uv-h3{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;color:var(--uv-l2);margin:18px 2px 8px}
.uv-h3:first-child{margin-top:2px}
/* detail případu */
.uv-ch{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 10px}
.uv-ch .tt{flex:1 1 220px;min-width:0}
.uv-ch h2{font-size:22px;margin:0;line-height:1.2;overflow:hidden;text-overflow:ellipsis}
.uv-ch .sub{font-size:13.5px;color:var(--uv-l2);margin-top:2px}
.uv-ch select{width:auto;font-weight:600}
.uv-steps{display:flex;gap:3px;margin:0 0 12px}
.uv-steps span{flex:1;height:5px;border-radius:3px;background:var(--uv-fill)}
.uv-steps span.on{background:var(--uv-z)}
.uv-next{display:grid;grid-template-columns:1fr 170px auto;gap:8px;align-items:center;margin:0 0 12px}
.uv-next label{font-size:12.5px;color:var(--uv-l2)}
.uv-tabs{display:flex;gap:4px;overflow-x:auto;margin:0 0 12px;border-bottom:1px solid var(--uv-sep)}
.uv-tabs button{border:0;background:transparent;padding:9px 12px;font-size:14.5px;color:var(--uv-l2);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.uv-tabs button.on{color:var(--uv-l);font-weight:600;border-bottom-color:var(--uv-z)}
.uv-tabs .cnt{font-size:11.5px;background:var(--uv-zs);color:var(--uv-z);border-radius:999px;padding:1px 6px;margin-left:4px;font-weight:600}
/* dotazník */
.uv-wiz{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
.uv-wsteps{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.uv-wsteps button{border:1px solid var(--uv-sep);background:var(--uv-card);border-radius:999px;padding:5px 11px;font-size:13px;color:var(--uv-l2)}
.uv-wsteps button.on{border-color:var(--uv-z);color:var(--uv-z);font-weight:600}
.uv-wsteps button.done{color:var(--uv-l)}
.uv-wsteps button.done::before{content:"✓ ";color:var(--uv-z)}
.uv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}
.uv-grid.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.uv-f{display:flex;flex-direction:column;gap:5px;min-width:0}
.uv-f.wide{grid-column:1/-1}
.uv-f>label,.uv-lbl{font-size:13px;color:var(--uv-l2);font-weight:500}
.uv-f .hint{font-size:12px;color:var(--uv-l2);line-height:1.4}
.uv-in{position:relative}
.uv-in .suf{position:absolute;right:11px;top:50%;transform:translateY(-50%);color:var(--uv-l2);font-size:13.5px;pointer-events:none}
.uv-in input{padding-right:42px}
.uv-chips{display:flex;flex-wrap:wrap;gap:6px}
.uv-chip{border:1px solid var(--uv-sep);background:var(--uv-card);border-radius:999px;padding:7px 12px;font-size:14px}
.uv-chip.on{background:var(--uv-z);border-color:var(--uv-z);color:#fff;font-weight:600}
.uv-chip.big{border-radius:12px;padding:10px 14px}
.uv-sub{border:1px solid var(--uv-sep);border-radius:14px;padding:12px;margin:0 0 10px;background:var(--uv-card)}
.uv-subh{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 10px;font-weight:600}
.uv-wnav{display:flex;justify-content:space-between;gap:8px;margin-top:14px}
.uv-live{position:sticky;top:10px;display:flex;flex-direction:column;gap:8px}
.uv-lv>summary{list-style:none;display:flex;align-items:center;gap:10px;cursor:default;margin:0 0 8px}
.uv-lv>summary::-webkit-details-marker{display:none}
.uv-lvs{display:none}
.uv-kv{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:5px 0;border-bottom:1px solid var(--uv-sep)}
.uv-kv:last-child{border-bottom:0}
.uv-kv span{color:var(--uv-l2)}
.uv-kv b{font-variant-numeric:tabular-nums;text-align:right}
.uv-kv b.bad{color:var(--uv-z)}
.uv-bar2{height:6px;background:var(--uv-fill);border-radius:3px;overflow:hidden;margin-top:4px}
.uv-bar2 i{display:block;height:100%;background:var(--uv-z)}
/* výsledek – banky */
.uv-mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px;margin:0 0 12px}
.uv-m{background:var(--uv-card);border-radius:12px;padding:10px 12px;box-shadow:var(--card-shadow,none)}
.uv-m .k{font-size:12px;color:var(--uv-l2)}
.uv-m .v{font-size:18px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.uv-m .s{font-size:12px;color:var(--uv-l2);margin-top:1px}
.uv-m.bad .v{color:var(--uv-z)}
.uv-bank{background:var(--uv-card);border-radius:14px;padding:12px 14px;margin:0 0 8px;box-shadow:var(--card-shadow,none);border:1px solid transparent}
.uv-bank.top{border-color:var(--uv-z)}
.uv-bank.no{opacity:.7}
.uv-bh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.uv-bh .rk{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13.5px;background:var(--uv-fill);flex:none}
.uv-bank.top .rk{background:var(--uv-z);color:#fff}
.uv-bh .nm{font-weight:700;font-size:15.5px;flex:1;min-width:140px}
.uv-bh .nums{display:flex;gap:14px;font-size:13px;color:var(--uv-l2);flex-wrap:wrap}
.uv-bh .nums b{color:var(--uv-l);font-variant-numeric:tabular-nums}
.uv-vd{font-size:12px;font-weight:700;border-radius:999px;padding:3px 9px;white-space:nowrap}
.uv-vd.top{background:var(--uv-z);color:#fff}
.uv-vd.ok{background:var(--uv-zs);color:var(--uv-z)}
.uv-vd.cond{background:var(--uv-fill);color:var(--uv-l)}
.uv-vd.no,.uv-vd.excl{background:var(--uv-fill);color:var(--uv-l2)}
.uv-why{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:4px 16px;margin-top:9px;font-size:13.5px;line-height:1.4}
.uv-why div{display:flex;gap:7px}
.uv-why .ic{flex:none;width:16px;text-align:center;font-weight:700}
.uv-why .p .ic{color:var(--uv-z)}
.uv-why .w .ic{color:var(--uv-l2)}
.uv-why .x{color:var(--uv-l2)}
.uv-why .x .ic{color:var(--uv-l2)}
.uv-more{font-size:12.5px;color:var(--uv-l2);margin-top:8px;line-height:1.45}
.uv-alts{margin:0;padding-left:18px;line-height:1.5;font-size:14px}
.uv-alts li{margin:3px 0}
.uv-note{background:var(--uv-zs);border-radius:12px;padding:10px 12px;font-size:13.5px;line-height:1.45;margin:0 0 12px}
.uv-note.gray{background:var(--uv-fill)}
/* podklady */
.uv-docg{margin:0 0 12px}
.uv-doc{display:flex;gap:10px;align-items:flex-start;padding:8px 2px;border-bottom:1px solid var(--uv-sep);font-size:14px;line-height:1.35}
.uv-doc:last-child{border-bottom:0}
.uv-doc .ck{flex:none;width:22px;height:22px;border-radius:6px;border:1.5px solid var(--uv-sep);display:grid;place-items:center;background:var(--uv-card);padding:0;font-size:13px;color:#fff}
.uv-doc .ck.on{background:var(--uv-z);border-color:var(--uv-z)}
.uv-doc .ck.na{background:var(--uv-fill);border-color:var(--uv-fill);color:var(--uv-l2)}
.uv-doc .tx{flex:1}
.uv-doc .tx small{display:block;color:var(--uv-l2);font-size:12px;margin-top:1px}
.uv-doc.done .tx{color:var(--uv-l2)}
.uv-doc .na-b{border:0;background:transparent;color:var(--uv-l2);font-size:12px;padding:2px 4px}
/* nabídky */
.uv-tw{overflow-x:auto}
.uv-tab{width:100%;border-collapse:collapse;font-size:13.5px;min-width:720px}
.uv-tab th{font-size:12px;color:var(--uv-l2);font-weight:600;text-align:left;padding:6px 6px;border-bottom:1px solid var(--uv-sep);white-space:nowrap}
.uv-tab td{padding:6px;border-bottom:1px solid var(--uv-sep);vertical-align:middle}
.uv-tab td input,.uv-tab td select{padding:6px 8px;border-radius:8px}
.uv-tab td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.uv-tab tr.sel td{background:var(--uv-zs)}
.uv-tab tr.best td.r b{color:var(--uv-z)}
/* průběh */
.uv-flow{display:flex;flex-direction:column;gap:6px}
.uv-st{border-radius:12px;background:var(--uv-card);padding:10px 12px;border:1px solid var(--uv-sep)}
.uv-st.cur{border-color:var(--uv-z);box-shadow:0 0 0 3px var(--uv-zs)}
.uv-st.past{opacity:.72}
.uv-sth{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14.5px}
.uv-sth i{width:10px;height:10px;border-radius:50%;display:inline-block}
.uv-sth .d{margin-left:auto;font-size:12px;color:var(--uv-l2);font-weight:500}
.uv-tk{display:flex;gap:9px;align-items:center;font-size:13.5px;padding:5px 0}
.uv-log{font-size:13.5px;line-height:1.45}
.uv-log div{padding:5px 0;border-bottom:1px solid var(--uv-sep)}
.uv-log span{color:var(--uv-l2);font-size:12px;margin-right:6px}
.uv-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.uv-list .it{display:flex;gap:10px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--uv-sep)}
.uv-list .it .m{flex:1;min-width:0}
.uv-list .it .m b{display:block}
.uv-list .it .m span{font-size:12.5px;color:var(--uv-l2)}
.uv-pick{position:relative}
.uv-pl{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:var(--uv-card);border:1px solid var(--uv-sep);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:280px;overflow:auto;z-index:20}
.uv-pl button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:9px 12px;font-size:14px}
.uv-pl button:hover,.uv-pl button.on{background:var(--uv-zs)}
.uv-box.uv-bp{padding:12px 14px;margin:0 0 8px}
.uv-bp summary{cursor:pointer;font-weight:600;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.uv-bp summary::after{content:"›";margin-left:auto;color:var(--uv-l2);transition:transform .15s}
.uv-bp[open] summary::after{transform:rotate(90deg)}
.uv-bp summary span{font-weight:400;color:var(--uv-l2);font-size:13px}
.uv-kb{background:var(--uv-card);border-radius:14px;margin:0 0 8px;box-shadow:var(--card-shadow,none)}
.uv-kb>summary{list-style:none;cursor:pointer;padding:12px 38px 12px 14px;display:flex;gap:6px 10px;align-items:center;flex-wrap:wrap;position:relative}
.uv-kb>summary::-webkit-details-marker{display:none}
.uv-kb>summary::after{content:"›";position:absolute;right:15px;top:10px;color:var(--uv-l2);font-size:20px;transition:transform .15s}
.uv-kb[open]>summary::after{transform:rotate(90deg)}
.uv-kb .nm{font-weight:700;font-size:15.5px}
.uv-kb .kt{font-size:12.5px;color:var(--uv-l2)}
.uv-kb .bd{padding:0 14px 14px}
.uv-kb .ab{font-size:14px;line-height:1.5;margin:0 0 8px}
.uv-pc{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:10px;margin:0 0 10px}
.uv-pc>div{background:var(--uv-bg);border-radius:12px;padding:10px 12px;min-width:0}
.uv-pc h4,.uv-at h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--uv-l2)}
.uv-pc ul{margin:0;padding:0;list-style:none;font-size:13.5px;line-height:1.45}
.uv-pc li{display:flex;gap:7px;margin:3px 0}
.uv-pc li i{font-style:normal;font-weight:700;flex:none;width:14px;text-align:center}
.uv-pc .p i{color:var(--uv-z)}
.uv-pc .m i{color:var(--uv-l2)}
.uv-at{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:10px}
.uv-at>div{border:1px solid var(--uv-sep);border-radius:12px;padding:10px 12px;min-width:0}
.uv-at dl{margin:0;display:grid;grid-template-columns:minmax(96px,38%) minmax(0,1fr);gap:6px 10px;font-size:13.5px;line-height:1.4}
.uv-at dt{color:var(--uv-l2)}
.uv-at dd{margin:0;font-weight:500;min-width:0;overflow-wrap:anywhere}
.uv-at dd small{display:block;font-weight:400;color:var(--uv-l2);margin-top:2px}
.uv-dots{letter-spacing:2px;color:var(--uv-z);white-space:nowrap}
.uv-dots s{text-decoration:none;color:var(--uv-l3)}
.uv-gl h4{margin:16px 2px 6px;font-size:12.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--uv-l2)}
.uv-gl h4:first-child{margin-top:2px}
.uv-gl dl{margin:0 0 6px;background:var(--uv-card);border-radius:14px;padding:2px 14px;box-shadow:var(--card-shadow,none)}
.uv-gl .t{padding:9px 0;border-bottom:1px solid var(--uv-sep)}
.uv-gl .t:last-child{border-bottom:0}
.uv-gl dt{font-weight:700;font-size:14.5px}
.uv-gl dd{margin:3px 0 0;font-size:13.5px;line-height:1.5;color:var(--uv-l2)}
.uv-tab.uv-cmp{min-width:860px}
.uv-cmp td,.uv-cmp th{vertical-align:top;font-size:13px;line-height:1.35}
.uv-cmp th{white-space:normal}
.uv-cmp th:first-child,.uv-cmp td:first-child{position:sticky;left:0;z-index:1;background:var(--uv-card);color:var(--uv-l2);font-weight:600;min-width:128px;max-width:150px}
.uv-help{display:inline-block;border:0;background:var(--uv-fill);color:var(--uv-l2);min-width:18px;height:18px;border-radius:9px;font-size:11px;font-weight:700;line-height:18px;padding:0 5px;margin-left:4px;vertical-align:1px;cursor:pointer}
@media (max-width:760px){
  .uv-wiz{grid-template-columns:minmax(0,1fr)}
  .uv-live{position:static}
  .uv-lv>summary{cursor:pointer;min-height:44px;margin:-14px -16px;padding:0 16px}
  .uv-lv[open]>summary{margin-bottom:6px}
  .uv-lv>summary::after{content:"›";margin-left:auto;color:var(--uv-l2);font-size:20px;transition:transform .15s}
  .uv-lv[open]>summary::after{transform:rotate(90deg)}
  .uv-lvs{display:block;flex:1;min-width:0;font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
  .uv-lv[open] .uv-lvs{display:none}
  /* statistiky v jednom vodorovném pásu */
  .uv-tiles{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;margin:0 -16px 12px;padding:2px 16px 4px;scrollbar-width:none}
  .uv-tiles::-webkit-scrollbar{display:none}
  .uv-tile{flex:0 0 auto;min-width:118px;max-width:46%;padding:8px 11px;scroll-snap-align:start}
  .uv-tile .v{font-size:17px;margin-top:1px}
  .uv-tile .h{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* iOS: pole min. 16 px (jinak se stránka při psaní přiblíží), dotykové cíle min. 40 px */
  .uv input,.uv select,.uv textarea{font-size:16px;min-height:44px}
  .uv input[type=checkbox]{min-height:0;width:22px;height:22px}
  .uv .btn,.uv .btn.sm,.uv-seg button,.uv-chip,.uv-wsteps button,.uv-tabs button,.uv-add,.uv-pl button,.uv-doc .na-b{min-height:40px}
  .uv .btn.sm{font-size:14px}
  .uv-doc .ck{position:relative}
  .uv-doc .ck::after{content:"";position:absolute;inset:-9px}
  .uv-help{min-width:28px;height:28px;line-height:28px;border-radius:14px;font-size:12px;position:relative}
  .uv-help::after{content:"";position:absolute;inset:-6px}
  .uv-tab td input,.uv-tab td select{min-height:40px}
  .uv-grid,.uv-grid.g3{grid-template-columns:1fr}
  .uv-next{grid-template-columns:1fr 1fr}
  .uv-next .btn{grid-column:1/-1}
  .uv-board{grid-auto-columns:82%}
  .uv-ch h2{font-size:19px}
  .uv-ch .btn{padding:6px 10px;font-size:14px}
  .uv-ch select{padding:6px 8px}
  .uv-bh .nums{gap:8px 12px}
}
@media print{.uv-bar,.uv-tabs,.uv-next{display:none}}
`;

/* ================= appka ================= */
const BASE=(()=>{try{return (document.currentScript&&document.currentScript.src||location.href).replace(/[^/]*$/,"")}catch(e){return ""}})();
const STEPS=["Účel","Financování","Žadatelé","Příjmy","Závazky","Preference"];
const TABS=[["dotaznik","Dotazník"],["banky","Banky"],["podklady","Podklady"],["nabidky","Nabídky"],["prubeh","Průběh"]];
const LOST=["Zamítnuto bankou","Nevyšla bonita","Klient nekoupil / odstoupil","Vyřídil si sám v bance","Šel k jinému poradci","Jiný důvod"];
/* parametry banky = výchozí BANKS + úpravy z appky (kolekce uvcfg) */
function mergeBank(b,o){if(!o)return b;const r={...b,...o};["ltv","osvc","inc","purp","foreign","rates","provize"].forEach(k=>{if(o[k]&&typeof o[k]==="object")r[k]={...(b[k]||{}),...o[k]}});return r}
function loanOf(c){const q=c&&c.q||{};return n0(c&&c.amount)||n0(q.uver)||Math.max(0,n0(q.cena)-n0(q.vlastni))}
function fixEndOf(c){const d=c&&c.dates&&c.dates.cerpani,f=n0(c&&c.fixYears)||n0(c&&c.q&&c.q.fixace);return d&&f?addMonthsStr(d,Math.round(f*12)):""}

function mount(root,opts={}){
  if(!document.getElementById("uvCss")){const st=document.createElement("style");st.id="uvCss";st.textContent=CSS;document.head.append(st)}
  const store=opts.store||null,toast=opts.toast||(m=>console.log(m));
  const ls=opts.ls||{get:k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  const clientsFn=opts.clients||(()=>[]),ensure=opts.ensure||null;
  const UIK="uv_ui_v1";
  let ui={view:"board",id:null,tab:"dotaznik",step:0,f:"",ft:"all",kseg:"inst",kf:"all",...(ls.get(UIK)||{})};ui.kq="";
  let cases=[],cfg={banks:{}},cur=null,saveT=null,newSt={q:"",pick:null,typ:"hypo",name:""},drag=null;
  const keepUi=()=>ls.set(UIK,{view:ui.view,id:ui.id,tab:ui.tab,step:ui.step,ft:ui.ft});
  const banks=()=>BANKS.map(b=>mergeBank(b,(cfg.banks||{})[b.id]));
  const bankById=id=>banks().find(b=>b.id===id)||null;
  const entries=()=>{try{return clientsFn().slice()}catch(e){return[]}};
  const entryOf=c=>{if(!c)return null;const E=entries();return E.find(e=>c.cid&&e.rec&&e.rec.id===c.cid)||E.find(e=>c.lid&&e.lead&&e.lead.id===c.lid)||E.find(e=>c.eid&&e.id===c.eid)||null};
  const sign=()=>{try{return opts.sign?opts.sign():""}catch(e){return""}};

  if(store){
    store.collection("uvery").onSnapshot(s=>{cases=s.docs.map(d=>({id:d.id,...d.data()}));onCases()});
    store.doc("uvcfg/main").onSnapshot(s=>{cfg=s&&s.exists?(s.data()||{banks:{}}):{banks:{}};if(!cfg.banks)cfg.banks={};if(ui.view==="banks"||ui.view==="katalog"||(ui.view==="case"&&(ui.tab==="banky"||ui.tab==="podklady")))draw()});
  }
  try{fetch(opts.ratesUrl||BASE+"sazby.json",{cache:"no-cache"}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.fix){RATES=j;if(ui.view==="case")draw()}}).catch(()=>{})}catch(e){}

  function onCases(){
    if(ui.view==="case"){
      const d=cases.find(c=>c.id===ui.id);
      if(!d){if(cur&&!saveT){cur=null;ui.view="board";keepUi();draw()}return}
      if(!cur||cur.id!==d.id){cur=clone(d);draw();return}
      if(saveT)return;                                   /* čeká se na uložení vlastních změn */
      const strip=o=>{const x={...o};delete x.updatedAt;return x};
      if(jeq(strip(d),strip(cur)))return;
      const a=document.activeElement;if(a&&root.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;   /* píše – nepřekreslovat pod rukama */
      cur=clone(d);draw();return}
    if(ui.view==="board"||ui.view==="fix")draw();
  }
  function save(now){
    if(!cur||!store)return;cur.updatedAt=Date.now();
    const i=cases.findIndex(c=>c.id===cur.id);if(i>=0)cases[i]=clone(cur);
    clearTimeout(saveT);
    const go=()=>{saveT=null;const d=clone(cur);delete d.id;store.doc("uvery/"+cur.id).set(d).catch(()=>toast("Nepodařilo se uložit"))};
    if(now)go();else saveT=setTimeout(go,450);
  }
  function logAdd(c,t){c.log=[...(c.log||[]),{d:new Date().toISOString(),t}].slice(-200)}
  function moveStage(c,k){
    if(!c||c.stage===k)return;const was=STAGE(c.stage).t,prevAuto=c.autoStep&&c.nextStep===c.autoStep;c.stage=k;c.stageAt={...(c.stageAt||{}),[k]:new Date().toISOString()};
    logAdd(c,"Fáze: "+was+" → "+STAGE(k).t);
    if(k==="cerpano"){if(!(c.dates&&c.dates.cerpani))c.dates={...(c.dates||{}),cerpani:todayStr()};c.tasks={...(c.tasks||{}),"cerpano:cerpanoD":c.tasks&&c.tasks["cerpano:cerpanoD"]||new Date().toISOString()}}
    /* další krok: první nesplněný úkol nové fáze (jen když tam nebyl vlastní text) */
    if(!c.nextStep||prevAuto||c.nextDate&&c.nextDate<todayStr()){
      if(k==="zamitnuto"){c.nextStep="";c.nextDate="";c.autoStep=""}
      else if(k==="odlozeno"){c.nextStep="Ozvat se znovu";c.nextDate=addDaysStr(todayStr(),30);c.autoStep=c.nextStep}
      else{const t=stageTasks(c,k).find(([x])=>!(c.tasks||{})[k+":"+x]);if(t){c.nextStep=t[1];c.nextDate=addDaysStr(todayStr(),k==="schvalovani"?3:1);c.autoStep=t[1]}}}
  }
  async function moveById(id,k){const c=cases.find(x=>x.id===id);if(!c||!store)return;const d=clone(c);moveStage(d,k);d.updatedAt=Date.now();delete d.id;
    try{await store.doc("uvery/"+id).set(d);toast(STAGE(k).t)}catch(e){toast("Nepodařilo se uložit")}}

  /* ---------- přepínání pohledů ---------- */
  function openCase(id,tab){const d=cases.find(c=>c.id===id);if(!d)return;cur=clone(d);ui.view="case";ui.id=id;
    ui.tab=tab||(["poptavka","analyza"].includes(d.stage)?"dotaznik":d.stage==="nabidky"?"banky":d.stage==="podklady"?"podklady":"prubeh");
    if(ui.tab==="dotaznik")ui.step=d.q&&d.q.zad&&d.q.zad.some(z=>(z.prijmy||[]).length)?ui.step||0:0;keepUi();draw();try{root.scrollIntoView({block:"start"})}catch(e){}}
  function go(view){if(saveT){clearTimeout(saveT);saveT=null;if(cur){const d=clone(cur);delete d.id;store&&store.doc("uvery/"+cur.id).set(d).catch(()=>{})}}
    ui.view=view;if(view!=="case")cur=null;keepUi();draw()}
  function draw(){
    root.innerHTML="";const w=document.createElement("div");w.className="uv";root.append(w);
    if(ui.view==="case"&&!cur){const d=cases.find(c=>c.id===ui.id);if(d)cur=clone(d);else ui.view="board"}
    w.innerHTML=ui.view==="case"?caseHTML():ui.view==="new"?newHTML():ui.view==="fix"?fixHTML():ui.view==="banks"?banksHTML():ui.view==="katalog"?katalogHTML():ui.view==="guide"?guideHTML():boardHTML();
    after(w);
  }

  /* ---------- nástěnka ---------- */
  function caseLine(c){const q=c.q||{},t=q.typ||"hypo",b=c.bank&&bankById(c.bank);
    return [TYPE_T[t]||"Úvěr",isHypoLike(t)&&t!=="amer"&&q.ucel?PURP_T[q.ucel].toLowerCase():"",isHypoLike(t)&&q.predmet&&q.ucel!=="refinancovani"?(PROP_T[q.predmet]||"").split(" ")[0].toLowerCase():"",b?b.s:""].filter(Boolean).join(" · ")}
  function dueInfo(c){const t=todayStr();if(!ACTIVE(c.stage))return {cls:"",txt:""};
    if(!c.nextDate)return {cls:"late",txt:c.nextStep?"Bez termínu · "+c.nextStep:"Chybí další krok"};
    const d=dDiff(c.nextDate,t);return {cls:d<0?"late":"",txt:(d<0?"Po termínu "+fmtDs(c.nextDate):d===0?"Dnes":d===1?"Zítra":fmtDs(c.nextDate))+(c.nextStep?" · "+c.nextStep:"")}}
  function docProgress(c){const L=docsList(c.q||{},c.bank&&bankById(c.bank)).filter(d=>d.c);const st=c.docs||{};const need=L.filter(d=>st[d.k]!=="na");return {have:need.filter(d=>st[d.k]).length,all:need.length}}
  function cardHTML(c){const L=loanOf(c),du=dueInfo(c),pills=[];const q=c.q||{};
    if(["podklady","schvalovani"].includes(c.stage)){const p=docProgress(c);if(p.all)pills.push(`<span class="uv-pill${p.have===p.all?"":" o"}">Podklady ${p.have}/${p.all}</span>`)}
    if(q.termin&&ACTIVE(c.stage)&&!["cerpani"].includes(c.stage)){const d=dDiff(q.termin,todayStr());pills.push(`<span class="uv-pill ${d<=14?"solid":d<=30?"o":""}">${d<0?"Termín prošel":"Termín za "+d+" "+plural(d,"den","dny","dní")}</span>`)}
    const st=STAGE(c.stage),inSt=c.stageAt&&c.stageAt[c.stage]?dDiff(todayStr(),c.stageAt[c.stage].slice(0,10)):0;
    if(st.sla&&inSt>st.sla)pills.push(`<span class="uv-pill o">${inSt} dní ve fázi</span>`);
    if(c.stage==="cerpano"){const fe=fixEndOf(c);if(fe)pills.push(`<span class="uv-pill">Fixace do ${fmtD(fe)}</span>`)}
    return `<button type="button" class="uv-card" data-a="open" data-id="${esc(c.id)}" draggable="true" style="--sc:${st.c}">
      <div class="c1"><b>${esc(c.name||"Bez jména")}</b><span class="amt">${L?mil(L).replace(" Kč",""):""}</span></div>
      <div class="c2">${esc(caseLine(c))}</div>
      ${du.txt?`<div class="c3 ${du.cls}">${esc(du.txt)}</div>`:""}
      ${pills.length?`<div class="uv-pills">${pills.join("")}</div>`:""}</button>`}
  function filtered(){const qq=fold(ui.f).trim();return cases.filter(c=>{const t=(c.q&&c.q.typ)||"hypo";
    if(ui.ft==="hypo"&&!isHypoLike(t))return false;if(ui.ft==="spotr"&&isHypoLike(t))return false;
    return !qq||fold([c.name,c.phone,caseLine(c)].join(" ")).includes(qq)})}
  function fixRows(){const t=todayStr(),out=[];
    entries().forEach(e=>(e.products||[]).forEach(p=>{if(!/Hypotéka|Úvěr/.test(p.type||"")||p.status==="ended"||!p.from||!(+p.fix>0))return;
      const fe=addMonthsStr(p.from.slice(0,10),Math.round(+p.fix*12)),d=dDiff(fe,t);if(d<-90||d>400)return;
      if(p.src&&p.src.uv&&cases.some(c=>c.id===p.src.uv&&c.stage!=="cerpano"))return;
      out.push({e,p,fe,d,name:e.name,bank:p.company||"",amt:+p.amt||0,refi:cases.find(c=>ACTIVE(c.stage)&&c.q&&c.q.ucel==="refinancovani"&&entryOf(c)===e)})}));
    return out.sort((a,b)=>a.d-b.d)}
  function boardHTML(){
    const L=filtered(),act=cases.filter(c=>ACTIVE(c.stage)),y=String(new Date().getFullYear());
    const vol=act.reduce((s,c)=>s+loanOf(c),0),appr=cases.filter(c=>["schvalovani","smlouvy"].includes(c.stage));
    const done=cases.filter(c=>c.stage==="cerpano"&&((c.dates&&c.dates.cerpani)||(c.stageAt&&c.stageAt.cerpano)||"").slice(0,4)===y);
    const late=act.filter(c=>dueInfo(c).cls==="late").length,fx=fixRows().filter(r=>r.d<=365);
    const tile=(k,v,h,a,act2)=>`<div class="uv-tile${a?" alert":""}"${act2?` data-a="${act2}" role="button" tabindex="0" style="cursor:pointer"`:""}><div class="k"><i></i>${k}</div><div class="v">${v}</div>${h?`<div class="h">${h}</div>`:""}</div>`;
    const cols=STAGES.filter(s=>ACTIVE(s.k)||L.some(c=>c.stage===s.k)||s.k==="cerpano").map(s=>{
      let items=L.filter(c=>c.stage===s.k);
      items.sort((a,b)=>s.k==="cerpano"?String((b.dates&&b.dates.cerpani)||"").localeCompare(String((a.dates&&a.dates.cerpani)||"")):String(a.nextDate||"9").localeCompare(String(b.nextDate||"9")));
      const sum=items.reduce((t,c)=>t+loanOf(c),0);
      return `<section class="uv-col" data-stage="${s.k}"><div class="uv-colh"><span class="t"><i style="background:${s.c}"></i>${esc(s.t)}</span><span class="n">${items.length}</span></div>
        ${sum?`<div class="uv-colm">${mil(sum)}</div>`:""}
        ${items.map(cardHTML).join("")}
        ${s.k==="poptavka"?`<button type="button" class="uv-add" data-a="new">+ Nový případ</button>`:""}</section>`}).join("");
    return `<div class="uv-bar"><input type="search" class="uv-q" data-ui="f" placeholder="Hledat klienta…" value="${esc(ui.f)}" aria-label="Hledat případ">
        <div class="uv-seg" role="tablist">${[["all","Vše"],["hypo","Hypotéky"],["spotr","Spotřebitelské"]].map(([k,t])=>`<button type="button" data-a="ft" data-v="${k}" class="${ui.ft===k?"on":""}">${t}</button>`).join("")}</div>
        <span class="sp"></span>
        <button type="button" class="btn" data-a="guide">Průvodce</button>
        <button type="button" class="btn" data-a="katalog">Banky</button>
        <button type="button" class="btn pri" data-a="new">+ Nový případ</button></div>
      <div class="uv-tiles">${tile("Rozjednané",act.length,"objem "+mil(vol))}${tile("Ve schvalování a podpisu",appr.length,appr.length?mil(appr.reduce((s,c)=>s+loanOf(c),0)):"nic nečeká")}${tile("Načerpáno "+y,mil(done.reduce((s,c)=>s+loanOf(c),0)),done.length+" "+plural(done.length,"úvěr","úvěry","úvěrů"))}${tile("Po termínu",late,late?"nebo bez dalšího kroku":"vše naplánováno",late>0)}${tile("Konce fixací",fx.length,"do 12 měsíců · klikni",fx.some(r=>r.d<=120),"fix")}</div>
      ${cases.length?`<div class="uv-board" id="uvBoard">${cols}</div>`:`<div class="uv-box"><b>Zatím tu není žádný úvěr.</b><p class="uv-foot" style="margin-top:6px">Založ první případ tlačítkem „+ Nový případ“ – vyplníš s klientem dotazník a appka ti seřadí banky, připraví seznam podkladů a povede případ až po čerpání. Refinancování najdeš v „Konce fixací“ (bere fixace z karet klientů).</p></div>`}
      <p class="uv-foot">Karty přetahuj mezi sloupci (na počítači) nebo měň fázi v detailu. Oranžově: po termínu, dlouho ve fázi nebo blízký termín z rezervační smlouvy.</p>`;
  }

  /* ---------- nový případ ---------- */
  function newHTML(){
    const words=fold(newSt.q).split(/\s+/).filter(Boolean),E=entries().filter(e=>e.name&&words.length&&words.every(w=>fold(e.name).includes(w))).slice(0,12);
    return `<div class="uv-ch"><button type="button" class="btn ghost" data-a="back">‹ Úvěry</button><div class="tt"><h2>Nový úvěrový případ</h2></div></div>
      <div class="uv-box"><div class="uv-grid">
        <div class="uv-f wide uv-pick"><label for="uvNq">Klient z appky (klienti a leady)</label><input id="uvNq" type="search" data-n="q" autocomplete="off" placeholder="Začni psát jméno…" value="${esc(newSt.pick?newSt.pick.name:newSt.q)}">
          ${!newSt.pick&&E.length?`<div class="uv-pl">${E.map(e=>`<button type="button" data-a="npick" data-id="${esc(e.id)}">${esc(e.name)}<span style="color:var(--uv-l2);font-size:12.5px"> · ${e.rec?"klient":e.lead?"lead":"z kalendáře"}</span></button>`).join("")}</div>`:""}
          <div class="hint">${newSt.pick?`Propojeno s „${esc(newSt.pick.name)}“ · <button type="button" class="btn ghost sm" data-a="nunpick">zrušit</button>`:"Když klient v appce ještě není, napiš jen jméno – případ se založí bez propojení a propojit ho jde později."}</div></div>
        <div class="uv-f wide"><span class="uv-lbl">Typ úvěru</span><div class="uv-chips">${TYPES.map(([k,t])=>`<button type="button" class="uv-chip big${newSt.typ===k?" on":""}" data-a="ntyp" data-v="${k}">${t}</button>`).join("")}</div></div>
      </div>
      <div class="uv-wnav"><span></span><button type="button" class="btn pri" data-a="ncreate">Založit a vyplnit dotazník ›</button></div></div>`;
  }
  async function createCase(){
    const e=newSt.pick,name=(e?e.name:newSt.q).trim();if(!name){toast("Napiš jméno klienta");return}
    const now=new Date().toISOString();
    const z0={jmeno:name,narozen:e&&e.rec&&e.rec.birth||"",prijmy:[]};
    const d={name,cid:e&&e.rec?e.rec.id:null,lid:e&&e.lead?e.lead.id:null,eid:e?e.id:null,phone:e&&(e.phone||(e.rec&&e.rec.phone)||(e.lead&&e.lead.phone))||"",email:e&&((e.rec&&e.rec.email)||(e.lead&&e.lead.email))||"",
      stage:"poptavka",stageAt:{poptavka:now},createdAt:now,updatedAt:Date.now(),nextStep:"Vyplnit dotazník",nextDate:todayStr(),
      q:{typ:newSt.typ,ucel:isHypoLike(newSt.typ)?"koupe":"",predmet:isHypoLike(newSt.typ)?"byt":"",zajisteni:"kupovana",zad:[z0],zav:[],priority:[],fixace:isHypoLike(newSt.typ)?3:"",splatnost:newSt.typ==="amer"?20:isHypoLike(newSt.typ)?30:8},
      docs:{},tasks:{},offers:[],dates:{},log:[{d:now,t:"Případ založen"}]};
    if(!store){toast("Úložiště není připravené");return}
    const r=await store.collection("uvery").add(d);newSt={q:"",pick:null,typ:"hypo",name:""};
    cases=cases.filter(c=>c.id!==r.id).concat([{id:r.id,...d}]);openCase(r.id,"dotaznik");ui.step=0;keepUi();draw();
  }

  /* ---------- formulářové prvky (vázané na cur podle cesty, např. q.zad.0.narozen) ---------- */
  const V=k=>getPath(cur,k);
  const fid=k=>"uv_"+String(k).replace(/\./g,"_");
  const fv=(k,t)=>{const v=V(k);if(v==null||v==="")return"";if(t==="kc"){const x=num(v);return isFinite(x)?fmt0(x):String(v)}if(t==="n"&&typeof v==="number")return String(v).replace(".",",");return String(v)};
  const wrap=(k,label,inner,o)=>`<div class="uv-f${o&&o.wide?" wide":""}"${o&&o.attr?" "+o.attr:""}>${label?`<label for="${fid(k)}">${esc(label)}</label>`:""}${inner}${o&&o.hint?`<div class="hint">${o.hint}</div>`:""}</div>`;
  const fKc=(k,label,o={})=>wrap(k,label,`<div class="uv-in"><input id="${fid(k)}" data-k="${k}" data-t="kc" inputmode="numeric" autocomplete="off" placeholder="${esc(o.ph||"")}" value="${esc(fv(k,"kc"))}"><span class="suf">${o.suf||"Kč"}</span></div>`,o);
  const fNum=(k,label,o={})=>wrap(k,label,`<div class="uv-in"><input id="${fid(k)}" data-k="${k}" data-t="n" inputmode="decimal" autocomplete="off" placeholder="${esc(o.ph||"")}" value="${esc(fv(k))}">${o.suf?`<span class="suf">${o.suf}</span>`:""}</div>`,o);
  const fTxt=(k,label,o={})=>wrap(k,label,`<input id="${fid(k)}" data-k="${k}" data-t="t" autocomplete="off" placeholder="${esc(o.ph||"")}" value="${esc(fv(k))}">`,o);
  const fArea=(k,label,o={})=>wrap(k,label,`<textarea id="${fid(k)}" data-k="${k}" data-t="t" placeholder="${esc(o.ph||"")}">${esc(fv(k))}</textarea>`,o);
  const fDate=(k,label,o={})=>wrap(k,label,`<input id="${fid(k)}" type="date" data-k="${k}" data-t="date" value="${esc(fv(k))}">`,o);
  const fSel=(k,label,opts,o={})=>wrap(k,label,`<select id="${fid(k)}" data-k="${k}" data-t="sel">${o.empty!==false?`<option value="">${esc(o.empty||"— vyber —")}</option>`:""}${opts.map(([v,t])=>`<option value="${esc(v)}"${String(V(k)??"")===String(v)?" selected":""}>${esc(t)}</option>`).join("")}</select>`,o);
  const chips=(k,opts,o={})=>{const v=V(k),on=x=>o.multi?(Array.isArray(v)&&v.includes(x)):String(v??"")===String(x);
    return `<div class="uv-chips" role="group">${opts.map(([x,t])=>`<button type="button" class="uv-chip${o.big?" big":""}${on(x)?" on":""}" data-a="chip" data-k="${k}" data-v="${esc(x)}"${o.multi?' data-multi="1"':""}${o.max?` data-max="${o.max}"`:""} aria-pressed="${on(x)}">${esc(t)}</button>`).join("")}</div>`};
  const fChips=(k,label,opts,o={})=>`<div class="uv-f${o.wide!==false?" wide":""}"><span class="uv-lbl">${esc(label)}</span>${chips(k,opts,o)}${o.hint?`<div class="hint">${o.hint}</div>`:""}</div>`;
  const fYn=(k,label,o={})=>`<div class="uv-f${o.wide?" wide":""}"><span class="uv-lbl">${esc(label)}</span>${chips(k,[["ano","Ano"],["ne","Ne"]])}${o.hint?`<div class="hint">${o.hint}</div>`:""}</div>`;

  /* ---------- detail případu ---------- */
  function caseHTML(){
    const c=cur,q=c.q||(c.q={}),M=metrics(q,RATES),st=STAGE(c.stage),idx=STAGES.findIndex(s=>s.k===c.stage);
    const e=entryOf(c),L=loanOf(c);
    const sub=[TYPE_T[q.typ||"hypo"],L?mil(L):"",isFinite(M.ltv)&&isHypoLike(q.typ||"hypo")?"LTV "+pct(M.ltv):"",c.bank&&bankById(c.bank)?bankById(c.bank).name:""].filter(Boolean).join(" · ");
    const p=docProgress(c);
    const tabs=TABS.map(([k,t])=>`<button type="button" data-a="tab" data-v="${k}" class="${ui.tab===k?"on":""}">${t}${k==="podklady"&&p.all?`<span class="cnt">${p.have}/${p.all}</span>`:k==="nabidky"&&(c.offers||[]).length?`<span class="cnt">${c.offers.length}</span>`:""}</button>`).join("");
    const body=ui.tab==="banky"?banksTabHTML():ui.tab==="podklady"?docsTabHTML():ui.tab==="nabidky"?offersTabHTML():ui.tab==="prubeh"?flowTabHTML():wizardHTML();
    return `<div class="uv-ch"><button type="button" class="btn ghost" data-a="back">‹ Úvěry</button>
        <div class="tt"><h2>${esc(c.name||"Bez jména")}</h2><div class="sub">${esc(sub)}</div></div>
        <select data-a="stage" aria-label="Fáze případu">${STAGES.map(s=>`<option value="${s.k}"${s.k===c.stage?" selected":""}>${esc(s.t)}</option>`).join("")}</select>
        ${e&&opts.openClient?`<button type="button" class="btn" data-a="client">Karta klienta</button>`:""}
        <button type="button" class="btn" data-a="print">Tisk / PDF</button></div>
      <div class="uv-steps" aria-hidden="true">${STAGES.filter(s=>ACTIVE(s.k)||s.k==="cerpano").map((s,i)=>`<span class="${i<=idx&&ACTIVE(c.stage)||c.stage==="cerpano"?"on":""}"></span>`).join("")}</div>
      <div class="uv-next"><div class="uv-f"><label for="uv_nextStep">Další krok</label><input id="uv_nextStep" data-k="nextStep" data-t="t" value="${esc(c.nextStep||"")}" placeholder="např. Doložit potvrzení o příjmu"></div>
        <div class="uv-f"><label for="uv_nextDate">Kdy</label><input id="uv_nextDate" type="date" data-k="nextDate" data-t="date" value="${esc(c.nextDate||"")}"></div>
        ${idx<STAGES.findIndex(s=>s.k==="cerpano")&&ACTIVE(c.stage)?`<button type="button" class="btn pri" data-a="advance" style="align-self:end">${esc(STAGES[idx+1].t)} ›</button>`:"<span></span>"}</div>
      <div class="uv-tabs" role="tablist">${tabs}</div>
      <div id="uvTab">${body}</div>`;
  }

  /* ---------- dotazník ---------- */
  function wizardHTML(){
    const q=cur.q,t=q.typ||"hypo",s=Math.max(0,Math.min(STEPS.length-1,ui.step||0));
    const done=i=>stepDone(q,i);
    return `<div class="uv-wiz"><div>
      <div class="uv-wsteps">${STEPS.map((x,i)=>`<button type="button" data-a="step" data-v="${i}" class="${i===s?"on":done(i)?"done":""}">${i+1}. ${x}</button>`).join("")}</div>
      <div class="uv-box">${[step0,step1,step2,step3,step4,step5][s]()}</div>
      <div class="uv-wnav">${s>0?`<button type="button" class="btn" data-a="step" data-v="${s-1}">‹ ${STEPS[s-1]}</button>`:"<span></span>"}
        ${s<STEPS.length-1?`<button type="button" class="btn pri" data-a="step" data-v="${s+1}">${STEPS[s+1]} ›</button>`:`<button type="button" class="btn pri" data-a="tab" data-v="banky">Vyhodnotit banky ›</button>`}</div>
      </div><div class="uv-live" id="uvLive">${liveHTML()}</div></div>`;
  }
  function stepDone(q,i){const t=q.typ||"hypo",z=applicants(q);
    if(i===0)return !!q.typ&&(!isHypoLike(t)||t==="amer"||!!q.ucel);
    if(i===1)return n0(q.uver)>0||(n0(q.cena)>0&&isFinite(num(q.vlastni)));
    if(i===2)return z.every(x=>x.jmeno&&x.narozen);
    if(i===3)return z.some(x=>(x.prijmy||[]).some(p=>n0(p.castka)||n0(p.prijmy)||n0(p.zisk)));
    if(i===4)return !!q.registry;
    return !!(q.priority&&q.priority.length)}
  function missing(q){const m=[],t=q.typ||"hypo",z=applicants(q);
    if(isHypoLike(t)&&!n0(q.cena)&&!n0(q.uver))m.push("cena / výše úvěru");
    if(isHypoLike(t)&&t!=="amer"&&!q.ucel)m.push("účel");
    z.forEach((x,i)=>{if(!x.narozen)m.push("datum narození"+(z.length>1?" ("+(x.jmeno||i+1+". žadatel")+")":""))});
    if(!z.some(x=>(x.prijmy||[]).length))m.push("příjmy");
    if(!q.registry)m.push("registry / exekuce");
    return m}
  function liveHTML(){
    const q=cur.q,M=metrics(q,RATES),t=q.typ||"hypo",miss=missing(q);
    const row=(k,v,bad)=>`<div class="uv-kv"><span>${k}</span><b class="${bad?"bad":""}">${v}</b></div>`;
    const ages=M.ages.length?(isFinite(M.ageEnd)?M.oldest+" → "+M.ageEnd+" let":"–"):"–";
    /* na mobilu sbalitelné (výchozí sbalené, pod formulářem) – v souhrnu jen úvěr, LTV a splátka; na počítači vždy otevřené vpravo */
    const sum=[M.loan?kc(M.loan):"",isHypoLike(t)&&isFinite(M.ltv)?"LTV "+pct(M.ltv,1):"",M.pay?kc(M.pay)+"/měs.":""].filter(Boolean).join(" · ");
    return `<details class="uv-box uv-lv" style="margin:0"${liveOpen()?" open":""}><summary><span class="uv-h3" style="margin:0">Orientačně</span><span class="uv-lvs">${esc(sum||(miss.length?"chybí údaje":""))}</span></summary>
      ${row("Úvěr",M.loan?kc(M.loan):"–")}
      ${isHypoLike(t)?row("Zajištění",M.coll?kc(M.coll):"–")+row("LTV / limit",isFinite(M.ltv)?pct(M.ltv,1)+" / "+M.ltvLimit+" %":"–",M.ltv>M.ltvLimit+0.05):""}
      ${row("Splátka",M.pay?kc(M.pay):"–")}
      <div class="uv-kv"><span style="font-size:12px">${t==="spotr"||t==="konsol"?"sazba ~"+fmtR(M.rate)+" (orientační)":"při "+fmtR(M.rate)+" · fixace "+M.fix+" "+plural(M.fix,"rok","roky","let")+" · Hypoindex "+esc(String(RATES.period||"").split("-").reverse().join("/"))}</span></div>
      ${row("Příjem domácnosti",M.income?kc(M.income):"–")}
      ${row("DSTI (splátky / příjem)",isFinite(M.dsti)?pct(M.dsti):"–",M.dsti>50)}
      ${isHypoLike(t)?row("DTI (dluh / roční příjem)",isFinite(M.dti)?M.dti.toFixed(1).replace(".",",")+"×":"–",M.dti>(M.invest?7:9)):""}
      ${row("Věk při splatnosti",ages,M.ageEnd>70)}
      ${M.income?row("Zbude po splátkách",kc(M.reserve),M.reserve<0):""}
      ${M.invest?`<div class="uv-note" style="margin:8px 0 0">Investiční nemovitost – od 1. 4. 2026 LTV max. 70 % a DTI max. 7.</div>`:""}
      ${miss.length?`<div class="uv-note gray" style="margin:8px 0 0"><b>Chybí:</b> ${esc(miss.join(", "))}</div>`:`<div class="uv-note" style="margin:8px 0 0">Dotazník je kompletní – <button type="button" class="btn ghost sm" data-a="tab" data-v="banky">pořadí bank ›</button></div>`}
      </details>`;
  }
  /* stav panelu Orientačně: na počítači vždy otevřený, na mobilu podle posledního rozbalení (výchozí sbalený) */
  let lvOpen=false;
  const narrow=()=>typeof matchMedia==="function"&&matchMedia("(max-width:760px)").matches;
  const liveOpen=()=>!narrow()||lvOpen;
  function drawLive(){const b=root.querySelector("#uvLive");if(b)b.innerHTML=liveHTML()}
  root.addEventListener("toggle",e=>{const d=e.target;if(d&&d.classList&&d.classList.contains("uv-lv")){if(!narrow()&&!d.open){d.open=true;return}if(narrow())lvOpen=d.open}},true);

  function step0(){const q=cur.q,t=q.typ||"hypo",hypo=isHypoLike(t);
    const cenaHint=hypo?"":"";
    return `<div class="uv-grid">
      ${fChips("q.typ","Typ úvěru",TYPES,{big:true})}
      ${hypo&&t!=="amer"?fChips("q.ucel","Účel",PURPOSES):""}
      ${hypo?fChips("q.predmet",t==="amer"?"Zastavovaná nemovitost":"Nemovitost",PROPS):""}
      ${hypo&&["koupe","pozvyst"].includes(q.ucel||"koupe")&&t!=="amer"?fChips("q.prodavajici","Kupuje od",SELLERS,{hint:q.prodavajici==="pribuzny"?"Prodej v rodině pod cenou: LTV se počítá z odhadu, rozdíl ceny a odhadu nahradí vlastní zdroje.":q.prodavajici==="drazba"?"Dražba: peníze musí být do lhůty k doplacení nejvyššího podání – úvěr připrav předem.":""}):""}
      ${t==="amer"||!hypo?fTxt("q.ucelText","Na co peníze použije",{ph:t==="konsol"?"sloučení úvěrů":"např. auto, vybavení, rezerva",wide:true}):""}
      ${t==="spotr"?fYn("q.bydleni","Peníze jdou na bydlení",{hint:"Účelový úvěr na bydlení bez zástavy (stavební spořitelny, Rekopůjčka, ČSOB Půjčka na lepší bydlení, UniCredit PRESTO na bydlení): vyšší částky (2,5–3,5 mil.), delší splatnost a nižší sazba než neúčelová půjčka."}):""}
      ${t==="spotr"&&yes(q.bydleni)?fChips("q.bydUcel","Na co v bydlení",[["reko","Rekonstrukce / vybavení"],["druz","Družstevní byt"],["vyp","Vypořádání / dědictví"],["jine","Koupě, splacení úvěru na bydlení"]]):""}
      ${hypo&&t!=="amer"?fYn("q.pronajem","Bude nemovitost pronajímat?",{hint:"Investiční nemovitost má od 1. 4. 2026 přísnější limity ČNB (LTV 70 %, DTI 7)."}):""}
      ${hypo&&t!=="amer"?fNum("q.nemovitosti","Kolik obytných nemovitostí už vlastní (žadatel s nejvíce)",{ph:"0",hint:"3. a další = investiční. Počítá se každý žadatel zvlášť, i družstevní podíly a zahraničí; SJM = 1, podíl od 50 % = 1. Chatu bez celoroční vody / elektřiny lze vyřadit, nemovitost na prodej jen s podepsanou (budoucí) kupní smlouvou."}):""}
      ${hypo?fTxt("q.lokalita","Obec / okres nemovitosti",{ph:"např. Brno-Žabovřesky"}):""}
      ${fDate("q.termin","Do kdy musí být peníze",{hint:"Termín kupní smlouvy / úhrady podle rezervace. Schválení trvá typicky 2–5 týdnů."})}
      ${hypo?fYn("q.rezervace","Rezervační smlouva už podepsaná"):""}
    </div>`}
  function step1(){const q=cur.q,t=q.typ||"hypo",u=q.ucel||"koupe",hypo=isHypoLike(t);if(hypo&&!q.zajisteni)q.zajisteni=u==="druzstvo"?"jina":"kupovana";
    if(!hypo)return `<div class="uv-grid">${fKc("q.uver","Požadovaná výše úvěru")}${fNum("q.splatnost","Splatnost",{suf:"let",ph:"8"})}
      ${fKc("q.splatkaMax","Klient chce splátku nejvýš",{ph:"nepovinné"})}
      ${t==="konsol"?`<div class="uv-f wide"><div class="uv-note gray" style="margin:0">Úvěry ke sloučení zapiš v kroku Závazky a označ „Splatit z nového úvěru“ – součet se přenese sem.</div></div>`:""}</div>`;
    const lab={koupe:"Kupní cena",vystavba:"Rozpočet stavby",pozvyst:"Pozemek + stavba celkem",rekonstrukce:"Rozpočet rekonstrukce",refinancovani:"Zůstatek stávajícího úvěru",vyporadani:"Částka k vyplacení",druzstvo:"Cena družstevního podílu",jine:"Potřebná částka"}[t==="amer"?"jine":u];
    const sugg=Math.max(0,n0(q.cena)-n0(q.vlastni))+(u==="refinancovani"?n0(q.navyseni):0);
    return `<div class="uv-grid">
      ${fKc("q.cena",lab)}
      ${fKc("q.odhad",t==="amer"?"Hodnota zastavované nemovitosti":"Odhadní (tržní) hodnota",{ph:"stejná jako cena",hint:["vystavba","pozvyst","rekonstrukce"].includes(u)?"Hodnota po dokončení – z ní se čerpá a počítá LTV.":"LTV se počítá z hodnoty zástavy (odhadu), ne z kupní ceny."})}
      ${u==="refinancovani"?fKc("q.navyseni","Navýšení (rekonstrukce, neúčelová část)",{ph:"0"}):""}
      ${u!=="refinancovani"?fKc("q.vlastni","Vlastní zdroje",{ph:"0"}):""}
      ${fKc("q.uver","Požadovaný úvěr",{ph:sugg?fmt0(sugg):""})}
      ${u!=="refinancovani"&&t!=="amer"?fChips("q.zdroje","Odkud jsou vlastní zdroje (AML)",OWN_SRC,{multi:true}):""}
      ${u==="refinancovani"?fTxt("q.refBanka","Stávající banka")+fNum("q.refSazba","Stávající sazba",{suf:"%"})+fDate("q.refFixDo","Konec fixace")+fKc("q.refSplatka","Stávající splátka"):""}
      ${fChips("q.zajisteni","Zajištění",COLLAT,{hint:q.zajisteni==="treti"?"Zástavce podepisuje zástavní smlouvu; po 3–5 letech jde dozajištění vyvázat.":""})}
      ${["jina","obe","treti"].includes(q.zajisteni)?fKc("q.zajHodnota","Hodnota další zastavované nemovitosti"):""}
      ${fChips("q.zatizeni","Zatížení nemovitosti",BURDENS,{multi:true})}
      ${fChips("q.penb","Energetický štítek (PENB)",[["A","A"],["B","B"],["C","C"],["D","D"],["EFG","E–G"],["?","Nevím"]],{hint:"A/B = zelená sleva u některých bank (typicky 0,1 p.b.)."})}
      ${fNum("q.splatnost","Splatnost",{suf:"let",ph:t==="amer"?"20":"30",hint:u==="refinancovani"?"ČNB doporučuje při refinancování neprodlužovat splatnost oproti původní smlouvě.":"ČNB doporučuje max. 30 let (mBank až 40, ČS u PENB A/B 35)."})}
      ${fChips("q.fixace","Fixace",[["1","1 rok"],["2","2 roky"],["3","3 roky"],["5","5 let"],["7","7 let"],["10","10 let"]],{wide:false})}
      ${fKc("q.splatkaMax","Klient chce splátku nejvýš",{ph:"nepovinné"})}
    </div>`}
  function step2(){const q=cur.q,zad=applicants(q);if(!q.zad)q.zad=zad;
    const married=zad.filter(z=>z.stav==="manzel").length,spouse=zad.slice(1).some(z=>z.vztah==="manzel");
    return zad.map((z,i)=>{const p="q.zad."+i+".";const age=ageAt(z.narozen);
      return `<div class="uv-sub"><div class="uv-subh"><span>${i+1}. žadatel${z.jmeno?" – "+esc(z.jmeno):""}${isFinite(age)?` <span style="font-weight:400;color:var(--uv-l2)">· ${age} let</span>`:""}</span>${i>0?`<button type="button" class="btn ghost sm" data-a="zdel" data-i="${i}">Odebrat</button>`:""}</div>
        <div class="uv-grid">${fTxt(p+"jmeno","Jméno a příjmení")}${fDate(p+"narozen","Datum narození",{hint:i===0?"Rozhoduje o LTV 90 % (do 36 let) a o max. splatnosti.":""})}
          ${i>0?fSel(p+"vztah","Vztah k 1. žadateli",RELS):""}${fSel(p+"stav","Rodinný stav",MARITAL)}
          ${fChips(p+"obc","Občanství",CITIZEN,{wide:false})}${z.obc&&z.obc!=="cz"?fChips(p+"pobyt","Pobyt v ČR",RESID,{wide:false}):""}
          ${i>0?fYn(p+"dom2","Žije v jiné domácnosti (např. rodiče)"):""}</div></div>`}).join("")+
      `${zad.length<4?`<button type="button" class="btn" data-a="zadd">+ Přidat spolužadatele</button>`:""}
      ${married&&!spouse&&zad.some(z=>z.stav==="manzel")?`<div class="uv-note" style="margin-top:10px">Ženatý / vdaná bez manžela v žádosti: banky chtějí manžela jako spoludlužníka (SJM). Výjimka jen při zúženém SJM (notářský zápis).</div>`:""}
      <div class="uv-grid" style="margin-top:12px">${fNum("q.deti","Vyživované děti",{ph:"0"})}${fTxt("q.detiVek","Věk dětí",{ph:"např. 3 a 7"})}</div>`}
  function step3(){const q=cur.q,zad=applicants(q),gen=metrics(q,RATES);
    return zad.map((z,i)=>{const P=z.prijmy||(z.prijmy=[]);
      return `<div class="uv-sub"><div class="uv-subh"><span>Příjmy – ${esc(z.jmeno||(i+1)+". žadatel")}</span></div>
        ${P.map((x,j)=>{const T=INC[x.typ]||INC.jiny,p="q.zad."+i+".prijmy."+j+".";
          const fields=T.f.filter(f=>!f[4]||Object.entries(f[4]).every(([k,v])=>(x[k]||(k==="rezim"?"pausal":""))===v)).map(f=>{const k=p+f[0];
            return f[2]==="kc"?fKc(k,f[1]):f[2]==="n"?fNum(k,f[1]):f[2]==="sel"?fSel(k,f[1],f[3]):f[2]==="yn"?fYn(k,f[1]):f[2]==="date"?fDate(k,f[1]):fTxt(k,f[1])}).join("");
          return `<div class="uv-sub" style="background:var(--uv-bg)"><div class="uv-subh"><span>${esc(T.t)}</span><button type="button" class="btn ghost sm" data-a="pdel" data-i="${i}" data-j="${j}">Odebrat</button></div><div class="uv-grid">${fields}</div>${incHint(x)}</div>`}).join("")}
        <div class="uv-row"><select data-a="padd" data-i="${i}" aria-label="Přidat příjem"><option value="">+ Přidat příjem…</option>${Object.entries(INC).map(([k,v])=>`<option value="${k}">${esc(v.t)}</option>`).join("")}</select></div></div>`}).join("")+
      (gen.income?`<p class="uv-foot">Obecně započitatelný příjem domácnosti ≈ <b>${kc(gen.income)}</b> měsíčně. Každá banka počítá jinak – přesně v záložce Banky.</p>`:"");
  }
  function incHint(x){const h=[];
    if(x.typ==="osvc"){const n=osvcNet(x),o=n0(x.prijmy)/12;if(n||o)h.push("Z daňového základu ≈ "+kc(n)+"/měs · z obratu "+kc(o)+"/měs (banky s obratovou metodou berou 30–75 % podle oboru)")}
    if(x.typ==="zam"&&yes(x.zkusebni))h.push("Ve zkušební době většina bank nepůjčí – podat až po jejím skončení (výjimka: kontinuita v oboru).");
    if(x.typ==="pronajem")h.push("Banky typicky berou 50–80 % nájemného bez služeb; nájem v hotovosti skoro neprojde.");
    if(x.typ==="rodic")h.push("Rodičovská se u většiny bank započítává, pokud nekončí v nejbližších měsících.");
    if(x.typ==="provize")h.push("ZFPA: RSTS 70 % (max 180 000/měs.), mBank 60 % průměru, UniCredit 60 % (paušál) / 40 % (skutečné výdaje), Buřinka individuálně. Potvrzení sjetin vystaví centrála.");
    if(x.typ==="zahr")h.push("Pendleři do Rakouska / Německa: Lohnzettel + výpisy; ne každá banka bere příjem v cizí měně.");
    return h.length?`<div class="hint" style="margin-top:8px">${h.map(esc).join("<br>")}</div>`:""}
  function step4(){const q=cur.q,Z=q.zav||(q.zav=[]);
    return `${Z.map((d,i)=>{const p="q.zav."+i+".";const rev=d.typ==="kk"||d.typ==="ko";
      return `<div class="uv-sub"><div class="uv-subh"><span>${esc(DEBT_T[d.typ]||"Závazek")}</span><button type="button" class="btn ghost sm" data-a="ddel" data-i="${i}">Odebrat</button></div>
        <div class="uv-grid g3">${fSel(p+"typ","Typ",DEBTS,{empty:false})}${fTxt(p+"banka","U koho")}${rev?fKc(p+"limit","Limit",{hint:"Banky počítají ~3 % limitu jako splátku, i když je karta nevyčerpaná."}):fKc(p+"splatka","Měsíční splátka")}
          ${rev?fKc(p+"zustatek","Vyčerpáno"):fKc(p+"zustatek","Zůstatek")}${fYn(p+"splatit","Splatit / zrušit z nového úvěru")}</div></div>`}).join("")}
      <button type="button" class="btn" data-a="dadd">+ Přidat závazek</button>
      <div class="uv-grid" style="margin-top:14px">
        ${fChips("q.registry","Úvěrové registry (BRKI, NRKI, SOLUS)",[["ok","Čisté"],["problem","Záznam / prodlení"],["nevim","Nevím"]],{hint:"Banky koukají ~5 let zpět; prodlení za posledních 3–6 měsíců je problém. Při „Nevím“ si klient zažádá o výpis z registrů."})}
        ${fYn("q.exekuce","Exekuce")}${fYn("q.insolvence","Insolvence / oddlužení")}
        ${fKc("q.zivotni","Životní náklady domácnosti měsíčně",{ph:"nepovinné",hint:"Jen pro tvou kontrolu rezervy – banky si počítají vlastní normativy."})}
      </div>`}
  function step5(){const q=cur.q,B=banks().filter(b=>!b.off&&b.kind!=="ss"&&b.kind!=="spec").map(b=>[b.id,b.s]);
    return `<div class="uv-grid">
      ${fChips("q.priority","Co je pro klienta nejdůležitější (max. 2)",PRIORITIES,{multi:true,max:2})}
      ${fChips("q.ucty","Kde má účet",B,{multi:true,hint:"Účet u banky = argument pro obchodní slevu; výplatu tam ale posílat nemusí."})}
      ${fChips("q.nechce","Banky, které nechce",B,{multi:true})}
      ${fChips("q.pss","Pojištění schopnosti splácet",[["ano","Chce"],["ne","Nechce"],["nevim","Probrat"]],{hint:"PSS sleví sazbu o 0,1–0,2 p.b., ale stojí víc než ušetří a zaniká s úvěrem. Lepší vlastní životní pojištění (smrt, invalidita, PN)."})}
      ${fYn("q.predVkladem","Potřebuje čerpat ještě před zápisem zástavy",{hint:"Úhrada prodávajícímu hned po podání návrhu na vklad – ne každá banka to umí."})}
      ${fArea("q.pozn","Poznámka",{wide:true,ph:"cokoli, co ovlivní výběr banky nebo průběh"})}
    </div>`}

  /* ---------- banky: pořadí a důvody ---------- */
  function banksTabHTML(){
    const q=cur.q,R=recommend(q,banks(),RATES),M=R.M,t=q.typ||"hypo",miss=missing(q);
    const TIP={LTV:"Úvěr / hodnota zástavy. Limit ČNB 80 %, do 36 let 90 %, investiční 70 %.",DSTI:"Splátky všech úvěrů / čistý měsíční příjem. Banky obvykle do 45–50 %.",DTI:"Všechny dluhy / roční čistý příjem. ČNB: nad 8 obezřetně, investiční max. 7."};
    const m=(k,v,s,bad)=>`<div class="uv-m${bad?" bad":""}"${TIP[k]?` title="${esc(TIP[k])}"`:""}><div class="k">${k}${TIP[k]?`<button type="button" class="uv-help" data-a="kpojem" data-v="${k}" aria-label="Co je ${k}">?</button>`:""}</div><div class="v">${v}</div>${s?`<div class="s">${s}</div>`:""}</div>`;
    const top=R.list.filter(r=>!r.ko.length&&r.verdict!=="excl");
    const tags=[...R.tags].map(k=>TAG_T[k]).filter(Boolean);
    const card=(r,i,open)=>{const b=r.b,isTop=i===0&&r.verdict!=="no"&&r.verdict!=="excl";
      const vcls=isTop?"top":r.verdict,vd={top:"Doporučuji",ok:"Vhodná",cond:"S výhradou",no:"Nelze",excl:"Klient nechce"}[vcls];
      const lines=[...r.plus.map(x=>`<div class="p"><span class="ic">✓</span><span>${esc(x)}</span></div>`),...r.warn.map(x=>`<div class="w"><span class="ic">!</span><span>${esc(x)}</span></div>`),...r.ko.map(x=>`<div class="x"><span class="ic">✕</span><span>${esc(x)}</span></div>`)];
      const nums=r.na?"":`<div class="nums">${isFinite(r.rate)?`<span>sazba ~<b>${fmtR(r.rate)}</b></span>`:""}${r.pay?`<span>splátka <b>${kc(r.pay)}</b></span>`:""}${r.income?`<span>započte <b>${kc(r.income)}</b></span>`:""}${isFinite(r.maxLoan)?`<span>max. úvěr <b>${mil(r.maxLoan)}</b></span>`:""}${r.years!==M.years?`<span>splatnost <b>${r.years} let</b></span>`:""}</div>`;
      const head=`<div class="uv-bh"><span class="rk">${r.rank||"–"}</span><span class="nm">${esc(b.name)}${open?"":`<span class="uv-chev">›</span>`}</span><span class="uv-vd ${vcls}">${vd}</span></div>`;
      const my=cfg.banks&&cfg.banks[b.id]&&cfg.banks[b.id].myNote;
      const why=lines.length?`<div class="uv-why">${lines.join("")}</div>`:"";
      const rest=`${my?`<div class="uv-more"><b>Moje poznámka:</b> ${esc(my)}</div>`:""}
        ${!r.ko.length&&b.pros&&b.pros.length?`<div class="uv-more"><b>Obecně:</b> ${esc(b.pros.join(" · "))}${b.cons&&b.cons.length?` <br><b>Pozor:</b> ${esc(b.cons.join(" · "))}`:""}</div>`:""}
        ${!r.ko.length?`<div class="uv-row" style="margin-top:8px"><button type="button" class="btn sm${cur.bank===b.id?" pri":""}" data-a="pickbank" data-v="${b.id}">${cur.bank===b.id?"✓ Vybraná banka":"Vybrat"}</button><button type="button" class="btn sm" data-a="offeradd" data-v="${b.id}">Do nabídek</button><button type="button" class="btn ghost sm" data-a="kprof" data-v="${b.id}">Profil banky ›</button>${b.portal?`<span class="uv-pill">${esc(b.portal)}</span>`:""}</div>`:`<div class="uv-row" style="margin-top:8px"><button type="button" class="btn ghost sm" data-a="kprof" data-v="${b.id}">Profil banky ›</button></div>`}`;
      const numRow=nums?`<div class="uv-bh" style="margin-top:6px">${nums}</div>`:"";
      return open?`<div class="uv-bank${isTop?" top":""}${r.ko.length?" no":""}" data-bank="${b.id}">${head}${numRow}${why}${rest}</div>`
        :`<details class="uv-bank${r.ko.length?" no":""}" data-bank="${b.id}"><summary>${head}${numRow}</summary>${why}${rest}</details>`};
    const shown=R.list.filter(r=>!r.na);
    const na=R.list.filter(r=>r.na&&!r.b.off),off=R.list.filter(r=>r.b.off);
    return `${miss.length?`<div class="uv-note gray"><b>Neúplné:</b> ${esc(miss.join(", "))} – pořadí se zpřesní po doplnění dotazníku.</div>`:""}
      <div class="uv-mgrid">${m("Úvěr",M.loan?mil(M.loan):"–",TYPE_T[t])}${isHypoLike(t)?m("LTV",isFinite(M.ltv)?pct(M.ltv,1):"–","limit "+M.ltvLimit+" %"+(M.invest?" (investiční)":""),M.ltv>M.ltvLimit+0.05):""}${m("Splátka",M.pay?kc(M.pay):"–","~"+fmtR(M.rate)+" · "+M.years+" let")}${m("DSTI",isFinite(M.dsti)?pct(M.dsti):"–","obecně, bez stresu",M.dsti>50)}${isHypoLike(t)?m("DTI",isFinite(M.dti)?M.dti.toFixed(1).replace(".",",")+"×":"–",M.invest?"limit 7":"banky ~8–9,5",M.dti>(M.invest?7:9)):""}${m("Věk při splatnosti",isFinite(M.ageEnd)?M.ageEnd+" let":"–","nejstarší žadatel",M.ageEnd>70)}</div>
      ${(()=>{const mx=R.list.filter(r=>!r.na&&isFinite(r.maxLoan)&&r.maxLoan>0&&!r.ko.some(k=>!/bonita/.test(k))).map(r=>r.maxLoan);if(!mx.length)return"";
        const lo=Math.min(...mx),hi=Math.max(...mx),own=isHypoLike(t)&&t!=="amer"&&M.coll>0?Math.max(0,M.loan-M.coll*M.ltvLimit/100):0;
        return `<div class="uv-note">Podle bonity klient dosáhne zhruba na <b>${lo===hi?mil(lo):mil(lo).replace(" Kč","")+" – "+mil(hi)}</b> (při ${M.years} letech splatnosti)${own>0?` · do LTV ${M.ltvLimit} % chybí <b>${mil(own)}</b> vlastních zdrojů`:""}. Klientovi říkej splátku a celkové náklady, DSTI a DTI nech pro sebe.</div>`})()}
      ${tags.length?`<div class="uv-pills" style="margin:-4px 0 12px">${tags.map(x=>`<span class="uv-pill">${esc(x)}</span>`).join("")}</div>`:""}
      ${R.alts.length?`<div class="uv-box"><div class="uv-h3" style="margin-top:0">Na co myslet</div><ul class="uv-alts">${R.alts.map(a=>`<li>${esc(a)}</li>`).join("")}</ul></div>`:""}
      <div class="uv-h3">Pořadí institucí (přes ZFPA)</div>
      ${top.length?"":`<div class="uv-note">Teď to nevychází v žádné bance – podívej se na důvody u jednotlivých bank a na „Na co myslet“.</div>`}
      ${shown.filter(r=>!r.ko.length).map((r,i)=>card(r,i,i<3)).join("")}
      ${shown.some(r=>r.ko.length)?`<details class="uv-box"><summary style="cursor:pointer;font-weight:600">Nevychází (${shown.filter(r=>r.ko.length).length}) – proč</summary><div style="margin-top:10px">${shown.filter(r=>r.ko.length).map((r,i)=>card(r,99,true)).join("")}</div></details>`:""}
      ${na.length?`<p class="uv-foot">Pro tenhle typ úvěru nejsou: ${esc(na.map(r=>r.b.s).join(", "))}.</p>`:""}${off.length?`<p class="uv-foot">Vypnuté v Parametrech bank: ${esc(off.map(r=>r.b.s).join(", "))}.</p>`:""}
      <p class="uv-foot">Orientační pořadí pro tebe podle pravidel v „Parametry bank“ (stav ${esc(BANKS_ASOF)}). Sazby: ${esc(RATES.source||"")} ${esc(String(RATES.period||"").split("-").reverse().join("/"))} + odchylky bank. Přesnou bonitu a nabídky ověř v HypoUP / u banky. ZFPA neposkytuje radu dle § 85 ZSÚ – klientovi předkládej přehled zpracovaných nabídek (záložka Nabídky).</p>`;
  }

  /* ---------- podklady ---------- */
  function docsTabHTML(){
    const c=cur,b=c.bank&&bankById(c.bank),L=docsList(c.q||{},b),st=c.docs||{},groups=[...new Set(L.map(d=>d.g))];
    const p=docProgress(c),txt=clientDocsText(c.q||{},st,b,sign());
    return `<div class="uv-box"><div class="uv-row" style="justify-content:space-between"><div><b>Od klienta: ${p.have} z ${p.all}</b><div class="uv-bar2" style="width:220px"><i style="width:${p.all?Math.round(p.have/p.all*100):0}%"></i></div></div>
        <div class="uv-row"><button type="button" class="btn" data-a="dcopy"${txt?"":" disabled"}>Zkopírovat seznam pro klienta</button>${c.email?`<button type="button" class="btn" data-a="dmail"${txt?"":" disabled"}>E-mail</button>`:""}${c.phone?`<button type="button" class="btn" data-a="dsms"${txt?"":" disabled"}>SMS</button>`:""}</div></div>
        ${b?"":`<p class="uv-foot" style="margin:8px 0 0">Vyber banku (záložka Banky) – doplní se její specifika.</p>`}</div>
      ${groups.map(g=>`<div class="uv-box uv-docg"><div class="uv-h3" style="margin-top:0">${esc(g)}</div>${L.filter(d=>d.g===g).map(d=>{const v=st[d.k];
        return `<div class="uv-doc${v?" done":""}"><button type="button" class="ck${v==="na"?" na":v?" on":""}" data-a="dck" data-k="${esc(d.k)}" aria-label="${v?"Označit jako chybějící":"Označit jako dodané"}">${v==="na"?"–":v?"✓":""}</button>
          <div class="tx">${esc(d.t)}${v&&v!=="na"?`<small>dodáno ${esc(fmtD(v))}</small>`:v==="na"?"<small>nevyžaduje se</small>":d.c?"":"<small>zajistíš ty / interní</small>"}</div>
          ${v?"":`<button type="button" class="na-b" data-a="dna" data-k="${esc(d.k)}">nepotřeba</button>`}</div>`}).join("")}</div>`).join("")}
      <div id="uvDocs"></div>`;
  }

  /* ---------- nabídky (3 modelace pro ZFPA) ---------- */
  const isSp=()=>["spotr","konsol"].includes((cur&&cur.q&&cur.q.typ)||"hypo");
  function offerCalc(o){const L=n0(o.amount),r=num(o.rate),y=n0(o.years)||(isSp()?8:30),f=isSp()?y:(n0(o.fix)||5);if(!(L>0)||!isFinite(r))return null;
    const fc=fixCost(L,r,y,f),fees=n0(o.fee)+n0(o.feeOdhad)+n0(o.feeOther),pss=n0(o.pss)*fc.months;return {...fc,fees,pss,total:fc.paid+fees+pss,cost:fc.interest+fees+pss}}
  function offersTabHTML(){
    const c=cur,O=c.offers||(c.offers=[]),B=banks(),sp=isSp();
    const calc=O.map(offerCalc),costs=calc.filter(Boolean).map(x=>x.cost),minC=Math.min(...costs),maxC=Math.max(...costs);
    const best=costs.length>1&&maxC-minC>=1?calc.findIndex(x=>x&&x.cost===minC):-1;
    const opt=v=>B.map(b=>`<option value="${b.id}"${b.id===v?" selected":""}>${esc(b.s)}</option>`).join("");
    const inp=(i,k,ph,w,t)=>`<input data-k="offers.${i}.${k}" data-t="${t||"kc"}" inputmode="decimal" placeholder="${ph||""}" value="${esc(fv("offers."+i+"."+k,t||"kc"))}" style="width:${w||100}px" aria-label="${k}">`;
    return `<div class="uv-box"><div class="uv-row" style="justify-content:space-between"><b>Zpracované nabídky</b><div class="uv-row"><button type="button" class="btn" data-a="offertop">Doplnit 3 nejlepší z doporučení</button><button type="button" class="btn" data-a="offeradd">+ Nabídka</button><button type="button" class="btn" data-a="offerprint"${O.length?"":" disabled"}>Tisk / PDF – přehled nabídek</button></div></div>
      ${O.length?`<div class="uv-tw" style="margin-top:10px"><table class="uv-tab"><thead><tr><th>Banka</th><th>Sazba %</th><th>${sp?"RPSN %":"Fixace"}</th><th>Splatnost</th><th>Výše úvěru</th><th>Poplatky</th><th>${sp?"Pojištění/měs":"PSS/měs"}</th><th class="r">Splátka</th><th class="r">${sp?"Náklady celkem":"Náklady za fixaci"}</th><th class="r">${sp?"Celkem zaplatí":"Zůstatek po fixaci"}</th><th></th></tr></thead><tbody>
        ${O.map((o,i)=>{const x=calc[i];return `<tr class="${c.offerId===o.id?"sel":""}${i===best?" best":""}"><td><select data-k="offers.${i}.bank" data-t="sel" style="width:120px">${opt(o.bank)}</select></td>
          <td>${inp(i,"rate",sp?"6,9":"5,19",70,"n")}</td><td>${sp?inp(i,"rpsn","7,2",62,"n"):inp(i,"fix","5",52,"n")}</td><td>${inp(i,"years",sp?"8":"30",52,"n")}</td><td>${inp(i,"amount","",112)}</td><td>${inp(i,"fee","0",78)}</td><td>${inp(i,"pss","0",70)}</td>
          <td class="r"><b>${x?kc(x.payment):"–"}</b></td><td class="r">${x?`<b>${kc(x.cost)}</b><br><small style="color:var(--uv-l2)">úroky ${mil(x.interest)}${x.fees?" + poplatky "+fmt0(x.fees):""}${x.pss?" + PSS "+fmt0(x.pss):""}</small>`:"–"}</td><td class="r">${x?kc(sp?x.total:x.balance):"–"}</td>
          <td><div class="uv-row" style="flex-wrap:nowrap"><button type="button" class="btn sm${c.offerId===o.id?" pri":""}" data-a="offerpick" data-i="${i}">${c.offerId===o.id?"✓ Vybraná":"Vybrat"}</button><button type="button" class="btn ghost sm" data-a="offerdel" data-i="${i}" aria-label="Smazat">✕</button></div></td></tr>
          <tr class="${c.offerId===o.id?"sel":""}"><td colspan="11"><input data-k="offers.${i}.note" data-t="t" placeholder="Poznámka (slevy, podmínky, platnost nabídky, garance sazby…)" value="${esc(o.note||"")}"></td></tr>`}).join("")}
        </tbody></table></div>`:`<p class="uv-foot">Sem zapiš 3 nabídky (z HypoUP nebo kalkulaček bank). Appka spočítá splátku, náklady za celou fixaci a zůstatek – to je argument, který klienty přesvědčí víc než rozdíl ve splátce. Vytištěný přehled slouží i jako příloha k záznamu o zprostředkování (ZFPA).</p>`}
      ${best>=0?`<p class="uv-foot">Nejnižší náklady ${sp?"celkem":"za fixaci"}: <b>${esc((bankById(O[best].bank)||{}).name||"")}</b> – o ${kc(maxC-minC)} méně než nejdražší nabídka. ${sp?"Porovnávej RPSN a celkovou zaplacenou částku při stejné splatnosti.":"Porovnávej vždy stejnou fixaci a bez PSS."}</p>`:O.length>1?`<p class="uv-foot">${sp?"Porovnávej RPSN a celkovou zaplacenou částku při stejné splatnosti.":"Porovnávej vždy stejnou fixaci a bez PSS; doplň skutečné sazby z HypoUP / nabídek bank."}</p>`:""}</div>`;
  }

  /* ---------- průběh ---------- */
  function flowTabHTML(){
    const c=cur,idx=STAGES.findIndex(s=>s.k===c.stage),T=c.tasks||{},B=banks(),fe=fixEndOf(c),e=entryOf(c);
    const flow=STAGES.filter(s=>ACTIVE(s.k)||s.k==="cerpano").map((s,i)=>{const tasks=stageTasks(c,s.k),dn=tasks.filter(([k])=>T[s.k+":"+k]).length;
      const at=c.stageAt&&c.stageAt[s.k];
      return `<div class="uv-st${s.k===c.stage?" cur":i<idx?" past":""}"><div class="uv-sth"><i style="background:${s.c}"></i>${esc(s.t)}<span class="d">${at?fmtD(at.slice(0,10)):""}${tasks.length?" · "+dn+"/"+tasks.length:""}</span>${s.k!==c.stage?`<button type="button" class="btn ghost sm" data-a="setstage" data-v="${s.k}">sem</button>`:""}</div>
        ${s.k===c.stage||i===idx+1?tasks.map(([k,t])=>{const v=T[s.k+":"+k];return `<label class="uv-tk"><input type="checkbox" data-a="task" data-k="${s.k}:${k}"${v?" checked":""} style="width:auto"> <span>${esc(t)}${v?` <span style="color:var(--uv-l2);font-size:12px">· ${esc(fmtD(String(v).slice(0,10)))}</span>`:""}</span></label>`}).join(""):""}</div>`}).join("");
    return `<div class="uv-grid" style="align-items:start"><div class="uv-flow">${flow}
        <div class="uv-row" style="margin-top:6px">${c.stage!=="odlozeno"?`<button type="button" class="btn" data-a="setstage" data-v="odlozeno">Odložit</button>`:""}${c.stage!=="zamitnuto"?`<button type="button" class="btn" data-a="setstage" data-v="zamitnuto">Zamítnuto / lost</button>`:""}<button type="button" class="btn ghost" data-a="delcase">Smazat případ</button></div>
        ${c.stage==="zamitnuto"?fSel("lostWhy","Důvod",LOST.map(x=>[x,x])):""}</div>
      <div><div class="uv-box"><div class="uv-h3" style="margin-top:0">Úvěr</div><div class="uv-grid">
          ${fSel("bank","Banka",B.map(b=>[b.id,b.name]))}${fKc("amount","Schválená výše",{ph:fmt0(loanOf({q:c.q}))})}
          ${fNum("rate","Sjednaná sazba",{suf:"%"})}${fNum("fixYears","Fixace",{suf:"let",ph:String(c.q&&c.q.fixace||"")})}
          ${fTxt("contractNo","Číslo úvěrové smlouvy")}${fDate("dates.podani","Žádost podána")}
          ${fDate("dates.schvaleno","Schváleno")}${fDate("dates.podpis","Úvěrová smlouva podepsána")}
          ${fDate("dates.vklad","Návrh na vklad podán")}${fDate("dates.cerpani","Čerpání")}</div>
          ${fe?`<p class="uv-foot">Konec fixace: <b>${fmtD(fe)}</b> – připomene se v „Konce fixacích“ a po uložení i v kartě klienta (Co tě dneska čeká).</p>`:""}
          ${c.stage==="cerpano"||c.dates&&c.dates.cerpani?`<div class="uv-row" style="margin-top:8px"><button type="button" class="btn pri" data-a="saveprod"${opts.saveProduct?"":" disabled"}>${(T["cerpano:ulozit"])?"✓ Uloženo ke klientovi – aktualizovat":"Uložit úvěr ke klientovi"}</button>${e?"":`<span class="uv-pill">Klient není propojený – při uložení se založí</span>`}</div>`:""}
          ${opts.openLead&&["smlouvy","cerpani","cerpano"].includes(c.stage)?`<div class="uv-row" style="margin-top:8px"><button type="button" class="btn" data-a="tolead">Provize do pipeline ›</button><span class="uv-foot" style="margin:0">otevře lead – přidáš produkt Hypotéka a body se spočítají</span></div>`:""}</div>
        <div class="uv-box"><div class="uv-h3" style="margin-top:0">Poznámky a historie</div>
          <div class="uv-row" style="flex-wrap:nowrap"><input id="uvLogIn" placeholder="Zapsat poznámku (telefonát, požadavek banky…)" autocomplete="off"><button type="button" class="btn" data-a="logadd">Zapsat</button></div>
          <div class="uv-log" style="margin-top:8px">${(c.log||[]).slice().reverse().slice(0,40).map(l=>`<div><span>${esc(fmtD(String(l.d).slice(0,10)))}</span>${esc(l.t)}</div>`).join("")}</div></div></div></div>`;
  }

  /* ---------- konce fixací (refinancování) ---------- */
  function fixHTML(){
    const R=fixRows(),C=cases.filter(c=>c.stage==="cerpano"&&fixEndOf(c)).map(c=>({c,fe:fixEndOf(c),d:dDiff(fixEndOf(c),todayStr())})).filter(x=>x.d<=400&&x.d>=-90&&!R.some(r=>r.p.src&&r.p.src.uv===x.c.id));
    const row=(name,line,d,act)=>`<div class="it"><div class="m"><b>${esc(name)}</b><span>${esc(line)}</span></div><span class="uv-pill ${d<=120?"solid":d<=240?"o":""}">${d<0?"skončila":"za "+d+" "+plural(d,"den","dny","dní")}</span>${act}</div>`;
    return `<div class="uv-ch"><button type="button" class="btn ghost" data-a="back">‹ Úvěry</button><div class="tt"><h2>Konce fixací</h2><div class="sub">Hypotéky a úvěry z karet klientů (s vyplněnou fixací) a načerpané případy</div></div></div>
      <div class="uv-note">Začni 6–9 měsíců před koncem: banka musí nabídnout novou sazbu nejpozději 3 měsíce předem, a některé banky umí refixaci domluvit i 1–3 roky dopředu. Do 3 měsíců od oznámení nové sazby a ke konci fixace jde úvěr splatit nebo převést bez sankce – argument pro vyjednání sazby i pro refinancování (navýšení, rekonstrukce). Splatnost při refinancování ČNB doporučuje neprodlužovat.</div>
      <div class="uv-box uv-list">${R.length||C.length?R.map(r=>row(r.name,[r.p.type,r.bank,r.amt?mil(r.amt):"","konec "+fmtD(r.fe)].filter(Boolean).join(" · "),r.d,r.refi?`<button type="button" class="btn sm" data-a="open" data-id="${r.refi.id}">Případ ›</button>`:`<button type="button" class="btn sm pri" data-a="refi" data-eid="${esc(r.e.id)}" data-pid="${esc(r.p.id||"")}">Založit refinancování</button>`)).join("")+
        C.map(x=>row(x.c.name,[(bankById(x.c.bank)||{}).name,mil(loanOf(x.c)),"konec "+fmtD(x.fe)].filter(Boolean).join(" · "),x.d,`<button type="button" class="btn sm" data-a="open" data-id="${x.c.id}">Případ ›</button>`)).join("")
        :`<p class="uv-empty">V příštích 12 měsících nekončí žádná fixace. Fixaci zadáš u hypotéky/úvěru v kartě klienta (Sjednáno + Fixace) – nebo se uloží sama z načerpaného případu.</p>`}</div>`;
  }
  async function createRefi(eid,pid){
    const e=entries().find(x=>x.id===eid);if(!e)return;const p=(e.products||[]).find(x=>String(x.id||"")===pid)||(e.products||[]).find(x=>/Hypotéka|Úvěr/.test(x.type||""));
    newSt={q:"",pick:e,typ:"hypo",name:e.name};await createCase();if(!cur)return;
    const fe=p&&p.from&&p.fix?addMonthsStr(p.from.slice(0,10),Math.round(+p.fix*12)):"";
    Object.assign(cur.q,{ucel:"refinancovani",refBanka:p&&p.company||"",refFixDo:fe,cena:p&&p.amt||"",termin:fe?addDaysStr(fe,-30):""});
    cur.nextStep="Zjistit nabídku stávající banky a zůstatek";logAdd(cur,"Refinancování – konec fixace "+fmtD(fe));save(true);draw();
  }

  /* ---------- parametry bank (vlastní úpravy pravidel) ---------- */
  const BP=[["off","Nepoužívám (nemám přístup / nespolupracuji)","yn"],["ltv.max","Max. LTV – vlastní bydlení","n","%"],["ltv.amer","Max. LTV – americká","n","%"],["maxAge","Max. věk při splatnosti","n","let"],["maxYears","Max. splatnost","n","let"],
    ["dsti","Limit DSTI (splátky / příjem)","n","%"],["dti","Limit DTI","n","×"],["stress","Stresová přirážka k sazbě","n","p.b."],["rateAdj","Odchylka od průměrné sazby","n","p.b."],
    ["rates.3","Sazba fixace 3 roky (LTV do 80 %)","n","%"],["rates.5","Sazba fixace 5 let","n","%"],["rates.7","Sazba fixace 7 let","n","%"],["rates.10","Sazba fixace 10 let","n","%"],
    ["ltv.young","Max. LTV do 36 let (výjimka ČNB)","n","%"],["spotr.typ","Spotřebitelský úvěr – orientační sazba","n","%"],["spotr.max","Spotřebitelský úvěr – max. částka","n","Kč"],["inc.dpp","Započte DPP","n","× (0–1)"],["inc.pronajem","Započte nájem","n","× (0–1)"],["inc.rodic","Započte rodičovskou","n","× (0–1)"],["inc.diety","Započte diety","n","× (0–1)"],["probation","Půjčí ve zkušební době","yn"],["myNote","Moje poznámka","t"]];
  function banksHTML(){
    const B=banks(),O=cfg.banks||{};
    return `<div class="uv-ch"><button type="button" class="btn ghost" data-a="katalog">‹ Banky</button><div class="tt"><h2>Parametry bank</h2><div class="sub">Výchozí pravidla: stav ${esc(BANKS_ASOF)} · tvoje úpravy se synchronizují s ostatními zařízeními</div></div></div>
      <div class="uv-note gray">Banky mění metodiky často. Když se na školení nebo v HypoUP dozvíš novinku (limit, sazbu, co započítávají), přepiš ji tady – doporučení se hned přepočítá. Sazby z měsíčního „Přehledu úrokových sazeb“ v HypoUP zpřesní pořadí podle ceny.</div>
      ${B.map(b=>{const o=O[b.id]||{},n=Object.keys(o).length;
        return `<details class="uv-box uv-bp"${ui.bank===b.id?" open":""}><summary data-a="bopen" data-v="${b.id}">${esc(b.name)} <span>${esc(b.kindT||"")}${b.off?" · nepoužívám":""}${n?" · "+n+" "+plural(n,"úprava","úpravy","úprav"):""}</span></summary>
          <p class="uv-foot" style="margin:6px 0 10px">${esc((b.pros||[]).join(" · "))}${b.cons&&b.cons.length?"<br>Pozor: "+esc(b.cons.join(" · ")):""}${b.src?"<br>Zdroj: "+esc(b.src):""}</p>
          <div class="uv-grid g3">${BP.map(([k,l,t,suf])=>{const v=getPath(b,k),ov=getPath(o,k)!==undefined;
            if(t==="yn")return `<div class="uv-f"><span class="uv-lbl">${esc(l)}${ov?" •":""}</span><div class="uv-chips"><button type="button" class="uv-chip${v?" on":""}" data-a="bset" data-b="${b.id}" data-k="${k}" data-v="1">Ano</button><button type="button" class="uv-chip${!v?" on":""}" data-a="bset" data-b="${b.id}" data-k="${k}" data-v="0">Ne</button></div></div>`;
            return `<div class="uv-f${t==="t"?" wide":""}"><label>${esc(l)}${ov?" •":""}</label><div class="uv-in"><input data-b="${b.id}" data-k="${k}" data-t="${t}" value="${esc(v==null?"":String(v).replace(".",","))}" ${t==="n"?'inputmode="decimal"':""}>${suf?`<span class="suf">${esc(suf)}</span>`:""}</div></div>`}).join("")}</div>
          ${n?`<div class="uv-row" style="margin-top:10px"><button type="button" class="btn sm" data-a="breset" data-v="${b.id}">Vrátit výchozí</button></div>`:""}</details>`}).join("")}`;
  }
  let cfgT=null;
  function saveCfg(){clearTimeout(cfgT);cfgT=setTimeout(()=>{cfgT=null;store&&store.doc("uvcfg/main").set(clone(cfg)).catch(()=>toast("Nepodařilo se uložit"))},400)}


  /* ---------- Banky: profily institucí, srovnání a slovníček ---------- */
  const facT=f=>f==null?"–":f>=1?"ano":f<=0?"ne":"z "+Math.round(f*100)+" %";
  const ynT=v=>v?"ano":"ne";
  const pctT=f=>Math.round(f*100)+" %";
  const dotsH=n=>{n=Math.max(0,Math.min(5,+n||0));return `<span class="uv-dots" aria-label="${n} z 5">${"●".repeat(n)}<s>${"●".repeat(5-n)}</s></span>`};
  function bankText(b){const S=b.spotr||{};return [b.name,b.s,b.kindT,b.about,b.prod,b.portal,...(b.pros||[]),...(b.cons||[]),...Object.values(b.good||{}),...Object.values(b.bad||{}),...Object.values(b.ended||{}),...(b.docs||[]),S.note,S.konsolNote,S.byd&&S.byd.note,S.byd&&S.byd.name,b.provize&&b.provize.note,b.ratesNote,b.costly].filter(Boolean).join(" ")}
  function rateLine(b){if(b.rates){const ks=Object.keys(b.rates).filter(k=>isFinite(+b.rates[k])).map(Number).sort((a,c)=>a-c);
      return ks.map(k=>k+"R "+fmtR(+b.rates[k]).replace(" %","")).join(" · ")+" %"+(b.ltv90add?" · nad 80 % LTV +"+String(b.ltv90add).replace(".",",")+" p.b.":"")}
    const ad=+b.rateAdj||0;return "průměr trhu (Hypoindex)"+(ad?(ad>0?" +":" ")+String(ad).replace(".",",")+" p.b.":"")}
  function attrGroups(b){const G=[],I=b.inc||{},P=b.purp||{},F=b.foreign||{},L=b.ltv||{},O=b.osvc||{},S=b.spotr||null,T=b.types||[],e=esc;
    const hy=T.some(t=>t==="hypo"||t==="amer")&&!(b.ended&&b.ended.hypo)&&!b.model;
    if(b.model==="druzstvo")G.push({t:"Jak to funguje",rows:[["Kdo kupuje","bytové družstvo, klient je člen a platí nájem"],["Vlastní zdroje","asi 20 % ceny"],["Příjmy","nedokládají se, posouzení individuálně"],["Pro koho","i cizinci, starší žadatelé, OSVČ s krátkou historií"],["Vlastnictví","po splacení úvěru družstva převod do osobního vlastnictví"]].map(([k,v])=>[k,e(v)])});
    if(hy){const r=[];
      r.push(["Max. LTV",e(L.max>=90?"80 %, do 36 let 90 % (ČNB)":(L.max||80)+" % (i pro mladé)")+(L.young?`<small>do 36 let až ${L.young} % v rámci výjimky ČNB</small>`:"")]);
      r.push(["Investiční / americká",e((L.inv||70)+" % / "+(T.includes("amer")?(L.amer||70)+" %":"přes ZFPA ne"))]);
      r.push(["Sazby (LTV do 80 %)",e(rateLine(b))+(b.ratesNote?`<small>${e(b.ratesNote)}</small>`:"")]);
      if(b.amerRate)r.push(["Americká hypotéka",e("od "+fmtR(+b.amerRate))]);
      const fk=b.rates?Math.max(...Object.keys(b.rates).map(Number)):null;
      r.push(["Fixace",e(b.maxFix?"max. "+b.maxFix+" let":fk?"až "+fk+" let":"podle nabídky")]);
      r.push(["Splatnost",e((b.maxYears||30)+" let"+(b.maxYearsAB?", s PENB A/B "+b.maxYearsAB+" let":"")+(T.includes("amer")?", americká "+(b.maxYearsAmer||20)+" let":""))]);
      r.push(["Věk na konci splácení",e((b.maxAge||70)+" let"+(b.ageSoft?" (standardně "+b.ageSoft+")":"")+(b.ageByYounger?", umí podle mladšího žadatele":""))]);
      r.push(["Výše úvěru",e((b.minLoan?"od "+mil(b.minLoan):"")+(b.maxLoan?(b.minLoan?" ":"")+"do "+mil(b.maxLoan):"")||"podle bonity")+(b.maxLoanAmer?e(" · americká max. "+mil(b.maxLoanAmer)):"")]);
      if(b.noIncDocsLtv)r.push(["Bez dokládání příjmů",e("do LTV "+b.noIncDocsLtv+" %")]);
      if(b.costly)r.push(["Náklady",e(b.costly)]);
      r.push(["Výpočet bonity v appce",e("DSTI do "+(b.dsti||50)+" % při sazbě +"+String(b.stress??1).replace(".",",")+" p.b., DTI do "+String(b.dti||9).replace(".",","))+"<small>orientačně – přesně HypoUP</small>"]);
      G.push({t:"Hypotéka",rows:r});
      G.push({t:"Účel a zajištění",rows:[["Družstevní byt",e(P.druzstvo?(P.druzstvo===true?"ano":P.druzstvo):"jen se zástavou jiné nemovitosti")],["Dražba",e(ynT(P.drazba))],
        ["Chata / ateliér / pozemek",e("chata "+(P.rekreace===false?"ne":"ano")+", nebytový prostor "+(P.nebytovy===false?"ne":"ano")+", samotný pozemek "+(P.pozemek===false?"ne":"ano"))],["Zástava třetí osoby",e(P.treti===false?"ne":"ano")]]})}
    if(b.inc||b.osvc){const D=I.duchod||{},Z=I.zahr||{},r=[];
      r.push(["Zkušební doba",e(b.probation?"půjčí":"ne (výjimka jen při kontinuitě)")]);
      r.push(["DPČ / DPP",e("DPČ "+facT(I.dpc??1)+", DPP "+facT(I.dpp??0))]);
      r.push(["Nájem",e(facT(I.pronajem??0.7)+" nájemného"+"; budoucí nájem "+(I.pronajemBudouci?facT(I.pronajemBudouci)+" (investiční)":"ne"))]);
      r.push(["Rodičovská, výživné, diety",e("rodičovská "+facT(I.rodic??1)+", výživné "+facT(I.vyzivne??1)+" (soudní), diety "+facT(I.diety??0))]);
      r.push(["Důchody",e("starobní a invalidní ano, vdovský "+facT(D.vdovsky??1)+", sirotčí "+facT(D.sirotci??1))]);
      r.push(["Příjem ze zahraničí",e("EU "+facT(Z.EU??0)+", mimo EU "+facT(Z.X??0))]);
      const ob=O.obrat;r.push(["OSVČ",e("z daňového základu (min. "+(O.minDp??1)+" podané DP"+(O.minMonths?" nebo "+O.minMonths+" měsíců":"")+")")+(ob?`<small>${e("obratová metoda: IT "+pctT(ob.it||0)+", svobodná povolání "+pctT(ob.svobodne||0)+", služby "+pctT(ob.sluzby||0)+", řemeslo "+pctT(ob.remeslo||0)+", obchod "+pctT(ob.obchod||0)+(O.obratMaxLtv?" (do LTV "+O.obratMaxLtv+" %"+(O.obratMaxLoan?", do "+mil(O.obratMaxLoan):"")+")":""))}</small>`:"<small>obratovou metodu nebere</small>")]);
      r.push(["Paušální daň",e(O.pausaldan===false?"nebere":O.pdK?"~"+pctT(O.pdK)+" fakturace, min. "+(O.pdMinMonths??6)+" měsíců (řemesla a obchod méně)":"jako OSVČ, individuálně")]);
      r.push(["Společník s.r.o.",e(b.sro?"vyplácený zisk "+facT(b.sro)+(b.sroNoPay?", nevyplácený "+facT(b.sroNoPay):", nevyplácený ne")+(b.sroMinPodil?", od "+b.sroMinPodil+" % podílu":"")+(b.sroMinMonths?" a "+Math.round(b.sroMinMonths/12)+" let":""):"zisk nebere (jen mzdu jednatele)")]);
      r.push(["Provize ZFPA",e(b.provize&&b.provize.note?b.provize.note.replace(/^ZFPA:\s*/,""):"jako OSVČ z daňového přiznání")]);
      G.push({t:"Jaké příjmy uzná",rows:r})}
    if(b.foreign||(S&&S.onlyCz))G.push({t:"Cizinci",rows:S&&S.onlyCz?[["Kdo","jen občané ČR s trvalým pobytem"]]:[["EU s přechodným pobytem",e(F.euPrechodny===false?"individuálně":"ano")],["Mimo EU s trvalým pobytem",e(F.mimoTrvaly===false?"ne":"ano")],["Mimo EU bez trvalého",e(F.mimoPrechodny?"individuálně":"ne")]].concat(F.note?[["Poznámka",e(F.note)]]:[])});
    if(S&&(T.includes("spotr")||T.includes("konsol"))){const r=[];
      if(!S.onlyByd){r.push(["Půjčka",e((S.od?"od "+fmtR(S.od)+", ":"")+"počítám ~"+fmtR(S.typ??RATE_SPOTR))]);
        r.push(["Částka a splatnost",e((S.min?mil(S.min)+" – ":"do ")+mil(S.max||0)+", až "+(S.years||10)+" let")]);
        if(T.includes("konsol"))r.push(["Konsolidace",e("~"+fmtR(S.konsolTyp??S.typ??RATE_SPOTR)+(S.konsolMin?", od "+mil(S.konsolMin):"")+(S.konsolYears?", až "+S.konsolYears+" let":""))]);
        if(S.garMin)r.push(["Garance sazby",e("jen nad "+mil(S.garMin)+" na max. "+S.garYears+" let s aktivním účtem")]);
        if(S.warn)r.push(["Pozor",e(S.warn)]);
        if(S.note)r.push(["Poznámka",e(S.note)]);if(S.konsolNote)r.push(["Konsolidace – jak",e(S.konsolNote)])}
      if(S.byd){const y=S.byd;r.push([y.name||"Na bydlení bez zástavy",e("~"+fmtR(y.typ)+(y.typDruz?" (družstvo "+fmtR(y.typDruz)+")":"")+", do "+mil(y.max)+(y.max2?" (ve dvou "+mil(y.max2)+")":"")+(y.maxDruz?", družstvo do "+mil(y.maxDruz):"")+", až "+y.years+" let"+(y.yearsDruz?" (družstvo "+y.yearsDruz+")":""))+(y.note?`<small>${e(y.note)}</small>`:"")])}
      G.push({t:S.onlyByd?"Úvěry na bydlení bez zástavy":"Spotřebitelské úvěry",rows:r})}
    G.push({t:"Proces",rows:[["Systém / podání",e(b.portal||"–")],["Rychlost",dotsH(b.speed||3)],["Flexibilita",dotsH(b.flex||3)],["Jednoduché dokládání",dotsH(b.simple||3)],["Online",dotsH(b.online||3)]].concat((b.docs||[]).length?[["Specifika",e(b.docs.join(" · "))]]:[])});
    return G}
  function katalogHTML(){
    const B=banks(),O=cfg.banks||{},seg=ui.kseg||"inst",qq=fold(ui.kq||"").trim();
    const back=ui.ret&&ui.ret.view==="case"?`<button type="button" class="btn ghost" data-a="kback">‹ Zpět k případu</button>`:ui.ret&&ui.ret.view==="guide"?`<button type="button" class="btn ghost" data-a="kback">‹ Průvodce</button>`:`<button type="button" class="btn ghost" data-a="back">‹ Úvěry</button>`;
    const nT=GLOSS.reduce((a,g)=>a+g[1].length,0);
    let html=`<div class="uv-ch">${back}<div class="tt"><h2>Banky a pojmy</h2><div class="sub">Profily institucí přes ZFPA – plusy, minusy a pravidla (stav ${esc(BANKS_ASOF)}), srovnání a slovníček</div></div><button type="button" class="btn" data-a="banks">Upravit pravidla</button></div>
      <div class="uv-bar"><div class="uv-seg" role="tablist">${[["inst","Instituce"],["cmp","Srovnání"],["pojmy","Pojmy"]].map(([k,t])=>`<button type="button" data-a="kseg" data-v="${k}" class="${seg===k?"on":""}">${t}</button>`).join("")}</div>
      ${seg==="cmp"?"":`<input type="search" class="uv-q" data-ui="kq" placeholder="${seg==="pojmy"?"Hledat pojem… (např. LTV, plomba)":"Hledat… (např. OSVČ, cizinci, družstvo)"}" value="${esc(ui.kq||"")}" aria-label="Hledat">`}</div>`;
    if(seg==="pojmy"){
      const G=GLOSS.map(([cat,L])=>[cat,L.filter(([t,d])=>hitQ(t+" "+d,ui.kq||""))]).filter(([,L])=>L.length);
      return html+(G.length?`<div class="uv-gl">${G.map(([cat,L])=>`<h4>${esc(cat)}</h4><dl>${L.map(([t,d])=>`<div class="t"><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>`).join("")}</div>`:`<p class="uv-empty">Nic nenalezeno – zkus jiné slovo.</p>`)
        +`<p class="uv-foot">${nT} pojmů · stav 10/2026. Čísla bank se mění – aktuální pravidla jsou v profilech institucí.</p>`}
    if(seg==="cmp"){
      const H=B.filter(b=>(b.types||[]).some(t=>t==="hypo")&&!(b.ended&&b.ended.hypo)&&!b.model);
      const row=(lab,f)=>`<tr><td>${esc(lab)}</td>${H.map(b=>`<td>${f(b)}</td>`).join("")}</tr>`;
      const rt=(b,f)=>fmtR(bankRate(b,f,75,RATES,"hypo",3000000));
      return html+`<div class="uv-box uv-tw" style="padding:6px 8px"><table class="uv-tab uv-cmp"><thead><tr><th></th>${H.map(b=>`<th>${esc(b.s)}${b.off?" (nepoužívám)":""}</th>`).join("")}</tr></thead><tbody>
        ${row("Sazba 3 / 5 let (LTV do 80 %)",b=>esc(rt(b,3)+" / "+rt(b,5)))}
        ${row("Nad 80 % LTV",b=>esc(b.rates?"+"+String(b.ltv90add??0.2).replace(".",",")+" p.b.":"–"))}
        ${row("Max. LTV",b=>esc(((b.ltv||{}).max>=90?"90 % do 36 let":((b.ltv||{}).max||80)+" %")+((b.ltv||{}).young?", mladí až "+b.ltv.young+" %":"")))}
        ${row("Americká hypotéka",b=>esc((b.types||[]).includes("amer")?"LTV "+((b.ltv||{}).amer||70)+" %"+(b.amerRate?", od "+fmtR(+b.amerRate):""):"ne"))}
        ${row("Fixace max.",b=>esc(b.maxFix?b.maxFix+" let":b.rates?Math.max(...Object.keys(b.rates).map(Number))+" let":"10 let"))}
        ${row("Splatnost / věk na konci",b=>esc((b.maxYears||30)+" let / "+(b.maxAge||70)+(b.ageSoft?" (st. "+b.ageSoft+")":"")))}
        ${row("DPČ / DPP",b=>esc(facT((b.inc||{}).dpc??1)+" / "+facT((b.inc||{}).dpp??0)))}
        ${row("OSVČ – obrat (služby)",b=>esc((b.osvc||{}).obrat?pctT(b.osvc.obrat.sluzby||0)+((b.osvc||{}).obratMaxLtv?" do LTV "+b.osvc.obratMaxLtv+" %":""):"ne"))}
        ${row("Paušální daň",b=>esc((b.osvc||{}).pdK?"~"+pctT(b.osvc.pdK)+" fakturace":"individuálně"))}
        ${row("Zisk s.r.o.",b=>esc(b.sro?facT(b.sro)+(b.sroNoPay?" (i nevyplácený)":""):"ne"))}
        ${row("Budoucí nájem",b=>esc((b.inc||{}).pronajemBudouci?facT(b.inc.pronajemBudouci):"ne"))}
        ${row("Cizinec EU s přechodným pobytem",b=>esc((b.foreign||{}).euPrechodny===false?"individuálně":"ano"))}
        ${row("Družstevní byt bez jiné zástavy",b=>esc((b.purp||{}).druzstvo?"ano (předhypoteční)":"ne"))}
        ${row("Bez dokládání příjmů",b=>esc(b.noIncDocsLtv?"do LTV "+b.noIncDocsLtv+" %":"–"))}
        ${row("Rychlost",b=>dotsH(b.speed||3))}
        ${row("Online",b=>dotsH(b.online||3))}
        ${row("Nejsilnější v",b=>esc((b.pros||[])[0]||""))}
      </tbody></table></div>
      <p class="uv-foot">Sazby: vlastní tabulky bank (stav ${esc(BANKS_ASOF)}) nebo průměr Hypoindexu ${esc(String(RATES.period||"").split("-").reverse().join("/"))} ± odchylka, včetně tvých úprav v Parametrech bank. Stavební spořitelny, BIDLI a spotřebitelské společnosti najdeš v Institucích.</p>`}
    const KF=[["all","Vše"],["banka","Banky"],["ss","Stavební spořitelny"],["spotr","Spotřebitelské"],["spec","Ostatní"]];
    const list=B.filter(b=>(!ui.kf||ui.kf==="all"||b.kind===ui.kf)&&hitQ(bankText(b),ui.kq||""));
    const card=b=>{const o=O[b.id]||{},n=Object.keys(o).filter(k=>k!=="myNote").length,open=ui.kopen===b.id||(qq&&list.length<=2);
      const types=(b.types||[]).filter(t=>!(b.ended&&b.ended[t])).map(t=>`<span class="uv-pill">${esc(t==="spotr"&&b.spotr&&b.spotr.onlyByd?"Bydlení bez zástavy":TYPE_T[t]||t)}</span>`).join("");
      const tagLi=(k,v,cls,ic)=>{const lab=TAG_T[k]||k,pre=fold(v).startsWith(fold(lab).split(" ")[0])?"":`<b>${esc(lab)}:</b> `;return `<li class="${cls}"><i>${ic}</i><span>${pre}${esc(v)}</span></li>`};
      const plus=(b.pros||[]).map(x=>`<li class="p"><i>✓</i><span>${esc(x)}</span></li>`).concat(Object.entries(b.good||{}).map(([k,v])=>tagLi(k,v,"p","✓")));
      const minus=[...Object.values(b.ended||{}),...(b.cons||[])].map(x=>`<li class="m"><i>!</i><span>${esc(x)}</span></li>`).concat(Object.entries(b.bad||{}).map(([k,v])=>tagLi(k,v,"m","!")));
      return `<details class="uv-kb" id="kb-${b.id}"${open?" open":""}><summary data-a="kopen" data-v="${b.id}"><span class="nm">${esc(b.name)}</span><span class="kt">${esc(b.kindT||"")}${b.off?" · nepoužívám":""}${n?" · "+n+" "+plural(n,"vlastní úprava","vlastní úpravy","vlastních úprav"):""}</span><span class="uv-pills" style="margin:0;flex-basis:100%">${types}</span></summary>
        <div class="bd">${b.about?`<p class="ab">${esc(b.about)}</p>`:""}
          <p class="uv-more" style="margin:0 0 10px">${b.prod?`<b>Přes ZFPA:</b> ${esc(b.prod)}`:""}${b.portal?` · <b>Podání:</b> ${esc(b.portal)}`:""}</p>
          <div class="uv-pc"><div><h4>Plusy</h4><ul>${plus.join("")||`<li>–</li>`}</ul></div><div><h4>Minusy a na co pozor</h4><ul>${minus.join("")||`<li>–</li>`}</ul></div></div>
          <div class="uv-at">${attrGroups(b).map(g=>`<div><h4>${esc(g.t)}</h4><dl>${g.rows.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl></div>`).join("")}</div>
          ${o.myNote?`<div class="uv-note gray" style="margin:10px 0 0"><b>Moje poznámka:</b> ${esc(o.myNote)}</div>`:""}
          <div class="uv-row" style="margin-top:10px"><button type="button" class="btn sm" data-a="kedit" data-v="${b.id}">Upravit pravidla ${esc(b.s)}</button><span class="uv-foot" style="margin:0;flex:1;min-width:200px">Zdroj: ${esc(b.src||"")}</span></div></div></details>`};
    return html+`<div class="uv-seg" style="margin:0 0 12px">${KF.map(([k,t])=>`<button type="button" data-a="kf" data-v="${k}" class="${(ui.kf||"all")===k?"on":""}">${t}</button>`).join("")}</div>
      ${list.length?list.map(card).join(""):`<p class="uv-empty">Nic nenalezeno – zkus jiné slovo nebo filtr.</p>`}
      <p class="uv-foot">Plusy a minusy jsou ze ZFPA metodik, školení HypoUP a webů bank (stav ${esc(BANKS_ASOF)}). Pravidla, podle kterých appka řadí banky, upravíš tlačítkem „Upravit pravidla“ – projeví se v doporučení i tady.</p>`;
  }

  /* ---------- průvodce ---------- */
  function guideHTML(){
    const F=RATES.fix||{},fx=k=>F[k]&&F[k].a!=null?fmtR(F[k].a):"–",per=String(RATES.period||"").split("-").reverse().join("/");
    const S=[["Poptávka a příprava","Účel, cena, termín z rezervace. Rezervace bývá 30–60 dní – domluv lhůtu s rezervou a „hypoteční doložku“ (poplatek se vrací, když banka úvěr zamítne). Rezervaci až po ověření bonity. 1–3 měsíce předem žádné nové úvěry, splátky na telefon, změna práce ani přechod na IČO."],
      ["Analýza (schůzka)","Dotazník, souhlas s registry, karta klienta + GDPR + informační list (ZFPA). Řekni, koho zastupuješ a že nejde o radu dle § 85. AML: účel úvěru, původ vlastních zdrojů, PEP. Bonita v HypoUP; klientovi ukazuj splátku a náklady za fixaci, ne DTI/DSTI."],
      ["Srovnání a výběr","3 modelace / HypoUP, stejná fixace, bez PSS. Garance sazby (ČSOB i RB 30 dní). Bez vybrané nemovitosti: hypotéka předem (ČSOB 9 měsíců, UniCredit 12 měsíců, KB až 3 roky). Záznam o zprostředkování (2026: 260424_FK)."],
      ["Podklady a odhad","Kompletní podklady najednou (záložka Podklady). Odhad 1–2 týdny (online u bytů pár dní), platí obvykle 6 měsíců. Nízký odhad: jiná banka (jiná metodika), dozajištění nebo vyjednat cenu. Kopie ověřuj proti originálu."],
      ["Schvalování","Od kompletních podkladů typicky 1–3 týdny (ČSOB do 5 pracovních dnů, RB do 3 dnů); celá koupě 1–3 měsíce. Nesoulad potvrzení o příjmu a výpisů = zamítnutí. Žádné nové závazky do čerpání."],
      ["Smlouvy","ESIS předej s předstihem a vysvětli – u hypotéky není 14denní odstoupení. Úvěrová a zástavní smlouva (ověřené podpisy), kupní smlouva + úschova (advokát, notář, banka). Kupní smlouvu až po schválení."],
      ["Čerpání","Návrh na vklad (správní poplatek 2 000 Kč, kolky skončily 2024) → plomba na LV → pojištění s vinkulací → doložit vlastní zdroje (platí se první) → banka platí poslední. Katastr zapisuje nejdřív za 20 dní (průměr 22 dní); čerpání na plombu stojí 1–2,2 tis. (KB zdarma)."],
      ["Po čerpání","Doložit zápis zástavy (LV), u výstavby kolaudaci do 6–12 měsíců po dočerpání. Uložit úvěr ke klientovi, hlídat fixaci, nabídnout ŽP a pojištění nemovitosti, požádat o doporučení."]];
    const N=[["LTV","80 %, do 36 let 90 % (manželům stačí jeden, nesezdaní oba), jen vlastní bydlení. Výjimka ČNB do 5 % objemu – UniCredit mladým až 95 %, Oberbank jen 80 %."],
      ["Investiční (ČNB od 1. 4. 2026)","LTV 70 % a DTI 7 při koupi 3. a další obytné nemovitosti nebo k pronájmu (rozhoduje žadatel s nejvíc nemovitostmi, SJM = 1). Započtený budoucí nájem = vždy investiční, neúčelová (americká) se předpokládá investiční. Neplatí pro výstavbu, rekonstrukci a refinancování bez navýšení."],
      ["Doporučení ČNB","DSTI nad 40 % (počítané i při sazbě +2 p.b.) a DTI nad 8 jen velmi obezřetně; splatnost max. 30 let; refinancování bez prodloužení splatnosti; nezajištěný úvěr klientovi s hypotékou max. 8 let; neobcházet LTV spotřebákem."],
      ["Bonita","banky nechají splácet zhruba 45–50 % čistého příjmu; 1 mil. ≈ 5,5–6 tis. Kč splátky na 30 let; kreditky a kontokorenty ~3 % limitu i nevyčerpané – nepoužívané zrušit."],
      ["Věk a splatnost","standard 30 let (mBank 40, ČS u PENB A/B 35); věk při splatnosti 70 (Oberbank 75, ČSOB standardně 65), ČSOB umí podle mladšího žadatele."],
      ["OSVČ","1 podané DP (UniCredit rok podnikání), výpisy 3–6 měsíců; daňový základ vs. obratová metoda (RSTS až 65 % obratu, ČS a RB 40–60 % podle oboru). Paušální daň: výpisy za 6 měsíců s platbami daně – nejvíc uzná mBank (~70 % fakturace), nejmíň ČSOB HB."],
      ["Mimořádné splátky (ZSÚ od 9/2024)","zdarma: v měsíci před výročím smlouvy až 25 % výše úvěru, do 3 měsíců od oznámení nové sazby, prodej nemovitosti a vypořádání SJM po 24 měsících, smrt / invalidita / dlouhodobá nemoc, plnění z PSS. Jinak max. 0,25 % za každý započatý rok zbývající fixace (celkem max. 1 %), americká max. 1 %. Smlouvy před 9/2024 až od další fixace."],
      ["Poplatky","odhad 3,5–7 tis. (ČS a ČSOB zdarma, mBank online 1 900 Kč); vklad 2 000 Kč; nečerpání u výstavby: ČS 0,5 % p.a. až po 24 měsících, ČSOB 0,5 % p.a. (u výstavby obvykle sleva), RB jen při čerpání pod 50 %, UniCredit kompenzace 0,3 %, Oberbank 5 % (nad 20 % nevyčerpaných)."],
      ["Fixace a refixace","banka musí oznámit novou sazbu nejpozději 3 měsíce před koncem; refixaci řeš 6–9 měsíců předem (UniCredit 18–24, RB až 24, Oberbank 12–18 měsíců dopředu). Refixuje se 2026 ~470 mld. (z ~3,2 %), 2027 ~530 mld., 2028 ~600 mld."],
      ["Sazby",`Hypoindex ${per}: ${fmtR(+RATES.index)} (nabídkový průměr; LTV do 80 %: 1R ${fx(1)}, 3R ${fx(3)}, 5R ${fx(5)}, 10R ${fx(10)}). Skutečně sjednané bývají níž (ČBA 9/2026: 5,10 %). Repo ČNB 3,75 % od 19. 6. 2026.`],
      ["Daně a podpory","odpočet úroků max. 150 tis. Kč ročně na domácnost (300 tis. u bydlení pořízeného před 2021; od 2026 i družstevníci); stavební spoření: státní podpora max. 1 000 Kč ročně; Nová zelená úsporám: bezúročný úvěr na renovace rodinných domů až 750 tis. / 2 mil. (od 19. 10. 2026 ČSOB, další banky během podzimu)."],
      ["Registry","BRKI a NRKI drží data 4 roky po skončení smlouvy (neúspěšná žádost 1 rok / 6 měsíců), negativní SOLUS 3 roky po zaplacení. Výpis: kolikmam.cz (BRKI + NRKI), solus.cz."]];
    const C=["Před zprostředkováním (§ 93 ZSÚ): koho zastupuješ (ZFP akademie), že neposkytuješ radu dle § 85, výši odměny od banky na požádání.",
      "Od klienta před uzavřením úvěrové smlouvy nic (§ 83); odměna od klienta i od banky zároveň je zakázaná (§ 80).",
      "Bance jen pravdivé a úplné údaje (§ 84) – potvrzení ani výpisy neupravuj, kopie ověřuj proti originálům.",
      "ESIS / předsmluvní informace předat a vysvětlit (§ 94). Záznamy uchovej 5 let, u zamítnuté žádosti 1 rok (§ 78).",
      "AML: identifikace, účel obchodu, původ peněz, PEP; podezřelý obchod hlásit (ne e-mailem). Úvěr nikdy nesjednáš sám sobě.",
      "Spotřebáky: ukazuj RPSN a celkovou splatnou částku; klient má 14 dní na odstoupení. Novela ZSÚ (CCD2, Senát od 21. 10. 2026, účinnost asi od 1. 2. 2027): strop RPSN ~48 %, BNPL pod zákon, domněnka úvěruschopnosti."];
    return `<div class="uv-ch"><button type="button" class="btn ghost" data-a="back">‹ Úvěry</button><div class="tt"><h2>Průvodce hypotékou</h2><div class="sub">Postup krok za krokem a čísla, která potřebuješ u stolu (ověřeno 10/2026)</div></div><button type="button" class="btn" data-a="kpojem">Slovníček pojmů</button></div>
      <div class="uv-grid" style="align-items:start"><div><div class="uv-box"><div class="uv-h3" style="margin-top:0">Postup</div>${S.map(([t,d],i)=>`<div class="uv-kv" style="display:block"><b>${i+1}. ${esc(t)}</b><div style="color:var(--uv-l2);margin-top:2px;line-height:1.45">${esc(d)}</div></div>`).join("")}</div>
        <div class="uv-box"><div class="uv-h3" style="margin-top:0">Povinnosti vázaného zástupce</div><ul class="uv-alts">${C.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div></div>
      <div class="uv-box"><div class="uv-h3" style="margin-top:0">Čísla a pravidla</div>${N.map(([t,d])=>`<div class="uv-kv" style="display:block"><b>${esc(t)}</b><div style="color:var(--uv-l2);margin-top:2px;line-height:1.45">${esc(d)}</div></div>`).join("")}
        <p class="uv-foot">ZFPA: k provizi karta klienta, souhlas GDPR, informační list, záznam o zprostředkování, srovnání (HypoUP / 3 modelace) a kopie smlouvy.</p></div></div>`;
  }

  /* ---------- tisk ---------- */
  function printDoc(title,body){
    const html=`<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#111;padding:28px;max-width:820px;margin:auto;font-size:13.5px;line-height:1.45}
      h1{font-size:21px;margin:0 0 2px}h2{font-size:15px;margin:20px 0 6px;border-bottom:2px solid #E8571A;padding-bottom:3px}.sub{color:#666;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;margin:6px 0}td,th{padding:6px 7px;border-bottom:1px solid #e5e5ea;text-align:left;vertical-align:top}th{font-size:12px;color:#666}td.r,th.r{text-align:right}
      .ft{margin-top:22px;font-size:11px;color:#777;border-top:1px solid #e5e5ea;padding-top:8px}ul{padding-left:18px}li{margin:3px 0}.box{border:1px solid #e5e5ea;border-radius:8px;padding:10px 12px}
      .sig{display:flex;gap:40px;margin-top:40px}.sig div{flex:1;border-top:1px solid #999;padding-top:4px;font-size:12px;color:#555}@media print{body{padding:0}}</style></head><body>${body}
      <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`;
    const w=window.open("","_blank");if(!w){toast("Prohlížeč zablokoval nové okno – povol vyskakovací okna");return}
    w.document.open();w.document.write(html);w.document.close();
  }
  function printSummary(){
    const c=cur,q=c.q||{},M=metrics(q,RATES),t=q.typ||"hypo",b=c.bank&&bankById(c.bank);
    const docs=docsList(q,b).filter(d=>d.c&&!(c.docs||{})[d.k]);
    const rows=[["Typ úvěru",TYPE_T[t]],isHypoLike(t)&&t!=="amer"?["Účel",PURP_T[q.ucel||"koupe"]]:null,isHypoLike(t)?["Nemovitost",PROP_T[q.predmet]||""]:null,n0(q.cena)?["Cena / rozpočet",kc(n0(q.cena))]:null,
      n0(q.vlastni)?["Vlastní zdroje",kc(n0(q.vlastni))]:null,["Výše úvěru",kc(M.loan)],isHypoLike(t)&&isFinite(M.ltv)?["LTV",pct(M.ltv,1)]:null,["Splatnost",M.years+" let"],isHypoLike(t)?["Fixace",M.fix+" "+plural(M.fix,"rok","roky","let")]:null,
      ["Orientační splátka",kc(M.pay)+" (při sazbě ~"+fmtR(M.rate)+")"],b?["Banka",b.name]:null].filter(Boolean);
    printDoc("Úvěr – "+(c.name||""),`<h1>Podklady k úvěru – ${esc(c.name||"")}</h1><div class="sub">${esc(fmtD(todayStr()))}</div>
      <h2>Parametry</h2><table>${rows.map(([k,v])=>`<tr><th style="width:38%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
      ${docs.length?`<h2>Co prosím připravit</h2><ul>${docs.map(d=>`<li>${esc(d.c)}</li>`).join("")}</ul>`:""}
      <h2>Jak to půjde dál</h2><ol><li>Podklady a odhad nemovitosti</li><li>Podání žádosti a schválení (obvykle 1–3 týdny)</li><li>Podpis úvěrové a zástavní smlouvy, kupní smlouva s úschovou</li><li>Návrh na vklad na katastr, pojištění nemovitosti, čerpání</li></ol>
      <div class="ft">Orientační výpočet podle průměrných sazeb (${esc(RATES.source||"")} ${esc(String(RATES.period||""))}); závazné jsou až podmínky banky ve smlouvě. ${esc(sign())}</div>`);
  }
  function printOffers(){
    const c=cur,O=c.offers||[],sp=isSp();
    const rows=O.map(o=>{const x=offerCalc(o),b=bankById(o.bank);return `<tr><td>${esc(b?b.name:o.bank)}</td><td class="r">${esc(fmtR(num(o.rate)))}</td><td class="r">${sp?esc(isFinite(num(o.rpsn))?fmtR(num(o.rpsn)):"–"):esc(o.fix||"")+" let"}</td><td class="r">${esc(o.years||"")} let</td><td class="r">${kc(n0(o.amount))}</td><td class="r">${x?kc(x.payment):"–"}</td><td class="r">${x?kc(x.cost):"–"}</td><td class="r">${x?kc(sp?x.total:x.balance):"–"}</td></tr>${o.note?`<tr><td colspan="8" style="color:#555;font-size:12px">${esc(o.note)}</td></tr>`:""}`}).join("");
    printDoc("Přehled nabídek – "+(c.name||""),`<h1>Přehled zpracovaných nabídek úvěru</h1><div class="sub">${esc(c.name||"")} · ${esc(fmtD(todayStr()))}</div>
      <table><thead><tr><th>Banka</th><th class="r">Sazba</th><th class="r">${sp?"RPSN":"Fixace"}</th><th class="r">Splatnost</th><th class="r">Výše</th><th class="r">Splátka</th><th class="r">${sp?"Náklady celkem*":"Náklady za fixaci*"}</th><th class="r">${sp?"Celkem zaplatíte":"Zůstatek po fixaci"}</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:12px;color:#555">* ${sp?"úroky za celou dobu splácení + poplatky + případné pojištění":"úroky za dobu fixace + poplatky + případné pojištění schopnosti splácet"}. Nabídky jsou orientační; platí podmínky v úvěrové smlouvě a v ESIS / předsmluvních informacích.</p>
      <p style="font-size:12px;color:#555">Přehled zpracovaných nabídek pro Vaše rozhodnutí – nejde o radu podle § 85 zákona o spotřebitelském úvěru. Vázaný zástupce zprostředkovává jménem ZFP akademie, a.s.; výši odměny od poskytovatele Vám na požádání sdělíme.</p>
      ${c.offerId?`<p><b>Klient zvolil:</b> ${esc((bankById((O.find(o=>o.id===c.offerId)||{}).bank)||{}).name||"")}</p>`:""}
      <div class="sig"><div>Klient</div><div>Vázaný zástupce (ZFP akademie, a.s.)</div></div>
      <div class="ft">Příloha k záznamu o zprostředkování úvěru. ${esc(sign())}</div>`);
  }

  /* ---------- akce ---------- */
  function offerFor(bankId){const q=cur.q||{},M=metrics(q,RATES),b=bankById(bankId)||banks()[0];
    return {id:newId(),bank:b.id,rate:bankRate(b,M.fix,M.ltv,RATES,q.typ||"hypo"),fix:M.fix,years:M.years,amount:M.loan||"",fee:"",feeOdhad:"",feeOther:"",pss:"",note:""}}
  async function saveProd(){
    const c=cur;let e=entryOf(c);
    if(!opts.saveProduct){toast("Ukládání ke klientovi tu není k dispozici");return}
    if(!e)e={id:"x:"+c.id,name:c.name,phone:c.phone||"",products:[],virtual:true};
    const b=bankById(c.bank),t=(c.q&&c.q.typ)||"hypo";
    const p={type:isHypoLike(t)?"Hypotéka":"Úvěr",company:b?b.name:"",amt:loanOf(c),unit:"Kč",from:(c.dates&&c.dates.cerpani)||todayStr(),fix:n0(c.fixYears)||n0(c.q&&c.q.fixace)||"",status:"active",no:c.contractNo||"",src:{uv:c.id}};
    try{const rec=await opts.saveProduct(e,p);if(rec&&rec.id&&!c.cid){c.cid=rec.id}c.tasks={...(c.tasks||{}),"cerpano:ulozit":new Date().toISOString()};logAdd(c,"Úvěr uložen ke klientovi");save(true);toast("Uloženo ke klientovi – fixace se bude hlídat");draw()}
    catch(err){console.warn(err);toast("Nepodařilo se uložit ke klientovi")}
  }
  function copyText(t){try{navigator.clipboard.writeText(t).then(()=>toast("Zkopírováno – vlož do zprávy"),()=>prompt("Zkopíruj:",t))}catch(e){prompt("Zkopíruj:",t)}}
  function after(w){
    w.addEventListener("click",onClick);w.addEventListener("input",onInput);w.addEventListener("change",onChange);
    w.addEventListener("focusout",ev=>{const el=ev.target;if(el.dataset&&el.dataset.t==="kc"&&el.dataset.k){const v=num(el.value);if(isFinite(v))el.value=fmt0(v)}});
    w.addEventListener("keydown",ev=>{const el=ev.target;if(ev.key==="Enter"&&el.classList&&el.classList.contains("uv-tile")&&el.dataset.a){el.click()}if(ev.key==="Enter"&&el.id==="uvLogIn"){ev.preventDefault();w.querySelector('[data-a="logadd"]').click()}if(ev.key==="Enter"&&el.id==="uvNq"){ev.preventDefault();const f=w.querySelector('[data-a="npick"]');if(f)f.click();else w.querySelector('[data-a="ncreate"]').click()}});
    const board=w.querySelector("#uvBoard");
    if(board){board.addEventListener("dragstart",ev=>{const c=ev.target.closest&&ev.target.closest(".uv-card");if(!c)return;drag=c.dataset.id;try{ev.dataTransfer.setData("text/plain",drag);ev.dataTransfer.effectAllowed="move"}catch(e){}});
      board.querySelectorAll(".uv-col").forEach(col=>{col.addEventListener("dragover",ev=>{if(!drag)return;ev.preventDefault();col.classList.add("drop")});col.addEventListener("dragleave",()=>col.classList.remove("drop"));
        col.addEventListener("drop",ev=>{ev.preventDefault();col.classList.remove("drop");const id=drag;drag=null;if(id)moveById(id,col.dataset.stage)})})}
    if(ui.view==="case"&&ui.tab==="podklady"&&opts.docsFor){const box=w.querySelector("#uvDocs"),e=entryOf(cur);if(box&&e){try{const n=opts.docsFor(e);if(n){box.className="uv-box";box.append(n)}}catch(err){console.warn(err)}}}
  }
  function onClick(ev){
    const el=ev.target.closest("[data-a]");if(!el||el.tagName==="SELECT"||(el.tagName==="INPUT"&&el.type==="checkbox"))return;
    const a=el.dataset.a,v=el.dataset.v;
    if(a==="open")return openCase(el.dataset.id);
    if(a==="new"){newSt={q:"",pick:null,typ:"hypo",name:""};ui.view="new";keepUi();draw();setTimeout(()=>{const i=root.querySelector("#uvNq");if(i)i.focus()},30);return}
    if(a==="back")return go("board");
    if(a==="ft"){ui.ft=v;keepUi();return draw()}
    if(a==="guide"||a==="banks"||a==="fix")return go(a);
    if(a==="katalog"){if(ui.view!=="banks")ui.ret=null;return go("katalog")}
    if(a==="kseg"){ui.kseg=v;ui.kq="";keepUi();return draw()}
    if(a==="kf"){ui.kf=v;keepUi();return draw()}
    if(a==="kopen"){ui.kopen=ui.kopen===v?null:v;return}
    if(a==="kedit"){ui.bank=v;go("banks");setTimeout(()=>{const x=root.querySelector(`summary[data-v="${v}"]`);if(x)x.scrollIntoView({block:"start"})},30);return}
    if(a==="kpojem"||a==="kprof"){ui.ret=ui.view==="case"&&cur?{view:"case",id:cur.id,tab:ui.tab}:ui.view==="guide"?{view:"guide"}:null;
      if(a==="kprof"){ui.kseg="inst";ui.kf="all";ui.kopen=v;ui.kq=""}else{ui.kseg="pojmy";ui.kq=v||""}
      go("katalog");if(a==="kprof")setTimeout(()=>{const x=root.querySelector("#kb-"+v);if(x)x.scrollIntoView({block:"start"})},30);return}
    if(a==="kback"){const r=ui.ret;ui.ret=null;if(r&&r.view==="case"&&r.id&&cases.some(c=>c.id===r.id))return openCase(r.id,r.tab||"banky");if(r&&r.view==="guide")return go("guide");return go("board")}
    if(a==="npick"){newSt.pick=entries().find(e=>e.id===el.dataset.id)||null;return draw()}
    if(a==="nunpick"){newSt.pick=null;newSt.q="";return draw()}
    if(a==="ntyp"){newSt.typ=v;return draw()}
    if(a==="ncreate")return createCase();
    if(a==="refi")return createRefi(el.dataset.eid,el.dataset.pid);
    if(a==="bopen"){ui.bank=ui.bank===v?null:v;return}
    if(a==="bset"){const o=cfg.banks[el.dataset.b]||(cfg.banks[el.dataset.b]={});setPath(o,el.dataset.k,v==="1");saveCfg();return draw()}
    if(a==="breset"){delete cfg.banks[v];saveCfg();return draw()}
    if(!cur)return;
    const c=cur,q=c.q||(c.q={});
    if(a==="tab"){ui.tab=v;keepUi();draw();return}
    if(a==="step"){ui.step=+v;keepUi();draw();const b=root.querySelector(".uv-wsteps");if(b&&b.getBoundingClientRect().top<0)b.scrollIntoView({block:"start"});return}
    if(a==="chip"){const k=el.dataset.k,cv=getPath(c,k);
      if(el.dataset.multi){let arr=Array.isArray(cv)?cv.slice():[];if(arr.includes(v))arr=arr.filter(x=>x!==v);else{arr.push(v);const mx=+el.dataset.max;if(mx&&arr.length>mx)arr.shift()}setPath(c,k,arr)}
      else setPath(c,k,String(cv??"")===v&&!/^q\.(typ|ucel|predmet|zajisteni)$/.test(k)?"":(/fixace$/.test(k)?+v:v));
      if(k==="q.typ"){if(!isHypoLike(v)){q.splatnost=q.splatnost&&n0(q.splatnost)<=10?q.splatnost:8}else{if(!q.ucel&&v!=="amer")q.ucel="koupe";if(!q.predmet)q.predmet="byt";if(n0(q.splatnost)<=10)q.splatnost=v==="amer"?20:30;if(!q.fixace)q.fixace=5}}
      save();return draw()}
    if(a==="zadd"){(q.zad=applicants(q)).push({jmeno:"",prijmy:[],vztah:"manzel"});save();return draw()}
    if(a==="zdel"){q.zad.splice(+el.dataset.i,1);save();return draw()}
    if(a==="pdel"){q.zad[+el.dataset.i].prijmy.splice(+el.dataset.j,1);save();return draw()}
    if(a==="dadd"){(q.zav||(q.zav=[])).push({typ:"spotr"});save();return draw()}
    if(a==="ddel"){q.zav.splice(+el.dataset.i,1);save();return draw()}
    if(a==="advance"){const i=STAGES.findIndex(s=>s.k===c.stage);if(i>=0&&STAGES[i+1]){moveStage(c,STAGES[i+1].k);save(true);toast(STAGES[i+1].t);draw()}return}
    if(a==="setstage"){moveStage(c,v);save(true);return draw()}
    if(a==="client"){const e=entryOf(c);if(e&&opts.openClient)opts.openClient(e);return}
    if(a==="print")return printSummary();
    if(a==="pickbank"){c.bank=c.bank===v?"":v;if(c.bank)logAdd(c,"Vybraná banka: "+(bankById(v)||{}).name);save();return draw()}
    if(a==="offeradd"){(c.offers||(c.offers=[])).push(offerFor(v||c.bank||(recommend(q,banks(),RATES).list.find(r=>!r.ko.length)||{}).id||banks()[0].id));save();ui.tab="nabidky";keepUi();return draw()}
    if(a==="offertop"){const have=new Set((c.offers||[]).map(o=>o.bank));const top=recommend(q,banks(),RATES).list.filter(r=>!r.ko.length&&!r.na&&r.verdict!=="excl"&&!have.has(r.id)).slice(0,Math.max(0,3-(c.offers||[]).length)||3);
      if(!top.length){toast("Žádná další vhodná banka");return}top.forEach(r=>(c.offers||(c.offers=[])).push(offerFor(r.id)));save();return draw()}
    if(a==="offerpick"){const o=c.offers[+el.dataset.i];if(!o)return;if(c.offerId===o.id){c.offerId="";save();return draw()}c.offerId=o.id;c.bank=o.bank;c.rate=o.rate;c.fixYears=o.fix;c.amount=o.amount;logAdd(c,"Klient zvolil nabídku: "+((bankById(o.bank)||{}).name||"")+" "+fmtR(num(o.rate))+", fixace "+o.fix+" let");save();return draw()}
    if(a==="offerdel"){const o=c.offers[+el.dataset.i];c.offers.splice(+el.dataset.i,1);if(o&&c.offerId===o.id)c.offerId="";save();return draw()}
    if(a==="offerprint")return printOffers();
    if(a==="dck"){const k=el.dataset.k,d=c.docs||(c.docs={});if(d[k])delete d[k];else d[k]=todayStr();save();return draw()}
    if(a==="dna"){(c.docs||(c.docs={}))[el.dataset.k]="na";save();return draw()}
    if(a==="dcopy"||a==="dmail"||a==="dsms"){const b=c.bank&&bankById(c.bank),txt=clientDocsText(q,c.docs||{},b,sign());if(!txt)return;
      if(a==="dcopy")return copyText(txt);
      if(a==="dmail"){location.href="mailto:"+encodeURIComponent(c.email||"")+"?subject="+encodeURIComponent("Podklady k úvěru")+"&body="+encodeURIComponent(txt);return}
      location.href="sms:"+String(c.phone||"").replace(/\s/g,"")+"?&body="+encodeURIComponent(txt);return}
    if(a==="logadd"){const i=root.querySelector("#uvLogIn"),t=(i&&i.value||"").trim();if(!t)return;logAdd(c,t);save(true);return draw()}
    if(a==="delcase"){if(!confirm("Smazat případ „"+(c.name||"")+"“ včetně dotazníku a nabídek?"))return;const id=c.id;cur=null;saveT&&clearTimeout(saveT);saveT=null;store&&store.doc("uvery/"+id).delete();ui.view="board";keepUi();toast("Smazáno");return draw()}
    if(a==="saveprod")return saveProd();
    if(a==="tolead"){if(opts.openLead)opts.openLead(entryOf(c),c);return}
  }
  function parseVal(el){const t=el.dataset.t,v=el.value;if(t==="kc"||t==="n"){const x=num(v);return v.trim()===""?"":isFinite(x)?x:v}return v}
  function onInput(ev){const el=ev.target;
    if(el.dataset.ui==="f"){ui.f=el.value;const pos=el.selectionStart;draw();const i=root.querySelector('[data-ui="f"]');if(i){i.focus();try{i.setSelectionRange(pos,pos)}catch(e){}}return}
    if(el.dataset.ui==="kq"){ui.kq=el.value;const pos=el.selectionStart;draw();const i=root.querySelector('[data-ui="kq"]');if(i){i.focus();try{i.setSelectionRange(pos,pos)}catch(e){}}return}
    if(el.dataset.n==="q"){newSt.q=el.value;newSt.pick=null;const pos=el.selectionStart;draw();const i=root.querySelector("#uvNq");if(i){i.focus();try{i.setSelectionRange(pos,pos)}catch(e){}}return}
    if(el.dataset.b&&el.dataset.k){const o=cfg.banks[el.dataset.b]||(cfg.banks[el.dataset.b]={});const v=el.dataset.t==="n"?num(el.value):el.value;
      if(el.value.trim()==="")setPath(o,el.dataset.k,undefined);else setPath(o,el.dataset.k,el.dataset.t==="n"?(isFinite(v)?v:undefined):v);saveCfg();return}
    if(!cur||!el.dataset.k||el.tagName==="SELECT"||el.type==="date")return;
    setPath(cur,el.dataset.k,parseVal(el));save();
    if(ui.tab==="dotaznik"){drawLive();if(/^q\.(cena|vlastni|navyseni)$/.test(el.dataset.k)){const u=root.querySelector('[data-k="q.uver"]'),q=cur.q;if(u){const sg=Math.max(0,n0(q.cena)-n0(q.vlastni))+(q.ucel==="refinancovani"?n0(q.navyseni):0);u.placeholder=sg?fmt0(sg):""}}}
    if(ui.tab==="nabidky"&&/^offers\./.test(el.dataset.k)){clearTimeout(onInput.t);onInput.t=setTimeout(()=>{const a=document.activeElement,k=a&&a.dataset&&a.dataset.k,pos=a&&a.selectionStart;draw();if(k){const n=root.querySelector(`[data-k="${k}"]`);if(n){n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}}}},700)}
  }
  function onChange(ev){const el=ev.target;
    if(el.dataset.a==="stage"){if(cur){moveStage(cur,el.value);save(true);toast(STAGE(el.value).t);draw()}return}
    if(el.dataset.a==="padd"){if(!el.value||!cur)return;const z=applicants(cur.q)[+el.dataset.i];if(!cur.q.zad)cur.q.zad=[z];(z.prijmy||(z.prijmy=[])).push({typ:el.value});save();return draw()}
    if(el.dataset.a==="task"){if(!cur)return;const T=cur.tasks||(cur.tasks={});if(el.checked)T[el.dataset.k]=new Date().toISOString();else delete T[el.dataset.k];save();return draw()}
    if(el.dataset.b)return;
    if(!cur||!el.dataset.k)return;
    if(el.tagName==="SELECT"||el.type==="date"||el.dataset.t==="date"){setPath(cur,el.dataset.k,parseVal(el));save();draw()}
  }

  draw();
  return {refresh(){if(ui.view!=="case")draw()},refreshClients(){if(ui.view==="new"||ui.view==="fix"||ui.view==="board")draw()},open:(id,tab)=>openCase(id,tab),cases:()=>cases.slice()};
}


/* ================= slovníček pojmů ================= */
const GLOSS=[
 ["Ukazatele a regulace",[
  ["LTV","Loan to Value – poměr úvěru k hodnotě zástavy (z odhadu, ne z kupní ceny). Počítají se všechny dluhy zajištěné stejnou nemovitostí. Limit ČNB 80 %, žadatel do 36 let při pořízení vlastního bydlení 90 %, investiční hypotéka 70 %."],
  ["DSTI","Debt Service to Income – podíl všech měsíčních splátek na čistém měsíčním příjmu. Závazný limit ČNB zrušila 7/2023; doporučuje být velmi obezřetný nad 40 % a počítat i se sazbou o 2 p.b. vyšší. Banky běžně pustí 45–50 %."],
  ["DTI","Debt to Income – všechny dluhy (i nevyčerpané limity karet a kontokorentů) děleno ročním čistým příjmem. Závazně zrušeno 1/2024, doporučení: nad 8 velmi obezřetně, u investičních hypoték max. 7."],
  ["Bonita (úvěruschopnost)","Schopnost klienta splácet podle banky: příjmy, výdaje (normativy), závazky a registry. Banka ji musí posoudit (§ 86 ZSÚ). Každá banka počítá jinak – rozdíl v maximální výši úvěru bývá až 1,5–2×."],
  ["Stresová sazba","Sazba zvýšená o 1–2 p.b., se kterou banka počítá bonitu, aby klient zvládl splátku i po růstu sazeb na konci fixace."],
  ["Normativní výdaje","Výdaje domácnosti, které si banka sama dopočítá podle počtu dospělých a dětí (a kraje). Proto zadávej do HypoUP výdaje na bydlení jen jednou."],
  ["Investiční hypotéka","Koupě 3. a další obytné nemovitosti nebo nemovitosti k pronájmu. Od 1. 4. 2026 doporučení ČNB: LTV max. 70 % a DTI max. 7. Započtený budoucí nájem = vždy investiční, americká se předpokládá investiční. Netýká se výstavby, rekonstrukce a refinancování bez navýšení."],
  ["Výjimka 5 %","Banka smí čtvrtletně poskytnout do 5 % objemu nových hypoték nad limitem LTV (ČNB doporučuje max. 100 %). Na investiční hypotéky se nevztahuje. Díky ní dává UniCredit mladým až 95 %."],
  ["Doporučení vs. opatření ČNB","Opatření obecné povahy (LTV) je závazné. Doporučení (DSTI, DTI, investiční hypotéky, splatnost max. 30 let) banky dodržují „dobrovolně“, ČNB je ale hlídá – v praxi platí."]]],
 ["Sazby a fixace",[
  ["Úroková sazba vs. RPSN","Sazba je cena peněz. RPSN (roční procentní sazba nákladů) zahrnuje i poplatky a povinné pojištění. Nabídky srovnávej podle RPSN a celkové zaplacené částky, ne podle „sazby od“."],
  ["Fixace","Doba, po kterou je sazba pevná (1–20 let). Na konci banka nabídne novou sazbu a klient může bez sankce odejít jinam. Převládají tříleté fixace."],
  ["Refixace","Nastavení nové sazby na konci fixace u stejné banky. Banka musí nabídku poslat nejpozději 3 měsíce před koncem fixace; do 3 měsíců od oznámení jde úvěr splatit bez sankce."],
  ["Refinancování","Převedení úvěru k jiné bance – nejčastěji na konci fixace, často s navýšením. ČNB doporučuje neprodlužovat přitom splatnost."],
  ["Hypoindex","Průměrná nabídková sazba hypoték (Swiss Life), vychází měsíčně kolem 5. dne. Skutečně sjednané sazby bývají nižší (ČBA Hypomonitor). Appka podle něj počítá banky bez vlastní tabulky sazeb."],
  ["Repo sazba ČNB","Hlavní měnová sazba České národní banky (3,75 % od 19. 6. 2026). Ovlivňuje hlavně krátké fixace a spotřebitelské úvěry; dlouhé fixace víc táhnou swapové sazby."],
  ["Anuita","Stejná měsíční splátka po celou dobu fixace. Na začátku jde většina na úroky, později na jistinu."],
  ["Jistina","Dlužná částka bez úroků – to, co klient ještě musí bance vrátit."],
  ["Splatnost","Celková doba splácení. Standard 30 let (ČNB doporučuje max. 30), mBank až 40, ČS u PENB A/B 35; omezuje ji i věk žadatele na konci splácení (obvykle 70 let)."],
  ["Garance sazby","Banka drží nabídnutou sazbu po určitou dobu (ČSOB a RB 30 dní) – i když mezitím zdraží."],
  ["Reprezentativní příklad","Povinný modelový příklad v reklamě (sazba, RPSN, celková částka). Ne každý klient ho dostane – u spotřebáků banky přiznávají, kolik procent klientů dosáhne nejnižší sazby."],
  ["Balíček slev","Nižší sazba za účet s příjmem, pojištění, PENB A/B nebo LTV do 70 %. Bez slev bývá hypotéka dražší o 0,5–0,9 p.b. – vždy porovnávej stejné podmínky."],
  ["PENB a zelená hypotéka","Průkaz energetické náročnosti budovy. Třída A nebo B = sleva 0,1–0,2 p.b. a u ČS splatnost až 35 let."]]],
 ["Druhy úvěrů",[
  ["Účelová hypotéka","Úvěr na bydlení (koupě, výstavba, rekonstrukce, refinancování, vypořádání, družstevní podíl) zajištěný zástavou nemovitosti."],
  ["Americká hypotéka","Neúčelový úvěr zajištěný nemovitostí. LTV obvykle 70 % (mBank a Oberbank 75 %), splatnost do 20–25 let, vyšší sazba, úroky nejdou odečíst z daní. ČNB ji bere jako investiční, dokud se neprokáže opak."],
  ["Neúčelová část hypotéky","Část účelové hypotéky na cokoliv bez dokládání (UniCredit až 40 %, max. 1 mil.; KB Hypotéka 2v1 až 2 mil.)."],
  ["Předhypoteční úvěr","Krátký úvěr na koupi družstevního podílu nebo v dražbě, dokud nemovitost nejde zastavit (max. 2 roky, platí se jen úroky). Pak se splatí hypotékou. Umí ČS."],
  ["Úvěr ze stavebního spoření","Řádný úvěr po přidělení cílové částky (aspoň 2 roky spoření a naspořeno 35–40 %). Sazba pevná na celou dobu, nízká (od 2,99 %)."],
  ["Překlenovací úvěr","Úvěr od stavební spořitelny hned: klient platí úroky z celé částky a souběžně spoří, po přidělení se převede na řádný úvěr. Celkově dražší."],
  ["Nezajištěný úvěr na bydlení","Úvěr bez zástavy nemovitosti (Modrá pyramida, Rekopůjčka RSTS, Buřinka, ČSOB, UniCredit PRESTO) do 1,5–3,5 mil. na 12–25 let. Bez odhadu a katastru, rychlejší, ale dražší než hypotéka."],
  ["Spotřebitelský úvěr","Neúčelová půjčka bez zástavy. Klient má 14 dní na odstoupení bez udání důvodu. Klientovi s hypotékou max. na 8 let (doporučení ČNB)."],
  ["Konsolidace","Sloučení více úvěrů a karet do jednoho s nižší sazbou a jednou splátkou. Pozor: delší splatnost často znamená víc zaplaceno celkem."],
  ["Hypotéka předem","Schválení bonity a sazby ještě před výběrem nemovitosti (ČSOB 9 měsíců, UniCredit 12 měsíců, KB až 3 roky)."],
  ["Družstevní podíl","Členský podíl v bytovém družstvu – byt nepatří klientovi, a proto ho nejde zastavit. Řeší se zástavou jiné nemovitosti, předhypotečním úvěrem, nezajištěným úvěrem nebo modelem BIDLI."],
  ["Cizoměnová / eurová hypotéka","Pro příjmy v cizí měně: UniCredit dá úvěr v korunách s kurzovou pojistkou, Oberbank i úvěr v eurech."]]],
 ["Proces a smlouvy",[
  ["Rezervační smlouva","Blokuje nemovitost (obvykle 30–60 dní) za rezervační poplatek. U realitky jde poplatek do úschovy. Hypoteční doložka = poplatek se vrací, když banka úvěr zamítne."],
  ["Smlouva o smlouvě budoucí kupní","Uzavírá se u developera nebo když nemovitost ještě nejde převést. Banky ji berou jako podklad k žádosti."],
  ["Odhad (tržní / zástavní hodnota)","Ocenění nemovitosti pro banku – z něj se počítá LTV. U bytů často online, platí obvykle 6 měsíců. Když vyjde nízko: jiná banka, dozajištění nebo jednání o ceně."],
  ["ESIS","Evropský standardizovaný informační přehled – předsmluvní informace k hypotéce (sazba, RPSN, splátky, poplatky). Klient ho musí dostat s předstihem a ty mu ho vysvětlíš."],
  ["Úvěrová a zástavní smlouva","Úvěrová smlouva s bankou; zástavní smlouva zřizuje zástavu k nemovitosti (podepisují vlastníci, podpisy ověřené)."],
  ["Úschova","Kupní cena leží u advokáta, notáře nebo banky a prodávající ji dostane až po zápisu do katastru. Chrání obě strany."],
  ["Podmínky čerpání","Co musí klient doložit, než banka pošle peníze: návrh na vklad zástavy, pojištění nemovitosti s vinkulací, zaplacení vlastních zdrojů, případně další podle smlouvy."],
  ["Čerpání na plombu","Banka pošle peníze hned po podání návrhu na vklad zástavy, ještě před zápisem do katastru. Některé banky si za to účtují 1–2,2 tis., KB zdarma."],
  ["Tranše","Postupné čerpání u výstavby a rekonstrukce po etapách, obvykle po kontrole odhadce."],
  ["Dočerpání a poplatek za nečerpání","Termín, do kdy se musí vyčerpat celý úvěr (obvykle 24 měsíců). Když klient nečerpá včas, platí rezervační / kompenzační poplatek (ČS 0,5 % p.a., UniCredit 0,3 %, Oberbank 5 %)."],
  ["Mimořádná splátka","Splátka navíc. Zdarma do 25 % celkové výše úvěru v měsíci před výročím smlouvy, u KB 25 % ročně."],
  ["Předčasné splacení","Zdarma: do 3 měsíců od oznámení nové sazby, při prodeji nebo vypořádání SJM po 24 měsících, při smrti, invaliditě, dlouhodobé nemoci a z PSS. Jinak max. 0,25 % za každý započatý rok zbývající fixace, celkem max. 1 % (smlouvy od 9/2024)."],
  ["Vinkulace pojištění","Plnění z pojištění nemovitosti jde při škodě přednostně bance. Banka ji chce doložit před čerpáním."],
  ["Dozajištění","Zástava další nemovitosti (vlastní nebo třetí osoby, např. rodičů), když chybí vlastní zdroje. Po 3–5 letech splácení jde obvykle vyvázat."],
  ["Kolaudace","Povolení k užívání stavby. U výstavby ji banka chce doložit obvykle 6–12 měsíců po dočerpání."],
  ["Povolení záměru","Dřív stavební povolení (zákon 283/2021 Sb.). Pravomocné ho banky chtějí před prvním čerpáním na stavbu."]]],
 ["Katastr",[
  ["List vlastnictví (LV)","Výpis z katastru nemovitostí: vlastník, zástavy, věcná břemena, exekuce a plomby."],
  ["Návrh na vklad","Podání do katastru, kterým se zapisuje vlastnictví nebo zástava. Správní poplatek 2 000 Kč (kolky skončily 2024). Katastr rozhodne nejdřív za 20 dní, v průměru za 22 dní."],
  ["Plomba","Značka na listu vlastnictví, že u nemovitosti probíhá řízení (byl podán návrh)."],
  ["Věcné břemeno, předkupní právo","Zatížení nemovitosti (např. právo cesty nebo dožití). Banka ho posuzuje, protože snižuje hodnotu zástavy."],
  ["Prohlášení vlastníka","Dokument, kterým v domě vznikají jednotky (byty) jako samostatné nemovitosti – důležité u developerských projektů."]]],
 ["Příjmy",[
  ["Daňový základ","U OSVČ příjmy minus výdaje (řádek 101 − 102 přiznání). Banky z něj po odečtení daně a pojistného počítají čistý příjem – pro OSVČ nejpřísnější metoda."],
  ["Obratová metoda","Banka uzná podíl z obratu (příjmů) podle oboru, typicky 30–65 %, místo daňového základu. Umí ji ČS (do LTV 80 %), RB, ČSOB HB z výpisů a RSTS (až 65 %)."],
  ["Výdajový paušál","OSVČ si odečte paušální výdaje 80 / 60 / 40 / 30 % podle druhu činnosti místo skutečných výdajů."],
  ["Paušální daň","OSVČ platí jednu měsíční platbu (daň + pojistné) a nepodává přiznání. Banky berou podíl fakturace z výpisů za 6 měsíců – modelovému paušalistovi se 70 tis. měsíčně uzná mBank 49 tis., ČS a UniCredit 42 tis., ČSOB HB 38,5 tis."],
  ["DPP a DPČ","Dohody mimo pracovní poměr. DPP započte jen ČS (a Buřinka), DPČ většina bank, RB ani jednu."],
  ["Zkušební a výpovědní doba","Ve zkušební době (první 3 měsíce, u vedoucích 6) většina bank nepůjčí – žádost se pošle den po jejím skončení. Ve výpovědní lhůtě úvěr neprojde."],
  ["Lohnzettel","Roční potvrzení o příjmu a dani v Rakousku a Německu – dokládá se u pendlerů spolu s výplatními páskami a výpisy."],
  ["Vedlejší příjmy","Nájem, výživné, diety, rodičovská. Banky je berou jen částečně (nájem obvykle 70 %) a nejvýš do výše hlavních příjmů."],
  ["Provize ZFPA","Příjem poradce jako OSVČ. Některé banky mají se ZFPA vlastní výpočet: UniCredit 60 % (paušál) / 40 % (skutečné výdaje), mBank 60 % průměru, RSTS 70 % (max. 180 tis. měsíčně)."]]],
 ["Registry, zákon a pojištění",[
  ["BRKI a NRKI","Bankovní a nebankovní registr klientských informací. Data drží po dobu smlouvy a 4 roky po ní, neúspěšnou žádost 1 rok (BRKI), resp. 6 měsíců (NRKI). Výpis z obou přes kolikmam.cz s Bank iD."],
  ["SOLUS","Registr dlužníků (i telefony a energie). Negativní záznam od 500 Kč a 30 dní prodlení, po zaplacení zůstává 3 roky (telco a energie 1 rok)."],
  ["AML","Zákon proti praní peněz: identifikace klienta, účel obchodu, původ vlastních zdrojů a kontrola politicky exponované osoby. Podezřelý obchod se hlásí."],
  ["PEP","Politicky exponovaná osoba (politik, vysoký úředník a jejich blízcí) – přísnější kontrola původu peněz."],
  ["ZSÚ","Zákon č. 257/2016 Sb., o spotřebitelském úvěru – hlavní pravidla pro hypotéky i půjčky: informace, úvěruschopnost, předčasné splacení, povinnosti zprostředkovatele."],
  ["Rada podle § 85 ZSÚ","Doporučení konkrétního produktu na základě analýzy klienta s písemným záznamem. ZFPA radu neposkytuje – klient dostává přehled zpracovaných nabídek a vybírá sám."],
  ["Vázaný zástupce","Zprostředkovatel, který pracuje pro jednoho zastoupeného (u tebe ZFP akademie) a je zapsaný v registru ČNB. Za jeho chyby odpovídá zastoupený."],
  ["HypoUP","Srovnávač hypoték a výpočet bonity pro poradce (ČS, ČSOB HB, KB, mBank, RB, UniCredit). Výstup slouží i jako příloha k provizi."],
  ["PSS","Pojištění schopnosti splácet. Sleví sazbu o 0,1–0,2 p.b., ale obvykle stojí víc, než ušetří, a zaniká s úvěrem. Lepší je vlastní životní pojištění (smrt, invalidita, pracovní neschopnost)."],
  ["SJM a vypořádání","Společné jmění manželů – manžel bývá spoludlužníkem. Při rozvodu se SJM vypořádá a jeden z manželů úvěr přebírá (rozsudek s právní mocí a dohoda o vypořádání)."],
  ["Odpočet úroků","Úroky z hypotéky na vlastní bydlení snižují základ daně: max. 150 tis. Kč ročně na domácnost (300 tis. u bydlení pořízeného před 2021). U americké hypotéky ne."],
  ["NZÚ – Nová zelená úsporám","Státní program na úspory energií. Od 6/2026 bezúročný úvěr na renovace rodinných domů (dílčí až 750 tis., komplexní až 2 mil.) přes banky; od 19. 10. 2026 ČSOB."]]]
];
/* ================= banky a spořitelny (přes ZFPA) ================= */
/* Pole: types = typy úvěrů, které přes ZFPA zprostředkuješ · ltv.max / .amer · maxAge (věk při splatnosti) · maxYears · dsti/dti = interní limity bonity (orientačně)
   stress = přirážka k sazbě při výpočtu bonity · inc = koeficienty započtení příjmů · osvc.obrat = obratová metoda (podíl obratu podle oboru) · good/bad = silné a slabé stránky
   podle štítků případu (caseTags) · docs = specifika dokládání · rateAdj = odchylka od průměru Hypoindexu (bez vlastních sazeb). Vše jde upravit v appce (Parametry bank). */
const BANKS_ASOF="10/2026";
const ZAHR_EU={DE:1,AT:1,SK:1,PL:1,EU:1,X:0};
const BANKS=[
  {id:"cs",name:"Česká spořitelna",s:"ČS",kind:"banka",kindT:"banka",types:["hypo","amer","spotr","konsol","podnik"],portal:"Expert24",about:"Největší banka na trhu. Sazba stojí na balíčku slev (účet, PSS, PENB), umí ale i nestandardní případy: obratovou metodu pro OSVČ, Předhypoteční úvěr na družstva a dražby a nejdelší fixace na trhu. Přes ZFPA i spotřebitelské úvěry.",prod:"Hypotéka, americká hypotéka, překlenovací financování, úvěry pro BD a SVJ; Půjčka a Konsolidace (od 5/2025); firmy jen tipem",
    ltv:{max:90,amer:70,inv:70},maxAge:70,maxYears:30,maxYearsAB:35,maxYearsAmer:20,dsti:50,dti:9,stress:1,
    rates:{1:5.59,2:5.59,3:5.59,4:5.69,5:5.79,8:5.99,10:6.19,15:6.39,20:6.59},ltv90add:.2,amerRate:5.89,ratesNote:"se slevou za účet, bez PSS a PENB A/B (od 11. 9. 2026)",
    inc:{zam:1,dpc:1,dpp:1,rodic:1,vyzivne:1,diety:0,pronajem:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.6,svobodne:.6,sluzby:.5,remeslo:.4,obchod:.3,jine:.4},obratMaxLtv:80,obratMaxLoan:10000000,minDp:1,pdK:.6},sro:.8,
    spotr:{od:4.39,typ:6.9,max:2500000,min:2000,years:10,konsolTyp:6.9,note:"Půjčka od 4,39 % – 70 % klientů (od 250 tis.) do 7,99 % (počítám ~6,9 %); za řádné splácení odpustí až 12 splátek",konsolNote:"převede i nebankovní půjčky a pomůže zrušit staré; za řádné splácení odpustí až 12 splátek"},
    purp:{druzstvo:"Předhypoteční úvěr na převod podílu (max. 2 roky, jen úroky, pak Hypotéka ČS)",drazba:true,rekreace:true,nebytovy:true,pozemek:true,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    speed:3,flex:3,simple:3,online:4,
    good:{vystavba:"výstavba: poplatek za rezervaci (0,5 % p.a.) až po 24 měsících čerpání",dpp:"započítá i DPP",dlouhaFix:"fixace až 20 let (8, 10, 15, 20)",zelena:"Hypotéka pro budoucnost (PENB A/B): −0,1 p.b. a splatnost až 35 let",refin:"převod hypotéky bez poplatků, odhad zdarma",osvc:"OSVČ obratovou metodou do 10 mil. Kč (LTV do 80 %)",amer:"americká hypotéka od 5,89 % (vyřízení 6 000 Kč)",konsolidace:"konsoliduje i nebankovní půjčky"},
    bad:{},pros:["bez poplatku za vyřízení; první čerpání zdarma, další 500 Kč","nejdelší fixace na trhu (až 20 let)","online v Georgi, Předhypoteční úvěr na družstva i dražby"],cons:["sazba stojí na slevách (účet 0,5 p.b., PSS a PENB po 0,1 p.b.) – bez nich +0,7 p.b.","rezervační poplatek 0,5 % p.a. u koupě po 6 měsících","změny smlouvy 3–5 tis. Kč"],
    docs:["žádost přes Expert24, ID ZFPxxxxx","OSVČ: daňová přiznání za 2 roky (do 5 mil. Kč může stačit poslední)"],src:"MP ZFPA 25. 9. 2025; sazby od 11. 9. 2026 (finance.cz), ceník ČS od 21. 8. 2026, csas.cz 20. 10. 2026; HypoUP"},
  {id:"kb",name:"Komerční banka",s:"KB",kind:"banka",kindT:"banka",types:["hypo","amer","spotr","konsol"],portal:"NOBY",about:"Konzervativní banka s pohodlným procesem přes poradce: smlouvy podepíšeš s klientem u sebe a čerpat jde už na návrh na vklad zdarma. Tří- a pětileté fixace bývají dražší, nejlepší sazba váže příjem na účet a pojištění u Komerční pojišťovny.",prod:"Hypotéka (NOBY), úvěry pro BD a SVJ, Osobní úvěr / Optimální půjčka (KB Share)",
    ltv:{max:90,amer:70,inv:70},maxAge:70,maxYears:30,maxYearsAmer:20,maxFix:5,dsti:50,dti:9,stress:1,
    rates:{1:5.69,2:5.99,3:6.14,4:6.29,5:6.49},ltv90add:.4,amerRate:6.09,ratesNote:"s příjmem na účet KB a pojištěním nemovitosti, bez PENB A/B (od 5. 10. 2026)",
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.75,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:null,minDp:1,pdK:.575},sro:0,purp:{druzstvo:false,drazba:false,rekreace:true,nebytovy:true,pozemek:true,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    spotr:{od:4.69,typ:6,max:2500000,min:30000,years:8,konsolTyp:6.2,konsolYears:10,note:"Půjčka od 4,69 % – 48 % klientů do 5,9 % (počítám ~6 %); poplatek 850 Kč, podmínkou účet v KB",konsolNote:"konsolidace od 4,99 % (~40 % klientů do 5,9 %), KB jedná s věřiteli a platí jim napřímo; poplatek 850 Kč"},
    speed:2,flex:4,simple:3,online:3,
    good:{developer:"developer: čerpání až 36 měsíců, LTV až 90 %",predVkladem:"čerpání i na návrh na vklad zdarma",rychle:"podpis smluv i mimo banku (u poradce)",refin:"refinancování bez poplatku za vyřízení",zelena:"Hypotéka na udržitelné bydlení (akce od 5,19 %, bez poplatku)",cizinec:"cizinci EU i s přechodným pobytem"},
    bad:{dpp:"DPP nezapočítá",sro:"podíl na zisku ze s.r.o. nebere (jen mzdu jednatele)",dlouhaFix:"fixace jen do 5 let",osvc:"obratovou metodu nebere – OSVČ ze základu daně (výhodněji jen vybrané profese)"},
    pros:["čerpání zdarma i na návrh na vklad, 25 % ročně mimořádně zdarma","Hypotéka 2v1 (neúčelová část až 2 mil.) a Hypotéka bez nemovitosti (3 roky na výběr)","podpis mimo pobočku přes poradce"],cons:["dražší 3 a 5leté fixace, fixace jen do 5 let","poplatek za poskytnutí 4 900 Kč (zdarma u udržitelného bydlení a refinancování)","přirážka za LTV 80–90 % +0,4 p.b.; nejlepší sazba váže pojištění u Komerční pojišťovny"],
    docs:["žádost v systému NOBY, identifikace osobním číslem ZFPA + IČO","k provizi výstup HypoUP nebo 3 modelace"],src:"MP ZFPA 29. 5. 2025; oznámení o sazbách KB od 5. 10. 2026; kb.cz 20. 10. 2026; HypoUP"},
  {id:"csob",name:"ČSOB Hypoteční banka",s:"ČSOB",kind:"banka",kindT:"banka (ČSOB HB)",types:["hypo","amer","spotr","konsol"],portal:"Informatorium / HypoUP API",about:"Hypoteční banka skupiny ČSOB s nejlepším online procesem: žádost jde z HypoUP přes API, posouzení do 5 pracovních dnů a podpis přes Bank iD. Jako jediná dává slevu za životní pojištění; bez balíčku slev je dražší.",prod:"Hypotéka (ČSOB HB); přes pobočku ČSOB Půjčka na cokoliv, Půjčka na lepší bydlení a konsolidace",
    ltv:{max:90,amer:70,inv:70},maxAge:70,ageSoft:65,ageByYounger:true,maxYears:30,maxYearsAmer:20,dsti:50,dti:9,stress:1,minLoan:500000,maxLoanAmer:15000000,
    rates:{1:6.14,3:6.24,5:6.59,7:6.95,10:7.3},ltv90add:.15,amerRate:6.59,smallAdd:{lt:2000000,add:.2},ratesNote:"s aktivním účtem, bez pojištění u ČSOB a PENB A/B (od 12. 10. 2026, dopočet)",
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.5,svobodne:.5,sluzby:.45,remeslo:.35,obchod:.3,jine:.35},minDp:1,minMonths:6,pdK:.55,pdMinMonths:6},sro:.8,purp:{druzstvo:false,drazba:false,rekreace:true,nebytovy:true,pozemek:true,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    spotr:{typ:7.9,max:2500000,years:10,konsolTyp:5.49,konsolMin:150000,note:"Půjčka na cokoliv (pobočka ČSOB): 2/3 klientů od 150 tis. do 8,9 % (počítám ~7,9 %), online sleva 15 % z úroku, předčasné splacení zdarma, 30 dní na rozmyšlenou",konsolNote:"konsolidace s garancí 5,49 % (od 150 tis. cizích dluhů, max. 2,5 mil. na 10 let), staré úvěry splatí ČSOB sama",
      byd:{typ:5.99,max:2500000,years:12,name:"Půjčka na lepší bydlení (pobočka ČSOB)",note:"Půjčka na lepší bydlení: až 2,5 mil. bez zástavy na 12 let (~5,99 %), 20 % (max. 150 tis.) na cokoliv, účel doložit do 12 měsíců"}},
    speed:4,flex:3,simple:3,online:5,
    good:{vystavba:"výstavba: rezervační poplatek se u výstavby obvykle odpouští",rychle:"žádost z HypoUP přes API, posouzení do 5 pracovních dnů, garance sazby 30 dní",online:"celý podpis online přes Bank iD (bonus 4 000 Kč do 31. 12. 2026), online odhad zdarma",osvc:"OSVČ jde i z výpisů (kreditní obraty)"},
    bad:{dpp:"DPP nezapočítá",senior:"věk při splatnosti standardně do 65 let (podle profese až 70)"},
    pros:["jediná banka se slevou za životní pojištění","nejlepší online proces (API z HypoUP, podpis Bank iD), garance sazby 30 dní, Hypotéka bez nemovitosti 9 měsíců","online odhad i odhadce u účelových hypoték zdarma; po 6 měsících jde snížit splátku až o 30 %"],cons:["drahá bez balíčku slev (účet 0,5, pojištění 0,2, PENB 0,2 p.b.) a +0,2 p.b. pod 2 mil.","čerpání na návrh na vklad 2 200 Kč, prodloužení čerpání 4 900 Kč","věk standardně do 65 let"],
    docs:["provizní číslo z Informatoria (např. 1291HU46)","OSVČ: alternativně výpisy s kreditními obraty"],src:"MP ZFPA 29. 5. 2025; sazby ČSOB od 12. 10. 2026; sazebník ČSOB HB od 22. 9. 2025; HypoUP; video Výstavba"},
  {id:"rb",name:"Raiffeisenbank",s:"RB",kind:"banka",kindT:"banka",types:["hypo","amer","spotr","konsol","podnik"],portal:"FA portál (HYFE)",about:"Nejrychlejší schvalování (do 3 dnů) a nejnižší sazby u krátkých fixací. Silná na OSVČ (obratová metoda), investiční byty (Hypotéka na pronájem) a refinancování až 24 měsíců dopředu. Nebere DPP, DPČ ani vdovský důchod.",prod:"Hypotéka (FA portál – HYFE, garance sazby 30 dní), spotřebitelské úvěry, Micro, firmy",
    ltv:{max:90,amer:70,inv:70},maxAge:70,maxYears:30,maxYearsAmer:20,dsti:50,dti:9,stress:1,maxLoan:20000000,maxLoanAmer:12000000,
    rates:{1:5.29,3:5.49,5:5.74,7:6.1,10:6.39,15:6.49},ltv90add:.2,amerRate:6.19,ratesNote:"základní sazby (Měšec 26. 9. 2026); v Hypodnech do 20. 12. 2026 −0,1 p.b. a odhad zdarma",
    inc:{zam:1,dpc:0,dpp:0,rodic:1,vyzivne:1,diety:1,pronajem:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:0,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.6,svobodne:.6,sluzby:.5,remeslo:.4,obchod:.3,jine:.4},minDp:1,pdK:.588},sro:.8,sroMinPodil:20,sroMinMonths:24,
    spotr:{od:4.9,typ:5.9,max:2000000,min:5000,years:8,konsolTyp:5.9,note:"Minutová půjčka od 4,9 % (repr. příklad od 250 tis.: 4,9 %, RPSN 5,0 %), max. 17,9 %; peníze za pár minut",konsolNote:"RePůjčka od 4,9 % – převede úvěry z jakékoli banky, navíc až 2 mil."},purp:{druzstvo:false,drazba:false,rekreace:true,nebytovy:true,pozemek:true,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    speed:5,flex:3,simple:4,online:4,
    good:{vystavba:"výstavba bez faktur (kontroluje odhadce), rezervační poplatek jen při čerpání pod 50 %",rychle:"garance sazby 30 dní, schválení do 3 dnů od dokladů, odhad do 9 dnů",osvc:"obratová metoda pro OSVČ",invest:"Hypotéka na pronájem – započte nájem, bez limitu počtu nemovitostí",refin:"refinancování až 24 měsíců před koncem fixace, bez poplatků, stačí starý odhad",sro:"podíl na zisku s.r.o. (od 20 % podílu, 2 roky)"},
    bad:{dpp:"DPP ani DPČ nezapočítá",cizinec:"cizinci mimo EU s přísnější bonitou a přirážkou"},
    pros:["nejnižší 1–3leté fixace, Hypodny do 20. 12. 2026 (−0,1 p.b. za PENB, odhad zdarma)","nejrychlejší schválení a online podpis v IB","Hypotéka naruby, na pronájem, montované domy"],cons:["čerpání na vklad 1 900 Kč, každé další 800 Kč; rezervace 29 900 Kč při čerpání pod 50 %","nezapočítá vdovský důchod; DPP/DPČ ne","Klasik max. 20 mil., americká max. 12 mil."],
    docs:["kopie ověřuj: OVĚŘENO DLE ORIGINÁLU + jméno, podpis, datum","zaměstnanci: výpisy za 6 měsíců; paušální daň: výpisy za 6 měsíců"],src:"MP ZFPA 25. 9. 2025; rb.cz 20. 10. 2026, ceník RB od 1. 5. 2026, Hypodny 2026; HypoUP; video Výstavba"},
  {id:"ucb",name:"UniCredit Bank",s:"UCB",kind:"banka",kindT:"banka",types:["hypo","spotr","konsol","podnik"],portal:"pobočka (tištěná žádost)",about:"Banka pro nestandardní klienty: mladým do 36 let půjčí až 95 % ceny, má cizoměnovou hypotéku pro příjmy v cizí měně a uzná DPČ, provize i obrat. Proces je papírový přes pobočky a nejnižší sazba stojí na placeném pojištění.",prod:"Hypotéka, PRESTO půjčka a PRESTO na bydlení, Small business",
    ltv:{max:90,amer:70,inv:70,young:95},maxAge:70,maxYears:30,dsti:50,dti:9,stress:1,
    rates:{3:5.49,5:5.89,7:6.1,10:6.35},ltv90add:.5,ratesNote:"odhad bez PSS: web „od 5,29 %“ (s placeným pojištěním −0,2 p.b.), repr. příklad 3R 5,69 %; podmínka příjem na účet 1,5× splátky + 3 platby kartou (20. 10. 2026)",
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.7,pronajemBudouci:0,zahr:{DE:1,AT:1,SK:1,PL:1,EU:1,X:1},duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.5,svobodne:.5,sluzby:.45,remeslo:.35,obchod:.3,jine:.35},minDp:1,minMonths:12,pdK:.6},sro:.8,purp:{druzstvo:false,drazba:false,rekreace:true,nebytovy:true,pozemek:true,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:true,note:"cizinci i s přechodným pobytem (individuálně), cizoměnová hypotéka"},
    provize:{pct:.6,pctSkutecne:.4,minMonths:12,note:"ZFPA: 60 % (paušál) / 40 % (skutečné) hrubých provizí"},
    spotr:{typ:5.55,max:1500000,min:20000,years:7,garMin:200001,garYears:5,mimoGar:7.9,konsolTyp:5.55,konsolMin:200001,konsolYears:5,note:"PRESTO: garance 5,55 % nad 200 tis. na max. 5 let s aktivním účtem (nabídka do konce 10/2026); po 10 splátkách až 5× odklad",konsolNote:"převod úvěrů s garancí 5,55 % (nad 200 tis., max. 5 let), banka věřitele splatí sama, jde přidat peníze navíc",
      byd:{typ:6.29,max:1500000,years:15,name:"PRESTO Půjčka na bydlení",note:"PRESTO na bydlení: až 1,5 mil. bez zástavy od 6,29 % (i převod družstevního podílu), poplatek 1 500 Kč; s hypotékou max. 8 let, nad 600 tis. může chtít spolužadatele"}},
    speed:2,flex:3,simple:3,online:2,
    good:{ltv90:"do 36 let až 95 % LTV (výjimka ČNB, sazba +0,5 p.b.)",cizinec:"cizoměnová hypotéka – příjem v cizí měně nebo bydliště v zahraničí",zahranici:"cizoměnová hypotéka: úvěr v Kč, při posílení koruny o 20 % splacení bez sankce (podmínky individuálně)",duchod:"započítá vdovský i sirotčí důchod",provize:"provize ZFPA: 60 % (paušál) / 40 % (skutečné výdaje)",developer:"developer: čerpání až 36 měsíců",refin:"refinancování zdarma, uzná původní odhad, jde i bez dokládání příjmů a 18–24 měsíců dopředu",vystavba:"zrychlená výstavba – 1. čerpání až 500 tis. nad zástavní hodnotu; rekonstrukce do 500 tis. bez dokládání"},
    bad:{dpp:"DPP nezapočítá",rychle:"papírová žádost a podpis jen na pobočce – počítej s 2–4 týdny",invest:"nemovitost k pronájmu a nájem v bonitě spíš ne (stav 2025) – ověř"},
    pros:["neúčelová část až 40 % (max. 1 mil.) bez dokládání","Hypotéka předem: 12 měsíců na výběr nemovitosti (LTV do 80 %)","vstřícná k nestandardním příjmům (DPČ, provize, obrat), zvýhodnění lékařů a advokátů"],cons:["nízká sazba stojí na placeném pojištění (PSS −0,2 p.b.)","poskytnutí 2 900 Kč, odhad 5 700 (byt) / 7 000 Kč (RD), čerpání na plombu 1 900 Kč – vstup ~10 tis.","kompenzační poplatek 0,3 % při nedodržení plánu čerpání"],
    docs:["kopie OP: „souhlasí s originálem“ + vlastnoruční souhlas klienta","průvodní list / předávací protokol z pobočky"],src:"MP ZFPA 29. 5. 2025; unicreditbank.cz 20. 10. 2026, sazebník FO od 1. 6. 2026; Hypoindex 24. 9. 2026; martinstratil.cz 7/2026; bonita z provizí ZFPA 2024"},
  {id:"mb",name:"mBank",s:"mBank",kind:"banka",kindT:"banka",types:["hypo","spotr","konsol"],portal:"e-žádost (link ZFPA) + papír",about:"Online banka s nulovými poplatky. Do 50 % LTV nechce dokládat příjmy, paušalistům uzná nejvíc ze všech bank a dá splatnost až 40 let. Sazby bývají nad průměrem a fixace jen 1, 3 a 5 let.",prod:"mHypotéka (Light), mPůjčka a konsolidace – jen fyzické osoby",
    ltv:{max:90,amer:75,inv:70},maxAge:70,maxYears:40,minLoan:200000,maxFix:5,dsti:50,dti:9,stress:1,noIncDocsLtv:50,
    rates:{1:5.99,3:5.59,5:5.79},ltv90add:.2,ratesNote:"úrokový lístek od 1. 10. 2026, LTV do 80 % (nad 80 % +0,2 p.b.); stávající klienti −0,3 p.b.",
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.7,pronajemBudouci:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.5,svobodne:.5,sluzby:.45,remeslo:.35,obchod:.3,jine:.35},minDp:1,pdK:.7,pdMinMonths:6},sro:.9,sroNoPay:.5,purp:{druzstvo:false,drazba:false,rekreace:false,nebytovy:false,pozemek:false,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    provize:{pct:.6,note:"ZFPA: 60 % průměru provizí (10 měsíců bez max/min), max. 10 mil."},
    spotr:{od:4.49,typ:6.9,max:1200000,min:10000,years:8,konsolTyp:8.9,konsolYears:10,note:"mPůjčka Plus od 4,49 % (RPSN od 4,59 %); s příjmem na mKonto bez dokládání",konsolNote:"konsolidace až 10 úvěrů o 2 p.b. levněji než nejdražší z nich (6,9–15,9 %), bez dokládání příjmů; staré úvěry splácené aspoň 3 měsíce"},
    speed:3,flex:3,simple:4,online:3,
    good:{sro:"bere i jednoosobové s.r.o.",provize:"provize ZFPA: 60 % průměru",pausaldan:"paušalistům uzná nejvíc z bank (~70 % fakturace u modelového klienta)",invest:"investiční hypotéka – započte budoucí nájem (LTV 70 %, DTI 7)",refin:"refinancování zdarma, výsledek do 48 h, po 12 splátkách bez dokládání příjmů, odhad až 6 let starý",konsolidace:"konsolidace bez dokládání příjmů (až 10 úvěrů)"},
    bad:{dlouhaFix:"fixace jen 1, 3 a 5 let"},
    pros:["do LTV 50 % bez dokládání příjmů – ideální pro OSVČ s větším vkladem","splatnost až 40 let (nižší splátka = vyšší bonita), nulové poplatky, online odhad 1 900 Kč","jen fyzické osoby, jednoduchý proces"],cons:["sazby nad průměrem trhu, fixace jen 1/3/5 let","formuláře, odhad a LV v originále","americká hypotéka (LTV 75 %) jen do 4 mil. – přes ZFPA ověř"],
    docs:["formuláře banky, odhad a LV v originále; ostatní kopie ověří SPU","do LTV 50 % stačí výpis z účtu / prohlášení o příjmu"],src:"MP ZFPA 29. 5. 2025; mbank.cz 20. 10. 2026, úrokový lístek od 1. 10. 2026, sazebník od 1. 6. 2026; E15 6/2025 (paušální daň); bonita z provizí ZFPA 2024"},
  {id:"ober",name:"Oberbank",s:"Oberbank",kind:"banka",kindT:"banka",types:["hypo","amer"],portal:"pobočky (osobní návštěva)",about:"Rakouská banka na speciality: eurové hypotéky a příjmy z Rakouska, Německa a Slovenska, variabilní sazba, zástava v zahraničí a investiční hypotéky do 50 mil. Pro běžného klienta s příjmem v korunách je drahá (procentní poplatky) a LTV dává max. 80 %.",prod:"StandardHypotéka (Plus), Investiční hypotéka, FlexiHypotéka (americká), Hypotéka bez hranic",
    ltv:{max:80,amer:75,inv:70},maxAge:75,ageSoft:70,minLoan:250000,maxYears:30,maxYearsAmer:20,dsti:50,dti:9.5,stress:1,rateAdj:.4,costly:"vstupní náklady: zpracování 0,7–1,5 % úvěru (min. 8 000 Kč), vedení účtu 150 Kč měsíčně",ratesNote:"sazby individuálně (srovnávače „od 6,10 %“, 2025) – vždy poptat",
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.8,pronajemBudouci:.6,zahr:{DE:1,AT:1,SK:1,PL:1,EU:1,X:0},duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:null,minDp:1},sro:.8,purp:{druzstvo:false,drazba:false,rekreace:true,nebytovy:true,pozemek:true,treti:true},foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:true,note:"rakouská banka – EU občané žijící v ČR, eurová hypotéka"},
    speed:2,flex:2,simple:2,online:1,
    good:{zahranici:"eurová hypotéka, příjmy z AT/DE/SK (i nájem a podíly na zisku v EUR)",invest:"Investiční hypotéka 2–50 mil. – započte budoucí nájem (chce podnikatelský plán)",cizinec:"EU občané s pobytem v ČR, formuláře i německy / anglicky",amer:"FlexiHypotéka (americká) do LTV 75 %",druzstvo:"družstevní podíl se zástavou jiné nemovitosti",refin:"refinancuje i úvěry od nebankovních společností a fyzických osob, 12–18 měsíců dopředu"},
    bad:{vystavba:"poplatek 5 % z nevyčerpané částky (když zůstane nad 20 %)",rychle:"nutná osobní návštěva pobočky, pomalejší proces"},
    pros:["jediná eurová hypotéka a variabilní sazba (3M PRIBOR / EURIBOR) na trhu","Hypotéka bez hranic – zástava v Rakousku, Německu, na Slovensku","Investiční hypotéka až 50 mil., americká do LTV 75 %"],cons:["LTV max. 80 % – ani mladým 90 % nedá","zpracování 0,7–1,5 % (min. 8 000 Kč), vedení 150 Kč/měs., změna podmínek 0,2–1 % ze zůstatku","sazby netransparentní, v HypoUP jen metodika"],
    docs:["vyřízení přes pobočku, identifikace jménem + ZFPA","potvrzení o příjmu i v němčině / angličtině"],src:"MP ZFPA 11/2022; oberbank.cz 20. 10. 2026, sazebník FO od 1. 10. 2025; HypoGO 9/2026; hyponamiru 2024; školení HypoUP"},
  {id:"mp",name:"Modrá pyramida",s:"MP",kind:"ss",kindT:"stavební spořitelna (KB)",types:["ss","hypo","spotr"],portal:"eFormuláře",about:"Stavební spořitelna skupiny KB. Hypotéky pro nové klienty už zřejmě nedělá – zůstává Půjčka na bydlení bez zástavy nemovitosti, nejvýhodnější na družstevní a udržitelné bydlení (až 3,5 mil. na 25 let).",prod:"Půjčka na bydlení (bez zástavy), stavební spoření a úvěr ze SS",
    ended:{hypo:"Hypoúvěr pro nové klienty zřejmě skončil (úrokový lístek od 4. 9. 2026 ho nemá) – hypotéky dělá KB, ověř v systému ZFPA"},
    maxAge:75,dsti:50,dti:9,stress:1,
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:null,minDp:1},sro:.8,foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    spotr:{onlyByd:true,byd:{typ:5.99,typDruz:5.79,max:2500000,maxDruz:3500000,min:100000,years:20,yearsDruz:25,name:"Půjčka na bydlení (bez zástavy nemovitosti)",note:"Půjčka na bydlení 3R 5,99 % / 5R 6,19 %, družstevní a udržitelné bydlení 5,79 % až na 25 let; zastavuje se jen vklad na stavebku (smlouva o SS podmínkou)"}},
    speed:3,flex:3,simple:4,online:3,
    good:{druzstvo:"družstevní byt bez zástavy až 3,5 mil. na 25 let (5,79 %)",rekonstrukce:"Půjčka na bydlení bez zástavy do 2,5 mil."},bad:{},
    pros:["Půjčka na družstevní a udržitelné bydlení bez zástavy (až 3,5 mil., 25 let)","úvěr ze stavebního spoření ALFA 3,49 % (po přidělení)","200+ poradenských center"],cons:["Hypoúvěr zřejmě ukončen – na hypotéky KB","předčasné splacení Půjčky na bydlení není zdarma; správa 300 Kč/rok"],
    docs:["9místné číslo VZ (osobní číslo ZFPA doplněné nulami)"],src:"MP ZFPA 29. 5. 2025; úrokový lístek MP od 4. 9. 2026; peníze.cz; banky.cz"},
  {id:"rsts",name:"Raiffeisen stavební spořitelna",s:"RSTS",kind:"ss",kindT:"stavební spořitelna",types:["ss","hypo","spotr"],portal:"Cibis",about:"Stavební spořitelna skupiny Raiffeisen. Zajištěné úvěry od dubna 2026 nedělá (Hyposplátka skončila), má ale nejsilnější nezajištěné úvěry: Rekopůjčku a Půjčku na družstevní bydlení. OSVČ uzná až 65 % obratu a poradcům ZFPA nejlépe započítá provize.",prod:"Rekopůjčka, Půjčka na družstevní bydlení, úvěr ze SS, úvěry pro OSVČ, BD a SVJ",
    ended:{hypo:"Hyposplátka skončila 1. 4. 2026 – zajištěné úvěry nad 2,5 mil. vyřizuje hypoteční centrum Raiffeisenbank"},
    maxAge:70,dsti:50,dti:9,stress:1,
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.65,svobodne:.65,sluzby:.6,remeslo:.5,obchod:.4,jine:.5},minDp:1},sro:.8,foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    provize:{pct:.7,cap:180000,note:"ZFPA: 70 % provizí (max. 180 000 Kč/měs.)"},
    spotr:{onlyByd:true,byd:{typ:5.85,max:2000000,max2:2500000,maxDruz:3500000,min:20000,years:20,yearsDruz:25,name:"Rekopůjčka / Půjčka na družstevní bydlení (bez zajištění)",note:"Rekopůjčka od 4,9 % (repr. 500 tis., 3R: 5,85 %, RPSN 6,27 %), poplatek 1 % (1–10 tis.); i vypořádání SJM / dědictví a splacení nebankovních dluhů; družstevní byt až 3,5 mil. na 25 let"}},
    speed:4,flex:3,simple:4,online:4,
    good:{osvc:"OSVČ: uzná až 65 % obratu",druzstvo:"družstevní byt bez zástavy až 3,5 mil. na 25 let",rekonstrukce:"Rekopůjčka bez zajištění do 2–2,5 mil.",provize:"provize ZFPA: 70 % (max. 180 000 Kč/měs.)"},bad:{},
    pros:["nejlepší nástroj pro OSVČ (až 65 % obratu) a družstevní byty","široké účely Rekopůjčky (vypořádání, nebankovní dluhy), elektronicky s podpisem SMS","úvěr ze stavebního spoření od 2,99 % pevně na celou dobu","pro poradce ZFPA nejlepší zápočet provizí"],cons:["Hyposplátka skončila 4/2026 – zajištěné úvěry jen přes RB","„od 4,9 %“ jen s pojištěním a účtem u RB, reálně kolem 5,85 %; poplatek 1 %"],
    docs:["provozní číslo regionu + osobní číslo ZFPA","klient s výplatou na účet u RB příjmy nedokládá"],src:"MP ZFPA 29. 5. 2025; rsts.cz 20. 10. 2026; bonita z provizí ZFPA 2024"},
  {id:"sscs",name:"Stavební spořitelna ČS (Buřinka)",s:"Buřinka",kind:"ss",kindT:"stavební spořitelna (ČS)",types:["ss","hypo","spotr"],portal:"Expert24",about:"Stavební spořitelna České spořitelny. Úvěry zajištěné nemovitostí od 10/2024 nedělá; má rychlé nezajištěné úvěry na rekonstrukci a úsporné bydlení – peníze do 2 dnů, místo faktur fotky.",prod:"Úvěr na rekonstrukci, Úvěr od Buřinky pro budoucnost, úvěr ze SS, úvěr pro SVJ a BD",
    ended:{hypo:"Buřinka od 10/2024 nedává úvěry zajištěné nemovitostí – hypotéky ČS"},
    maxAge:70,dsti:50,dti:9,stress:1,
    inc:{zam:1,dpc:1,dpp:1,rodic:1,vyzivne:1,diety:0,pronajem:.7,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:null,minDp:1},sro:.8,foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    provize:{pct:.5,note:"ZFPA: individuálně přes Expert24 (zápočet do poznámky)"},
    spotr:{onlyByd:true,byd:{typ:5.79,max:2500000,maxDruz:3500000,min:40000,years:25,name:"Úvěr na rekonstrukci / Úvěr od Buřinky (bez zástavy)",note:"až 2,5 mil. bez zástavy na 25 let od 5,79 % (úsporné bydlení do 3 mil. od 5,29 %), bez poplatků; peníze do 2 pracovních dnů, místo faktur fotky do 1 roku"}},
    speed:5,flex:4,simple:5,online:4,
    good:{rekonstrukce:"nejrychlejší peníze na rekonstrukci (do 2 dnů, fotky místo faktur)"},bad:{},
    pros:["Úvěr na rekonstrukci až 2,5 mil. bez zástavy, i na nábytek a spotřebiče","Úvěr od Buřinky pro budoucnost (úsporné bydlení) do 3 mil.","úvěr pro SVJ a bytová družstva bez zástavy (až 500 tis. na byt)"],cons:["žádné zajištěné financování – na velké částky banky","produkt „Obnova“ na webu není – ověř v Expert24"],
    docs:["ID z ČS (stejné jako u ČS)"],src:"MP ZFPA 29. 5. 2025; burinka.csas.cz a ceník FO od 1. 6. 2026; peníze.cz; bonita z provizí ZFPA 2024"},
  {id:"bidli",name:"BIDLI – družstevní bydlení",s:"BIDLI",kind:"spec",kindT:"bydlení přes bytové družstvo",types:["hypo"],portal:"intranet BIDLI",about:"Model družstevního bydlení: nemovitost koupí bytové družstvo, klient v ní bydlí za nájem a po splacení úvěru družstva ji převede do vlastnictví. Bez dokládání příjmů, stačí asi 20 % vlastních zdrojů – řešení pro ty, kterým banky nepůjčí.",prod:"Družstevní bydlení BIDLI (koupě přes družstvo)",model:"druzstvo",
    speed:3,flex:3,simple:5,online:3,good:{},bad:{},
    pros:["nemovitost koupí družstvo, klient platí nájem a po splacení ji převede do vlastnictví (převod smluvně zajištěný)","bez dokládání příjmů, i cizinci a starší – stačí ~20 % vlastních zdrojů","novostavby i starší byty a domy v ČR"],cons:["do převodu klient není vlastník a nese riziko hospodaření družstva","nájem, marže a poplatky nejsou veřejné – vždy chtít kalkulaci","úroky nejspíš nepůjdou odečíst z daní"],
    docs:["kalkulace na intranetu BIDLI"],src:"MP ZFPA 1. 8. 2023; bidli.cz 20. 10. 2026"},
  {id:"trinity",name:"Trinity Bank",s:"Trinity",kind:"spotr",kindT:"spotřebitelské úvěry",types:["spotr","konsol"],portal:"Portál 3P",about:"Online spotřebitelské úvěry: Lepší půjčka až 1,5 mil. na 12 let s odměnou za včasné splácení (3,97 % místo 9,99 %). Celé online přes PSD2 výpis a Bank iD, jen pro občany ČR.",prod:"Lepší půjčka, převod úvěrů (přes ZFPA od 10/2026)",
    maxAge:75,dstiSpotr:50,
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.5,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:{it:.5,svobodne:.5,sluzby:.45,remeslo:.35,obchod:.3,jine:.35},minDp:1},sro:.8,foreign:{euPrechodny:false,mimoTrvaly:false,mimoPrechodny:false},
    spotr:{typ:3.97,max:1500000,min:20000,years:12,onlyCz:true,konsolTyp:3.97,warn:"3,97 % jen při včasném splácení všech splátek – jinak 9,99 % (ukaž klientovi obě varianty)",note:"Lepší půjčka 20 tis.–1,5 mil. až na 12 let, peníze do 5 minut (schválení výjimečně do 3 dnů); OSVČ podle příjmů na účet",konsolNote:"převod úvěrů – staré úvěry banka vypoví a splatí, peníze do 3 dnů"},
    speed:5,flex:4,simple:5,online:5,good:{konsolidace:"převod úvěrů – načte je sama z registrů"},bad:{},
    pros:["Lepší půjčka – celé online (PSD2 výpis, Bank iD, SMS podpis)","nejdelší splatnost spotřebáku na trhu (144 měsíců)"],cons:["klient musí mít internetové bankovnictví s Bank iD","jen občané ČR s trvalým pobytem","bez odměny za včasné splácení 9,99 % (v příkladu banky 430 tis. místo 338 tis. zaplaceno)"],docs:["PSD2 výpis + Bank iD + souhlas s ověřením u operátora"],src:"MP ZFPA 9/2026; trinitybank.cz (srovnání k 7. 10. 2026)"},
  {id:"inbank",name:"Inbank",s:"Inbank",kind:"spotr",kindT:"spotřebitelské úvěry",types:["spotr","konsol"],portal:"Partner portál",about:"Estonská banka se spotřebitelskými úvěry: Osobní půjčka 20–300 tis. na 1–7 let, peníze do 1 pracovního dne, účet u Inbank není potřeba.",prod:"Osobní půjčka (přes ZFPA od 9/2026)",
    maxAge:75,dstiSpotr:50,
    inc:{zam:1,dpc:1,dpp:0,rodic:1,vyzivne:1,diety:0,pronajem:.5,zahr:ZAHR_EU,duchod:{starobni:1,invalidni:1,vysluha:1,vdovsky:1,sirotci:1},jiny:0},
    osvc:{dz:1,obrat:null,minDp:1},sro:.8,foreign:{euPrechodny:true,mimoTrvaly:true,mimoPrechodny:false},
    spotr:{od:4.99,typ:7.9,max:300000,min:20000,years:7,note:"Osobní půjčka 20–300 tis. od 4,99 % na 1–7 let (typická sazba neuvedená – počítám orientačně), peníze do 1 pracovního dne; účet u Inbank není potřeba"},
    speed:5,flex:3,simple:4,online:5,good:{},bad:{},pros:["Osobní půjčka – elektronické uzavření přes Bank iD"],cons:["max. 300 tis. Kč","OSVČ jen na soukromé účely, může chtít výpisy za 3 měsíce"],docs:["žádost a dokumenty přes Partner portál"],src:"MP ZFPA 8/2026; inbank.cz 20. 10. 2026"}
];
/* stavební spořitelny a spotřebitelské společnosti nemají hypoteční LTV pravidla – u spotřebitelských úvěrů se LTV neřeší */

window.Uvery={GLOSS,mount,math:{payment,balanceAfter,principalFor,fixCost,marketRate,osvcNet,incomeFor,incomeTotal,metrics,ltvLimit,isInvest,evalBank,recommend,docsList,clientDocsText,caseTags,ageAt,setRates:r=>{if(r&&r.fix)RATES=r}},BANKS,STAGES,TYPES,INC,VERSION};
})();
