// Testy finančního plánu (fp.html) v Chromiu. Sazby pojišťoven jsou ve fp.html zašifrované – potřebují PP_KEY (přístupový kód).
// Použití: PP_KEY=XXXXX-… node tests/fp.run.mjs
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";
if (!process.env.PP_KEY) { console.log("Chybí PP_KEY (přístupový kód) – sazby pojišťoven ve fp.html jsou zašifrované, testy přeskakuji."); process.exit(0); }

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const FP = url.replace(/index\.html$/, "fp.html");

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  /* přístupový kód v zařízení – stejně jako ho tam uloží Pipeline */
  await ctx.addInitScript(k => { try { if (!localStorage.getItem("pp_key")) localStorage.setItem("pp_key", k); } catch (e) {} }, process.env.PP_KEY);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(FP);
  await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function" && window.FP_SAZBY_OK === true);
  return { ctx, page, errors };
}
/* uloží plán klienta do localStorage a načte stránku znovu */
async function setPlan(page, patch) {
  await page.evaluate(p => { const d = JSON.parse(JSON.stringify(DB)), c = d.clients[d.cur]; Object.assign(c, p); localStorage.setItem(LS, JSON.stringify(d)); }, patch);
  await page.reload();
  await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function" && window.FP_SAZBY_OK === true);
}
const pvAnn = (m, n, r) => { const q = Math.pow(1 + r, 1 / 12) - 1; return n > 0 && m > 0 ? m * (1 - Math.pow(1 + q, -n)) / q : 0; };

const tests = {
  async "shrnutí mailem: oslovení podle titulu, následné kroky (zřízení + trvalý příkaz, ŽP), termín podpisu z kalendáře"() {
    const { ctx, page, errors } = await open();
    await page.evaluate(() => { const d = JSON.parse(JSON.stringify(DB)), c = d.clients[d.cur]; c.klient.titul = "Ing."; c.klient.jmeno = "Petr Novák"; c.kontakt = { email: "novak@example.cz" }; localStorage.setItem(LS, JSON.stringify(d)); });
    await page.reload(); await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function" && window.FP_SAZBY_OK === true);
    await page.click("#bMail"); await page.waitForSelector("#mTxt");
    let t = await page.$eval("#mTxt", e => e.value);
    assert(t.startsWith("Dobrý den, pane inženýre,\n\nposílám shrnutí finančního plánu"), "úvod: " + t.slice(0, 80));
    assert(/Následné kroky\nZřízení akciového portfolia Conseq \+ (jednorázový vklad [\d\s]+Kč \+ )?nastavení trvalého příkazu na [\d\s]+Kč/.test(t), "zřízení + trvalý příkaz: " + t);
    assert(/Sjednání životního pojištění|Zrušení aktuálního životního pojištění/.test(t), "ŽP v krocích");
    assert(/ozvu telefonicky/.test(t), "bez termínu podpisu obecná věta");
    eq(await page.$eval("#mTo", e => e.value), "novak@example.cz", "adresát z kontaktu");
    await page.click("[data-a=x]");
    /* termín z kalendáře (posílá Pipeline) */
    const d = await page.evaluate(() => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 9, 15, 0); MAILCFG.podpis = { start: d.toISOString() }; return kdyTxt(d); });
    assert(/^(příští týden|ve|v) /.test(d) && / v 15:00$/.test(d), "kdy: " + d);
    await page.click("#bMail"); await page.waitForSelector("#mTxt");
    t = await page.$eval("#mTxt", e => e.value);
    assert(t.includes(d.charAt(0).toUpperCase() + d.slice(1) + " bych se Vám ozval telefonicky ohledně elektronického podpisu (záležitost 15 minut)."), "věta s termínem: " + t);
    assert(!/[<>]|&amp;|undefined|NaN/.test(t), "čistý text");
    /* příloha PPTX: připraví se v okně, bez sdílení (Chromium) se stáhne a otevře se mailto */
    await page.waitForFunction(() => /Příloha: FP_.*\.pptx/.test(document.querySelector("#mAtt").textContent), null, { timeout: 60000 });
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click("[data-a=send]")]);
    assert(/^FP_.*\.pptx$/.test(dl.suggestedFilename()), "stažená příloha: " + dl.suggestedFilename());
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "příjem a výdaje v čase: rodičovská → návrat do práce, nová hypotéka nahradí starou, důchody, splacení; rozpis za každého"() {
    const { ctx, page, errors } = await open();
    await setPlan(page, {
      klient: { jmeno: "Petr Novák", narozen: "1988-03-01", zam: 62000, vydaje_osobni: 30000, starobni: 21000, inv1: 9000, inv2: 12000, inv3: 20000, bez_partnera: false },
      partner: { zapnuto: true, jmeno: "Jana Nováková", narozen: "1991-06-01", zam: 0, vydaje_osobni: 12000, starobni: 17000 }, deti: [], majetek: [{ typ: "Spořicí účet", nazev: "Účet", hodnota: 300000 }],
      docasne: [{ nazev: "Rodičovská", typ: "rodicovska", castka: 12000, do: (new Date().getFullYear() + 2) + "-09", potom: 34000, kdo: "partner" }],
      uvery: [{ typ: "Hypotéka", nazev: "KB", zustatek: 1800000, splatka: 14500, fixace_do: "", splatnost: (new Date().getFullYear() + 13) + "-06" }],
      hypo: { zapnuto: true, promitnout: true, cena: 7500000, uver: 5800000, sazba: 5.5, let: 30, za_let: 3, odpadne: 0, naklady: 1500, nahrazuje: "0" }, cile: [], renta: { mesicne: 0 } });
    const r = await page.evaluate(() => { const t = cfTimeline(inp(), R); return { pts: t.pts.map(q => ({ t: q.t, I: Math.round(q.s.I), loans: Math.round(q.s.loans), inc: q.s.inc.map(Math.round) })), fr: FR.filter(f => f.g === "cft").length,
      uv: R.uvery.map(u => u.nazev), h: FR.filter(f => f.g === "cft")[1].h }; });
    eq(r.pts.map(p => p.t), ["Dnes", "Konec: Rodičovská (Jana)", "Nahrazeno: Hypotéka – KB · Koupě nemovitosti", "Důchod: Petr", "Důchod: Jana", "Splacena plánovaná hypotéka"], "záchytné body (koupě až v termínu)");
    eq(r.pts[0].inc, [62000, 12000], "dnes: Petr práce, Jana rodičovská");
    eq(r.pts[1].inc, [62000, 34000], "Jana zpátky v práci");
    eq([r.pts[0].loans, r.pts[2].loans > 30000, r.pts[5].loans], [14500, true, 0], "stará hypotéka → nová → splaceno");
    eq(r.pts[4].inc, [21000, 17000], "oba v důchodu");
    eq(r.fr, 8, "přehled grafu + přiblížení na každý bod + celý graf na konci");
    eq(r.uv, ["Hypotéka – plánovaná"], "nahrazený úvěr není v krytí smrti dvakrát");
    assert(r.h.includes("PETR") || (r.h.includes("Petr") && r.h.includes("Jana")), "rozpis za každého");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
  async "plánovaná hypotéka: z kalkulace, slajd Dnes → Po koupi, promítnutí do plánu (výdaje, cíl, úvěr), bez zdvojení cíle"() {
    const { ctx, page, errors } = await open();
    const base = { klient: { jmeno: "Hana Hypoteční", narozen: "1990-01-01", zam: 60000, vydaje_osobni: 30000, bez_partnera: true }, partner: { zapnuto: false }, deti: [],
      majetek: [{ typ: "Spořicí účet", nazev: "Spořák", hodnota: 1500000 }], uvery: [], cile: [], renta: { mesicne: 0 } };
    await setPlan(page, base);
    // kalkulace z Pipeline (fp:init → hypoFromCalc)
    const r = await page.evaluate(() => { const I = inp(); hypoFromCalc(I, { price: 5000000, pv: 4000000, rate: 6, rpsn: 6.2, years: 30, fix: 5, src: "Swiss Life Hypoindex (září 2026)", at: 1000, name: "Hana – byt" });
      I.hypo.odpadne = 15000; I.hypo.naklady = 3000; compute();
      const H = hypoOf(I), fr = FR.filter(f => f.g === "hy");
      return { pmt: Math.round(H.pmt), own: H.own, n: fr.length, vyd: R.vydCelkem, cile: R.cile.map(c => [c.nazev, c.castka]), uv: R.uvery.map(u => [u.nazev, u.zustatek, u.splatka]), h: fr[1] && fr[1].h,
        older: (hypoFromCalc(I, { pv: 1, price: 2, rate: 1, years: 1, at: 500 }), I.hypo.uver) }; });
    eq(r.pmt, 23982, "anuita 4 mil., 6 %, 30 let");
    eq([r.n, r.own], [2, 1000000], "dva snímky Morph, vlastní zdroje");
    eq(r.vyd, 30000 + 23982 + 3000 - 15000, "výdaje po koupi");
    eq(r.cile, [["Vlastní zdroje na bydlení", 1000000]], "vlastní zdroje = cíl");
    eq(r.uv, [["Hypotéka – plánovaná", 4000000, 23982]], "úvěr v plánu (krytí smrti)");
    eq(r.older, 4000000, "starší kalkulace plán nepřepíše");
    assert(r.h.includes("RPSN") && r.h.includes("Výdaje po koupi") && r.h.includes("Swiss Life Hypoindex"), "obsah slajdu");
    // klient už má cíl na byt → vlastní zdroje se nepřidají podruhé; bez promítnutí se plán nemění
    const r2 = await page.evaluate(() => { const I = inp(); I.cile = [{ nazev: "Byt – vlastní zdroje", castka: 900000, za_let: 2 }]; compute(); const a = R.cile.map(c => c.nazev);
      I.hypo.promitnout = false; compute(); return { a, vyd: R.vydCelkem, uv: R.uvery.length, n: FR.filter(f => f.g === "hy").length }; });
    eq(r2.a, ["Byt – vlastní zdroje"], "bez zdvojení cíle");
    eq([r2.vyd, r2.uv, r2.n], [30000, 0, 2], "bez promítnutí: plán beze změny, slajd zůstává");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
  async "koláč: popisky dílů mají součet 100 % a stejná čísla jako legenda"() {
    const { ctx, page, errors } = await open();
    // 49,4 / 25,5 / 25,1 → dřív 49 + 25 + 25 = 99 (každý díl zaokrouhlený zvlášť), legenda 49 + 26 + 25
    const r = await page.evaluate(() => [[494, 255, 251], [1, 1, 1], [333, 333, 334], [612, 194, 194], [0.5, 0.3, 0.2], [700, 150, 150], [1000]].map(c => {
      const labs = [...donut(c, ["#a", "#b", "#c", "#d"], 330, 0).matchAll(/>(\d+) %<\/text>/g)].map(m => +m[1]);
      return { c: c.join("/"), sum: labs.reduce((a, b) => a + b, 0), same: JSON.stringify(labs) === JSON.stringify(FPE.pct100(c).filter(x => x > 6)) };
    }));
    r.forEach(x => { eq(x.sum, 100, "součet popisků koláče " + x.c); assert(x.same, "popisky = legenda " + x.c); });
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
  async "všechny snímky: popisky v každém SVG koláči dávají 100 % a sedí s legendou"() {
    const { ctx, page, errors } = await open();
    await setPlan(page, {
      klient: { jmeno: "Test Klient", narozen: "1974-10-01", zam: 60000, vydaje_osobni: 33000, inv1: 8000, inv2: 10000, inv3: 20000, bez_partnera: true }, partner: { zapnuto: false }, deti: [],
      majetek: [{ typ: "Spořicí účet", nazev: "Spořák", hodnota: 2040000 }], uvery: [],
      cile: [{ nazev: "Horské kolo", castka: 100000, za_let: 4 }, { nazev: "Loď", castka: 1500000, za_let: 9 }, { nazev: "Auto", castka: 300000, za_let: 10 }], renta: { mesicne: 40000, od_veku: 65 },
    });
    const bad = await page.evaluate(() => { compute(); const out = [];
      FR.forEach(f => { const t = document.createElement("div"); t.innerHTML = f.h;
        t.querySelectorAll("svg").forEach(s => { const labs = [...s.querySelectorAll("text")].map(e => e.textContent.trim()).filter(x => /^\d+ %$/.test(x)).map(x => parseInt(x, 10)); if (labs.length > 1 && labs.reduce((a, b) => a + b, 0) !== 100) out.push([f.lbl, labs]); });
        const leg = [...t.querySelectorAll("[data-k=leg] div")].map(e => +(e.textContent.match(/\((\d+) %\)/) || [])[1]).filter(Boolean);
        if (leg.length && leg.reduce((a, b) => a + b, 0) !== 100) out.push([f.lbl + " legenda", leg]); });
      return out; });
    eq(bad, [], "koláče, jejichž procenta nedávají 100");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
};

/* společný základ pro nové testy engine: čisté FPE.compute nad plánem (bez DOM) */
const calc = (page, plan) => page.evaluate(p => { const R = FPE.compute(JSON.parse(JSON.stringify(p)), new Date(), {});
  return { rH: R.trida.rH, flags: R.flags, cf: R.cf, cfZbyva: R.cfZbyva, pmtCelkem: R.pmtCelkem, renta: R.renta ? { pmt: R.renta.pmt, inh: R.renta.inh, spl: R.renta.splneni } : null,
    cile: R.cile.map(c => ({ n: c.nazev, vklad: c.vklad, pmt: c.pmt, inh: c.inh, spl: c.splneni, castka: c.castka })),
    kat: R.katastrofy.map(k => ({ vyd: k.vyd, vydFP: k.vydFP, invPlan: k.invPlan, normal: k.normal, smrt: { p3: k.smrt.prijem3, vyd: k.smrt.vyd, vydOs: k.smrt.vydOs, faze: k.smrt.faze.map(f => f.gap) } })), miss: missing(p, R).map(m => m.p) }; }, plan);
const zaklad = o => Object.assign({ klient: { jmeno: "Test", narozen: "1985-05-05", zam: 60000, vydaje_osobni: 30000, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 80000 }, partner: { zapnuto: false }, deti: [], motivace: "x",
  majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 400000 }], uvery: [], cile: [{ nazev: "Auto", castka: 300000, za_let: 3 }, { nazev: "Byt", castka: 1500000, za_let: 8 }], renta: { mesicne: 40000, od_veku: 60 }, pojisteni: { zivotni: { stav: 0, navrh: 1500 } } }, o);

tests["hotovost 2 % nominálně: reálně = 2 % − inflace; vklad na cíl se nezaokrouhluje na 10 000"] = async function () {
  const { ctx, page, errors } = await open();
  const base = zaklad({ majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 900000 }], cile: [{ nazev: "Koupelna", castka: 300000, za_let: 2 }, { nazev: "Notebook", castka: 80000, za_let: 1 }], renta: { mesicne: 0, od_veku: "" } });
  let o = await calc(page, base);
  assert(Math.abs(o.rH - (0.02 - 0.03)) < 1e-9, "rH = 2 % − 3 % = −1 %, je " + o.rH);
  o = await calc(page, Object.assign({}, base, { nastaveni: { inflace: 0.04 } }));
  assert(Math.abs(o.rH - (0.02 - 0.04)) < 1e-9, "rH sleduje inflaci");
  o = await calc(page, base);
  const k = o.cile.find(c => c.n === "Koupelna"), n = o.cile.find(c => c.n === "Notebook");
  assert(k.vklad < 310000, "koupelna za 300 000 už nepotřebuje 310 000 (je " + k.vklad + ")");
  assert(n.vklad % 10000 !== 0 || n.vklad === 80000 || n.vklad < 90000, "notebook za 80 000 se nezaokrouhluje na 90 000 (je " + n.vklad + ")");
  assert(k.spl >= 0.995 && n.spl >= 0.995, "cíle jsou splněné");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["kaskáda cílů: když cash flow stačí, každý cíl platí plnou platbu hned; přelévá se jen v nutné míře"] = async function () {
  const { ctx, page, errors } = await open();
  const mk = vyd => zaklad({ klient: { jmeno: "Test", narozen: "1985-05-05", zam: 60000, vydaje_osobni: vyd, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 80000 },
    majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 300000 }], cile: [{ nazev: "Auto", castka: 600000, za_let: 2 }, { nazev: "Byt", castka: 1200000, za_let: 10 }], renta: { mesicne: 0, od_veku: "" } });
  const res = [];
  for (let vyd = 14000; vyd <= 40000; vyd += 1000) {
    const o = await calc(page, mk(vyd));
    res.push({ vyd, kas: o.cile.some(c => c.inh > 0.5), flag: o.flags.some(f => /přelévá/.test(f)), kraceno: o.flags.some(f => /zkráceny/.test(f)), zbyva: o.cfZbyva, byt: o.cile.find(c => c.n === "Byt").pmt });
  }
  const info = JSON.stringify(res.map(r => [r.vyd, r.kas, r.kraceno]));
  const bez = res.filter(r => !r.kas && !r.kraceno), s = res.filter(r => r.kas && !r.kraceno);
  assert(bez.length >= 2, "při dost cash flow se nekaskáduje " + info);
  assert(s.length >= 1, "při těsném cash flow se přelévá " + info);
  bez.forEach(r => { assert(!r.flag, "bez kaskády není varování o přelévání"); assert(r.zbyva >= 0, "bez kaskády nezbývá záporné cash flow"); assert(r.byt > 3000, "pozdější cíl platí plnou platbu hned, ne drobnou (" + r.byt + ")"); });
  s.forEach(r => { assert(r.flag, "s kaskádou je varování o přelévání"); assert(r.zbyva >= -0.5, "i s kaskádou se platby vejdou"); });
  // čím méně cash flow, tím víc přelévání: jakmile se kaskáduje, platí to i pro všechny těsnější případy
  const first = res.findIndex(r => r.kas || r.kraceno); assert(res.slice(first).every(r => r.kas || r.kraceno), "monotónnost: kaskáda se po zapnutí nevypíná " + info);
  // renta při dost cash flow: plná platba od začátku (ne „900 Kč“ s tím, že se později přelije)
  const o = await calc(page, zaklad({ klient: { jmeno: "Test", narozen: "1985-05-05", zam: 90000, vydaje_osobni: 30000, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 120000 }, majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 450000 }] }));
  assert(o.renta && o.renta.inh === 0 && o.renta.pmt > 3000, "renta: plná vlastní platba od začátku (" + JSON.stringify(o.renta) + ")");
  assert(o.cile.every(c => c.inh === 0), "žádný cíl nebere přítok, když cash flow stačí");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["renta, kterou pokrývá státní důchod, se do plánu nedává (žádné Infinity)"] = async function () {
  const { ctx, page, errors } = await open();
  const plan = zaklad({ klient: { jmeno: "Dů", narozen: "1962-03-03", zam: 60000, vydaje_osobni: 30000, starobni: 40000, inv1: 6000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 80000 }, renta: { mesicne: 25000, od_veku: 65 } });
  const o = await calc(page, plan);
  eq(o.renta, null, "renta s nulovou potřebou");
  assert(o.flags.some(f => /už pokrývá státní důchod/.test(f)), "vysvětlující poznámka");
  await setPlan(page, plan);
  const bad = await page.evaluate(() => { compute(); return FR.filter(f => /Infinity|NaN|undefined/.test(f.h.replace(/<style[\s\S]*?<\/style>/g, ""))).map(f => f.lbl); });
  eq(bad, [], "snímky bez Infinity / NaN");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
const rent = (page, plan) => page.evaluate(p => { const R = FPE.compute(JSON.parse(JSON.stringify(p)), new Date(), {}); return { flags: R.flags, renta: R.renta ? { auto: R.renta.auto, mesicne: R.renta.mesicne, dor: R.renta.dor } : null }; }, plan);
tests["renta nezadána (prázdná / 0): cílem je stejný příjem jako dnes (starobní důchod + renta)"] = async function () {
  const { ctx, page, errors } = await open();
  const d = rm => zaklad({ klient: { jmeno: "Re", narozen: "1980-03-03", zam: 60000, vydaje_osobni: 30000, starobni: 25000, inv1: 6000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 80000 }, cile: [], renta: { mesicne: rm, od_veku: "" } });
  for (const rm of [0, ""]) { const o = await rent(page, d(rm)); assert(o.renta && o.renta.auto, "renta se dopočítá"); eq(o.renta.mesicne, 60000, "renta = dnešní příjem"); eq(o.renta.dor, 35000, "dorovnání = příjem − starobní důchod"); assert(o.flags.some(f => /nahradil dnešní příjem z práce/.test(f)), "poznámka"); }
  const o2 = await rent(page, d(40000)); assert(!o2.renta.auto && o2.renta.mesicne === 40000, "zadaná renta zůstává");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["manželé: platba do plánu se dělí poměrem příjmů (stejné % z platu)"] = async function () {
  const { ctx, page, errors } = await open();
  const o = await calc(page, zaklad({ klient: { jmeno: "A", narozen: "1985-05-05", zam: 80000, vydaje_osobni: 40000, vydaje_dom: 30000, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, hruba: 100000 }, partner: { zapnuto: true, jmeno: "B", narozen: "1986-05-05", zam: 40000, vydaje_osobni: 20000, vydaje_dom: 15000, starobni: 15000, inv1: 5000, inv2: 9000, inv3: 15000, hruba: 55000 } }));
  const [a, b] = o.kat; assert(o.pmtCelkem > 0, "plán má platby");
  assert(Math.abs(a.invPlan - 2 * b.invPlan) <= 2, "manžel s 2× vyšším příjmem dává 2× víc (" + a.invPlan + " vs " + b.invPlan + ")");
  assert(Math.abs(a.invPlan + b.invPlan - o.pmtCelkem) <= 2, "součet podílů = platba celkem");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["prezentace: jen životní pojištění (bez nemovitosti, domácnosti, auta), bez „v termínu“ a tabulka plánu s odsazením od okrajů"] = async function () {
  const { ctx, page, errors } = await open();
  const pl = zaklad({ klient: { jmeno: "Test", narozen: "1985-05-05", zam: 70000, vydaje_osobni: 40000, vydaje_dom: 30000, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, hruba: 90000, bez_partnera: true }, partner: { zapnuto: false }, deti: [{ jmeno: "D", narozen: "2016-06-01", vs: true }],
    pojisteni: { zivotni: { stav: 1000, navrh: 2500 }, nemovitost: { stav: 1900, navrh: 1900, pc: 6500000 }, domacnost: { stav: 550, navrh: 550, pc: 1200000 }, auto: { stav: 1400, navrh: 1400 } } });
  const o = await calc(page, pl);
  const ref = await page.evaluate(p => { const R = FPE.compute(JSON.parse(JSON.stringify(p)), new Date(), {}); return { typy: FPE.POJ_TYPY.map(x => x[0]), pojOst: R.pojOst, nove: R.pojNove, cf: R.cf, pmt: R.pmtCelkem, zbyva: R.cfZbyva }; }, pl);
  eq(ref.typy, ["zivotni"], "jediný typ pojištění v plánu"); eq(ref.pojOst, undefined, "žádné majetkové pojištění ve výsledku");
  eq(ref.nove, 2500, "životní pojištění zůstává"); eq(ref.zbyva, ref.cf - ref.pmt - 2500, "cash flow se krátí jen o životní pojištění");
  await setPlan(page, pl);
  const f = await page.evaluate(() => { compute(); const out = { lbl: FR.map(x => x.lbl), txt: [], bar: [] };
    FR.forEach(x => { const t = document.createElement("div"); t.innerHTML = x.h; out.txt.push([x.lbl, t.textContent]);
      t.querySelectorAll("div").forEach(d => { const tx = d.textContent.trim().toLowerCase(); if ((tx === "co" || tx === "splnění") && d.children.length === 0) out.bar.push([tx, parseFloat(d.style.left), parseFloat(d.style.width), d.style.textAlign]); }); });
    return out; });
  assert(!f.lbl.some(l => /majetku/i.test(l)), "žádný snímek Pojištění majetku");
  const bad = f.txt.filter(([, t]) => /v termínu|Pojištění (domácnosti|nemovitosti|auta)|Poj\. (domácnosti|nemovitosti|auta)/.test(t)).map(x => x[0]);
  eq(bad, [], "snímky s textem o majetkovém pojištění nebo „v termínu“");
  assert(f.txt.some(([, t]) => /Životní pojištění/.test(t)), "životní pojištění v prezentaci zůstává");
  assert(f.bar.length >= 2, "našel jsem záhlaví Co / Splnění");
  f.bar.forEach(([t, l, w, al]) => { if (al === "left") assert(l >= 80 + 16, "„Co“ je odsazené od levé hrany pruhu (" + l + ")"); else assert(l + w <= 1520 - 16, "„Splnění“ je odsazené od pravé hrany pruhu (" + (l + w) + ")"); });
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["plán po krocích: nejdřív veškerý finanční majetek (i DPS u renty), teprve potom cash flow"] = async function () {
  const { ctx, page, errors } = await open();
  /* plán jako Horáková: po rezervě zbývá majetek na dva cíle, DPS patří rentě a cash flow pokryje platby u tří cílů */
  await setPlan(page, zaklad({ klient: { jmeno: "Test", narozen: "1980-05-05", zam: 80000, vydaje_osobni: 60000, vydaje_dom: 40000, starobni: 30000, inv1: 8000, inv2: 16000, inv3: 25000, hruba: 100000, bez_partnera: true }, partner: { zapnuto: false }, deti: [],
    majetek: [{ typ: "Spořicí účet", nazev: "Rezerva", hodnota: 1700000 }, { typ: "Podílový fond (OPF)", nazev: "Fond", hodnota: 800000 }, { typ: "Doplňkové penzijní spoření (DPS)", nazev: "DPS", hodnota: 140000, vklad: 1700 }], uvery: [],
    cile: [{ nazev: "Rekonstrukce", castka: 900000, za_let: 3 }, { nazev: "Předčasné splacení", castka: 1500000, za_let: 6 }, { nazev: "Studium", castka: 1200000, za_let: 9 }], renta: { mesicne: 70000, od_veku: 58 } }));
  const o = await page.evaluate(() => { compute(); const num = h => { const t = document.createElement("div"); t.innerHTML = h; const g = k => { const e = t.querySelector("[data-k=" + k + "]"); return e ? +(e.textContent.replace(/\s|\u00a0/g, "").match(/zbývá:(-?\d+)/) || [])[1] : NaN; }; return [g("bz0"), g("bz1")]; };
    return { cf: R.cf, kroky: FR.filter(f => /^Plán: krok/.test(f.lbl)).map(f => num(f.h)) }; });
  assert(o.kroky.length >= 5, "plán má kroky (" + o.kroky.length + ")");
  const mzEnd = o.kroky[o.kroky.length - 1][0];
  const cf0 = o.kroky[0][1], first = o.kroky.findIndex(k => k[1] < cf0);
  assert(first > 0, "cash flow se nakonec čerpá");
  o.kroky.forEach((k, i) => { if (i >= first) eq(k[0], mzEnd, "krok " + (i + 1) + ": než se sáhne na cash flow, musí být rozdělený veškerý majetek (zbývá " + k[0] + ")"); });
  eq(o.kroky.slice(0, first).every(k => k[1] === cf0), true, "před prvním krokem z cash flow se cash flow nemění");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* hotové plány demo klientů (index.html → demoFpPlans): musí se spočítat, nesmí nic chybět a musí být splnitelné */
tests["demo plány: spočítají se, jsou kompletní, splnitelné a sedí s kartami klientů"] = async function () {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const fn = src.split("/*DEMO-FP-START*/")[1].split("/*DEMO-FP-END*/")[0];
  /* klienti z demoBuild: jméno + rok narození, ať plán sedí s kartou */
  const CL = [...src.split("const CL=[")[1].split("const cids=[]")[0].matchAll(/\["([^"]+)",(\d{4}),"/g)].map(m => [m[1], +m[2]]);
  assert(CL.length === 10, "našel jsem 10 demo klientů");
  const { ctx, page, errors } = await open();
  const res = await page.evaluate(([fn, CL]) => {
    eval(fn + ";window.__dfp=demoFpPlans");
    const n = new Date(), Y = n.getFullYear(), ym = k => { const d = new Date(Y, n.getMonth() + k, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
    const P = __dfp(Y, i => CL[i][1] + "-06-15", ym), out = [];
    for (const [i, plan] of Object.entries(P)) {
      const r = { i: +i, jmeno: plan.klient.jmeno, narozen: plan.klient.narozen, karta: CL[i][0], karta_rok: CL[i][1] };
      try {
        const R = FPE.compute(JSON.parse(JSON.stringify(plan)), n, {});
        r.chybi = missing(plan, R).map(m => m.t);
        r.cf = R.cf; r.nesplnene = (R.cile || []).filter(c => c.splneni < 0.9).map(c => c.nazev);
        r.rentaKracena = !!(R.renta && R.renta.kraceno); r.nedostatek = R.flags.filter(f => /nestačí/.test(f));
        r.cile = (R.cile || []).length; r.nan = JSON.stringify(R.cile.map(c => [c.vklad, c.pmt, c.splneni])).includes("null");
        r.frames = (() => { try { const d = JSON.parse(JSON.stringify(DB)); d.clients[d.cur] = plan; DB = d; compute(); return FR.length; } catch (e) { return "ERR " + e.message; } })();
      } catch (e) { r.err = String(e && e.message || e); }
      out.push(r);
    }
    return out;
  }, [fn, CL]);
  assert(res.length >= 6, "aspoň 6 hotových plánů");
  res.forEach(r => {
    eq(r.err, undefined, r.jmeno + ": compute spadl");
    eq(r.jmeno, r.karta, "jméno v plánu = jméno na kartě klienta #" + r.i);
    eq(r.narozen.slice(0, 4), String(r.karta_rok), r.jmeno + ": rok narození = karta");
    eq(r.chybi, [], r.jmeno + ": chybějící údaje před prezentací");
    assert(r.cf > 0, r.jmeno + ": kladné volné cash flow");
    eq(r.nedostatek, [], r.jmeno + ": cash flow nestačí na cíle");
    eq(r.nesplnene, [], r.jmeno + ": nesplněné cíle");
    assert(!r.rentaKracena, r.jmeno + ": renta nesmí být krácená");
    assert(r.cile >= 3 && !r.nan, r.jmeno + ": aspoň 3 cíle bez NaN");
    assert(typeof r.frames === "number" && r.frames > 30, r.jmeno + ": snímky prezentace se vykreslí (" + r.frames + ")");
  });
  /* migrace starších demo dat: doplní jen chybějící plány, nic nepřepíše ani neobnoví smazané, podruhé už nic nedělá */
  const mig = await page.evaluate(([fn, CL]) => {
    eval(fn + ";window.__mig=demoFpMigrate");
    const d = {}; CL.forEach((c, i) => d["clients/democ" + i] = { name: c[0], birth: c[1] + "-06-15" });
    d["fplan/democ0"] = { clientId: "democ0", name: "Moje úprava", plan: { klient: { jmeno: "X" } }, updatedAt: 1 };
    d["fplan/democ1"] = { _del: true, _u: 5 };
    const s = { docs: d }, c1 = __mig(s), after1 = Object.keys(d).filter(k => k.startsWith("fplan/")).sort(), c2 = __mig(s);
    return { c1, c2, after1, keep: d["fplan/democ0"].name, del: !!d["fplan/democ1"]._del, other: { docs: { "clients/x": { name: "x" } } } };
  }, [fn, CL]);
  eq(mig.c1, true, "migrace doplnila plány"); eq(mig.c2, false, "druhé spuštění už nic nemění");
  eq(mig.keep, "Moje úprava", "existující plán se nepřepsal"); assert(mig.del, "smazaný plán se neobnovil");
  assert(mig.after1.length === res.length + 0 || mig.after1.length >= res.length, "po migraci mají plán všichni vybraní klienti");
  eq(errors, [], "chyby v konzoli");
  await ctx.close();
};

/* ---- navazující cash flow: splněný cíl předá svou platbu dalšímu cíli a je to vidět ve slidu Finanční plán ---- */
const kaskada = { klient: { jmeno: "Test Klient", narozen: "1985-05-05", zam: 60000, vydaje_osobni: 38000, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 80000 }, partner: { zapnuto: false }, deti: [], motivace: "x",
  majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 490000 }], uvery: [], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: 1500 } },
  cile: [{ nazev: "Auto", castka: 800000, za_let: 3 }, { nazev: "Byt", castka: 1500000, za_let: 8 }] };
tests["navazující platba: cíl, který vyčerpá cash flow, po splnění předá platbu dalšímu – ve slidu plánu vidět krok i výsledek"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, kaskada);
  const o = await page.evaluate(() => { compute(); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/ /g, " "); };
    const P = FR.filter(f => f.g === "p");
    return { cile: R.cile.map(c => ({ n: c.nazev, pmt: c.pmt, flowIdx: c.flowIdx, flowTake: c.flowTake, spl: c.splneni })), lbl: P.map(f => f.lbl), txt: P.map(f => t(f.h)), cf: R.cf }; });
  const [auto, byt] = o.cile;
  assert(auto.pmt > 14000, "první cíl platí z cash flow naplno (" + auto.pmt + ")");
  eq(auto.flowIdx, 1, "platba Auta po splnění teče do Bytu"); assert(auto.flowTake > 10000, "do Bytu přeteče velká část platby (" + auto.flowTake + ")");
  assert(byt.pmt < 8000 && byt.spl >= 0.995, "Byt má málo vlastní platby a přesto vychází na 100 % díky navazující platbě (" + byt.pmt + ", " + byt.spl + ")");
  assert(o.lbl.includes("Plán: navazující platba"), "ve slidu je krok „navazující platba“ (" + o.lbl.join(" | ") + ")");
  assert(o.lbl[o.lbl.length - 1] === "Plán: hotovo", "slide končí snímkem bez bubliny, který ukáže výsledek");
  const f = o.txt[o.txt.length - 1], c = o.txt.find((_, i) => o.lbl[i] === "Plán: navazující platba");
  assert(/(po splnění|✓ splněno) → Byt/.test(f), "u Auta je poznámka, kam platba po splnění teče (v závěrečném snímku už ✓ splněno)");
  assert(/za 3 roky: [\d ]+ \+ [\d ]+ = (19|20) \d{3} Kč\/měs/.test(f.replace(/ /g, " ")), "u Bytu je vidět, kolik bude platit po splnění Auta (vlastní + přiteklá = celkem): " + f.match(/za \d+ roky:[^A-Z]*/));
  assert(/z cíle Auto poteče po jeho splnění/.test(c), "popis kroku vysvětluje přelévání");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["nedostatek cash flow: dřívější cíl má přednost a dostane 100 %, zkrácení dopadne na pozdější cíle"] = async function () {
  const { ctx, page, errors } = await open();
  const o = await calc(page, Object.assign({}, kaskada, { cile: [{ nazev: "Auto", castka: 800000, za_let: 3 }, { nazev: "Byt", castka: 6000000, za_let: 8 }] }));
  const [auto, byt] = o.cile;
  assert(o.flags.some(f => /dřívější cíle mají přednost/.test(f)), "varování o pořadí (" + o.flags.join(" / ") + ")");
  assert(auto.spl >= 0.995, "dřívější cíl se splní na 100 % (" + auto.spl + ")");
  assert(byt.spl < 0.995 && byt.pmt > 0, "krácen je až pozdější cíl (" + byt.spl + ")");
  assert(o.cfZbyva >= -0.5, "platby se vejdou do cash flow (" + o.cfZbyva + ")");
  await setPlan(page, Object.assign({}, kaskada, { cile: [{ nazev: "Auto", castka: 800000, za_let: 3 }, { nazev: "Byt", castka: 6000000, za_let: 8 }] }));
  const lbl = await page.evaluate(() => { compute(); return FR.filter(f => f.g === "p").map(f => f.lbl); });
  assert(lbl.includes("Plán: dosažitelné cíle"), "při nedostatku je závěrečný snímek „dosažitelné cíle“");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* ---- úmrtí: partner / dospělé děti = výdaje domácnosti na 3 roky − vdovský (1 rok) + závazky; do 18 let dětí po fázích ---- */

/* ---- slide „Proč pojištění, když platím sociální?“ za slidem s modelací ŽP ---- */
tests["slide sociální vs. pojištění: 3 animované snímky hned za modelací ŽP, 7,1 % z hrubé, OSVČ jen odhad"] = async function () {
  const { ctx, page, errors } = await open();
  const rodina = { klient: { jmeno: "Jan Novák", narozen: "1986-05-05", zam: 55000, vydaje_osobni: 52000, vydaje_dom: 44000, starobni: 22000, inv1: 8000, inv2: 12000, inv3: 20000, vdovsky: 9000, sirotci: 7000, bez_partnera: false, hruba: 75000 },
    partner: { zapnuto: true, jmeno: "Eva Nováková", narozen: "1988-02-02", zam: 38000, starobni: 18000, inv1: 6000, inv2: 9000, inv3: 15000, vdovsky: 9000, sirotci: 7000, hruba: 52000 },
    deti: [{ jmeno: "Anička", narozen: "2018-04-01", vs: false }], motivace: "x", majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 600000 }], uvery: [{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }],
    cile: [{ nazev: "Auto", castka: 400000, za_let: 3 }], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: 3200 } } };
  await setPlan(page, rodina);
  const o = await page.evaluate(() => { compute(); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/ /g, " "); };
    const idx = FR.map((f, i) => [f.g, i]).filter(x => /^soc\d$/.test(x[0]));
    const zp0 = FR.map(f => f.g).lastIndexOf("zp0"), s0 = FR.map((f, i) => f.g === "soc0" ? i : -1).filter(i => i >= 0);
    return { groups: [...new Set(idx.map(x => x[0]))], n0: s0.length, nextToZp: s0[0] === zp0 + 1, last: t(FR[s0[s0.length - 1]].h), first: t(FR[s0[0]].h), bad: FR.filter(f => /Infinity|NaN|undefined/.test(f.h.replace(/<style[\s\S]*?<\/style>/g, ""))).map(f => f.lbl),
      keys: s0.map(i => [...FR[i].h.matchAll(/data-k="(sb00|sb01|sb02|ib00|sum)"/g)].map(m => m[1]).join(",")), lbl: FR[s0[0]].lbl }; });
  eq(o.groups, ["soc0", "soc1"], "slide pro každou osobu"); eq(o.n0, 3, "3 snímky = animace karty → stát → + pojištění"); assert(o.nextToZp, "slide je hned za slidy s modelací ŽP (včetně varianty FitSport)");
  assert(/5 320/.test(o.first) && /7,1 %/.test(o.first), "sociální pojistné = 7,1 % z hrubé 75 000 = 5 320 Kč");
  assert(/Stát\s+20 000 Kč/.test(o.last) && /pojištění/.test(o.last), "poslední snímek ukazuje dávku státu i doplatek pojištění");
  assert(!/majetku/i.test(o.lbl), "popisek bez „majetku“"); eq(o.bad, [], "bez Infinity / NaN"); assert(o.keys.every(k => k === "sb00,ib00,sb01,sb02,sum"), "stejné animované prvky ve všech snímcích (" + o.keys.join(" | ") + ")");
  const osvc = { klient: { jmeno: "Petr Svoboda", narozen: "1990-03-03", zam: 0, podnik: 70000, vydaje_osobni: 45000, starobni: 20000, inv1: 6000, inv2: 10000, inv3: 18000, bez_partnera: true }, partner: { zapnuto: false }, deti: [], motivace: "x",
    majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 150000 }], uvery: [], cile: [{ nazev: "Auto", castka: 400000, za_let: 3 }], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: 2500 } } };
  await setPlan(page, osvc);
  const p = await page.evaluate(() => { compute(); const e = document.createElement("div"), f = FR.filter(x => x.g === "soc0"); e.innerHTML = f[f.length - 1].h; return { n: f.length, t: e.textContent.replace(/ /g, " ") }; });
  eq(p.n, 3, "OSVČ má také 3 snímky"); assert(/odhad/.test(p.t) && !/7,1 %/.test(p.t), "OSVČ: částka je označená jako odhad, bez sazby zaměstnance"); assert(/OSVČ bez nemocenského/.test(p.t), "OSVČ nemá nemocenskou");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* ---- slide ŽP: automatická modelace NN – jen rizika s pojistnou částkou, PČ a pojistné ---- */
tests["slide ŽP: tabulka z výpočtu NN má jen rizika s pojistnou částkou, PČ a měsíční pojistné; děti a součet sedí"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, { klient: { jmeno: "Jan Novák", narozen: "1988-05-05", zam: 55000, vydaje_osobni: 40000, inv1: 8000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 75000 }, partner: { zapnuto: false },
    deti: [{ jmeno: "Anička", narozen: "2018-04-01", vs: false }], majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 200000 }], uvery: [{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }], cile: [],
    renta: { mesicne: 0, od_veku: "" }, nastaveni: { nn_dite: 400 }, pojisteni: { zivotni: { stav: 0 } } });
  const o = await page.evaluate(() => { compute(); const f = FR.find(x => x.g === "zp0"); const e = document.createElement("div"); e.innerHTML = f.h;
    return { auto: R.pojAuto, celkem: R.nn.celkem, nove: R.pojNove, t: e.textContent.replace(/ /g, " "), rows: e.querySelectorAll("table tr").length, bad: /Infinity|NaN|undefined/.test(f.h) }; });
  assert(o.auto, "automatický výpočet"); eq(o.nove, o.celkem, "pojistné ve slidu = výpočet NN"); eq(o.bad, false, "bez Infinity/NaN/undefined");
  assert(/Pojistná částka/i.test(o.t) && /Pojistné/.test(o.t) && /NN Orange Risk/.test(o.t), "tabulka s PČ a pojistným");
  assert(!/0 Kč\s*0 Kč/.test(o.t), "žádný řádek s nulovou pojistnou částkou");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* NN Orange Risk: pojistné z pipeline = pojistné, které spočítala Stela 2.0 (fixture nn-stela.json = vstupy a výsledky přímo ze Stely 10/2026) */
tests["NN Orange Risk: testové případy sedí na korunu se Stelou (jednotlivec, rodina, rizikové povolání/sport, Fit, sleva za výši pojistného, Hypotéka, děti)"] = async function () {
  const { ctx, page, errors } = await open();
  const fx = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./fixtures/nn-stela.json", import.meta.url), "utf8"));
  const res = await page.evaluate(F => Object.entries(F).map(([nazev, c]) => {
    const fl = [], osoby = c.osoby.map(o => ({ jmeno: o.jmeno, vek: o.vek, dite: !!o.dite, maxKonec: o.dite ? o.maxKonec : (o.plan.maxKonec || 65), rsPovolani: o.rsPovolani, rsSport: o.rsSport, fit: o.fit,
      rizika: o.dite ? FPE.nnRizikaDitete({ jmeno: o.jmeno, vek: o.vek }, fl).map(r => Object.assign(r, { konec: Math.min(r.konec, o.maxKonec || 99), doba: Math.min(r.konec, o.maxKonec || 99) - o.vek }))
        : FPE.nnRizikaOsoby(Object.assign({ jmeno: o.jmeno, vstup: o.vek }, o.plan), o.opt || {}, fl) }));
    const R = FPE.nnOcen(osoby, c.hypo, fl);
    const rows = R.osoby.flatMap(o => o.rizika.map(r => [o.jmeno, r.tarif, r.pc, r.konec, r.mes]));
    return { nazev, celkem: R.celkem, sleva: R.sleva, rows, ocek: c.stela };
  }), fx);
  for (const r of res) {
    eq(r.rows, r.ocek.rows, r.nazev + " – rizika, PČ, konec a pojistné");
    eq([r.celkem, r.sleva], [r.ocek.celkem, r.ocek.sleva], r.nazev + " – celkem a sleva");
  }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["NN Orange Risk: navržené pojistné se doplní samo, slide modelace ukazuje jen rizika, která plánu vyšla, s PČ a pojistným"] = async function () {
  const { ctx, page, errors } = await open();
  const rodina = { klient: { jmeno: "Jan Novák", narozen: "1989-05-05", zam: 55000, vydaje_osobni: 52000, vydaje_dom: 44000, starobni: 22000, inv1: 8000, inv2: 12000, inv3: 20000, vdovsky: 9000, sirotci: 7000, bez_partnera: false, hruba: 75000, nn_fit: "sport" },
    partner: { zapnuto: true, jmeno: "Eva Nováková", narozen: "1991-02-02", zam: 38000, starobni: 18000, inv1: 6000, inv2: 9000, inv3: 15000, vdovsky: 9000, sirotci: 7000, hruba: 52000 },
    deti: [{ jmeno: "Anička", narozen: "2018-04-01", vs: false }], motivace: "x", majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 300000 }], uvery: [{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }],
    cile: [{ nazev: "Auto", castka: 400000, za_let: 3 }], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: "" } } };
  await setPlan(page, rodina);
  const o = await page.evaluate(() => { compute(); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/[\u00a0\u202f]/g, " "); };
    const zp = FR.filter(f => /^zp\d$/.test(f.g)), deti = FR.find(f => f.g === "deti");
    return { auto: R.pojAuto, poj: R.pojNove, nn: R.nn.celkem, sumRows: R.nn.osoby.reduce((a, x) => a + x.rizika.reduce((b, r) => b + r.mes, 0), 0), sleva: R.nn.sleva,
      zp: zp.map(f => t(f.h)), deti: deti && t(deti.h), rows0: R.nn.dospeli[0].rizika.filter(r => r.pc > 0).map(r => [r.nazev, r.pc, r.mes]),
      bad: FR.filter(f => /Infinity|NaN|undefined/.test(f.h.replace(/<style[\s\S]*?<\/style>/g, ""))).map(f => f.lbl) }; });
  assert(o.auto, "prázdné navržené pojistné → spočítá se z NN"); eq(o.poj, o.nn, "pojistné v plánu = výpočet NN"); eq(o.nn, o.sumRows, "celkem = součet řádků");
  eq(o.zp.length, 2, "slide modelace pro oba partnery");
  o.rows0.forEach(([n, pc, mes]) => { assert(o.zp[0].includes(n), "řádek " + n + " na slidu"); assert(o.zp[0].includes(mes.toLocaleString("cs-CZ").replace(/\s/g, " ") + " Kč"), "pojistné " + n + " na slidu"); });
  assert(!/Hospitalizace|Závažná onemocnění ZO4/.test(o.zp[0]), "na slidu nejsou rizika, která plán nedoporučil");
  assert(/Program Fit/.test(o.zp[0]) && !/Program Fit/.test(o.zp[1]), "Fit je jen u 1. pojištěného"); assert(/Pojistné/.test(o.deti), "slide dětí ukazuje pojistné");
  eq(o.bad, [], "bez Infinity / NaN / undefined");
  await setPlan(page, Object.assign({}, rodina, { pojisteni: { zivotni: { stav: 0, navrh: 2500 } } }));
  const m = await page.evaluate(() => { compute(); return { auto: !!R.pojAuto, poj: R.pojNove }; });
  eq(m, { auto: false, poj: 2500 }, "ručně zadané pojistné má přednost");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["NN Orange Risk: dospělí mají vždy TNÚ PREMIUM 1 mil., pojistné do konce smlouvy ≥ 100 Kč, za modelací slide s FitSport a logo NN"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => {
    const fl = [], o = FPE.nnRizikaOsoby({ jmeno: "A", vstup: 38, hlavni: true, smrt: 0, inv: [0, 5e5, 1.5e6], invKonec: 55, pnDen: 0 }, {}, fl);
    const tnu = o.find(x => x.tarif === "TNX1-P1R");
    /* bez TNÚ (jako kdyby ho nikdo nepřidal): invalidita jen do 55 → do konce smlouvy zbude jen povinná smrt 30 000 Kč → rizika se prodlouží do 65 */
    const fl2 = [], bez = o.filter(x => x.tarif !== "TNX1-P1R").map(x => Object.assign({}, x));
    const R2 = FPE.nnOcen([{ jmeno: "A", vek: 38, rizika: bez, maxKonec: 65 }], false, fl2);
    return { tnu: tnu && [tnu.pc, tnu.konec], kon: R2.osoby[0].rizika.map(x => [x.tarif, x.konec]), dk: R2.doKonce, flag: fl2.some(f => /100 Kč/.test(f)) };
  });
  eq(r.tnu, [1000000, 65], "TNÚ PREMIUM 1 mil. do 65"); assert(r.flag, "upozornění na 100 Kč");
  assert(r.kon.every(([t, k]) => k === 65), "bez TNÚ se rizika prodlouží na maximum (65)"); assert(r.dk >= 100, "pojistné do konce smlouvy ≥ 100 Kč");
  await setPlan(page, { klient: { jmeno: "Jan Novák", narozen: "1989-05-05", zam: 55000, vydaje_osobni: 40000, inv1: 8000, inv2: 12000, inv3: 20000, bez_partnera: true, hruba: 75000 }, partner: { zapnuto: false },
    deti: [], majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 200000 }], uvery: [{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }], cile: [], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: "" }, pojistovna: "nn" } });
  const o = await page.evaluate(() => { compute(); const zi = FR.map((f, i) => [f.g, f.lbl, i]).filter(x => x[0] === "zp0"); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/[  ]/g, " "); };
    return { n: zi.length, lbl: zi.map(x => x[1]), t: zi.map(x => t(FR[x[2]].h)), logo: zi.every(x => FR[x[2]].h.includes(NN_LOGO)), base: R.nn.celkem, fit: R.nnFit && R.nnFit.celkem, poj: R.pojNove }; });
  eq(o.n, 2, "modelace + hned za ní varianta FitSport"); assert(/FitSport/.test(o.lbl[1]), "druhý snímek je FitSport");
  assert(o.fit < o.base, "s FitSport je pojistné nižší (" + o.fit + " < " + o.base + ")"); eq(o.poj, o.base, "do plánu jde pojistné bez FitSport");
  assert(o.t[1].includes("ušetříte " + (o.base - o.fit).toLocaleString("cs-CZ").replace(/\s/g, " ") + " Kč"), "úspora na snímku");
  assert(o.logo, "logo NN na obou snímcích"); assert(/Trvalé následky úrazu PREMIUM/.test(o.t[0]), "TNÚ PREMIUM na slidu");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* Kooperativa FLEXI: pojistné z pipeline = pojistné z kalkulačky KoopLife (fixture koop-kalkulacka.json = vstupy a výsledky přímo z KoopLife 10/2026) */
tests["Kooperativa FLEXI: testové případy sedí na korunu s kalkulačkou KoopLife (jednotlivec, konstantní/klesající, invalidita do 67, sleva za komplexní rozsah, poplatek, rodina, děti)"] = async function () {
  const { ctx, page, errors } = await open();
  const fx = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./fixtures/koop-kalkulacka.json", import.meta.url), "utf8"));
  const res = await page.evaluate(F => Object.entries(F).map(([nazev, c]) => {
    const fl = [], osoby = c.osoby.map(o => ({ jmeno: o.jmeno, vek: o.vek, dite: !!o.dite,
      rizika: o.dite ? FPE.koopRizikaDitete({ jmeno: o.jmeno, vek: o.vek }, fl) : FPE.koopRizikaOsoby(Object.assign({ jmeno: o.jmeno, vstup: o.vek }, o.plan), o.opt || {}, fl) }));
    const R = FPE.koopOcen(osoby, fl);
    return { nazev, celkem: R.celkem, sleva: R.sleva, poplatek: R.poplatek, rows: R.osoby.flatMap(o => o.rizika.map(r => [o.jmeno, r.tarif, r.pc, r.konec, r.mes])), ocek: c.koop };
  }), fx);
  for (const r of res) {
    eq(r.rows, r.ocek.rows, r.nazev + " – rizika, PČ, konec a pojistné");
    eq([r.celkem, r.sleva, r.poplatek], [r.ocek.celkem, r.ocek.sleva, r.ocek.poplatek], r.nazev + " – celkem, sleva a poplatek");
  }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* UNIQA Život & radost: pojistné z pipeline vs. kalkulačka UniPoint (fixture uniqa-kalkulacka.json = vstupy a výsledky přímo z UniPoint 10/2026).
   UniPoint zaokrouhluje mezikroky jinak, než jde z výstupu zpětně zjistit – model sedí na ±2 Kč u krytí a do 0,15 % u celé smlouvy. */
tests["UNIQA Život & radost: pojistné sedí s kalkulačkou UniPoint (±2 Kč na krytí; pásma PČ, hlavní pojištění, sleva 0/15/20/25 %, dětský balíček na korunu)"] = async function () {
  const { ctx, page, errors } = await open();
  const fx = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./fixtures/uniqa-kalkulacka.json", import.meta.url), "utf8"));
  const r = await page.evaluate(F => {
    const dosp = Object.entries(F.dospeli).map(([nazev, c]) => { const R = FPE.uniqaOcen([{ jmeno: "A", vek: c.vek, rizika: c.rows.map(([t, pc, k]) => ({ tarif: t, nazev: t, typ: FPE.UNIQA_DEF[t].typ, pc, konec: k, doba: k - c.vek })) }], []);
      return { nazev, mes: R.osoby[0].rizika.map(x => x.mes), ocek: c.rows.map(x => x[3]), celkem: R.celkem, ocekC: c.celkem, sleva: R.sleva, ocekS: c.sleva }; });
    /* dítě se standardním balíčkem při každé slevě: dospělý s tolik pojistného, aby smlouva spadla do daného pásma slevy */
    const deti = Object.keys(F.deti).map(p => { let R;
      for (let pc = 50000; pc <= 2e7; pc += 50000) { R = FPE.uniqaOcen([{ jmeno: "A", vek: 30, rizika: [{ tarif: "SMRT-H", typ: "zivot", pc, konec: 65, doba: 35 }, { tarif: "TNU10", typ: "uraz", pc: 1e6, konec: 65, doba: 35 }] }, { jmeno: "D", vek: 6, dite: true, rizika: FPE.uniqaRizikaDitete({ jmeno: "D", vek: 6 }, []) }], []); if (R.sleva === +p) break; }
      return { p: +p, sleva: R.sleva, mes: R.osoby[1].rizika.map(x => x.mes), ocek: F.deti[p] }; });
    return { dosp, deti };
  }, fx);
  for (const c of r.dosp) {
    eq(c.sleva, c.ocekS, c.nazev + " – sleva za výši pojistného");
    c.mes.forEach((m, i) => assert(Math.abs(m - c.ocek[i]) <= 2, `${c.nazev} – krytí ${i}: ${m} vs UniPoint ${c.ocek[i]}`));
    assert(Math.abs(c.celkem - c.ocekC) <= Math.max(3, c.ocekC * 0.0015), `${c.nazev} – celkem ${c.celkem} vs UniPoint ${c.ocekC}`);
  }
  for (const d of r.deti) { eq(d.sleva, d.p, "pásmo slevy " + d.p + " %"); eq(d.mes, d.ocek, "dítě: úraz 1 mil., závažná onemocnění 500 tis., DOU 400 Kč při slevě " + d.p + " %"); }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* Allianz ŽIVOT: pojistné z pipeline vs. výpočet nabídky v Allfa (fixture allianz-kalkulace.json = vstupy a výsledky přímo z Allfa 10/2026) */
tests["Allianz ŽIVOT: pojistné sedí s Allfa (±1 Kč na krytí; miliónová sleva, sleva za počet skupin, hlavní pojištění 30 Kč, děti)"] = async function () {
  const { ctx, page, errors } = await open();
  const fx = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./fixtures/allianz-kalkulace.json", import.meta.url), "utf8"));
  const res = await page.evaluate(F => Object.entries(F.pripady).map(([k, c]) => { const fl = [];
    const os = [{ jmeno: "A", vek: c.vek, rizika: c.rows.map(([t, pc, kon]) => ({ tarif: t, nazev: t, typ: FPE.ALLIANZ_DEF[t].typ, pc, jedn: FPE.ALLIANZ_DEF[t].den ? "Kč/den" : "Kč", konec: kon, doba: kon - c.vek })) }]
      .concat(c.deti.map(v => ({ jmeno: "D", vek: v, dite: true, rizika: FPE.allianzRizikaDitete({ jmeno: "D", vek: v }, fl) })));
    const R = FPE.allianzOcen(os, fl); return { k, mes: R.osoby.flatMap(o => o.rizika.map(r => r.mes)), ocek: c.ocek, celkem: R.celkem, ocekC: c.celkem }; }), fx);
  let presne = 0;
  for (const r of res) {
    r.mes.forEach((m, i) => assert(Math.abs(m - r.ocek[i]) <= 1, `${r.k} – krytí ${i}: ${m} vs Allfa ${r.ocek[i]}`));
    assert(Math.abs(r.celkem - r.ocekC) <= 1, `${r.k} – celkem ${r.celkem} vs Allfa ${r.ocekC}`); if (r.celkem === r.ocekC) presne++;
  }
  assert(presne >= res.length * 0.8, `na korunu aspoň 80 % případů (${presne}/${res.length})`);
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

/* Generali Bel Mondo 20: pojistné z pipeline vs. kalkulačka LISA (fixture generali-kalkulacka.json = vstupy a výsledky přímo z LISA 10/2026, počátek 26. 10. 2026).
   LISA počítá věk i dobu po měsících a zaokrouhluje mezikroky – model sedí na ±1 Kč u krytí a do 3 Kč u celé smlouvy (4 ze 7 smluv na korunu). */
tests["Generali Bel Mondo 20: pojistné sedí s kalkulačkou LISA (±1 Kč na krytí; věk a doba po měsících, hlavní pojištění, sleva 0/40/44 %, přirážka PN, děti)"] = async function () {
  const { ctx, page, errors } = await open();
  const fx = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./fixtures/generali-kalkulacka.json", import.meta.url), "utf8"));
  const r = await page.evaluate(F => { const poc = new Date(2026, 9, 26);
    return F.smlouvy.map(c => { const os = c.os.map((o, i) => { const nar = new Date(o.nar), vek = poc.getFullYear() - nar.getFullYear();
        return { jmeno: "O" + i, vek, vekM: FPE.generaliVekM(nar, poc), dite: !!o.dite, rizika: o.rows.map(([t, pc, k]) => ({ tarif: t, nazev: t, typ: o.dite ? "dite" : FPE.GENERALI_DEF[t].typ, pc, konec: k, doba: k - vek })) }; });
      const R = FPE.generaliOcen(os, []);
      return { n: c.n, mes: R.osoby.map(o => o.rizika.map(x => x.mes)), ocek: c.os.map(o => o.rows.map(x => x[3])), celkem: R.celkem, ocekC: c.celkem, pn: R.pnPrirazka }; }); }, fx);
  for (const c of r) {
    c.mes.forEach((o, i) => o.forEach((m, j) => assert(m != null && Math.abs(m - c.ocek[i][j]) <= 1, `${c.n} – osoba ${i} krytí ${j}: ${m} vs LISA ${c.ocek[i][j]}`)));
    assert(Math.abs(c.celkem - c.ocekC) <= 3, `${c.n} – celkem ${c.celkem} vs LISA ${c.ocekC}`);
  }
  eq(r.map(c => c.pn), [0, 0, 0, 50, 0, 0, 0], "přirážka PN jen u smlouvy, kde PN tvoří přes polovinu pojistného");
  /* plán → rizika: jen jedna varianta invalidity (I.+II.+III. stupeň), PČ podle III. stupně, nejvýš 5 mil. Kč */
  const inv = await page.evaluate(() => { const fl = [], rows = FPE.generaliRizikaOsoby({ jmeno: "A", vstup: 37, hlavni: true, smrt: 7e6, smrtKonst: 9e5, smrtKonec: 65, inv: [4.1e6, 5.4e6, 7e6], invKonec: 67, pnDen: 0, maxKonec: 67 }, { smrt: "klesajici", inv: "klesajici" }, fl);
    const mala = FPE.generaliRizikaOsoby({ jmeno: "B", vstup: 30, hlavni: false, smrt: 0, inv: [1e6, 2e6, 3e6], invKonec: 65, pnDen: 0, maxKonec: 65 }, { inv: "konstantni" }, []);
    return { r: rows.filter(x => /^INV/.test(x.tarif)).map(x => [x.tarif, x.pc]), fl: fl.some(f => /nejvýš na 5 mil/.test(f)), m: mala.filter(x => /^INV/.test(x.tarif)).map(x => [x.tarif, x.pc]) }; });
  eq(inv.r, [["INV1-L", 5e6]], "jedna varianta invalidity, PČ omezená na 5 mil. Kč"); assert(inv.fl, "upozornění na limit 5 mil. Kč");
  eq(inv.m, [["INV1-K", 3e6]], "PČ invalidity podle potřeby na III. stupeň");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["NN × Kooperativa × UNIQA × Allianz × Generali: bez volby jde do plánu nejlevnější pojišťovna, ostatní jsou na slidu s logem a cenou; ruční volba; varianta se slevou za zdraví"] = async function () {
  const { ctx, page, errors } = await open();
  const rodina = { klient: { jmeno: "Jan Novák", narozen: "1989-05-05", zam: 55000, vydaje_osobni: 52000, vydaje_dom: 44000, starobni: 22000, inv1: 8000, inv2: 12000, inv3: 20000, vdovsky: 9000, sirotci: 7000, bez_partnera: false, hruba: 75000 },
    partner: { zapnuto: true, jmeno: "Eva Nováková", narozen: "1991-02-02", zam: 38000, starobni: 18000, inv1: 6000, inv2: 9000, inv3: 15000, vdovsky: 9000, sirotci: 7000, hruba: 52000 },
    deti: [{ jmeno: "Anička", narozen: "2018-04-01", vs: false }], motivace: "x", majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 300000 }], uvery: [{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }],
    cile: [{ nazev: "Auto", castka: 400000, za_let: 3 }], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: "" } } };
  const run = async poj => { await setPlan(page, Object.assign({}, rodina, { pojisteni: Object.assign({ zivotni: { stav: 0, navrh: "" } }, poj) }));
    return page.evaluate(() => { compute(); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/[  ]/g, " "); };
      const zp = FR.filter(f => /^zp\d$/.test(f.g) && !/FitSport|zdravý styl/.test(f.lbl)), alt = R.nnAlt;
      return { poj: R.nn.pojistovna, alt: alt.pojistovna, c: R.nn.celkem, a: alt.celkem, nove: R.pojNove, auto: R.pojAuto, kompl: R.nn.kompletni && alt.kompletni, volba: R.nn.volba,
        sum: R.nn.osoby.reduce((s, x) => s + x.rizika.reduce((b, r) => b + (r.mes || 0), 0), 0), lbl: FR.map(f => f.lbl), zp: zp.map(f => t(f.h)),
        logo: zp.every(f => f.h.includes(pojInfo(R.nn).logo()) && R.nnAlts.every(a => f.h.includes(pojInfo(a).logo()))), nAlt: R.nnAlts.length, altPer: R.pojOsAlt.dosp, altsPer: R.pojOsAlts.map(o => o.dosp), altsDeti: R.pojOsAlts.map(o => o.deti[0]), poradi: [R.nn.celkem].concat(R.nnAlts.map(a => a.celkem)), deti: t(FR.find(f => f.g === "deti").h), detiAlt: R.pojOsAlt.deti[0],
        fit: R.nnFit && { koop: R.nnFit.pojistovna, c: R.nnFit.celkem, zzs: R.nnFit.osoby.filter(o => !o.dite).every(o => o.zzs) },
        bad: FR.filter(f => /Infinity|NaN|undefined/.test(f.h.replace(/<style[\s\S]*?<\/style>/g, ""))).map(f => f.lbl) }; }); };
  const k = v => v.toLocaleString("cs-CZ").replace(/\s/g, " ");
  const a = await run({});
  eq(a.volba, "auto", "bez volby automaticky"); assert(a.kompl, "obě pojišťovny spočítané"); assert(a.auto, "automatické pojistné");
  assert(a.c <= a.a, "do plánu jde levnější (" + a.poj + " " + a.c + " ≤ " + a.alt + " " + a.a + ")"); eq(a.nove, a.c, "pojistné v plánu = levnější pojišťovna"); eq(a.c, a.sum, "celkem = součet řádků");
  eq(a.nAlt, 4, "srovnání se čtyřmi dalšími pojišťovnami"); eq(a.poradi, a.poradi.slice().sort((x, y) => x - y), "do plánu nejlevnější, ostatní seřazené podle ceny");
  assert(a.logo, "na slidu logo vybrané i ostatních pojišťoven"); a.zp.forEach((t, i) => a.altsPer.forEach(p => assert(t.includes("Pro srovnání") && t.includes(k(p[i]) + ",–"), "cena další pojišťovny za osobu na slidu " + i)));
  a.altsDeti.forEach(c => assert(a.deti.includes(k(c) + " Kč / měs"), "slide dětí: cena u další pojišťovny")); eq(a.bad, [], "bez Infinity / NaN / undefined");
  for (const v of ["nn", "koop", "uniqa", "allianz", "generali"]) {
    const m = await run({ pojistovna: v });
    eq([m.poj, m.alt !== v, m.volba], [v, true, v], "ruční volba " + v); eq(m.nove, m.c, "pojistné v plánu = zvolená pojišťovna " + v);
    assert(m.zp.every(t => t.includes({ nn: "NN Orange Risk", koop: "Kooperativa FLEXI", uniqa: "UNIQA Život & radost", allianz: "Allianz ŽIVOT", generali: "Generali Bel Mondo 20" }[v])), "název zvolené pojišťovny na slidu");
    if (v === "nn") assert(m.lbl.some(l => /FitSport/.test(l)) && !m.lbl.some(l => /zdravý styl/.test(l)), "NN: varianta FitSport");
    else if (["uniqa", "allianz", "generali"].includes(v)) assert(!m.fit && !m.lbl.some(l => /FitSport|zdravý styl/.test(l)), v + ": bez varianty se slevou za zdraví");
    else { assert(m.lbl.some(l => /zdravý styl/.test(l)) && !m.lbl.some(l => /FitSport/.test(l)), "Kooperativa: varianta se slevou za zdravý životní styl");
      assert(m.fit.koop === "koop" && m.fit.zzs && m.fit.c < m.c, "varianta se slevou za zdravý styl je levnější (" + m.fit.c + " < " + m.c + ")"); }
  }
  const z = await run({ pojistovna: "koop" }).then(async () => { await setPlan(page, Object.assign({}, rodina, { klient: Object.assign({}, rodina.klient, { koop_zzs: true }), partner: Object.assign({}, rodina.partner, { koop_zzs: true }), pojisteni: { zivotni: { stav: 0, navrh: "" }, pojistovna: "koop" } }));
    return page.evaluate(() => { compute(); return { fit: !!R.nnFit, zzs: R.nn.zzs, lbl: FR.map(f => f.lbl) }; }); });
  eq([z.fit, z.zzs], [false, true], "se splněným dotazníkem jde sleva rovnou do plánu a variantu už neukazuje");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["Kooperativa: sleva za zdravý životní styl +5 % jen na smrt a invaliditu dospělých a jen se slevou za komplexní rozsah; do součtu PČ jen pojištění do konce smlouvy nebo aspoň na 10 let"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => {
    const os = zzs => [{ jmeno: "A", vek: 40, maxKonec: 65, zzs, rizika: FPE.koopRizikaOsoby({ jmeno: "A", vstup: 40, hlavni: true, smrt: 2e6, smrtKonec: 65, inv: [0, 0, 2e6], invKonec: 65, pnDen: 500, maxKonec: 65 }, {}, []) }];
    const b = FPE.koopOcen(os(false), []), z = FPE.koopOcen(os(true), []);
    const pct = R => Object.fromEntries(R.osoby[0].rizika.map(x => [x.tarif, x.slevaPct]));
    const male = FPE.koopOcen([{ jmeno: "B", vek: 30, maxKonec: 65, zzs: true, rizika: FPE.koopRizikaOsoby({ jmeno: "B", vstup: 30, hlavni: true, smrt: 3e5, smrtKonec: 65, inv: [0, 0, 5e5], invKonec: 65, pnDen: 0, maxKonec: 65 }, {}, []) }], []);
    /* smrt jen na 6 let (do 46) – do součtu PČ se nepočítá */
    const kratka = FPE.koopOcen([{ jmeno: "C", vek: 40, maxKonec: 65, rizika: FPE.koopRizikaOsoby({ jmeno: "C", vstup: 40, hlavni: true, smrt: 3e6, smrtKonec: 46, inv: [0, 0, 0], invKonec: 65, pnDen: 0, maxKonec: 65 }, { smrt: "kratsi" }, []) }], []);
    return { b: pct(b), z: pct(z), cb: b.celkem, cz: z.celkem, male: [male.sleva, male.zzs, pct(male)], kr: [kratka.rozhodne, kratka.sleva] };
  });
  eq(r.b, { ZAKL: 0, "SMRT-L": 10, "INV3-L": 10, PN29: 10, TNU10: 10 }, "bez dotazníku jen komplexní rozsah");
  eq(r.z, { ZAKL: 0, "SMRT-L": 15, "INV3-L": 15, PN29: 10, TNU10: 10 }, "s dotazníkem +5 % na smrt a invaliditu");
  assert(r.cz < r.cb, "se slevou za zdravý styl je pojistné nižší");
  eq(r.male[0], 0, "malá smlouva bez slevy za komplexní rozsah"); eq(r.male[1], false, "bez komplexní slevy nejde ani sleva za zdravý styl"); eq(r.male[2]["SMRT-L"], 0, "smrt bez slevy");
  eq(r.kr, [10000, 0], "smrt na 6 let se do součtu PČ nepočítá");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["pojistné za osobu: SOCKO, modelace i realizace jen za danou osobu; hlavní pojištěný = muž; FitSport i při ručním / nulovém pojistném"] = async function () {
  const { ctx, page, errors } = await open();
  const rodina = { klient: { jmeno: "Jana Dvořáková", narozen: "1990-03-03", zam: 40000, vydaje_osobni: 30000, vydaje_dom: 25000, inv1: 7000, inv2: 10000, inv3: 16000, vdovsky: 9000, sirotci: 7000, hruba: 52000, starobni: 18000 },
    partner: { zapnuto: true, jmeno: "Karel Dvořák", narozen: "1988-05-05", zam: 62000, vydaje_osobni: 40000, vydaje_dom: 30000, inv1: 9000, inv2: 13000, inv3: 22000, vdovsky: 9000, sirotci: 7000, hruba: 85000, starobni: 24000 },
    deti: [{ jmeno: "Ema", narozen: "2019-02-01" }], motivace: "x", majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 450000 }], uvery: [{ nazev: "Hypotéka", zustatek: 3000000, splatka: 18000 }], cile: [], renta: { mesicne: 0 }, pojisteni: { stavajici: 0, navrh: 0 } };
  await setPlan(page, rodina);
  const t = await page.evaluate(() => { compute(); const tx = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/\s+/g, " "); };
    const soc = g => { const f = FR.filter(x => x.g === g); return tx(f[f.length - 1].h); };
    return { hl: R.nn.hlavni, auto: R.pojAuto, po: R.pojOs, lbl: FR.map(f => f.lbl), soc0: soc("soc0"), soc1: soc("soc1"), real: tx(FR.find(f => f.lbl === "Realizace").h), zp1: tx(FR.find(f => f.lbl === "ŽP Karel").h),
      smtv: R.nn.dospeli.map(o => o.rizika.some(r => r.tarif === "SMTV-P2R")) }; });
  eq(t.hl, 1, "hlavní pojištěný je muž (partner Karel), i když klientkou je Jana"); eq(t.smtv, [true, true], "konstantní smrt: u hlavního aspoň povinné minimum, u druhého pojištěného 1× roční příjem");
  assert(t.auto, "navržené pojistné 0 = automatický výpočet NN");
  const i = t.lbl.indexOf("ŽP Karel"); eq(t.lbl[i + 1], "ŽP Karel – FitSport", "FitSport hned za modelací hlavního pojištěného"); assert(!t.lbl.includes("ŽP Jana – FitSport"), "FitSport jen u hlavního");
  const k = v => v.toLocaleString("cs-CZ").replace(/\s/g, " ");
  assert(t.soc0.includes(k(t.po.dosp[0]) + " Kč/měs") && !t.soc0.includes(k(t.po.celkem) + " Kč/měs"), "SOCKO Jany = jen její pojistné: " + k(t.po.dosp[0]) + " | " + t.soc0.replace(/\s+/g, " ").slice(150, 500));
  assert(t.soc1.includes(k(t.po.dosp[1]) + " Kč/měs") && /jen Karel/.test(t.soc1), "SOCKO Karla = jen jeho pojistné");
  assert(t.zp1.includes("Měsíční pojistné – Karel") && t.zp1.includes(k(t.po.dosp[1]) + ",–"), "modelace Karla = jeho pojistné");
  assert(t.real.includes("Jana " + k(t.po.dosp[0])) && t.real.includes("Karel " + k(t.po.dosp[1])) && t.real.includes("děti " + k(t.po.detiCelkem)), "realizace po osobách");
  /* ručně zadané pojistné: FitSport se ukáže taky a pojistné se rozdělí poměrem výpočtu NN */
  await setPlan(page, Object.assign({}, rodina, { pojisteni: { zivotni: { stav: 0, navrh: 2600 } } }));
  const m = await page.evaluate(() => { compute(); return { lbl: FR.map(f => f.lbl), po: R.pojOs, poj: R.pojNove }; });
  assert(m.lbl.includes("ŽP Karel – FitSport"), "FitSport i s ručním pojistným"); eq(m.po.celkem, 2600, "celkem ručně");
  assert(Math.abs(m.po.dosp[0] + m.po.dosp[1] + m.po.detiCelkem - 2600) <= 2, "rozdělení sedí na součet");
  /* ruční volba hlavního pojištěného */
  await setPlan(page, Object.assign({}, rodina, { pojisteni: { nn_hlavni: "klient", stavajici: 0, navrh: 0 } }));
  eq(await page.evaluate(() => { compute(); return R.nn.hlavni; }), 0, "ručně klientka");
  eq(await page.evaluate(() => [FPE.zena({ jmeno: "Jana Dvořáková" }), FPE.zena({ jmeno: "Karel Dvořák" }), FPE.zena({ jmeno: "Nikola Svoboda" }), FPE.zena({ jmeno: "Eva Malá" }), FPE.zena({ jmeno: "Ing. Lucie Nová" })]), [true, false, false, true, true], "odhad pohlaví ze jména");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["produkty v automatickém návrhu: poslední změna = výchozí pro další nové plány"] = async function () {
  const { ctx, page, errors } = await open();
  await page.evaluate(() => { localStorage.removeItem(PDK); goStep(5); });
  await page.selectOption('[data-p="nastaveni.dip_prod"]', { index: 1 });
  const zvoleno = await page.$eval('[data-p="nastaveni.dip_prod"]', s => s.value);
  await page.click('[data-add="nastaveni.mixA"]');
  const def = await page.evaluate(() => JSON.parse(localStorage.getItem(PDK)));
  eq(def.dip_prod, zvoleno, "uložený výchozí DIP"); eq(def.mixA.length, 2, "uložená akciová složka (2 řádky)");
  await page.click("#bNew");
  const nove = await page.evaluate(() => ({ dip: inp().nastaveni.dip_prod, a: inp().nastaveni.mixA.length }));
  eq(nove, { dip: zvoleno, a: 2 }, "nový plán převzal výchozí produkty");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["rezervace: živá kontrola kalendáře skryje obsazené časy, termín se při rezervaci zablokuje (obsazený → vybrat jiný), blokace jde v šifrované zprávě"] = async function () {
  const { ctx, page, errors } = await open();
  const DZ = FP.replace("fp.html", "dotaznik.html"), BKU = "https://script.google.com/macros/s/TEST/exec";
  await page.goto(DZ); const key = await page.evaluate(() => DzCrypto.genKey());
  const d = new Date(Date.now() + 3 * 864e5); d.setHours(9, 0, 0, 0); const t1 = d.toISOString(), t2 = new Date(d.getTime() + 2 * 3600e3).toISOString(), t3 = new Date(d.getTime() + 4 * 3600e3).toISOString();
  const doc = { fields: { slots: { arrayValue: { values: [t1, t2, t3].map(x => ({ stringValue: x })) } }, len: { integerValue: "45" }, bk: { stringValue: BKU } } };
  const posts = [], calls = [];
  await ctx.route(/firestore\.googleapis\.com/, async r => { if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(doc) }); posts.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  let nBook = 0;
  await ctx.route(/script\.google\.com/, async r => { const o = JSON.parse(r.request().postData() || "{}"); calls.push(o);
    if (o.a === "busy") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, busy: [[Date.parse(t2) - 10 * 60000, Date.parse(t2) + 30 * 60000]], len: 45, buf: 15 }) });
    nBook++; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(nBook === 1 ? { ok: false, err: "busy" } : { ok: true, id: "hold123" }) }); });
  await page.goto(DZ + "#v=1&to=poradce%40example.cz&k=" + key.pub + "&m=r"); await page.reload(); await page.waitForTimeout(800);
  const times = await page.$$eval("[data-time]", b => b.map(x => x.dataset.time));
  eq([times.includes(t1), times.includes(t2), times.includes(t3)], [true, false, true], "obsazený čas z kalendáře se nenabízí");
  await page.evaluate(() => { const c = { jmeno: "Jan Testovací", email: "jan@example.cz", telefon: "777111222" }; Object.assign(BK.c, c); });
  await page.click(`[data-time="${t1}"]`); await page.click('[data-mode="osobne"]'); await page.click("#bBook"); await page.waitForTimeout(600);
  assert((await page.textContent("main")).includes("mezitím někdo obsadil"), "obsazený termín → hláška");
  eq(posts.length, 0, "bez blokace se rezervace neodeslala");
  await page.click(`[data-time="${t3}"]`); await page.click('[data-mode="osobne"]');
  const sealed = await page.evaluate(() => new Promise(res => { const o = DzCrypto.seal; DzCrypto.seal = (k, x) => { res(x); return o(k, x) }; document.getElementById("bBook").click() }));
  eq([sealed.start, sealed.hold], [t3, "hold123"], "zablokovaný termín v šifrované zprávě");
  await page.waitForTimeout(600); assert(posts.length > 0 && (await page.textContent("main")).includes("zarezervovaný"), "rezervace odeslaná");
  eq(calls.filter(c => c.a === "book").map(c => c.start), [t1, t3], "blokace volaná s vybraným časem");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["dotazník: povinné vyplnění (skok na chybějící), výpočet rodičovské, šifrované odeslání, které přečte jen klíč poradce; sloučení s plánem"] = async function () {
  const { ctx, page, errors } = await open();
  const DZ = FP.replace("fp.html", "dotaznik.html");
  await page.goto(DZ); const key = await page.evaluate(() => DzCrypto.genKey());
  const posts = []; await ctx.route(/firestore\.googleapis\.com/, async r => { if (r.request().method() === "GET") return r.fulfill({ status: 404, body: "{}" }); posts.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.goto(DZ + "#v=1&to=poradce%40example.cz&k=" + key.pub + "&p=Vojt%C4%9Bch%20Kudli%C4%8Dka"); await page.reload();
  assert((await page.textContent("main")).includes("Vojtěch Kudlička"), "poradce z odkazu");
  await page.click("#bSend"); await page.waitForTimeout(400);
  eq(posts.length, 0, "neúplný dotazník se neodešle"); assert(/Ještě chybí/.test(await page.textContent("#toast")), "upozornění na chybějící údaj");
  const f = (p, v) => page.fill(`[data-p="${p}"]`, v), seg = (p, v) => page.click(`[data-seg="${p}"][data-v="${v}"]`);
  await page.selectOption('[data-p="kontakt.stav"]', "svobodny"); await seg("klient.bez_partnera", "true"); await seg("kontakt.deti_ma", "true");
  await page.click('[data-add="deti"]'); await f("deti.0.jmeno", "Ema"); await f("deti.0.narozen", "2025-06-01");
  await f("klient.jmeno", "Petr Malý"); await f("klient.narozen", "1990-01-01"); await f("kontakt.telefon", "777 111 222"); await f("kontakt.email", "petr@example.cz");
  await f("motivace", "Chci mít klid a rezervu pro rodinu."); await f("klient.zam", "48000"); await page.locator('[data-p="klient.zam"]').blur(); await f("klient.hruba", "65000");
  await seg("kontakt.docasne_ma", "true"); await page.click('[data-add="docasne"]'); await page.selectOption('[data-p="docasne.0.typ"]', "rodicovska"); await page.selectOption('[data-p="docasne.0.dite"]', "0"); await f("docasne.0.castka", "15000");
  eq(await page.inputValue('[data-p="docasne.0.do"]'), "2027-11", "rodičovská: konec mateřské (22 týdnů po porodu) + 350 000 / 15 000 = 24 měsíců");
  await f("klient.vydaje_osobni", "35000"); await f("klient.vydaje_dom", "20000");
  for (const q of ["majetek_ma", "nefin_ma", "uvery_ma", "cile_ma", "zp_ma"]) await seg("kontakt." + q, "false");
  await seg("kontakt.renta_ma", "true"); await f("renta.mesicne", "25000");
  /* nové otázky: pro koho je plán, bydlení, pracovní status → povolání, sporty s úrovní */
  await page.click('[data-seg="kontakt.plan_pro"]:has-text("Jen pro mě")'); await seg("kontakt.hypo_ma", "false");
  await page.selectOption('[data-p="klient.prace"]', "zam"); await f("klient.povolani", "programátor"); await seg("klient.sport_ma", "true");
  await page.click('[data-add="klient.sporty"]'); await f("klient.sporty.0.nazev", "Fotbal"); await page.selectOption('[data-p="klient.sporty.0.uroven"]', "registrovane");
  eq(await page.$$eval("section h2", h => h.map(x => x.textContent.replace(/^\d+|✓$/g, ""))), ["Co je pro vás důležité", "Cíle", "Úspory a investice", "Nemovitosti a jiný majetek", "Úvěry", "Pojištění, práce a sport", "Výdaje", "Příjmy", "Rodina", "Něco dalšího?", "Kontakt na vás"], "pořadí částí: výdaje před příjmy, kontakt na konci");
  await page.click("#bSend"); await page.waitForTimeout(400); eq(posts.length, 0, "bez IOLDP se neodešle");
  assert(/IOLDP/.test(await page.textContent("#toast")), "upozornění na IOLDP");
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-ioldp="klient"]')]); await fc.setFiles({ name: "ioldp.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.click("#bSend"); await page.waitForFunction(() => /Odesláno/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
  assert(posts.length >= 1 && !JSON.stringify(posts).includes("Malý") && !JSON.stringify(posts).includes("petr@"), "do schránky jde jen šifrový text");
  eq(posts[0].fields.to.stringValue, "poradce@example.cz", "schránka poradce");
  const F = posts[0].fields;
  const x = await page.evaluate(([priv, b]) => DzCrypto.open(priv, b), [key.priv, { epk: F.epk.stringValue, salt: F.salt.stringValue, iv: F.iv.stringValue, ct: posts.map(p => p.fields.ct.stringValue).join("") }]);
  eq([x.plan.klient.jmeno, x.plan.klient.zam, x.files.length, x.files[0].who], ["Petr Malý", 48000, 1, "klient"], "obsah po dešifrování klíčem poradce");
  eq([x.plan.klient.prace, x.plan.klient.povolani, x.plan.klient.sporty], ["zam", "programátor", [{ nazev: "Fotbal", uroven: "registrovane" }]], "práce, povolání a sporty v dotazníku");
  const other = await page.evaluate(() => DzCrypto.genKey());
  const bad = await page.evaluate(([priv, b]) => DzCrypto.open(priv, b).then(() => "otevřel", () => "nejde"), [other.priv, { epk: F.epk.stringValue, salt: F.salt.stringValue, iv: F.iv.stringValue, ct: posts.map(p => p.fields.ct.stringValue).join("") }]);
  eq(bad, "nejde", "cizím klíčem nejde přečíst");
  eq(await page.evaluate(() => localStorage.getItem("fp_dotaznik_draft_v1")), null, "po odeslání se koncept smaže");
  await page.goto(FP); await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function" && window.FP_SAZBY_OK === true);
  const r = await page.evaluate(D => { const I = JSON.parse(JSON.stringify(inp())); I.klient.inv3 = 20000; mergeDz(I, D); I.pojisteni = Object.assign({}, I.pojisteni, { pojistovna: "nn" }); const N = FPE.compute(I, new Date()).nn; return { j: I.klient.jmeno, zam: I.klient.zam, inv3: I.klient.inv3, bez: I.klient.bez_partnera, doc: I.docasne[0].typ, sp: I.klient.sporty.length, rs: N && N.osoby[0].rs };
  }, x.plan);
  eq([r.j, r.zam, r.inv3, r.bez, r.doc, r.sp, r.rs], ["Petr Malý", 48000, 20000, true, "rodicovska", 1, 2], "sloučení s plánem (IOLDP z plánu zůstává; registrovaný fotbal = RS 2 automaticky)");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["DPS: státní příspěvek 20 % z vlastního vkladu 500–1 700 Kč (max. 340 Kč) se počítá do hodnoty DPS v rentě"] = async function () {
  const { ctx, page, errors } = await open();
  eq(await page.evaluate(() => [400, 500, 1000, 1700, 3000].map(FPE.dpsStatni)), [0, 100, 200, 340, 340], "příspěvek");
  const base = { klient: { jmeno: "Jan Novák", narozen: "1985-01-01", zam: 50000, vydaje_osobni: 30000, inv1: 8000, inv2: 12000, inv3: 20000, starobni: 18000, bez_partnera: true, hruba: 70000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [], renta: { mesicne: 30000, od_veku: "" } };
  const run = async v => { await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 300000 }, { typ: "Doplňkové penzijní spoření (DPS)", nazev: "DPS", hodnota: 100000, vklad: v }] })); return page.evaluate(() => { compute(); return { p: R.dpsPrisp, fv: R.renta && R.renta.dpsFv }; }); };
  const a = await run(1000), b = await run(400);
  eq([a.p, b.p], [200, 0], "příspěvek v plánu"); assert(a.fv > b.fv, "vyšší vklad + příspěvek = víc v DPS");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["vynechat slide: checkbox u každého slidu, vynechaný se nezobrazí v prezentaci/PDF/PPTX a volba se uloží do plánu"] = async function () {
  const { ctx, page, errors } = await open();
  const n0 = await page.evaluate(() => FR.length);
  assert(n0 > 3, "plán má víc slidů");
  eq(await page.locator("#thumbs input.skp").count(), n0, "checkbox u každého slidu");
  await page.locator("#thumbs input.skp").nth(1).check();
  const r = await page.evaluate(() => ({ sk: FR.map(f => f.skip), vis: visFR().length, saved: Object.keys(inp().vynechat || {}), cur: $("#skipCur").checked }));
  eq([r.sk[1], r.vis, r.saved.length], [true, n0 - 1, 1], "vynechán 1 slide");
  await page.reload();
  await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function" && window.FP_SAZBY_OK === true);
  eq(await page.evaluate(() => FR[1].skip), true, "volba přežije reload");
  await page.evaluate(() => { cur = 0; startPres(); });
  await page.evaluate(() => go(1));
  eq(await page.evaluate(() => cur), 2, "prezentace přeskočí vynechaný slide");
  eq(await page.evaluate(() => $("#pc").textContent), `2 / ${n0 - 1}`, "počítadlo jen z viditelných");
  await page.evaluate(() => stopPres());
  await page.locator("#thumbs input.skp").nth(1).uncheck();
  eq(await page.evaluate(() => visFR().length), n0, "po odškrtnutí zpět");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["ponechat produkt: celé / část (účet i fond) zůstane mimo plán, zbytek se převede; editor má volbu u každé položky"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Jan Novák", narozen: "1985-01-01", zam: 50000, vydaje_osobni: 30000, inv1: 8000, inv2: 12000, inv3: 20000, starobni: 18000, bez_partnera: true, hruba: 70000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [], renta: { mesicne: 30000, od_veku: "" } };
  const run = async fond => { await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 700000 }, Object.assign({ typ: "Podílový fond (OPF)", nazev: "Fond A", hodnota: 300000 }, fond)] })); return page.evaluate(() => { compute(); const f = R.produkty.find(x => x.nazev === "Fond A"); return { zust: f.zust, korZ: f.korZ, pozn: f.pozn, zbyva: R.zbyva, rv: R.renta ? R.renta.vklad : 0, rs: R.renta ? R.renta.splneni : 0, tx: R.transakce.filter(t => t.z === "Fond A").reduce((a, t) => a + t.castka, 0), nove: R.struktura.nove.reduce((a, b) => a + b, 0), flags: R.flags.filter(x => /Ponecháno/.test(x)).length }; }); };
  const std = await run({}), cast = await run({ nech: "cast", nech_kc: 100000 }), vse = await run({ nech: "vse" });
  eq([std.zust, std.korZ], [0, -300000], "bez volby se fond převede celý");
  eq([cast.zust, cast.korZ, cast.tx, cast.flags], [100000, -200000, 200000, 1], "nechat částku 100 000 → převede se 200 000");
  eq([vse.zust, vse.korZ, vse.tx], [300000, 0, 0], "nechat být → nic se nepřevádí");
  assert(vse.rv <= std.rv && vse.rs <= 1.06 && std.rs <= 1.06, "nechaný fond nepřidá do plánu další peníze; renta ≈ 100 % (" + vse.rs + ", " + std.rs + ")");
  assert(Math.abs(cast.nove - std.nove) < 2000, "celkový majetek po realokaci se nemění (kromě poplatků)");
  /* ponechání části účtu nad rezervou */
  await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 700000, nech: "cast", nech_kc: 650000 }] }));
  const ucet = await page.evaluate(() => { compute(); const s = R.produkty.find(x => x.nazev === "S"); return { zust: s.zust, pozn: s.pozn }; });
  assert(ucet.zust >= 650000, "na účtu zůstane aspoň ponechaná částka"); assert(/Ponechat/.test(ucet.pozn), "poznámka u produktu");
  /* editor: select „Co s produktem“ u každé položky finančního majetku */
  await page.evaluate(() => { goStep && goStep(1); });
  eq(await page.locator('select[data-p="majetek.0.nech"]').count(), 1, "volba v editoru");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["pravidelné vklady: jen do akcií (výchozí) nebo dle optimálního rozložení; checkbox DIP zapíná/vypíná DIP a daňovou úlevu"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Jan Novák", narozen: "1985-01-01", zam: 70000, vydaje_osobni: 30000, inv1: 8000, inv2: 12000, inv3: 20000, starobni: 18000, bez_partnera: true, hruba: 90000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], majetek: [], cile: [{ nazev: "Auto", castka: 600000, za_let: 6 }], renta: { mesicne: 40000, od_veku: 65 } };
  const run = async re => { await setPlan(page, Object.assign({}, base, { realokace: re })); return page.evaluate(() => { compute(); const mes = R.pozice.filter(p => p.mesicne > 0); const cls = i => mes.reduce((a, p) => a + p.mesicne * p.s[i] / 100, 0); return { sum: mes.reduce((a, p) => a + p.mesicne, 0), pmt: R.pmtCelkem, A: cls(0), D: cls(1), H: cls(2), dipPoz: R.pozice.filter(p => p.dip).reduce((a, p) => a + p.mesicne, 0), dip: R.dip, dan: R.renta ? R.renta.danCelkem : 0, nadpis: R.pozice.some(p => p.dip) }; }); };
  const std = await run({}), opt = await run({ mes: "opt" }), noDip = await run({ dip: false }), optNoDip = await run({ mes: "opt", dip: false });
  assert(std.pmt > 1000, "plán má pravidelné platby");
  eq([Math.round(std.D), Math.round(std.H)], [0, 0], "výchozí: měsíčně jen akcie");
  assert(std.dipPoz > 0 && std.dan > 0, "DIP je ve výchozím nastavení zapnutý");
  assert(opt.D > 0, "optimální rozložení: část měsíčně jde do dluhopisů");
  assert(Math.abs(opt.sum - opt.pmt) <= 5, "součet vkladů = platba plánu");
  assert(opt.A < std.A && opt.dipPoz <= opt.A + 1, "DIP je jen z akciové části");
  eq([noDip.dipPoz, noDip.dip, noDip.dan, noDip.nadpis], [0, 0, 0, false], "DIP vypnutý: žádný DIP produkt ani daňová úleva");
  assert(Math.abs(noDip.sum - noDip.pmt) <= 5 && Math.abs(optNoDip.sum - optNoDip.pmt) <= 5, "součty sedí i bez DIP");
  eq(optNoDip.dipPoz, 0, "optimum bez DIP");
  /* editor: volba + checkbox; načtení ručního návrhu volby zachová */
  await setPlan(page, Object.assign({}, base, { realokace: { mes: "opt", dip: false } }));
  for (let i = 0; i < 12 && !(await page.locator('select[data-p="realokace.mes"]').count()); i++) await page.evaluate(n => goStep(n), i);
  eq(await page.locator('select[data-p="realokace.mes"]').count(), 1, "select v editoru");
  eq(await page.locator('input[data-p="realokace.dip"]').count(), 1, "checkbox DIP v editoru");
  eq(await page.evaluate(() => { loadAuto(); return [inp().realokace.mes, inp().realokace.dip]; }), ["opt", false], "loadAuto zachová volby");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["cíl 100 %: renta nebere víc, než potřebuje (zbytek zůstane nealokován); platba se zaokrouhluje jemně"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 30000, vydaje_osobni: 17000, inv1: 0, inv2: 0, inv3: 0, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [], renta: { mesicne: 30000, od_veku: 67 } };
  for (const fond of [80000, 400000, 1500000]) {
    await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Podílový fond (OPF)", hodnota: fond }] }));
    const r = await page.evaluate(() => { compute(); return { spl: R.renta.splneni, vklad: R.renta.vklad, pmt: R.renta.pmt, zbyva: R.zbyva }; });
    assert(r.spl >= 0.6 && r.spl <= 1.05, `renta vychází na ~100 % (fond ${fond}: ${r.spl}); platby pod 500 Kč se nedávají, takže i méně`);
    assert(Number.isInteger(r.pmt) && r.pmt >= 0, `platba renty v celých korunách (${r.pmt})`);
    assert(r.spl >= 0.95 && r.spl < 1.08, `renta ~100 % – bez drobné platby pod 500 Kč (${r.spl})`);
    assert(r.pmt === 0 || r.pmt >= 500, `žádná platba pod 500 Kč (${r.pmt})`);
    if (fond >= 400000) assert(r.zbyva > 0 && r.pmt === 0, "co renta nepotřebuje, zůstane nealokováno (" + r.zbyva + ")");
  }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["ponechaný produkt se dál počítá v plánu; checkbox „nechat úložku“ nechá měsíční vklad běžet z cash flow"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "1990-06-01", zam: 40000, vydaje_osobni: 20000, inv1: 0, inv2: 0, inv3: 0, starobni: 16000, bez_partnera: true, hruba: 50000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [], renta: { mesicne: 30000, od_veku: 67 } };
  const run = async f => { await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Běžný účet", hodnota: 140000 }, Object.assign({ typ: "Podílový fond (OPF)", nazev: "F", hodnota: 300000, vklad: 2000 }, f)] })); return page.evaluate(() => { compute(); return { pmt: R.renta.pmt, vklad: R.renta.vklad, spl: R.renta.splneni, keepVal: R.renta.keepVal, keepMes: R.renta.keepMes, cfZ: R.cfZbyva, ok: R.cf }; }); };
  const std = await run({}), vse = await run({ nech: "vse" }), ul = await run({ nech: "vse", nech_mes: 2000 });
  eq([std.keepVal, std.keepMes], [0, 0], "bez volby se nic neponechává");
  eq([vse.keepVal, vse.keepMes], [300000, 0], "nechat být: zůstatek se počítá, vklad ne");
  eq([ul.keepVal, ul.keepMes], [300000, 2000], "s checkboxem běží i úložka");
  assert(vse.spl >= 0.995 && vse.spl <= 1.05, "nechaný zůstatek: renta ~100 % (" + vse.spl + ")");
  assert(ul.spl >= 0.995 && ul.pmt < vse.pmt, "ponechaná úložka pracuje pro rentu (renta potřebuje nejvýš tolik platby jako bez úložky)");
  assert(ul.cfZ <= vse.cfZ, "úložka se odečítá z cash flow (" + ul.cfZ + " vs " + vse.cfZ + ")");
  await run({ nech: "vse" });
  eq(await page.locator('input[data-p^="majetek."][data-p$=".nech_mes"]').count() >= 0, true, "editor se vykreslí");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["výnosy a poplatky produktů: rozbalovací skupiny podle správce, úprava hodnoty funguje"] = async function () {
  const { ctx, page, errors } = await open();
  await page.evaluate(() => { goStep(5); });
  const g = await page.evaluate(() => [...document.querySelectorAll("details.pgrp")].map(d => [d.dataset.grp, d.open]));
  assert(g.length >= 5 && g.every(x => x[1] === false), "skupiny jsou sbalené: " + JSON.stringify(g));
  assert(g.some(x => x[0] === "Conseq") && g.some(x => x[0] === "ZFP WI"), "podle správce");
  await page.locator('details.pgrp[data-grp="Conseq"] > summary').click();
  const inp0 = page.locator('details.pgrp[data-grp="Conseq"] input[data-p="nastaveni.prod.cq_akc.vynos"]');
  await inp0.fill("9"); await inp0.blur();
  eq(await page.evaluate(() => (inp().nastaveni.prod.cq_akc || {}).vynos != null), true, "hodnota se uloží");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["uvolnění platby po splnění cíle: krok s animací zpět do cash flow; šipky přeskočí vynechané slidy; ‚dle rozložení‘ jen akcie+dluhopisy; bez životka při vynechaných ŽP; dál spořit v návrhu realokace"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 28000, vydaje_osobni: 15000, inv1: 6000, inv2: 8000, inv3: 12000, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [{ nazev: "Start podnikání", castka: 250000, za_let: 10 }, { nazev: "Akontace na bydlení", castka: 1500000, za_let: 15 }], renta: { mesicne: 30000, od_veku: 67 } };
  const maj = [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Doplňkové penzijní spoření (DPS)", hodnota: 143000, vklad: 500 }];
  await setPlan(page, Object.assign({}, base, { majetek: maj }));
  const o = await page.evaluate(() => { compute(); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/ /g, " "); }; const P = FR.filter(f => f.g === "p");
    return { lbl: P.map(f => f.lbl), txt: P.filter(f => f.lbl === "Plán: uvolnění platby").map(f => t(f.h)) }; });
  assert(o.lbl.filter(l => l === "Plán: uvolnění platby").length >= 2, "uvolnění platby u obou cílů (za 10 a 15 let; u renty jen když má platbu ≥ 500 Kč): " + o.lbl.join("|"));
  assert(/za 10 let\) uvolní zpět do cash flow/.test(o.txt[0]) && /za 15 let\) uvolní zpět do cash flow/.test(o.txt[1]), "popis: za X let se platba vrací do cash flow (chronologicky 10 → 15 → …)");
  assert(/(po splnění|✓ splněno) → zpět do cash flow/.test(o.txt[1]), "u řádku cíle je poznámka");
  /* šipky přeskočí vynechané slidy (i mimo celou obrazovku) */
  const sk = await page.evaluate(() => { cur = 0; toggleSkip(1, true); cur = 0; update(); go(1); const a = cur; return [a, FR[1].skip]; });
  eq(sk, [2, true], "šipka vpřed přeskočí vynechaný slide");
  eq(await page.evaluate(() => { go(-1); return cur; }), 0, "šipka zpět přeskočí vynechaný slide");
  /* pravidelné vklady dle rozložení: jen akcie + dluhopisy = 100 % */
  await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Běžný účet", hodnota: 300000 }], realokace: { mes: "opt", dip: false } }));
  const m = await page.evaluate(() => { compute(); const A = R.pozice.filter(p => p.mesicne > 0); return { sum: A.reduce((a, p) => a + p.mesicne, 0), hot: A.filter(p => { const d = FPE.PRODUKTY.find(x => x.k === p.k); return d && d.s[2] === 100; }).length, pmt: R.pmtCelkem }; });
  eq(m.hot, 0, "pravidelné vklady neobsahují hotovost"); assert(Math.abs(m.sum - m.pmt) <= 5, "součet = platba plánu");
  /* vynechané slidy životního pojištění → životko se do plánu nedává */
  await setPlan(page, Object.assign({}, base, { majetek: maj, pojisteni: { zivotni: { navrh: 3000 } } }));
  const z1 = await page.evaluate(() => { compute(); return R.pojNove; }); eq(z1, 3000, "s ŽP slidy je životko v plánu");
  const z2 = await page.evaluate(() => { for (const k of FR.filter(f => /^zp\d/.test(f.g)).map(f => f.key)) toggleSkip(FR.findIndex(f => f.key === k), true); compute(); return [R.pojNove, FR.filter(f => /^zp\d/.test(f.g)).length > 0]; });
  eq(z2, [0, true], "všechny ŽP slidy vynechané → bez životka (slidy zůstávají k odškrtnutí)");
  /* ponechaný produkt: dál spořit částku se propíše do návrhu realokace */
  await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Podílový fond (OPF)", nazev: "Fond X", hodnota: 200000, vklad: 3000, nech: "vse", nech_mes: 1500 }] }));
  const f = await page.evaluate(() => { compute(); const p = R.produkty.find(x => x.nazev === "Fond X"); return [p.mes, p.korV, /dál spořit/.test(p.pozn)]; });
  eq(f, [1500, -1500, true], "v tabulce realokace běží ponechaná úložka dál");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["datumy: pole type=date se změní na ruční zadání dd.mm.rrrr (.value zůstává rrrr-mm-dd), špatné datum se označí"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(async () => {
    const i = document.createElement("input"); i.type = "date"; i.value = "2026-03-05"; let ev = 0; i.addEventListener("input", () => ev++); i.addEventListener("change", () => ev += 10);
    document.body.appendChild(i); await new Promise(r => setTimeout(r, 50));
    const out = { typ: i.type, disp: i.getAttribute("type") === "text" ? "text" : "?", ph: i.placeholder };
    out.shown = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").get.call(i);
    const typ = t => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, t); i.dispatchEvent(new Event("input", { bubbles: true })); };
    typ("1.2.2026"); out.rozepsane = [i.value, ev];
    i.dispatchEvent(new Event("change", { bubbles: true })); i.dispatchEvent(new Event("blur")); out.norm = [i.value, Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").get.call(i)];
    typ("31.02.2026"); i.dispatchEvent(new Event("blur")); out.spatne = [i.value, i.style.outline !== ""];
    typ("070385"); out.kratke = i.value; i.value = "1999-12-31"; out.set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").get.call(i);
    return out; });
  eq([r.typ, r.shown], ["text", "05.03.2026"], "pole je textové a ukazuje dd.mm.rrrr");
  eq(r.rozepsane[0], "2026-02-01", "čte se ISO"); eq(r.rozepsane[1], 0, "rozepsané datum nevyvolá input v kódu okolo");
  eq(r.norm, ["2026-02-01", "01.02.2026"], "po opuštění se zformátuje na dd.mm.rrrr");
  eq(r.spatne, ["", true], "neplatné datum → prázdná hodnota a červený rámeček");
  eq([r.kratke, r.set], ["1985-03-07", "31.12.1999"], "zkrácený zápis ddmmrr, zápis z kódu");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["předání platby po splnění cíle: přes slide se protočí „za N let“ (jednou za rok), platba splněného cíle se vynuluje a přeteče do dalšího, kroky jdou chronologicky"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 28000, vydaje_osobni: 15000, inv1: 6000, inv2: 8000, inv3: 12000, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [],
    cile: [{ nazev: "Start podnikání", castka: 250000, za_let: 10 }, { nazev: "Akontace na bydlení", castka: 1500000, za_let: 15 }], renta: { mesicne: 30000 },
    majetek: [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Doplňkové penzijní spoření (DPS)", hodnota: 143000, vklad: 500 }], pojisteni: { zivotni: { navrh: 7400 } } };
  await setPlan(page, base);
  const o = await page.evaluate(() => { compute(); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/\u00a0/g, " "); };
    const P = FR.filter(f => f.g === "p");
    return { lbl: P.map(f => f.lbl), ffw: P.map(f => { const m = f.h.match(/class="ffw"[\s\S]*?class="big" style="--n:(\d+)"/); return m ? +m[1] : null; }),
      first: P.filter(f => f.lbl === "Plán: navazující platba").map(f => ({ ffwFirst: f.h.indexOf('class="ffw"') < f.h.indexOf("<style>"), txt: t(f.h), strike: /<s style/.test(f.h) })) }; });
  const yrs = o.ffw.filter(x => x != null);
  eq(yrs, [10, 15], "overlay „za N let“ jen u prvního kroku každého roku, chronologicky: " + o.lbl.join("|"));
  assert(o.first.every(f => f.ffwFirst), "overlay je první prvek snímku (aby ~ zdržel morph tabulky)");
  assert(/✓ splněno → Akontace na bydlení/.test(o.first[0].txt) && o.first[0].strike, "po splnění cíle se jeho platba přeškrtne a vynuluje, řádek ukazuje kam teče");
  assert(/za 10 let: [\d ]+ \+ [\d ]+ = [\d ]+ Kč\/měs/.test(o.first[0].txt), "cíl, do kterého platba teče, ukazuje vlastní + přiteklá = celkem");
  /* overlay se nevypisuje do miniatur a exportu (nemá data-k, je skrytý v .mini) a nezablokuje ovládání */
  const css = await page.evaluate(() => { const e = document.createElement("div"); e.innerHTML = '<div class="thumbs"><div class="mini"><div class="sl"><div class="ffw"></div></div></div></div>'; document.body.appendChild(e); const d = getComputedStyle(e.querySelector(".ffw")).display; e.remove(); return d; });
  eq(css, "none", "v miniaturách se overlay nezobrazuje");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["výnos podle typu aktiva: DPS 7 %, ETF 9 %, akcie 9 %, fond 5 % … nominálně minus inflace, vlastní výnos u položky ho přebije; stávající majetek nepřestřelí rentu na stovky %"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 28000, vydaje_osobni: 15000, inv1: 6000, inv2: 8000, inv3: 12000, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [],
    cile: [{ nazev: "Start podnikání", castka: 250000, za_let: 10 }, { nazev: "Akontace na bydlení", castka: 1500000, za_let: 15 }], renta: { mesicne: 30000 }, pojisteni: { zivotni: { navrh: 7400 } } };
  const maj = (o = {}) => [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Doplňkové penzijní spoření (DPS)", nazev: "DPS", hodnota: 80000, vklad: 0 }, Object.assign({ typ: "ETF", nazev: "iShares", hodnota: 43000, nech: "vse" }, o.etf), { typ: "Akcie / dluhopisy (přímé)", nazev: "Akcie", hodnota: 20000, nech: "vse" }];
  const run = async m => { await setPlan(page, Object.assign({}, base, { majetek: m })); return page.evaluate(() => { compute(); return { fv: R.renta.dpsFv, mo: R.renta.months, spl: R.renta.splneni, infl: R.S.inflace, flags: R.flags }; }); };
  const a = await run(maj());
  const g = (h, nom, mo) => h * Math.pow(1 + nom - a.infl, mo / 12);
  const exp = g(80000, 0.07, a.mo) + g(43000, 0.09, a.mo) + g(20000, 0.09, a.mo);
  assert(Math.abs(a.fv - exp) / exp < 0.002, "DPS 7 % + ETF 9 % + akcie 9 % (nominálně) minus inflace: " + Math.round(a.fv) + " vs " + Math.round(exp));
  assert(a.spl >= 0.95 && a.spl <= 1.05, "renta vychází kolem 100 %, ne 400 % (" + a.spl + ")");
  assert(a.flags.some(f => /Akcie: počítám výnos akcií 9 %/.test(f)), "u přímých akcií/dluhopisů upozornění, že dluhopisy se zadávají ručně");
  const b = await run(maj({ etf: { vynos: 5 } }));
  const exp2 = g(80000, 0.07, b.mo) + g(43000, 0.05, b.mo) + g(20000, 0.09, b.mo);
  assert(Math.abs(b.fv - exp2) / exp2 < 0.002, "vlastní výnos u položky (5 %) přebije výnos podle typu: " + Math.round(b.fv) + " vs " + Math.round(exp2));
  eq(await page.evaluate(() => ["v_bu", "v_term", "v_ss", "v_pp", "v_opf", "v_etf", "v_akcie"].map(k => FPE.DEFAULT_SET[k])), [0, 0.04, 0.02, 0.01, 0.05, 0.09, 0.09], "výchozí dlouhodobé výnosy podle typu");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["případ klienta: 2 cíle + renta s ponechaným DPS/ETF/akciemi – všechny cíle ~100 %, renta si po splnění cíle vezme jen potřebnou část platby; měsíční vklady v celých korunách"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 28000, vydaje_osobni: 15000, inv1: 6000, inv2: 8000, inv3: 12000, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [],
    cile: [{ nazev: "Start podnikání", castka: 250000, za_let: 10 }, { nazev: "Akontace na bydlení", castka: 1500000, za_let: 15 }], renta: { mesicne: 30000 },
    majetek: [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Doplňkové penzijní spoření (DPS)", nazev: "DPS", hodnota: 80000, vklad: 0 }, { typ: "ETF", nazev: "iShares", hodnota: 43000, nech: "vse" }, { typ: "Akcie / dluhopisy (přímé)", nazev: "Akcie", hodnota: 20000, nech: "vse" }] };
  for (const [zp, mes] of [[0, "akcie"], [7400, "akcie"], [0, "opt"], [3000, "opt"]]) {
    await setPlan(page, Object.assign({}, base, { pojisteni: { zivotni: { navrh: zp } }, realokace: { mes, dip: false } }));
    const r = await page.evaluate(() => { compute(); return { g: R.cile.concat([R.renta]).map(g => ({ n: g.nazev || "Renta", spl: g.splneni, kr: g.kraceno, pmt: g.pmt, inh: g.inh })), poz: R.pozice.map(p => p.mesicne), pmt: R.pmtCelkem }; });
    r.g.forEach(g => { if (!g.kr) assert(g.spl >= 0.97 && g.spl <= 1.06, `${g.n} (ŽP ${zp}): splnění ${g.spl.toFixed(3)} má být ~100 % ` + JSON.stringify(r.g)); });
    assert(r.g[2].spl >= 0.97 && r.g[2].spl <= 1.06, "renta ~100 % (ŽP " + zp + "): " + r.g[2].spl);
    r.poz.filter(v => v > 0).forEach(v => assert(Number.isInteger(v), "měsíční vklad do produktu v celých korunách: " + JSON.stringify(r.poz)));
    if (r.pmt % 100 === 0) r.poz.filter(v => v > 0).forEach(v => assert(v % 100 === 0, "součet je na stovky → každý vklad na stovky: " + JSON.stringify(r.poz)));
    assert(Math.abs(r.poz.reduce((a, b) => a + b, 0) - r.pmt) <= 50, "součet vkladů sedí s platbami: " + r.poz + " vs " + r.pmt);
  }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["cíle přesně na 100 %: výsledek po zaokrouhlení na tisíce = cíl, platby na koruny (pod 500 Kč jen u malé potřeby)"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 28000, vydaje_osobni: 15000, inv1: 6000, inv2: 8000, inv3: 12000, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], renta: { mesicne: 30000 } };
  const cases = [[{ nazev: "A", castka: 250000, za_let: 10 }, { nazev: "B", castka: 1500000, za_let: 15 }], [{ nazev: "C", castka: 120000, za_let: 3 }, { nazev: "D", castka: 40000, za_let: 8 }], [{ nazev: "E", castka: 333333, za_let: 7 }]];
  for (const cile of cases) {
    await setPlan(page, Object.assign({}, base, { cile, majetek: [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "ETF", nazev: "E", hodnota: 43000, nech: "vse" }] }));
    const r = await page.evaluate(() => { compute(); return R.cile.concat(R.renta ? [R.renta] : []).map(g => { const t = g === R.renta ? R.renta.kap : g.castka; return [Math.round(t / 1000), Math.round(g.vysledek / 1000), g.splneni, g.kraceno]; }); });
    r.forEach(([t, v, sp, kr]) => { if (kr) return; assert(sp >= 0.995 && sp < 1.08, "cíl na 100 % (přesah jen ze zaokrouhlení plateb na stovky, na slidu = cíl): " + JSON.stringify(r)); });
  }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["renta jako v případu klienta (BÚ 140 000 + DPS 143 000, cash flow stačí): platí se hned, nepřestřelí a nečeká na přelitou platbu"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "2005-06-01", zam: 28000, vydaje_osobni: 15000, inv1: 6000, inv2: 8000, inv3: 12000, starobni: 16000, bez_partnera: true, hruba: 38000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [],
    cile: [{ nazev: "Start podnikání", castka: 250000, za_let: 10 }, { nazev: "Akontace na bydlení", castka: 1500000, za_let: 15 }], renta: { mesicne: 30000 },
    majetek: [{ typ: "Běžný účet", hodnota: 140000 }, { typ: "Doplňkové penzijní spoření (DPS)", hodnota: 143000, vklad: 500 }], pojisteni: { zivotni: { navrh: 0 } } };
  await setPlan(page, base);
  const r = await page.evaluate(() => { compute(); return R.cile.concat([R.renta]).map(g => ({ n: g.nazev || "Renta", spl: g.splneni, pmt: g.pmt, inh: g.inh, vklad: g.vklad })); });
    r.forEach(g => assert(g.spl <= 1.06, `${g.n}: přestřel ${g.spl.toFixed(3)} ` + JSON.stringify(r)));
  assert((r[2].pmt === 0 || r[2].pmt >= 500) && r[2].spl >= 0.995, "renta na 100 %, žádná drobná platba pod 500 Kč (malou potřebu vezme z platby splněného cíle) " + JSON.stringify(r));
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["nastavení „Neřešit pojištění“: žádné slidy s pojištěním (katastrofy, ŽP, SOCKO, děti, plán s pojištěním), plán bez pojistného, v Realizaci ani na ose nic o pojištění; editor nehlásí chybějící údaje k pojištění"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Petr Novák", narozen: "1988-03-01", zam: 62000, vydaje_osobni: 30000, vydaje_dom: 20000, starobni: 21000, bez_partnera: false },
    partner: { zapnuto: true, jmeno: "Jana Nováková", narozen: "1991-06-01", zam: 30000, vydaje_osobni: 12000, vydaje_dom: 8000, starobni: 17000 }, deti: [{ jmeno: "Anička", narozen: "2018-05-01", vs: false }], motivace: "x", uvery: [],
    cile: [{ nazev: "Auto", castka: 400000, za_let: 5 }], renta: { mesicne: 20000 }, majetek: [{ typ: "Běžný účet", nazev: "Účet", hodnota: 300000 }] };
  await setPlan(page, base);
  const on = () => page.evaluate(() => { compute(); const gr = [...new Set(FR.map(f => f.g))], real = FR.find(f => f.g === "z"), txt = real ? real.h.replace(/<[^>]+>/g, " ") : "";
    const all = FR.map(f => f.h.replace(/<[^>]+>/g, " ")).join(" ");
    return { gr, poj: R.pojNove, real: /ojišt|ojist|Zajištěný/.test(txt), anyZp: /Návrh životního pojištění|Pojištění dětí|Proč pojištění/.test(all), miss: missing(inp(), R).filter(m => m.st === 3 || /invalidní|OVZ|krytí smrti/.test(m.t)).length, saved: !!inp().bez_zp }; });
  const before = await on();
  assert(before.gr.some(g => /^zp/.test(g)) && before.gr.some(g => /^kat/.test(g)) && before.gr.includes("deti") && before.gr.includes("p2"), "bez zapnutí jsou slidy s pojištěním " + before.gr.join(","));
  assert(before.real, "bez zapnutí Realizace pojištění zmiňuje");
  await page.evaluate(() => { set(inp(), "nastaveni.bez_pojisteni", true); save(); });
  const after = await on();
  eq([after.gr.filter(g => /^(zp|kat|soc|deti|p2)/.test(g)), after.poj, after.real, after.anyZp, after.miss, after.saved], [[], 0, false, false, 0, false], "zapnuto: " + after.gr.join(","));
  assert(after.gr.includes("p") && after.gr.includes("z"), "plán a Realizace zůstávají");
  const ui = await page.evaluate(() => { STEP = 5; renderEditor(); return !!document.querySelector('#ed input[data-p="nastaveni.bez_pojisteni"]:checked'); });
  assert(ui, "přepínač je v Nastavení zaškrtnutý");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["cash flow v čase: Dnes bez plánu, od 2. bodu výdaje vč. plateb do plánu (spoření + pojištění) a cash flow = co opravdu zbývá"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, { klient: { jmeno: "Petr Novák", narozen: "1988-03-01", zam: 62000, vydaje_osobni: 35000, starobni: 21000, inv1: 9000, inv2: 12000, inv3: 20000, bez_partnera: true }, partner: { zapnuto: false }, deti: [],
    majetek: [{ typ: "Spořicí účet", nazev: "Účet", hodnota: 300000 }], uvery: [{ typ: "Hypotéka", nazev: "KB", zustatek: 900000, splatka: 12000, splatnost: (new Date().getFullYear() + 8) + "-06" }],
    cile: [{ nazev: "Auto", castka: 300000, za_let: 4 }], renta: { mesicne: 0 }, pojisteni: { zivotni: { stav: 0, navrh: "" } } });
  const r = await page.evaluate(() => { compute(); const T = cfTimeline(inp(), R), Ed = s => s.ost.reduce((a, b) => a + b, 0) + s.loans;
    const tx = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/[  ]/g, " "); };
    const F = FR.filter(f => f.g === "cft"), num = v => Math.round(v).toLocaleString("cs-CZ").replace(/\s/g, " ");
    return { n: T.pts.length, p0: { I: T.pts[0].s.I, ed: Ed(T.pts[0].s), E: T.pts[0].s.E }, p1: { I: T.pts[1].s.I, ed: Ed(T.pts[1].s), E: T.pts[1].s.E, plan: T.pts[1].s.spor + T.pts[1].s.poj.reduce((a, b) => a + b, 0) + T.pts[1].s.pojS },
      t0: tx(F[1].h), t1: tx(F[2].h), num: [num(Ed(T.pts[0].s)), num(T.pts[1].s.E), num(T.pts[1].s.I - T.pts[1].s.E)] }; });
  assert(r.n >= 2 && r.p1.plan > 0, "plán má platby a aspoň dva body");
  assert(r.t0.includes("Výdaje celkem") && !r.t0.includes("Výdaje celkem vč. plánu") && r.t0.includes(r.num[0] + " Kč"), "Dnes: výdaje bez plánu");
  assert(/půjde do plánu/.test(r.t0), "Dnes: kolik půjde do plánu a co zbude");
  assert(r.t1.includes("Výdaje celkem vč. plánu") && r.t1.includes(r.num[1] + " Kč"), "2. bod: výdaje včetně plánu " + r.num[1]);
  assert(r.t1.includes("+" + r.num[2] + " Kč") || r.t1.includes("−" + r.num[2].replace("-", "") + " Kč"), "2. bod: cash flow po platbách do plánu " + r.num[2]);
  assert(/finanční plán/.test(r.t1), "rozpis výdajů obsahuje finanční plán");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["uvolněný cash flow: splacený úvěr na ose a v cash flow jako „Uvolněný cash flow +částka“, ne mínus"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, { uvery: [{ typ: "Hypotéka", nazev: "na dům", zustatek: 900000, splatka: 17500, splatnost: "2035-09", fixace_do: "" }] });
  const r = await page.evaluate(() => { const t = FR.filter(f => f.g === "tl" && /Splaceno/.test(f.lbl)).map(f => f.h).join(""), c = FR.filter(f => f.g === "cft" && /Splaceno/.test(f.lbl)).map(f => f.h).join(""); return { t: /Uvolněný cash flow<\/span> \+17\s500/.test(t), minus: /−17\s500\s*Kč\/měs/.test(t), c: /uvolněný cash flow \+17\s500/.test(c) }; });
  eq(r, { t: true, minus: false, c: true }, "osa i cash flow");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["cíl bydlení: akontace podle věku (10 % / 20 %), prodej stávajícího bytu, zástava, nejlepší banka z modulu Úvěry, inkaso ve výdajích"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Petr Novák", narozen: "1994-05-01", zam: 70000, hruba: 100000, vydaje_osobni: 30000, vydaje_dom: 25000, inv1: 8000, inv2: 12000, inv3: 20000, starobni: 20000 },
    partner: { zapnuto: true, jmeno: "Jana Nováková", narozen: "1980-03-01", zam: 55000, hruba: 75000, vydaje_osobni: 25000, vydaje_dom: 20000, inv1: 6000, inv2: 9000, inv3: 15000, starobni: 17000 },
    kontakt: { stav: "zenaty" }, cile: [], nefin: [{ nazev: "Byt 3+1", typ: "Nemovitost k bydlení", hodnota: 7000000 }], uvery: [], majetek: [{ nazev: "SÚ", typ: "Spořicí účet", hodnota: 3500000 }],
    hypo: { zapnuto: true, cena: 15000000, za_let: 0, inkaso_ted: 6000, inkaso_po: 9000, prodej: "-1" } };
  await setPlan(page, base);
  await page.waitForFunction(() => !!window.Uvery, null, { timeout: 10000 });
  const r1 = await page.evaluate(() => { HYB = {}; const H = hypoOf(inp()); return { lim: hypoLtvLim(inp(), 0), own: H.own, uver: H.uver, bank: !!(H.bank && (H.bank.name || H.bank.none)), inkD: H.inkD, d: Math.round(H.delta - H.pmt) }; });
  eq([r1.lim, r1.own, r1.uver, r1.bank, r1.inkD, r1.d], [90, 1500000, 13500000, true, 3000, 3000], "manželé, jeden pod 36 → akontace 10 %; inkaso +3 000 ve výdajích");
  const r2 = await page.evaluate(() => { const I = JSON.parse(JSON.stringify(inp())); I.klient.narozen = "1980-01-01"; I.hypo.prodej = "0"; const H = hypoOf(I); return { lim: hypoLtvLim(I, 0), own: H.own, uver: H.uver, prodej: H.prodejNet }; });
  eq([r2.lim, r2.own, r2.uver, r2.prodej], [80, 0, 8000000, 7000000], "oba 36+ → 20 %; prodej bytu 7 mil. pokryje akontaci a sníží úvěr");
  const r3 = await page.evaluate(() => { const I = JSON.parse(JSON.stringify(inp())); I.hypo.financ = "zastava"; I.hypo.zastava = "0"; I.hypo.prodej = ""; const H = hypoOf(I); return { own: H.own, uver: H.uver, coll: H.coll }; });
  eq([r3.own, r3.uver, r3.coll], [0, 15000000, 22000000], "zástava bytu: bez vlastních zdrojů, úvěr na celou cenu, zajištění 22 mil.");
  await page.evaluate(() => { STEP = 2; renderEditor(); });
  assert(await page.locator("[data-hyuse]").count() === 2, "srovnání variant s tlačítkem Použít");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["oddělené finance páru: každý vlastní plán (cash flow, majetek, cíle, renta), pojištění a úvod společně; starý plán = společné finance"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Petr Novák", narozen: "1990-05-01", zam: 60000, hruba: 85000, vydaje_osobni: 30000, vydaje_dom: 22000, inv1: 7500, inv2: 9000, inv3: 15000, starobni: 20000 },
    partner: { zapnuto: true, jmeno: "Jana Nováková", narozen: "1992-03-01", zam: 45000, hruba: 60000, vydaje_osobni: 25000, vydaje_dom: 20000, inv1: 6000, inv2: 7000, inv3: 12000, starobni: 17000 },
    deti: [], cile: [{ nazev: "Auto", castka: 500000, za_let: 5, kdo: "klient" }, { nazev: "Dovolená", castka: 200000, za_let: 3 }], renta: { mesicne: 40000 }, renta2: { mesicne: 30000 },
    majetek: [{ nazev: "SÚ", typ: "Spořicí účet", hodnota: 600000, kdo: "klient" }, { nazev: "SÚ J", typ: "Spořicí účet", hodnota: 300000, kdo: "partner" }, { nazev: "Fond", typ: "Podílový fond (OPF)", hodnota: 200000, vklad: 1000 }] };
  await setPlan(page, base);
  const a = await page.evaluate(() => ({ odd: !!R.odd, n: FR.filter(f => /^o\d/.test(f.g)).length, cf: R.cf }));
  eq([a.odd, a.n], [false, 0], "bez volby = společné finance jako dřív");
  await setPlan(page, Object.assign({}, base, { fin: { spolecne: false } }));
  const b = await page.evaluate(() => ({ odd: R.odd.map(o => ({ cf: o.R.cf, maj: o.R.majCelkem, cile: o.R.cile.map(c => c.nazev + ":" + c.castka), renta: o.R.renta && o.R.renta.mesicnePuv })),
    g: [...new Set(FR.map(f => f.g))].join(","), kat: FR.filter(f => /^kat\d/.test(f.g)).length, mail: mailCompose() }));
  eq(b.odd.map(o => o.maj), [700000, 400000], "majetek: vlastní + polovina společného");
  eq(b.odd.map(o => o.cile.join("|")), ["Dovolená:100000|Auto:500000", "Dovolená:100000"], "cíle: vlastní + polovina společného");
  eq(b.odd.map(o => o.renta), [40000, 30000], "renta každého zvlášť");
  eq(b.odd.map(o => o.cf), [30000, 20000], "cash flow z vlastních příjmů a výdajů");
  assert(/^t,h,a,o0p,o1p,kat0/.test(b.g) && /o0z,o1z,e$/.test(b.g) && b.kat > 0, "pořadí slidů: úvod společně → plány → pojištění oba → … → realizace každého: " + b.g);
  assert(/Petr: Zřízení/.test(b.mail) && /Jana: Zřízení/.test(b.mail), "shrnutí mailem za každého");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["dotazník: starší rozpracovaný koncept se načte celý (povolání, sport, příjmy) a nové otázky se odvodí; riziková skupina NN z povolání a sportu"] = async function () {
  const { ctx, page, errors } = await open();
  const DZ = FP.replace("fp.html", "dotaznik.html");
  const old = { klient: { jmeno: "Jan Starý", narozen: "1985-02-03", zam: 50000, hruba: 70000, vydaje_osobni: 30000, vydaje_dom: 20000, povolani: "elektrikář", sport: "fotbal, lyže", bez_partnera: false },
    partner: { zapnuto: true, jmeno: "Eva Stará", narozen: "1987-01-01", povolani: "účetní", zam: 40000 }, kontakt: { telefon: "777111222", email: "a@b.cz", stav: "zenaty", deti_ma: true, majetek_ma: true },
    deti: [{ jmeno: "Ema", narozen: "2018-01-01" }], majetek: [{ typ: "Spořicí účet", nazev: "Moneta", hodnota: 300000, vklad: 0 }], motivace: "Chci jistotu pro rodinu a bydlení." };
  await page.goto(DZ); await page.evaluate(o => localStorage.setItem("fp_dotaznik_draft_v1", JSON.stringify({ at: Date.now(), plan: o })), old); await page.reload(); await page.waitForSelector("section");
  const v = await page.evaluate(() => ({ pov: document.querySelector('[data-p="klient.povolani"]').value, sport: document.querySelector('[data-p="klient.sport"]').value, zam: P.klient.zam, plan: P.kontakt.plan_pro, deti: P.deti.length, maj: P.majetek.length }));
  eq(v, { pov: "elektrikář", sport: "fotbal, lyže", zam: 50000, plan: "dva", deti: 1, maj: 1 }, "staré odpovědi zůstaly");
  await page.click('[data-seg="fin.spolecne"]:has-text("Každý zvlášť")');
  assert(await page.locator('[data-p="majetek.0.kdo"]').count() === 1, "při financích zvlášť se u majetku ptá, čí je");
  const rs = await page.evaluate(() => [NNRS.osoba({ povolani: "učitel", sporty: [{ nazev: "Fotbal", uroven: "rekreacne" }] }).rs, NNRS.osoba({ povolani: "učitel", sporty: [{ nazev: "Fotbal", uroven: "registrovane" }] }).rs,
    NNRS.osoba({ povolani: "tesař" }).rs, NNRS.osoba({ sporty: [{ nazev: "Box", uroven: "rekreacne" }] }).rs, NNRS.osoba({ sporty: [{ nazev: "Tenis", uroven: "profesionalne" }] }).uw, NNRS.osoba({ sporty: [{ nazev: "Golf", uroven: "profesionalne" }] }).rs]);
  eq(rs, [1, 2, 3, 4, true, 1], "RS: učitel + fotbal rekreačně 1, registrovaně 2 (příklad z OP NN), tesař 3, box 4, profesionální sport UW, profi golf 1");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["příspěvek zaměstnavatele (DPS, PP, DIP, ŽP): jde do produktu a do renty, z cash flow se neplatí; vlastní vklad do DPS/DIP z cash flow ano; nový produkt s hodnotou 0"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => { const base = { klient: { jmeno: "Jan Novák", narozen: "1985-01-01", zam: 50000, vydaje_osobni: 30000, inv1: 8000, inv2: 12000, inv3: 20000, starobni: 18000, bez_partnera: true, hruba: 70000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [], renta: { mesicne: 30000, od_veku: "" } };
    const run = m => FPE.compute(Object.assign({}, base, { majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 300000 }].concat(m) }), new Date());
    const dps = { typ: "Doplňkové penzijní spoření (DPS)", nazev: "DPS", hodnota: 100000, vklad: 1000 };
    const a = run([dps]), b = run([Object.assign({}, dps, { zam_prisp: 1500 })]), c = run([{ typ: "Dlouhodobý investiční produkt (DIP)", nazev: "DIP", hodnota: 0, vklad: 0, zam_prisp: 1000 }]), d = run([]);
    return { own: [a.prispVlastni, b.prispVlastni, c.prispVlastni], zam: [a.zamPrisp, b.zamPrisp, c.zamPrisp], zb: [a, b, d].map(x => x.cf - x.cfZbyva - x.pmtCelkem - x.pojNove), fv: b.renta.dpsFv > a.renta.dpsFv, dip: c.renta.dpsFv > 0 && c.renta.pmt < d.renta.pmt }; });
  eq(r.own, [1000, 1000, 0], "vlastní vklady do DPS / DIP");
  eq(r.zam, [0, 1500, 1000], "příspěvek zaměstnavatele");
  eq(r.zb, [1000, 1000, 0], "z cash flow jde jen vlastní vklad, příspěvek zaměstnavatele ne");
  assert(r.fv && r.dip, "příspěvek zaměstnavatele zvyšuje majetek pro rentu, nový DIP s hodnotou 0 sníží potřebnou platbu na rentu");
  const DZ = FP.replace("fp.html", "dotaznik.html"); await page.goto(DZ); await page.waitForSelector("section");
  await page.click('[data-seg="kontakt.majetek_ma"][data-v="true"]'); await page.click('[data-add="majetek"]'); await page.selectOption('[data-p="majetek.0.typ"]', "Doplňkové penzijní spoření (DPS)");
  assert(await page.locator('[data-p="majetek.0.zam_prisp"]').count() === 1, "dotazník: u DPS se ptá na příspěvek zaměstnavatele");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["společná domácnost páru: výdaje jedním číslem za oba (do katastrof podle podílu na příjmech); starší plán s výdaji po osobách funguje dál"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, { klient: { jmeno: "Petr Novák", narozen: "1990-01-01", zam: 60000, vydaje_osobni: 30000, vydaje_dom: 20000, inv1: 8000, inv2: 12000, inv3: 20000 }, partner: { zapnuto: true, jmeno: "Jana Nováková", narozen: "1992-01-01", zam: 40000, vydaje_osobni: 20000, inv1: 5000, inv2: 7000, inv3: 12000 } });
  eq(await page.evaluate(() => R.vydCelkem), 50000, "bez výdajů domácnosti = starší výdaje po osobách");
  await setPlan(page, { vydaje: { domacnost: 55000 } });
  const r = await page.evaluate(() => { STEP = 0; renderEditor(); return { v: R.vydCelkem, k: R.katastrofy.map(k => k.vyd), f: document.querySelectorAll('#ed [data-p="klient.vydaje_osobni"]').length, h: document.querySelectorAll('#ed [data-p="vydaje.domacnost"]').length }; });
  eq(r, { v: 55000, k: [33000, 22000], f: 0, h: 1 }, "výdaje domácnosti za oba, po osobách se nezadávají");
  await setPlan(page, { fin: { spolecne: false } });
  eq(await page.evaluate(() => R.odd.map(o => o.R.vydCelkem)), [30000, 20000], "finance zvlášť = výdaje každého");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["výdaje včetně všeho (výchozí u nových plánů): odečtou se současné vklady a pojistné ŽP; starší plány zůstávají bez investic a pojištění"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => { const base = { klient: { jmeno: "Jan Novák", narozen: "1985-01-01", zam: 50000, vydaje_osobni: 35000, vydaje_dom: 30000, inv1: 8000, inv2: 12000, inv3: 20000, starobni: 18000, bez_partnera: true, hruba: 70000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [],
      majetek: [{ typ: "Stavební spoření", nazev: "SS", hodnota: 100000, vklad: 1700 }, { typ: "Spořicí účet", nazev: "S", hodnota: 200000 }], pojisteni: { zivotni: { stav: 1300, navrh: 1500 } }, renta: { mesicne: 30000 } };
    const a = FPE.compute(base, new Date()), b = FPE.compute(Object.assign({}, base, { vydaje: { vcetne: true } }), new Date());
    const pair = FPE.compute(Object.assign({}, base, { partner: { zapnuto: true, jmeno: "Eva Nová", narozen: "1987-01-01", zam: 40000 }, vydaje: { domacnost: 60000, vcetne: true } }), new Date());
    const I = { klient: { vydaje_osobni: 30000 } }; migVyd(I); const J = {}; migVyd(J);
    return { a: a.vydCelkem, b: b.vydCelkem, dom: b.persons[0].vydDom, pair: pair.vydCelkem, old: I.vydaje.vcetne, nov: J.vydaje.vcetne }; });
  eq(r, { a: 35000, b: 32000, dom: 30000, pair: 57000, old: false, nov: true }, "odečet 1 700 vklad + 1 300 pojistné; výdaje domácnosti zůstanou; u společné domácnosti z celku");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["bydlení: prodej bytu s hypotékou – hypotéka se z prodeje doplatí a její splátka z výdajů zmizí; slidy hypotéky před finančním plánem"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, { klient: { jmeno: "Petr Novák", narozen: "1990-01-01", zam: 110000, hruba: 155000, vydaje_osobni: 50000, vydaje_dom: 45000, inv1: 8000, inv2: 12000, inv3: 20000 }, cile: [],
    nefin: [{ nazev: "Byt 3+1", typ: "Nemovitost k bydlení", hodnota: 7000000 }], uvery: [{ typ: "Hypotéka", nazev: "KB", zustatek: 2500000, splatka: 17500, splatnost: "2048-09", fixace_do: "" }],
    hypo: { zapnuto: true, cena: 15000000, za_let: 1, stavajici: "prodej", inkaso_ted: 6000, inkaso_po: 9000 } });
  const r = await page.evaluate(() => { const H = hypoOf(inp()), g = FR.map(f => f.g), I2 = JSON.parse(JSON.stringify(inp())); I2.hypo.nahrazuje = "-1"; const H2 = hypoOf(I2);
    return { nahr: H.nahrazuje, spl: H.splaceno, net: H.prodejNet, rep: H.rep, d: Math.round(H.delta - H.pmt), zav: R.zavazky, hy: g.indexOf("hy") > g.indexOf("h") && g.lastIndexOf("hy") === g.indexOf("a") - 1, off: [H2.rep, H2.prodejNet] }; });
  eq([r.nahr, r.spl, r.net, r.rep, r.d], ["0", 2500000, 4500000, 17500, -14500], "doplacení z prodeje: 7 mil. − 2,5 mil.; splátka 17 500 odpadne (+3 000 inkaso)");
  assert(r.zav === 10500000 && r.hy, "v závazcích jen nová hypotéka; slidy hypotéky před plánem: " + JSON.stringify(r));
  eq(r.off, [0, 7000000], "„— ne —“ = bez doplacení");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["pár s nájmem a hypotékou: překlep v datu důchodu z IOLDP, důchodový věk podle zákona, renta bez nájmu"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => {
    const base = { klient: { jmeno: "Adam Test", narozen: "1986-01-01", zam: 80000, pronajem: 10000, duchod: "1952-09-01", inv1: 14000, inv2: 19000, inv3: 33000, vdovsky: 19000, sirotci: 16000, starobni: 32000 },
      partner: { zapnuto: true, jmeno: "Eva Testová", narozen: "1988-08-20", zam: 40000, inv1: 11000, inv2: 14000, inv3: 24000, vdovsky: 14000, sirotci: 12000, starobni: 23000 }, kontakt: { stav: "zenaty" }, fin: { spolecne: true },
      deti: [{ jmeno: "Dítě", narozen: "2016-01-01" }], majetek: [{ typ: "Spořicí účet", hodnota: 500000 }], uvery: [{ typ: "Hypotéka", zustatek: 3000000, splatka: 15000, splatnost: "2056-01" }], cile: [], renta: { mesicne: 0 }, vydaje: { domacnost: 80000 } };
    const R = FPE.compute(base, new Date()), k = R.katastrofy[0];
    const dv = y => { const d = FPE.compute({ klient: { narozen: y + "-01-01", zam: 1 } }, new Date()).persons[0].duch; return d.getFullYear() * 12 + d.getMonth() - y * 12; };
    return { duch: R.persons.map(p => p.duch.getFullYear() + "-" + (p.duch.getMonth() + 1)), flag: R.flags.some(f => /1952 nedává smysl/.test(f)), renta: R.renta.mesicnePuv, vek: [1965, 1966, 1971, 1986, 1989].map(dv) }; });
  eq(r.duch, ["2052-10", "2055-7"], "zákonný věk 66 let 9 měs. (1986) a 66 let 11 měs. (1988), překlep 1952 se ignoruje");
  assert(r.flag, "upozornění na překlep v datu důchodu");
  eq(r.vek, [780, 781, 786, 801, 804], "důchodový věk v měsících: 1965 = 65 let, +1 měsíc za ročník, 1989 = 67 let");
  eq(r.renta, 120000, "renta nahrazuje příjem z práce (nájem 10 000 běží dál)");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["úmrtí (metodika VK): renta, kterou by pozůstalý potřeboval na všechny výdaje do svého důchodu (minus jeho příjem a dávky) – klesající PČ + 1× roční příjem konstantní; NN bez stropu"] = async function () {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => {
    const T = new Date(), y = T.getFullYear();
    const base = { klient: { jmeno: "Adam Test", narozen: "1986-01-01", zam: 80000, inv1: 14000, inv2: 19000, inv3: 33000, vdovsky: 19100, sirotci: 16200, starobni: 32000 },
      partner: { zapnuto: true, jmeno: "Eva Testová", narozen: "1988-01-01", zam: 40000, vdovsky: 14400, sirotci: 12500, inv1: 11000, inv2: 14000, inv3: 24000 }, kontakt: { stav: "zenaty" },
      deti: [{ jmeno: "A", narozen: (y - 10) + "-01-01" }], majetek: [{ typ: "Spořicí účet", hodnota: 500000 }], uvery: [], cile: [], renta: { mesicne: 0 }, vydaje: { domacnost: 100000 } };
    const R = FPE.compute(Object.assign({}, base, { pojisteni: Object.assign({}, base.pojisteni, { pojistovna: "nn" }) }), T), k = R.katastrofy[0], e = R.katastrofy[1];
    const sam = FPE.compute(Object.assign({}, base, { partner: { zapnuto: false }, klient: Object.assign({}, base.klient, { bez_partnera: true }), deti: [], uvery: [{ typ: "Hypotéka", zustatek: 2000000, splatka: 15000 }] }), T).katastrofy[0];
    const nnK = R.nn.dospeli.find(o => o.jmeno === "Adam Test").rizika;
    return { gap0: k.smrt.faze[0].gap, gapPo: k.smrt.faze.at(-1).gap, konec: k.smrt.konecRenty.getFullYear(), kles: k.smrt.pcKles, konst: k.smrt.pcKonst, pc: k.smrt.pc, eGap: e.smrt.faze[0].gap, eKonec: e.smrt.konecRenty.getFullYear(),
      sam: [sam.smrt.pcKonst, sam.smrt.pcKles], nn: nnK.filter(x => /^SMTV/.test(x.tarif)).map(x => [x.tarif, x.pc]), inv: nnK.filter(x => /^INV/.test(x.tarif)).map(x => x.pc) };
  });
  eq([r.gap0, r.gapPo], [100000 - 40000 - 19100 - 16200, 100000 - 40000], "chybí: výdaje − příjem partnerky − dávky; po 18 letech dítěte bez dávek");
  eq(r.konec, 1988 + 66 + 11 / 12 | 0, "do důchodu pozůstalé (ročník 1988 → 66 let 11 měs.)");
  eq(r.konst, 960000, "konstantní = 1× roční příjem zemřelého");
  eq(r.pc, r.kles + r.konst, "pojistná částka = klesající (renta) + konstantní");
  eq([r.eGap, r.eKonec], [Math.max(0, 100000 - 80000 - 14400 - 12500), 2052], "smrt partnerky: Adam do svého důchodu (2052)");
  eq(r.sam, [0, 2000000], "bez partnera a dětí: jen zůstatek úvěrů");
  eq(r.nn.map(x => x[0]), ["SMTV-P2R", "SMTV-K2R"], "NN: konstantní + klesající smrt");
  assert(r.nn[1][1] === r.kles && r.inv.every(x => x > 0), "NN bere vždy potřebnou částku (bez stropu 1 mil.)");
  /* srovnání sociální vs. ŽP: u úmrtí dva řádky – dnes (stát + pojistka) a po skončení dávek (jen pojistka) */
  const y = new Date().getFullYear();
  await setPlan(page, { klient: { jmeno: "Adam Test", narozen: "1986-01-01", zam: 80000, hruba: 110000, inv1: 14000, inv2: 19000, inv3: 33000, vdovsky: 19100, sirotci: 16200, starobni: 32000, vydaje_osobni: 60000 },
    partner: { zapnuto: true, jmeno: "Eva Testová", narozen: "1988-01-01", zam: 40000, hruba: 55000, vdovsky: 14400, sirotci: 12500, inv1: 11000, inv2: 14000, inv3: 24000, vydaje_osobni: 40000 },
    deti: [{ jmeno: "A", narozen: (y - 10) + "-01-01" }], majetek: [{ typ: "Spořicí účet", hodnota: 500000 }], uvery: [], cile: [] });
  const s = await page.evaluate(() => { const L = FR.filter(f => /^soc0/.test(f.g)).map(f => f.h); return { n: L.length, lanes: /dnes–20\d\d/.test(L[2] || ""), konec: (L[1] || "").includes("dávky skončily"), ins: /\+[0-9]+ %/.test(L[2] || "") }; });
  eq(s, { n: 3, lanes: true, konec: true, ins: true }, "SOCKO: posun pojistky u úmrtí dnes a po skončení dávek");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["bydlení: prodej víc nemovitostí najednou – výtěžek se sečte a doplatí se hypotéky na nich"] = async function () {
  const { ctx, page, errors } = await open();
  await setPlan(page, { klient: { jmeno: "Adam Test", narozen: "1990-01-01", zam: 120000, hruba: 170000, vydaje_osobni: 50000, vydaje_dom: 45000, inv1: 8000, inv2: 12000, inv3: 20000 }, cile: [],
    nefin: [{ nazev: "Byt A", typ: "Nemovitost k bydlení", hodnota: 7000000 }, { nazev: "Byt B", typ: "Investiční nemovitost", hodnota: 5000000 }],
    uvery: [{ typ: "Hypotéka", nazev: "A", zustatek: 3000000, splatka: 15000, splatnost: "2050-01" }, { typ: "Hypotéka", nazev: "B", zustatek: 1000000, splatka: 8000, splatnost: "2045-01" }],
    hypo: { zapnuto: true, cena: 15000000, za_let: 0, prodej: "0,1", inkaso_ted: 4000, inkaso_po: 4000 } });
  const r = await page.evaluate(() => { STEP = 2; renderEditor(); const H = hypoOf(inp()); return { hod: H.prodejHod, spl: H.splaceno, net: H.prodejNet, rep: H.rep, nahr: H.nahrazuje, uver: H.uver, boxes: document.querySelectorAll("#ed [data-hyprod]:checked").length }; });
  eq(r, { hod: 12000000, spl: 4000000, net: 8000000, rep: 23000, nahr: "0,1", uver: 7000000, boxes: 2 }, "dva byty prodané, obě hypotéky doplacené");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["pronájem patří k nemovitosti – při prodeji kvůli hypotéce odpadne; starší pronájem u osoby se přiřadí"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Adam Test", narozen: "1990-01-01", zam: 80000, hruba: 115000, vydaje_osobni: 50000, vydaje_dom: 45000 }, cile: [],
    nefin: [{ nazev: "Byt doma", typ: "Nemovitost k bydlení", hodnota: 5000000 }, { nazev: "Byt 2+kk", typ: "Investiční nemovitost", hodnota: 4000000, najem: 15000 }] };
  await setPlan(page, base);
  const a = await page.evaluate(() => ({ prijmy: R.prijmy, pron: R.persons[0].pronajem }));
  eq(a, { prijmy: 95000, pron: 15000 }, "nájem z nemovitosti je v příjmech");
  await setPlan(page, Object.assign({}, base, { hypo: { zapnuto: true, cena: 9000000, za_let: 0, prodej: "1", inkaso_ted: 3000, inkaso_po: 3000 } }));
  const b = await page.evaluate(() => { const H = hypoOf(inp()); STEP = 2; renderEditor(); return { prijmy: R.prijmy, odp: H.najOdp, box: /pronájem 15[\s\u00a0]000[\s\u00a0]Kč\/měs odpadne/.test(document.querySelector("#ed").textContent),
    hy: FR.filter(f => f.g === "hy").length, txt: FR.filter(f => f.g === "hy").map(f => f.h).join("").includes("prodaná nemovitost") }; });
  eq(b, { prijmy: 80000, odp: 15000, box: true, hy: 2, txt: true }, "prodej investičního bytu → nájem z příjmů zmizí");
  /* starší plán: pronájem u osoby → přiřadí se k jediné investiční nemovitosti, nepočítá se dvakrát; uložená hodnota u osoby zůstane */
  await setPlan(page, { klient: Object.assign({}, base.klient, { pronajem: 15000 }), cile: [], hypo: { zapnuto: false }, nefin: [base.nefin[0], { nazev: "Byt 2+kk", typ: "Investiční nemovitost", hodnota: 4000000 }] });
  const c = await page.evaluate(() => { renderEditor(); update(); return { najem: inp().nefin[1].najem, osoba: inp().klient.pronajem, prijmy: R.prijmy }; });
  eq(c, { najem: 15000, osoba: 15000, prijmy: 95000 }, "migrace pronájmu k nemovitosti");
  /* nejasné přiřazení (jen vlastní bydlení) → pronájem u osoby se počítá dál a editor upozorní */
  await setPlan(page, { klient: Object.assign({}, base.klient, { pronajem: 9000 }), cile: [], hypo: { zapnuto: false }, nefin: [base.nefin[0]] });
  const d = await page.evaluate(() => { STEP = 0; renderEditor(); update(); return { prijmy: R.prijmy, warn: document.querySelector("#ed").textContent.includes("NEPŘIŘAZENÝ"), flag: R.flags.some(f => /není přiřazený/.test(f)) }; });
  eq(d, { prijmy: 89000, warn: true, flag: true }, "nepřiřazený pronájem");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["hypotéka: srovnání prodat × neprodat ostatní majetek – druhá varianta pro srovnání, zvolená až za ní, před tabulkou rozložení"] = async () => {
    const { ctx, page, errors } = await open();
    await setPlan(page, { klient: { jmeno: "Petr Novák", narozen: "1992-03-01", zam: 70000, vydaje_osobni: 30000 }, partner: { zapnuto: false }, deti: [],
      majetek: [{ typ: "Spořicí účet", nazev: "Účet", hodnota: 900000 }], uvery: [],
      nefin: [{ nazev: "Byt Brno", typ: "Nemovitost k bydlení", hodnota: 4000000 }, { nazev: "Chata", typ: "Rekreační objekt", hodnota: 1500000, najem: 6000 }, { nazev: "Auto", typ: "Auto", hodnota: 400000 }],
      hypo: { zapnuto: true, promitnout: true, financ: "akontace", cena: 8000000, prodej: "0", sazba: 5, let: 30, cmp: true }, cile: [], renta: { mesicne: 0 } });
    const r = await page.evaluate(() => { const hy = FR.filter(f => f.g === "hy"), V = hyCmpVariants(inp()), H = V.map(v => hypoOf(v.I));
      const iA = FR.findIndex(f => f.g === "a");
      return { n: hy.length, a: hy[0].h.includes("s prodejem") && hy[1].h.includes("s prodejem"), b: hy[2].h.includes("bez prodeje") && hy[3].h.includes("doporučujeme"), pred: FR[iA - 1].g === "hy",
        sell: H.map(x => x.pList.join(",")), uver: H.map(x => Math.round(x.uver)), main: hypoOf(inp()).pList.join(",") }; });
    eq(r.n, 4, "2 slajdy (dnes → po koupi) na každou variantu");
    assert(r.a && r.b, "nejdřív srovnání s prodejem, za ním zvolená varianta bez prodeje");
    assert(r.pred, "hypotéka hned před tabulkou optimálního rozložení");
    eq(r.sell, ["0,1,2", "0"], "A prodá chatu i auto, B jen byt k bydlení");
    assert(r.uver[0] < r.uver[1], "s prodejem menší úvěr");
    eq(r.main, "0", "zbytek plánu podle „Prodat kvůli koupi“");
    await page.evaluate(() => { inp().hypo.cmp_prodej = "1"; compute(); });
    eq(await page.evaluate(() => hypoOf(hyCmpVariants(inp())[0].I).pList.join(",")), "0,1", "prodá se jen vybraný majetek");
    await page.evaluate(() => { inp().hypo.prodej = "0,1"; compute(); });
    eq(await page.evaluate(() => { const hy = FR.filter(f => f.g === "hy"); return [hy[0].h.includes("bez prodeje"), hy[3].h.includes("s prodejem") && hy[3].h.includes("doporučujeme")]; }), [true, true], "zaškrtnutý prodej → s prodejem jde druhá");
    await page.evaluate(() => { inp().hypo.cmp = false; compute(); });
    eq(await page.evaluate(() => FR.filter(f => f.g === "hy").length), 2, "bez srovnání jen 2 slajdy");
    eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["rezerva: rok nemoci (výdaje − nemocenská) toho, komu vypadne nejvíc, nejméně 6 měsíců výdajů; OSVČ = 12 × výdaje"] = async () => {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => { const base = { majetek: [{ typ: "Spořicí účet", nazev: "SÚ", hodnota: 200000 }], uvery: [], cile: [], deti: [], hypo: {}, vydaje: { vcetne: false }, partner: { zapnuto: false } };
    const run = k => { const R = computeR(Object.assign(JSON.parse(JSON.stringify(inp())), base, k)); return [R.rez.cil, R.rez.pravidlo]; };
    return { zam: run({ klient: { jmeno: "A B", narozen: "1990-01-01", zam: 40000, vydaje_osobni: 30000 } }),
      osvc: run({ klient: { jmeno: "A B", narozen: "1990-01-01", zam: 0, podnik: 60000, vydaje_osobni: 40000, prace: "osvc" } }),
      vysoky: run({ klient: { jmeno: "A B", narozen: "1990-01-01", zam: 150000, hruba: 220000, vydaje_osobni: 120000 } }) }; });
  eq(r.zam, [180000, "6 měsíců výdajů"], "zaměstnanec: nemocenská výdaje pokryje → minimum 6 měsíců");
  eq(r.osvc, [480000, "rok nemoci: výdaje − nemocenská"], "OSVČ bez nemocenského: 12 × výdaje");
  assert(r.vysoky[0] > 6 * 120000 && /rok nemoci/.test(r.vysoky[1]), "vysoký příjem: strop nemocenské → rezerva podle ročního výpadku (" + r.vysoky.join(", ") + ")");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["rezerva vždy na 100 %: z účtů, pak z investic jdoucích do plánu, zbytek z cash flow přednostně a pak přeteče do dalšího cíle"] = async () => {
  const { ctx, page, errors } = await open();
  const r = await page.evaluate(() => { const base = { klient: { jmeno: "A B", narozen: "1990-01-01", zam: 50000, vydaje_osobni: 30000 }, partner: { zapnuto: false }, uvery: [], deti: [], hypo: {}, vydaje: { vcetne: false }, cile: [{ nazev: "Auto", castka: 300000, za_let: 3 }] };
    const run = maj => { const R = computeR(Object.assign(JSON.parse(JSON.stringify(inp())), base, { majetek: maj })); return { cil: R.rez.cil, vklad: R.rez.vklad, zInv: R.rez.zInv, pmt: R.rez.pmt, m: R.rez.months, spl: R.rez.splneni, auto: R.cile[0].splneni, zb: R.cfZbyva }; };
    return { inv: run([{ typ: "Spořicí účet", nazev: "SÚ", hodnota: 50000 }, { typ: "Podílový fond (OPF)", nazev: "Fond", hodnota: 300000 }]), cf: run([{ typ: "Spořicí účet", nazev: "SÚ", hodnota: 50000 }]) }; });
  eq([r.inv.cil, r.inv.vklad, r.inv.zInv, r.inv.pmt], [180000, 180000, 130000, 0], "chybějící rezerva z fondu, který jde do plánu");
  eq([r.cf.vklad, r.cf.m, r.cf.pmt * r.cf.m >= 130000], [50000, 8, true], "zbytek z cash flow přednostně (8 měsíců)");
  assert(r.cf.spl >= 0.999 && r.cf.auto >= 0.995, "rezerva 100 %, Auto díky přetečené platbě taky (" + r.cf.spl + ", " + r.cf.auto + ")");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests).filter(([n])=>n.includes(process.env.F||""))) {
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
