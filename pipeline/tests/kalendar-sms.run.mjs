// Testy drobných pravidel v Pipeline: rozpoznání školního kalendáře po přejmenování („škola“), výchozí zobrazení osobního kalendáře,
// výběr šablony pro SMS „Potvrdit“ u rezervace (osobně × online). Funkce se vytáhnou přímo ze zdroje index.html.
// Použití: node tests/kalendar-sms.run.mjs
import { readFileSync } from "node:fs";
import { assert, eq } from "./helpers.mjs";
const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const grab = re => { const m = re.exec(src); assert(m, "ve zdroji chybí: " + re); return m[0]; };

const tests = {
  "školní kalendář se pozná i po přejmenování na „škola“ (původní \\b to u „š“ nezvládalo)"() {
    const m = /calendarList\?minAccessRole=reader&maxResults=250"\)\)\.json\(\);\s*calSchool=\(r\.items\|\|\[\]\)\.filter\(c=>(.*?)\)\.map\(c=>c\.id\)/s.exec(src); assert(m, "filtr školního kalendáře");
    const isSchool = new Function("c", "return " + m[1]);
    const imp = n => ({ id: "x@import.calendar.google.com", summary: "MUNI rozvrh", summaryOverride: n });
    for (const n of ["škola", "Škola", "MU", "rozvrh ESF"]) assert(isSchool(imp(n)), "měl by se poznat: " + n);
    for (const n of ["Spolupracovníci", "muzeum", "Narozeniny"]) assert(!isSchool({ id: "x@import.calendar.google.com", summary: n, description: "" }), "nesmí se poznat: " + n);
    assert(!isSchool({ id: "a@gmail.com", summary: "Soukromé" }) , "nepatřící");
  },
  "osobní kalendář je ve výchozím stavu v záložce Kalendář, jde vypnout, a nikdy nevznikne duplicita primary × e-mail"() {
    const fn = grab(/function ctIds\(\)\{.*?\n\s*return b\.some\(isMe\)\?b:\[\.\.\.b,"primary"\]\}/s);
    const mk = (settings, me) => new Function("settings", "calCfg", "dzMe", fn + "; return ctIds;")(settings, () => ({ id: "shared@group.calendar.google.com" }), () => me);
    eq(mk({ calTabIds: ["shared@x"] }, "me@gmail.com")(), ["shared@x", "primary"], "přidá se primary");
    eq(mk({ calTabIds: ["shared@x", "me@gmail.com"] }, "me@gmail.com")(), ["shared@x", "me@gmail.com"], "e-mail jako id už je osobní kalendář");
    eq(mk({ calTabIds: ["shared@x", "primary"] }, "me@gmail.com")(), ["shared@x", "primary"], "bez duplicity");
    eq(mk({ calTabIds: ["shared@x", "primary"], calTabNoPrimary: true }, "me@gmail.com")(), ["shared@x"], "vypnutý osobní kalendář");
    eq(mk({}, "me@gmail.com")(), ["shared@group.calendar.google.com", "primary"], "bez výběru: hlavní + osobní");
  },
  "SMS „Potvrdit“: online schůzka bere online šablonu potvrzení, osobní tu obyčejnou, jinak výchozí „potvrzeni“"() {
    const fn = grab(/function dzConfTpl\(online\)\{.*?\|\|T\[0\]\}/s);
    const mk = T => new Function("tpls", fn + "; return dzConfTpl;")(() => T);
    const T = [{ id: "potvrzeni", name: "Potvrzení schůzky" }, { id: "p2", name: "Potvrzení schůzky online" }, { id: "zitra", name: "Připomenutí" }];
    eq([mk(T)(false).id, mk(T)(true).id], ["potvrzeni", "p2"], "podle názvu");
    eq(mk([T[0], T[2]])(true).id, "potvrzeni", "bez online šablony se použije obyčejná");
    eq(mk([T[2]])(false).id, "zitra", "jinak první šablona");
  },
  "upozornění na rezervaci nese kontakt klienta a místo „Beru na vědomí“ nabízí „Potvrdit“"() {
    assert(/conf:\{ph:String\(x\.phone\|\|""\),em:String\(x\.email\|\|""\),online,name,at:start\.toISOString\(\)\}/.test(src), "dzNotify má conf");
    assert(/n\.conf\?el\("button",\{type:"button",class:"ok",onclick:\(\)=>dzConfirm\(n\)\},"Potvrdit"\)/.test(src), "tlačítko Potvrdit");
    assert(/location\.href="sms:"\+tel\+"\?&body="\+encodeURIComponent\(text\)/.test(src), "otevírá SMS");
  },
};
let fail = 0;
for (const [name, fn] of Object.entries(tests)) { try { await fn(); console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "\n      ", e.message); } }
if (fail) { console.log(fail + " testů selhalo"); process.exit(1); }
console.log("Všechny testy kalendáře a SMS prošly (" + Object.keys(tests).length + ").");
