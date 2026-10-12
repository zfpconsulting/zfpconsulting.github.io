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
    // totéž dítě bez VŠ: dávky jen do 18 let, pak celé výdaje
    o = await run([false], ["2016-06-01"]);
    eq(o.faze.map(f => f[2]), [33000, 41000], "po 18. narozeninách odpadne sirotčí a roste krytí na celé výdaje");
    // dvě děti s různým věkem: nejdřív 2× sirotčí, pak 1×, pak nic
    o = await run([false, false], ["2016-06-01", "2020-01-01"]);
    eq(o.faze.map(f => f[2]), [25000, 33000, 41000], "tři fáze podle věku dětí");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
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
