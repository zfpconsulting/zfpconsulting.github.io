/* Rizikové skupiny NN Orange Risk podle povolání a sportu – orientační zařazení z Obchodních podmínek NN (účinnost 1. 12. 2024, kapitola Rizikové skupiny).
   Závazné je zařazení ve Stele / ve smlouvě. Sdílí dotazník (dotaznik.html) i finanční plán (fp.html).
   RS 1–4; 5 = „UW“ (individuální posouzení pojišťovnou). Výsledná RS osoby = vyšší z povolání a sportu. */
(()=>{
"use strict";
const fold=t=>String(t||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();
/* povolání: [název, RS] – příklady z OP NN; kancelářské a nemanuální profese = RS 1 (obecná charakteristika skupiny 1) */
const POVOLANI=[
 ["Finanční poradce",1],["Kancelářská práce / administrativa",1],["Účetní",1],["Manažer / vedoucí (kancelář)",1],["IT / programátor",1],["Obchodník / obchodní zástupce",1],
 ["Bankéř",1],["Právník / advokát",1],["Učitel",1],["Vychovatel / družinář",1],["Lékař",1],["Zubař",1],["Zdravotní sestra",1],["Farmaceut / lékárník",1],["Veterinář",1],["Vědec / výzkumník",1],
 ["Výtvarník / grafik / designér",1],["Architekt",1],["Soudce",1],["Sociální pracovník",1],["Kadeřník",1],["Kosmetička",1],["Manikérka",1],["Cukrář",1],["Uklízečka",1],
 ["Prodavač (lehká manuální práce)",1],["Pokladní",1],["Řidič osobního auta",1],["Recepční",1],["Realitní makléř",1],["Personalista / HR",1],["Marketing / PR",1],["Úředník",1],
 ["Student / žák",1],["Rodičovská dovolená",1],["Důchodce",1],["Nezaměstnaný",1],
 ["Záchranář",2],["Dopravní policista",2,["policista","policie"]],["Strážník / městská policie",2],["Vězeňský dozorce",2],["Kuchař",2],["Řezník",2],["Truhlář",2],["Zootechnik",2],["Barman",2],
 ["Číšník / servírka",2],["Prodavač na benzinové pumpě",2],["Poštovní doručovatel / kurýr",2],["Školník",2],["Instalatér",2],["Elektrikář",2],["Obkladač",2],["Pekař",2],
 ["Řidič autobusu",2],["Řidič nákladního auta nad 7,5 t",2,["kamion","nakladni","tir","ridic kamionu"]],["Strojvůdce",2],["Stevard / letuška",2],
 ["Jeřábník",3],["Kovář",3],["Obráběč kovů",3],["Soustružník",3],["Slévač",3],["Tesař",3],["Horník",3],["Pilot dopravní společnosti",3],["Vyšetřovatel kriminální policie",3],
 ["Člen horské služby",3],["Dřevorubec",3],["Natěrač exteriérů",3],["Opravář těžké techniky",3],["Stavební práce ve výškách",3],
 ["Zkušební pilot",4],["Letecká záchranná služba",4],["Pracovník s výbušninami a hořlavinami",4],["Baletka / tanečník baletu",4],["Parašutista",4],["Práce s horolezeckou technikou (myč oken, izolatér)",4],
 ["Voják speciální jednotky",5,["specialni jednotk"]],["Pyrotechnik",5],["Artista v cirkuse",5],["Hasič – speciální nasazení",5,["specialni nasazeni"]],["Profesionální sportovec",5],
 ["Hasič (HZS)",0,["hasic"]],["Stavební dělník / zedník",0,["zednik","stavar","stavebni"]],["Voják z povolání",0,["vojak","armada"]],["Zemědělec",0,["zemedel","farmar"]],["Skladník",0,["sklad"]],["Mechanik / automechanik",0,["mechanik"]],["Dělník ve výrobě",0,["delnik","vyroba"]]
];
/* sporty: [název, kategorie]
   s1  = RS 1 rekreačně i registrovaně (profesionálně UW)          s1p = RS 1 i profesionálně
   s2  = registrovaně RS 2, rekreačně RS 1                          s3  = registrovaně RS 3, rekreačně odhad RS 2 (ověřit ve Stele)
   b3  = bojové bez plného kontaktu: RS 3 (vrcholově / za úplatu UW) b4 = bojové s plným kontaktem: RS 4 (vrcholově UW)
   uw  = adrenalinové sporty: vždy individuální posouzení (kromě jednorázového vyzkoušení) */
const SPORTY=[
 ["Běh","s1"],["Cyklistika (silnice)","s1",["kolo","cyklo","bike","silnicni kolo"]],["Badminton","s1"],["Baseball / softball","s1"],["Házená","s1"],["Basketbal","s1"],["Volejbal","s1"],["Florbal","s1"],["Tenis","s1"],
 ["Stolní tenis","s1"],["Squash","s1"],["Fitness / posilovna","s1",["crossfit","posilovna","gym","fitko"]],["Triatlon","s1"],["Střelba","s1"],["Lukostřelba","s1"],["Kanoistika","s1"],["Plavání","s1"],["Veslování","s1"],
 ["Jachting","s1"],["Krasobruslení","s1"],["Rychlobruslení","s1"],["Biatlon","s1"],["Skialpinismus","s1"],["Běžecké lyžování","s1",["bezky"]],["Turistika","s1"],["Tanec","s1"],["Dobrovolný hasič","s1"],
 ["Jóga","s1p"],["Golf","s1p"],["Šachy","s1p"],["Bowling","s1p"],["Kuželky","s1p"],["Biliard / kulečník","s1p"],["Šipky","s1p"],["Curling","s1p"],["Pétanque","s1p"],["Rybaření","s1p"],["Modelářství","s1p"],
 ["Fotbal","s2"],["Futsal","s2"],["Hokejbal","s2"],["In-line hokej","s2"],["Pozemní hokej","s2"],["Frisbee","s2"],["Lakros","s2"],["Sjezdové lyžování","s2",["lyze","lyzovani","sjezd","ski"]],["Snowboarding","s2"],
 ["Cyklokros","s2"],["Atletika – vrhy a skoky","s2"],["Víceboj (pětiboj, desetiboj)","s2"],["Skoky na trampolíně","s2"],["Skoky do vody","s2"],["Bobování","s2"],["Psí spřežení","s2"],
 ["Hasičský sport","s2"],["Myslivost / lov","s2"],
 ["Lední hokej","s3",["hokej"]],["Překážkový běh (Spartan, Army run)","s3"],["Jezdectví","s3"],["Americký fotbal","s3"],["Rugby","s3"],["Silový trojboj","s3"],["Vzpírání","s3"],["Kulturistika","s3"],
 ["Capoeira","b3"],["Krav maga","b3"],["Šerm","b3"],["Řecko-římský zápas","b3"],["Box s přilbou (amatérský)","b3"],["Karate – bez plného kontaktu","b3"],["Kick-box – bez plného kontaktu","b3"],
 ["Box","b4"],["Judo","b4"],["Karate","b4"],["Kick-box","b4"],["Taekwondo","b4"],["Jiu-jitsu","b4"],["Aikido","b4"],["Kung-fu","b4"],["Wing-chun","b4"],["Kendo","b4"],["MMA","b4"],
 ["Horolezectví / skalní lezení","uw",["lezeni","horolez","skaly"]],["Potápění","uw"],["Paragliding","uw"],["Parašutismus","uw"],["Parkour","uw"],["Rafting na divoké vodě","uw"],["Cliff diving","uw"],
 ["BMX freestyle","uw"],["Mountain biking / downhill","uw"],["Motoristický sport (motokros, závody)","uw",["motork","motokros","motosport","zavody aut"]],["Bungee / high jumping","uw"],["Survival / adventure","uw"],["Kitesurfing","uw"]
];
const UROVNE=[["rekreacne","Rekreačně (koníček)"],["registrovane","Registrovaně v klubu / soutěže"],["profesionalne","Profesionálně (živí mě to / nejvyšší soutěž)"]];
const RS_TXT=r=>r>=5?"UW – individuální posouzení":"RS "+r;
function best(list,text){const t=fold(text);if(!t)return null;let hit=null,sc=0;
  list.forEach(e=>{const n=fold(e[0]);let a=0;(e[2]||[]).forEach(x=>{if(x===t)a=Math.max(a,900);else if(x.length>=3&&t.includes(x))a=Math.max(a,150+x.length);else if(t.length>=3&&x.startsWith(t))a=Math.max(a,140+t.length)});const parts=n.split(/\s*[\/(),–-]\s*/).filter(x=>x.length>=4);
    let s=0;if(n===t)s=1000;else if(t.length>=4&&n.includes(t))s=200+t.length;else if(n.length>=4&&t.includes(n))s=100+n.length;else{const p=parts.find(x=>t.includes(x)||x.includes(t)&&t.length>=4);if(p)s=50+p.length}
    s=Math.max(s,a);if(s>sc){sc=s;hit=e}});return hit}
/* RS 0 = v OP NN neuvedeno → zařazení určí Stela (pro odhad RS 1 a upozornění) */
function povolaniRs(text){const e=best(POVOLANI,text);return e?{rs:e[1]||null,nazev:e[0],overit:!e[1]}:null}
function sportRs(s){if(!s||!String(s.nazev||"").trim())return null;const e=best(SPORTY,s.nazev);if(!e)return {rs:null,nazev:s.nazev,neznamy:true};
  const u=s.uroven||"rekreacne",k=e[1],prof=u==="profesionalne",reg=u==="registrovane";let rs,odhad=false;
  if(k==="uw")rs=5;else if(k==="s1p")rs=1;else if(prof)rs=5;
  else if(k==="s1")rs=1;else if(k==="s2")rs=reg?2:1;else if(k==="s3"){rs=reg?3:2;odhad=!reg}else if(k==="b3")rs=3;else if(k==="b4")rs=4;else rs=1;
  return {rs,nazev:e[0],odhad}}
/* osoba z plánu / dotazníku: {prace, povolani, sporty:[{nazev,uroven}]} → {pov, sporty, rs, uw, poznamky} */
function osoba(p){p=p||{};const pov=povolaniRs(p.povolani)||(p.prace==="student"?{rs:1,nazev:"Student"}:p.prace==="rodicovska"?{rs:1,nazev:"Rodičovská dovolená"}:p.prace==="duchodce"?{rs:1,nazev:"Důchodce"}:null);
  const sp=(p.sporty||[]).map(sportRs).filter(Boolean);
  const rsPov=pov&&pov.rs?pov.rs:null,rsSp=sp.reduce((a,x)=>Math.max(a,x.rs||1),sp.length?1:0)||null;
  const rs=Math.max(rsPov||1,rsSp||1);
  const pozn=[];if(String(p.povolani||"").trim()&&(!povolaniRs(p.povolani)||povolaniRs(p.povolani).overit))pozn.push("povolání „"+p.povolani+"“ není v příkladech OP NN – zařazení ověř ve Stele");
  sp.filter(x=>x.neznamy).forEach(x=>pozn.push("sport „"+x.nazev+"“ není v seznamu – ověř ve Stele"));
  sp.filter(x=>x.odhad).forEach(x=>pozn.push(x.nazev+" rekreačně – odhad RS 2, ověř ve Stele"));
  if(rs>=5)pozn.push("UW – pojišťovna posoudí individuálně (přirážka / výluka)");
  return {pov,sporty:sp,rsPov,rsSport:rsSp,rs,uw:rs>=5,pozn}}
window.NNRS={POVOLANI,SPORTY,UROVNE,povolaniRs,sportRs,osoba,RS_TXT,fold};
})();
