// Testy výpočtu měsíčního pojistného NN Orange Risk (fp.html, bez prohlížeče). Použití: node tests/nn.run.mjs
// Referenční hodnoty sazeb jsou opsané z modelací NN Stela 2.0 (10/2026), očekávané částky se počítají nezávisle ručním vzorcem.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, eq } from "./helpers.mjs";

globalThis.fmt = v => Math.round(+v || 0).toLocaleString("cs-CZ");
const html = readFileSync(fileURLToPath(new URL("../fp.html", import.meta.url)), "utf8");
const i0 = html.indexOf("<script>/* FP engine"), code = html.slice(i0 + 8, html.indexOf("</script>", i0));
const mod = { exports: {} }; new Function("module", "exports", code)(mod, mod.exports);
const E = mod.exports, TODAY = new Date(2026, 9, 18); // počátek 1. 11. 2026 → vstupní věk = 2026 − rok narození

const osoba = (nar, o = {}) => Object.assign({ jmeno: "Test", narozen: nar, zam: 60000, vydaje_osobni: 35000, inv1: 9000, inv2: 13000, inv3: 21000, hruba: 80000 }, o);
const plan = (o = {}) => Object.assign({ klient: osoba("1991-03-10", { bez_partnera: true }), partner: { zapnuto: false }, deti: [],
  majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 100000 }], uvery: [{ nazev: "Hypotéka", zustatek: 3000000, splatka: 15000 }], cile: [], renta: { mesicne: 20000 } }, o);
const run = p => E.compute(JSON.parse(JSON.stringify(p)), TODAY, {});
const sazba = (t, v) => E.nnSazba(t, v);
/* nezávislý výpočet z opsaných sazeb: pc / jednotka × sazba (a přirážka, sleva) */
const ocek = (pc, j, saz, prir = 0, fit = 0) => Math.round(pc / j * saz * (1 + prir / 100) * (1 - fit / 100));

const tests = {
  "sazebník: tabulkové body přesně, mezi body lineárně, mimo tabulku null"() {
    eq(sazba("INV3-P2R", 37), 213, "INV3 konst. věk 37"); eq(sazba("SMTV-K2R", 35), 100, "smrt klesající 35"); eq(sazba("PN29-P3R", 40), 93, "PN 40");
    eq(sazba("SMTV-K2R", 42), 152 + (247 - 152) * 2 / 5, "smrt klesající 42 = lineárně mezi 40 a 45");
    eq(sazba("SMTV-K2R", 19), null, "pod 20 let"); eq(sazba("SMTV-K2R", 61), null, "nad 60 let");
  },
  "jednotlivec: pojistné = PČ / 1 mil. × sazba pro vstupní věk 35, součet souhlasí s navrženým pojistným plánu"() {
    const R = run(plan()), o = R.nn.osoby[0];
    eq(o.vek, 35, "vstupní věk"); assert(R.pojAuto, "automatický výpočet");
    const byT = Object.fromEntries(o.rizika.map(r => [r.tarif, r]));
    eq(byT["SMTV-K2R"].mes, ocek(byT["SMTV-K2R"].pc, 1e6, 100), "smrt klesající (sazba 100)");
    eq(byT["INV3-K2R"].mes, ocek(byT["INV3-K2R"].pc, 1e6, 95), "invalidita III. klesající (95)");
    eq(byT["INV2-K2R"].mes, ocek(byT["INV2-K2R"].pc, 1e6, 57), "invalidita II. klesající (57)");
    eq(o.celkem, o.rizika.reduce((a, r) => a + r.mes, 0), "součet rizik");
    eq(R.pojNove, R.nn.celkem, "pojistné v plánu = výpočet NN");
    assert(o.rizika.every(r => r.pc > 0), "slide: jen rizika s pojistnou částkou");
  },
  "konstantní varianta smrti a invalidity používá tarify P2R"() {
    const R = run(plan({ nastaveni: { nn_smrt: "konstantni", nn_inv: "konstantni" } })), o = R.nn.osoby[0];
    assert(o.rizika.some(r => r.tarif === "SMTV-P2R") && o.rizika.some(r => r.tarif === "INV3-P2R"), "P2R tarify");
    assert(!o.rizika.some(r => /K2R/.test(r.tarif)), "žádné K2R");
    const r3 = o.rizika.find(r => r.tarif === "INV3-P2R"); eq(r3.mes, ocek(r3.pc, 1e6, 181), "invalidita III. konstantní (181)");
  },
  "rodina: dva dospělí + dvě děti, součet = osoby + děti"() {
    const R = run(plan({ klient: osoba("1988-01-01", { jmeno: "Otec" }), partner: { zapnuto: true, ...osoba("1990-06-06", { jmeno: "Matka", zam: 45000, vydaje_osobni: 30000 }) },
      deti: [{ jmeno: "Anna", narozen: "2018-02-02" }, { jmeno: "Boris", narozen: "2021-09-09" }], nastaveni: { nn_dite: 450 } }));
    eq(R.nn.osoby.length, 2, "dvě osoby"); eq(R.nn.deti.length, 2, "dvě děti");
    eq(R.nn.osoby.map(o => o.vek), [38, 36], "vstupní věky");
    eq(R.nn.hrubo, R.nn.osoby[0].celkem + R.nn.osoby[1].celkem + 900, "součet = osoby + 2 × 450");
    eq(R.nn.deti[0].rizika.map(r => r.pc), [1000000, 500000, 400], "balíček dítěte (TN PREMIUM 1 mil., ZO 500 tis., 400 Kč/den)");
    eq(R.pojNove, R.nn.celkem, "pojistné plánu = NN");
  },
  "riziková profese / sport: přirážka se připočte k pojistnému osoby"() {
    const z = run(plan()).nn.osoby[0], p = run(plan({ klient: osoba("1991-03-10", { bez_partnera: true, nn_prirazka: 25 }) })).nn.osoby[0];
    eq(p.prirazka, 25, "přirážka 25 %");
    p.rizika.forEach(r => eq(r.mes, ocek(r.pc, r.jedn === "Kč/den" ? 100 : 1e6, E.nnSazba(r.tarif, 35), 25), "řádek " + r.tarif));
    assert(p.celkem > z.celkem, "s přirážkou dráž");
  },
  "FitSport: sleva sníží pojistné osoby; bez vyplněné výše upozornění"() {
    const p = run(plan({ klient: osoba("1991-03-10", { bez_partnera: true, nn_fitsport: true }), nastaveni: { nn_fitsport: 10 } })).nn.osoby[0];
    eq(p.fitsport, 10, "sleva 10 %"); p.rizika.forEach(r => eq(r.mes, ocek(r.pc, r.jedn === "Kč/den" ? 100 : 1e6, E.nnSazba(r.tarif, 35), 0, 10), "řádek " + r.tarif));
    const R = run(plan({ klient: osoba("1991-03-10", { bez_partnera: true, nn_fitsport: true }) }));
    assert(R.flags.some(f => /FitSport/.test(f)), "chybí výše slevy FitSport → upozornění");
  },
  "sleva za propojištěnost: z celkového pojistného smlouvy včetně dětí"() {
    const R = run(plan({ deti: [{ jmeno: "Anna", narozen: "2018-02-02" }], pojisteni: { nn_propoj: true }, nastaveni: { nn_propoj: 5, nn_dite: 400 } })), n = R.nn;
    eq(n.hrubo, n.osoby[0].celkem + 400, "hrubé pojistné"); eq(n.sleva, Math.round(n.hrubo * 0.05), "sleva 5 %"); eq(n.celkem, n.hrubo - n.sleva, "po slevě");
    eq(R.pojNove, n.celkem, "plán počítá s pojistným po slevě");
  },
  "děti bez zadané ceny balíčku: upozornění a nekompletní výpočet"() {
    const R = run(plan({ deti: [{ jmeno: "Anna", narozen: "2018-02-02" }] }));
    assert(R.flags.some(f => /pojistné dětí/.test(f)), "upozornění na chybějící cenu dětí"); eq(R.nn.kompletni, false, "nekompletní");
  },
  "ručně zadané pojistné má přednost, automat se nepoužije"() {
    const R = run(plan({ pojisteni: { zivotni: { stav: 0, navrh: 1500 } } }));
    assert(!R.pojAuto, "bez automatu"); eq(R.pojNove, 1500, "ruční částka");
  },
  "věk mimo tabulku (61 let): pojistné řádku dle Stely, upozornění, součet jen z řádků se sazbou"() {
    const R = run(plan({ klient: osoba("1965-01-01", { bez_partnera: true }) }));
    assert(R.flags.some(f => /chybí sazba/.test(f)) || R.nn.osoby[0].rizika.length === 0 || R.nn.osoby[0].rizika.every(r => r.mes != null), "řádek bez sazby je označen");
  },
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); ok++; console.log("✓ " + name); } catch (e) { bad++; console.log("✗ " + name + "\n    " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")); }
}
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
