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
  assert(/za 3 roky už 20 \d{3} Kč\/měs/.test(f), "u Bytu je vidět, kolik bude platit po splnění Auta: " + f.match(/za \d+ roky už[^A-Z]*/));
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
    const zp0 = FR.findIndex(f => f.g === "zp0"), s0 = FR.map((f, i) => f.g === "soc0" ? i : -1).filter(i => i >= 0);
    return { groups: [...new Set(idx.map(x => x[0]))], n0: s0.length, nextToZp: s0[0] === zp0 + 1, last: t(FR[s0[s0.length - 1]].h), first: t(FR[s0[0]].h), bad: FR.filter(f => /Infinity|NaN|undefined/.test(f.h.replace(/<style[\s\S]*?<\/style>/g, ""))).map(f => f.lbl),
      keys: s0.map(i => [...FR[i].h.matchAll(/data-k="(sb0|ib0|sum)"/g)].map(m => m[1]).join(",")), lbl: FR[s0[0]].lbl }; });
  eq(o.groups, ["soc0", "soc1"], "slide pro každou osobu"); eq(o.n0, 3, "3 snímky = animace karty → stát → + pojištění"); assert(o.nextToZp, "slide je hned za slidem s modelací ŽP");
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
    const fl = [], osoby = c.osoby.map(o => ({ jmeno: o.jmeno, vek: o.vek, dite: !!o.dite, rsPovolani: o.rsPovolani, rsSport: o.rsSport, fit: o.fit,
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

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
