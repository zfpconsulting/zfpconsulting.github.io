// Testy finančního plánu (fp.html) v Chromiu – nepotřebují PP_KEY. Použití: node tests/fp.run.mjs
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const FP = url.replace(/index\.html$/, "fp.html");

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(FP);
  await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function");
  return { ctx, page, errors };
}
/* uloží plán klienta do localStorage a načte stránku znovu */
async function setPlan(page, patch) {
  await page.evaluate(p => { const d = JSON.parse(JSON.stringify(DB)), c = d.clients[d.cur]; Object.assign(c, p); localStorage.setItem(LS, JSON.stringify(d)); }, patch);
  await page.reload();
  await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function");
}
const pvAnn = (m, n, r) => { const q = Math.pow(1 + r, 1 / 12) - 1; return n > 0 && m > 0 ? m * (1 - Math.pow(1 + q, -n)) / q : 0; };

const tests = {
  async "příjem a výdaje v čase: rodičovská → návrat do práce, nová hypotéka nahradí starou, důchody, splacení; rozpis za každého"() {
    const { ctx, page, errors } = await open();
    await setPlan(page, {
      klient: { jmeno: "Petr Novák", narozen: "1988-03-01", zam: 62000, vydaje_osobni: 30000, starobni: 21000, inv1: 9000, inv2: 12000, inv3: 20000, bez_partnera: false },
      partner: { zapnuto: true, jmeno: "Jana Nováková", narozen: "1991-06-01", zam: 0, vydaje_osobni: 12000, starobni: 17000 }, deti: [], majetek: [{ typ: "Spořicí účet", nazev: "Účet", hodnota: 300000 }],
      docasne: [{ nazev: "Rodičovská", typ: "rodicovska", castka: 12000, do: (new Date().getFullYear() + 2) + "-09", potom: 34000, kdo: "partner" }],
      uvery: [{ typ: "Hypotéka", nazev: "KB", zustatek: 1800000, splatka: 14500, fixace_do: "", splatnost: (new Date().getFullYear() + 13) + "-06" }],
      hypo: { zapnuto: true, promitnout: true, cena: 7500000, uver: 5800000, sazba: 5.5, let: 30, za_let: 3, odpadne: 0, naklady: 1500, nahrazuje: "0" }, cile: [], renta: { mesicne: 0 } });
    const r = await page.evaluate(() => { const t = cfTimeline(inp(), R); return { pts: t.pts.map(q => ({ t: q.t, I: Math.round(q.s.I), loans: Math.round(q.s.loans), inc: q.s.inc.map(Math.round) })), fr: FR.filter(f => f.g === "cft").length,
      uv: R.uvery.map(u => u.nazev), h: FR.find(f => f.g === "cft").h }; });
    eq(r.pts.map(p => p.t), ["Dnes", "Konec: Rodičovská (Jana)", "Nahrazeno: Hypotéka – KB · Koupě nemovitosti", "Důchod: Petr", "Důchod: Jana", "Splacena plánovaná hypotéka"], "záchytné body");
    eq(r.pts[0].inc, [62000, 12000], "dnes: Petr práce, Jana rodičovská");
    eq(r.pts[1].inc, [62000, 34000], "Jana zpátky v práci");
    eq([r.pts[0].loans, r.pts[2].loans > 30000, r.pts[5].loans], [14500, true, 0], "stará hypotéka → nová → splaceno");
    eq(r.pts[4].inc, [21000, 17000], "oba v důchodu");
    eq(r.fr, 6, "snímek na každý bod");
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
  async "úmrtí s dětmi: výdaje bez plánu minus sirotčí/vdovský po fázích (do 18 let, s VŠ do 26)"() {
    const { ctx, page, errors } = await open();
    const run = async (vs, narozen) => {
      await setPlan(page, {
        klient: { jmeno: "Jitka Bartošová", narozen: "1985-03-14", zam: 60000, vydaje_osobni: 41000, starobni: 20000, inv1: 12000, inv2: 18000, inv3: 30000, vdovsky: 0, sirotci: 8000, bez_partnera: true },
        partner: { zapnuto: false }, deti: narozen.map((n, i) => ({ jmeno: "D" + i, narozen: n, vs: vs[i] })), majetek: [{ typ: "Spořicí účet", nazev: "Spořák", hodnota: 450000 }], uvery: [], cile: [], renta: { mesicne: 30000 } });
      return page.evaluate(() => { compute(); const k = R.katastrofy[0]; return { p3: k.smrt.prijem3, faze: k.smrt.faze.map(f => [f.od, f.do, f.gap]), ages: R.deti.map(d => d.vek) }; });
    };
    // jedno dítě na VŠ: celých 26 let dostává sirotčí → jediná fáze, 41 000 − 8 000
    let o = await run([true], ["2016-06-01"]);
    eq(o.faze.length, 1, "jedna fáze"); eq(o.faze[0][2], 33000, "výdaje − sirotčí");
    eq(o.p3, Math.ceil(pvAnn(33000, Math.round((26 - o.ages[0]) * 12), 0.045) / 100000) * 100000, "pojistná částka = PV výdajů po odečtu dávek");
    // totéž dítě bez VŠ: krytí končí v 18 letech dítěte (po 18. už není koho živit, žádný „ocas“ na celé výdaje)
    o = await run([false], ["2016-06-01"]);
    eq(o.faze.map(f => f[2]), [33000], "do 18 let výdaje − sirotčí, dál nic");
    eq(o.p3, Math.ceil(pvAnn(33000, Math.round((18 - o.ages[0]) * 12), 0.045) / 100000) * 100000, "částka = PV výdajů do 18 let dítěte");
    // dvě děti s různým věkem: nejdřív 2× sirotčí, pak 1× sirotčí; po 18. narozeninách mladšího krytí končí
    o = await run([false, false], ["2016-06-01", "2020-01-01"]);
    eq(o.faze.map(f => f[2]), [25000, 33000], "dvě fáze podle věku dětí, bez doběhu po 18. narozeninách mladšího");
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
  for (const rm of [0, ""]) { const o = await rent(page, d(rm)); assert(o.renta && o.renta.auto, "renta se dopočítá"); eq(o.renta.mesicne, 60000, "renta = dnešní příjem"); eq(o.renta.dor, 35000, "dorovnání = příjem − starobní důchod"); assert(o.flags.some(f => /stejný jako dnes/.test(f)), "poznámka"); }
  const o2 = await rent(page, d(40000)); assert(!o2.renta.auto && o2.renta.mesicne === 40000, "zadaná renta zůstává");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};
tests["výdaje: úmrtí kryje jen výdaje domácnosti (osobní odpadnou); bez rozdělení = vše domácnost"] = async function () {
  const { ctx, page, errors } = await open();
  const d = (tot, dom) => zaklad({ klient: { jmeno: "Jitka", narozen: "1985-03-14", zam: 60000, vydaje_osobni: tot, vydaje_dom: dom, starobni: 20000, inv1: 6000, inv2: 12000, inv3: 20000, sirotci: 8000, bez_partnera: true, hruba: 80000 }, deti: [{ jmeno: "D", narozen: "2016-06-01", vs: true }], cile: [], renta: { mesicne: 0, od_veku: "" } });
  const a = await calc(page, d(41000, 30000)), b = await calc(page, d(41000, undefined)), c = await calc(page, d(50000, 30000));
  eq(a.kat[0].smrt.faze, [22000], "gap = výdaje domácnosti 30 000 − sirotčí 8 000"); eq(a.kat[0].smrt.vydOs, 11000, "osobní výdaje 11 000");
  eq(b.kat[0].smrt.faze, [33000], "bez rozdělení: celé výdaje 41 000 − 8 000"); eq(b.kat[0].smrt.vydOs, 0);
  eq(c.kat[0].smrt.p3, a.kat[0].smrt.p3, "vyšší osobní výdaje nezvyšují krytí smrti");
  assert(c.kat[0].vyd === 50000 && a.kat[0].vyd === 41000, "celkové výdaje pro invaliditu a nemoc zůstávají celkové");
  assert(!a.miss.includes("klient.vydaje_dom") && b.miss.includes("klient.vydaje_dom"), "s dětmi se před prezentací chce rozdělení výdajů (a když je vyplněné, nechybí)");
  const e = await calc(page, d(41000, 90000)); eq(e.kat[0].smrt.vyd, 41000, "domácnost nad celkem se ořízne"); assert(e.flags.some(f => /vyšší než výdaje celkem/.test(f)), "upozornění");
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
  const first = o.kroky.findIndex(k => k[1] < o.cf);
  assert(first > 0, "cash flow se nakonec čerpá");
  o.kroky.forEach((k, i) => { if (i >= first) eq(k[0], mzEnd, "krok " + (i + 1) + ": než se sáhne na cash flow, musí být rozdělený veškerý majetek (zbývá " + k[0] + ")"); });
  eq(o.kroky.slice(0, first).every(k => k[1] === o.cf), true, "před prvním krokem z cash flow se cash flow nemění");
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
        r.cf = R.cf; r.nesplnene = (R.cile || []).filter(c => c.splneni < 0.995).map(c => c.nazev);
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
  assert(auto.pmt > 15000, "první cíl platí z cash flow naplno (" + auto.pmt + ")");
  eq(auto.flowIdx, 1, "platba Auta po splnění teče do Bytu"); assert(auto.flowTake > 10000, "do Bytu přeteče velká část platby (" + auto.flowTake + ")");
  assert(byt.pmt < 8000 && byt.spl >= 0.995, "Byt má málo vlastní platby a přesto vychází na 100 % díky navazující platbě (" + byt.pmt + ", " + byt.spl + ")");
  assert(o.lbl.includes("Plán: navazující platba"), "ve slidu je krok „navazující platba“ (" + o.lbl.join(" | ") + ")");
  assert(o.lbl[o.lbl.length - 1] === "Plán: hotovo", "slide končí snímkem bez bubliny, který ukáže výsledek");
  const f = o.txt[o.txt.length - 1], c = o.txt.find((_, i) => o.lbl[i] === "Plán: navazující platba");
  assert(/po splnění → Byt/.test(f), "u Auta je poznámka, kam platba po splnění teče");
  assert(/za 3 roky: [\d ]+ \+ [\d ]+ = 20 \d{3} Kč\/měs/.test(f.replace(/ /g, " ")), "u Bytu je vidět, kolik bude platit po splnění Auta (vlastní + přiteklá = celkem): " + f.match(/za \d+ roky:[^A-Z]*/));
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
tests["úmrtí s dospělými dětmi: výdaje domácnosti na 3 roky minus vdovský plus závazky (bez fází)"] = async function () {
  const { ctx, page, errors } = await open();
  const mk = (uvery, vs) => ({ klient: { jmeno: "Jan Novák", narozen: "1970-05-05", zam: 70000, vydaje_osobni: 50000, vydaje_dom: 40000, starobni: 25000, inv1: 8000, inv2: 12000, inv3: 20000, vdovsky: 9000, sirotci: 7000, bez_partnera: false, hruba: 95000 },
    partner: { zapnuto: false }, deti: [{ jmeno: "Dospělý", narozen: "2004-01-01", vs: vs }], motivace: "x",
    majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 800000 }], uvery, cile: [], renta: { mesicne: 30000 }, pojisteni: { zivotni: { stav: 0, navrh: 2000 } } });
  const run = plan => page.evaluate(p => { const R = FPE.compute(JSON.parse(JSON.stringify(p)), new Date(), {}); const s = R.katastrofy[0].smrt; return { p3: s.prijem3, pc: s.pc, faze: s.faze.length, met: s.metoda, zav: s.zavazky, zavisli: s.zavisli }; }, plan);
  let o = await run(mk([], false));
  eq(o.faze, 0, "dospělé dítě: žádné fáze sirotčího"); eq(o.met, "partner", "metoda: výdaje domácnosti na několik let");
  eq(o.p3, Math.ceil((3 * 12 * 40000 - 12 * 9000) / 100000) * 100000, "3 roky výdajů domácnosti − 12× vdovský");
  o = await run(mk([{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }], false));
  eq(o.zav, 2500000, "závazky = zůstatek úvěrů"); eq(o.pc, o.p3 + 2500000, "pojistná částka = výdaje domácnosti na 3 roky − vdovský + závazky");
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

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
      keys: s0.map(i => [...FR[i].h.matchAll(/data-k="(sb0|ib0|sum)"/g)].map(m => m[1]).join(",")), lbl: FR[s0[0]].lbl }; });
  eq(o.groups, ["soc0", "soc1"], "slide pro každou osobu"); eq(o.n0, 3, "3 snímky = animace karty → stát → + pojištění"); assert(o.nextToZp, "slide je hned za slidy s modelací ŽP (včetně varianty FitSport)");
  assert(/5 320/.test(o.first) && /7,1 %/.test(o.first), "sociální pojistné = 7,1 % z hrubé 75 000 = 5 320 Kč");
  assert(/Stát\s+20 000 Kč/.test(o.last) && /pojištění/.test(o.last), "poslední snímek ukazuje dávku státu i doplatek pojištění");
  assert(!/majetku/i.test(o.lbl), "popisek bez „majetku“"); eq(o.bad, [], "bez Infinity / NaN"); assert(o.keys.every(k => k === "sb0,ib0,sum"), "stejné animované prvky ve všech snímcích (" + o.keys.join(" | ") + ")");
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
    deti: [], majetek: [{ typ: "Spořicí účet", nazev: "S", hodnota: 200000 }], uvery: [{ nazev: "Hypotéka", zustatek: 2500000, splatka: 15000 }], cile: [], renta: { mesicne: 0, od_veku: "" }, pojisteni: { zivotni: { stav: 0, navrh: "" } } });
  const o = await page.evaluate(() => { compute(); const zi = FR.map((f, i) => [f.g, f.lbl, i]).filter(x => x[0] === "zp0"); const t = h => { const e = document.createElement("div"); e.innerHTML = h; return e.textContent.replace(/[  ]/g, " "); };
    return { n: zi.length, lbl: zi.map(x => x[1]), t: zi.map(x => t(FR[x[2]].h)), logo: zi.every(x => FR[x[2]].h.includes(NN_LOGO)), base: R.nn.celkem, fit: R.nnFit && R.nnFit.celkem, poj: R.pojNove }; });
  eq(o.n, 2, "modelace + hned za ní varianta FitSport"); assert(/FitSport/.test(o.lbl[1]), "druhý snímek je FitSport");
  assert(o.fit < o.base, "s FitSport je pojistné nižší (" + o.fit + " < " + o.base + ")"); eq(o.poj, o.base, "do plánu jde pojistné bez FitSport");
  assert(o.t[1].includes("ušetříte " + (o.base - o.fit).toLocaleString("cs-CZ").replace(/\s/g, " ") + " Kč"), "úspora na snímku");
  assert(o.logo, "logo NN na obou snímcích"); assert(/Trvalé následky úrazu PREMIUM/.test(o.t[0]), "TNÚ PREMIUM na slidu");
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
  eq(t.hl, 1, "hlavní pojištěný je muž (partner Karel), i když klientkou je Jana"); eq(t.smtv, [false, true], "povinné minimum smrti jen u hlavního pojištěného");
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
  await seg("kontakt.renta_ma", "true"); await f("renta.mesicne", "25000"); await f("klient.povolani", "programátor");
  await page.click("#bSend"); await page.waitForTimeout(400); eq(posts.length, 0, "bez IOLDP se neodešle");
  assert(/IOLDP/.test(await page.textContent("#toast")), "upozornění na IOLDP");
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-ioldp="klient"]')]); await fc.setFiles({ name: "ioldp.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.click("#bSend"); await page.waitForFunction(() => /Odesláno/.test(document.querySelector("main").textContent), null, { timeout: 10000 });
  assert(posts.length >= 1 && !JSON.stringify(posts).includes("Malý") && !JSON.stringify(posts).includes("petr@"), "do schránky jde jen šifrový text");
  eq(posts[0].fields.to.stringValue, "poradce@example.cz", "schránka poradce");
  const F = posts[0].fields;
  const x = await page.evaluate(([priv, b]) => DzCrypto.open(priv, b), [key.priv, { epk: F.epk.stringValue, salt: F.salt.stringValue, iv: F.iv.stringValue, ct: posts.map(p => p.fields.ct.stringValue).join("") }]);
  eq([x.plan.klient.jmeno, x.plan.klient.zam, x.files.length, x.files[0].who], ["Petr Malý", 48000, 1, "klient"], "obsah po dešifrování klíčem poradce");
  const other = await page.evaluate(() => DzCrypto.genKey());
  const bad = await page.evaluate(([priv, b]) => DzCrypto.open(priv, b).then(() => "otevřel", () => "nejde"), [other.priv, { epk: F.epk.stringValue, salt: F.salt.stringValue, iv: F.iv.stringValue, ct: posts.map(p => p.fields.ct.stringValue).join("") }]);
  eq(bad, "nejde", "cizím klíčem nejde přečíst");
  eq(await page.evaluate(() => localStorage.getItem("fp_dotaznik_draft_v1")), null, "po odeslání se koncept smaže");
  await page.goto(FP); await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function");
  const r = await page.evaluate(D => { const I = JSON.parse(JSON.stringify(inp())); I.klient.inv3 = 20000; mergeDz(I, D); return { j: I.klient.jmeno, zam: I.klient.zam, inv3: I.klient.inv3, bez: I.klient.bez_partnera, doc: I.docasne[0].typ };
  }, x.plan);
  eq([r.j, r.zam, r.inv3, r.bez, r.doc], ["Petr Malý", 48000, 20000, true, "rodicovska"], "sloučení s plánem (IOLDP z plánu zůstává)");
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
  await page.waitForFunction(() => typeof FPE !== "undefined" && typeof donut === "function");
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
    assert(r.spl >= 0.995 && r.spl <= 1.05, `renta vychází na ~100 % (fond ${fond}: ${r.spl})`);
    if (fond >= 400000) assert(r.zbyva > 0 && r.pmt === 0, "co renta nepotřebuje, zůstane nealokováno (" + r.zbyva + ")");
  }
  eq(errors, [], "chyby v konzoli"); await ctx.close();
};

tests["ponechaný produkt se dál počítá v plánu; checkbox „nechat úložku“ nechá měsíční vklad běžet z cash flow"] = async function () {
  const { ctx, page, errors } = await open();
  const base = { klient: { jmeno: "Test", narozen: "1990-06-01", zam: 40000, vydaje_osobni: 20000, inv1: 0, inv2: 0, inv3: 0, starobni: 16000, bez_partnera: true, hruba: 50000 }, partner: { zapnuto: false }, deti: [], motivace: "x", uvery: [], cile: [], renta: { mesicne: 30000, od_veku: 67 } };
  const run = async f => { await setPlan(page, Object.assign({}, base, { majetek: [{ typ: "Běžný účet", hodnota: 140000 }, Object.assign({ typ: "Podílový fond (OPF)", nazev: "F", hodnota: 300000, vklad: 2000 }, f)] })); return page.evaluate(() => { compute(); return { pmt: R.renta.pmt, vklad: R.renta.vklad, spl: R.renta.splneni, keepVal: R.renta.keepVal, keepMes: R.renta.keepMes, cfZ: R.cfZbyva, ok: R.cf }; }); };
  const std = await run({}), vse = await run({ nech: "vse" }), ul = await run({ nech: "vse", nech_uloz: true });
  eq([std.keepVal, std.keepMes], [0, 0], "bez volby se nic neponechává");
  eq([vse.keepVal, vse.keepMes], [300000, 0], "nechat být: zůstatek se počítá, vklad ne");
  eq([ul.keepVal, ul.keepMes], [300000, 2000], "s checkboxem běží i úložka");
  assert(vse.spl >= 0.995 && vse.spl <= 1.05, "nechaný zůstatek: renta ~100 % (" + vse.spl + ")");
  assert(ul.spl > vse.spl && ul.pmt === 0, "ponechaná úložka pracuje pro rentu (renta nepotřebuje novou platbu)");
  assert(ul.cfZ <= vse.cfZ, "úložka se odečítá z cash flow (" + ul.cfZ + " vs " + vse.cfZ + ")");
  await run({ nech: "vse" });
  eq(await page.locator('input[data-p^="majetek."][data-p$=".nech_uloz"]').count() >= 0, true, "editor se vykreslí");
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

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
