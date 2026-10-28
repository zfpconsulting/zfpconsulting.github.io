// Testy důchodové kalkulačky (duchod.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/duchod.run.mjs [--shots]
import { readFileSync } from "node:fs";
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const SHOTS = process.argv.includes("--shots");
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

/* prázdná stránka s tokeny barev jako v Pipeline + paměťové úložiště se stejným API jako LStore + dva fiktivní klienti */
async function open({ width = 1300, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8">
    <style>:root{--bg:#F2F2F7;--bg2:#fff;--label:#000;--label2:rgba(60,60,67,.6);--sep:rgba(60,60,67,.18);--orange:#FF9500;--orange-soft:rgba(255,149,0,.14);--red:#FF3B30;--tint:#007AFF;--card-shadow:0 1px 2px rgba(0,0,0,.04)}
    @media (prefers-color-scheme: dark){:root{--bg:#000;--bg2:#1C1C1E;--label:#fff;--label2:rgba(235,235,245,.6);--sep:rgba(84,84,88,.6)}}body{background:var(--bg);margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif}</style>
    </head><body><div id="box"></div><script src="duchod.js"></script><script>
    const docs={},subs=new Set(),emit=()=>subs.forEach(f=>f());let n=0;
    const store={collection:name=>({onSnapshot(cb){const f=()=>cb({docs:Object.entries(docs).filter(([k])=>k.startsWith(name+"/")).map(([k,v])=>({id:k.split("/")[1],data:()=>v}))});subs.add(f);f()},
      async add(d){const id="d"+(++n);docs[name+"/"+id]=d;emit();return{id}}}),
      doc:p=>({onSnapshot(cb){const f=()=>cb({exists:!!docs[p],data:()=>docs[p]});subs.add(f);f()},async set(d){docs[p]=d;emit()},async delete(){delete docs[p];emit()}})};
    const cl=[{id:"c:a",rec:{id:"a"},name:"Novák Petr"},{id:"l:b",name:"Dvořáková Jana"},{id:"l:c",lead:{id:"c"},name:"Svoboda Karel",leadOnly:true,prospect:"Nový lead"}];
    window.toasts=[];window.ensured=[];
    window.ui=DuchodCalc.mount(document.getElementById("box"),{store,toast:m=>toasts.push(m),clients:()=>cl,ensure:async e=>{ensured.push(e.id);e.rec={id:"new"+e.id.slice(2)};return e.rec}});window.docs=docs;
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ui);
  return { ctx, page, errors };
}
const tiles = page => page.$$eval(".dk-tile", ts => ts.map(t => [t.querySelector(".k").textContent, t.querySelector(".v").textContent.replace(/ /g, " ")]));
const fill = async (page, k, v) => { await page.fill(`[data-k="${k}"]`, String(v)); };

const tests = {
  async "redukce: 99 % / 26 % / 0 % podle redukčních hranic 2026 (reforma § 15 odst. 3)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { reduce, PAR } = DuchodCalc.math, p = PAR[2026];
      return { low: reduce(15000, p), mid: reduce(30000, p), hi: reduce(300000, p), zero: reduce(0, p) };
    });
    /* 15 000·0,99 = 14 850; 21 546·0,99 + 8 454·0,26 = 21 330,54 + 2 198,04 = 23 528,58 → 23 529; 21 330,54 + 174 322·0,26 = 66 654,26 → 66 655 */
    eq(r, { low: 14850, mid: 23529, hi: 66655, zero: 0 }, "výpočtový základ");
    await ctx.close();
  },
  async "reforma 2026: % zápočtu do 1. RH a sazba procentní výměry podle roku (§ 15, § 34, § 41)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { zapPct, sazba, paramsFor } = DuchodCalc.math;
      return { z: [2026, 2027, 2030, 2035, 2045].map(zapPct), s: [2026, 2027, 2030, 2035, 2045].map(sazba), p: paramsFor("2031-06-01") };
    });
    eq(r.z, [99, 98, 95, 90, 90], "zápočet do 1. RH");
    eq(r.s, [1495, 1490, 1475, 1450, 1450], "sazba v tisícinách %");
    eq([r.p.use, r.p.est, r.p.p.zap, r.p.p.saz, r.p.p.rh1], [2027, true, 94, 1470, 22732], "rok bez NV: RH z 2027, zákonné parametry roku 2031");
    await ctx.close();
  },
  async "ukázkový IOLDP (OVZ 52 300, nárok 28. 10. 2026): výp. základ 29 327, inv. III 24 192, II 14 546, I 11 331, vdovský 14 546, sirotčí 12 617"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const c = DuchodCalc.math.calc({ ovz: 52300, tY: 22, tD: 120, nY: 2, nD: 30, evt: "2026-10-28", ret: "2049-05-01", dopPct: 100, kids: 1 });
      return { vz: c.vz, years: c.years, i1: c.i1.total, i2: c.i2.total, i3: c.i3.total, wid: c.wid.total, orp: c.orp.total, sta: c.sta.total, stY: c.sta.pr.year, est: c.sta.pr.est };
    });
    /* VZ 21 546·0,99 + 30 754·0,26 = 29 326,58 → 29 327; doba 7 998 + 8 221 dní = 44 let; PV III 29 327·1,495 %·44 = 19 291,3 → 19 292;
       II 9 646, I 6 431; vdovský 50 % = 9 646, sirotčí 40 % = 7 717 (+ ZV 4 900).
       Starobní s parametry 2049: RH 2027 (odhad), 90 % → 22 732·0,9 + 29 568·0,26 = 28 146,48 → 28 147; ·1,45 %·44 = 17 958 + ZV 5 170 */
    eq(r, { vz: 29327, years: 44, i1: 11331, i2: 14546, i3: 24192, wid: 14546, orp: 12617, sta: 23128, stY: 2049, est: true }, "částky");
    await ctx.close();
  },
  async "invalidní, vdovský a sirotčí: ručně spočítaný případ (OVZ 30 000, 25 let, dopočtená doba 9 131 dní)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const c = DuchodCalc.math.calc({ ovz: 30000, tY: 25, tD: 0, nY: 0, nD: 0, evt: "2026-10-10", ret: "2051-10-10", dopPct: 100, kids: 2 });
      return { vz: c.vz, dop: c.dop, years: c.years, sta: c.sta.total, i1: c.i1.total, i2: c.i2.total, i3: c.i3.total, wid: c.wid.total, orp: c.orp.total, fam: c.orp.family };
    });
    /* VZ 23 529; 9 125 + 9 131 dní = 18 256 → 50 celých roků; PV III. 23 529·1,495 %·50 = 17 587,9 → 17 588; II. 8 794, I. 5 863;
       starobní s parametry 2051 (90 %, 1,45 %, RH 2027): VZ 20 458,8 + 1 893,2 = 22 349; ·1,45 %·50 = 16 204 + ZV 5 170 */
    eq(r, { vz: 23529, dop: 9131, years: 50, sta: 21374, i1: 10763, i2: 13694, i3: 22488, wid: 13694, orp: 11936, fam: 23872 }, "částky");
    await ctx.close();
  },
  async "zákonná minima procentní výměry (2026) a rok 2027"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { calc } = DuchodCalc.math, a = calc({ ovz: 5000, tY: 1, tD: 0, evt: "2026-10-10" }), b = calc({ ovz: 5000, tY: 1, tD: 0, evt: "2027-03-01" });
      return { a: [a.i1.total, a.i2.total, a.i3.total, a.wid.total, a.orp.total, a.i3.minUsed], b: [b.i1.total, b.i3.total, b.wid.total, b.orp.total], by: b.pr.use };
    });
    eq(r.a, [4900 + 1634, 4900 + 2450, 4900 + 4900, 4900 + 2450, 4900 + 1960, true], "minima 2026");
    eq(r.b, [5170 + 1724, 5170 + 5170, 5170 + 2585, 5170 + 2068], "minima 2027");
    eq(r.by, 2027, "rok parametrů");
    await ctx.close();
  },
  async "náhradní doby jen z 80 %, dopočtená doba zkrácená a rok bez vyhlášených parametrů"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { doba, dopocet, paramsFor } = DuchodCalc.math;
      return { d: doba({ tY: 10, tD: 0, nY: 5, nD: 0 }), dop: dopocet("2026-10-10", "2026-10-20", 50), none: dopocet("2026-10-10", "2026-10-01", 100), w: paramsFor("2030-01-01").use, w2: paramsFor("2030-01-01").warn };
    });
    eq(r.d, { tot: 3650, sub: 1825, eff: 3285 }, "doba");
    eq([r.dop, r.none, r.w, r.w2], [5, 0, 2027, true], "dopočtená doba a parametry");
    await ctx.close();
  },
  async "vdovský a sirotčí z procentní výměry zemřelého, který už pobíral důchod"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const c = DuchodCalc.math.calc({ ovz: 30000, tY: 40, tD: 0, evt: "2026-10-10", pvDead: 14001, kids: 1 });
      return { base: c.base, wid: c.wid.pv, orp: c.orp.pv };
    });
    eq(r, { base: 14001, wid: 7001, orp: 5601 }, "odvozené výměry (50 % a 40 % nahoru)");
    await ctx.close();
  },
  async "UI: zadání z IOLDP vyplní dlaždice, uložení ke klientovi a načtení zpět"() {
    const { ctx, page, errors } = await open();
    await fill(page, "ovz", "30 000"); await fill(page, "tY", 25); await fill(page, "tD", 0);
    await page.fill('[data-k="evt"]', "2026-10-10"); await page.fill('[data-k="ret"]', "2051-10-10");
    const t = await tiles(page);
    eq(t.map(x => x[0]), ["Starobní důchod", "Invalidní I. stupně", "Invalidní II. stupně", "Invalidní III. stupně", "Vdovský / vdovecký", "Sirotčí (na 1 dítě)"], "dlaždice");
    eq(t[3][1], "22 488 Kč", "invalidní III.");
    eq(t[0][1], "21 374 Kč", "starobní s parametry roku odchodu");
    assert((await page.textContent(".dk-tile")).includes("odhad"), "starobní pro budoucí rok označen jako odhad");
    /* bez klienta nejde uložit */
    await page.click('[data-a="save"]'); assert((await page.evaluate(() => toasts)).some(m => /vyber klienta/i.test(m)), "výzva k výběru klienta");
    /* virtuální klient se při uložení založí přes ensure() a data se uloží pod jeho id */
    /* výběr klienta vyhledáváním (bez diakritiky) */
    await page.fill("#dk_cq", "dvorak");
    assert(await page.isVisible('#dk_cl button[data-id="l:b"]'), "vyhledání klienta bez diakritiky");
    assert(!(await page.isVisible('#dk_cl button[data-id="a"]')) || (await page.$$eval("#dk_cl button[data-a=pick]", b => b.length)) >= 2, "filtr");
    await page.keyboard.press("Enter");
    eq(await page.inputValue("#dk_cq"), "Dvořáková Jana", "vybraný klient v poli");
    await page.fill('[data-k="ioldp"]', "2026-10-09");
    await page.click('[data-a="save"]'); await page.waitForFunction(() => Object.keys(docs).length);
    const d = await page.evaluate(() => ({ keys: Object.keys(docs), ens: ensured, doc: docs[Object.keys(docs)[0]] }));
    eq(d.ens, ["l:b"], "ensure");
    eq(d.keys, ["duchod/newb"], "klíč dokumentu");
    eq([d.doc.name, d.doc.ioldp, d.doc.res.i3, d.doc.res.wid, d.doc.in.ovz], ["Dvořáková Jana", "2026-10-09", 22488, 13694, 30000], "uložený dokument");
    /* druhý klient s existující kartou, pak návrat k prvnímu */
    await page.click("#dk_cq"); await page.click('#dk_cl button[data-id="a"]'); await fill(page, "ovz", 45000);
    await page.click('[data-a="save"]'); await page.waitForFunction(() => Object.keys(docs).length === 2);
    await page.fill("#dk_cq", "jana"); await page.click('#dk_cl button[data-id="newb"]');
    eq(await page.inputValue('[data-k="ovz"]'), "30000", "načtená data prvního klienta");
    assert((await page.$$(".dk-row")).length === 2, "dva uložené záznamy");
    /* smazání vyžaduje potvrzení */
    await page.click('[data-a="del"] >> nth=0'); assert((await page.evaluate(() => Object.keys(docs).length)) === 2, "první klik jen žádá potvrzení");
    await page.click('[data-a="del"][data-sure="1"]'); await page.waitForFunction(() => Object.keys(docs).length === 1);
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "lead z pipeline (bez klienta): jde vybrat, uložit pod lead_<id> a klient se nezakládá"() {
    const { ctx, page, errors } = await open();
    await fill(page, "ovz", "30 000"); await fill(page, "tY", 25);
    await page.fill('[data-k="evt"]', "2026-10-10"); await page.fill('[data-k="ret"]', "2051-10-10");
    await page.fill("#dk_cq", "svobod");
    assert(await page.isVisible('#dk_cl button[data-id="lead_c"]'), "lead je v nabídce");
    await page.click('#dk_cl button[data-id="lead_c"]');
    await page.click('[data-a="save"]'); await page.waitForFunction(() => Object.keys(docs).length);
    const d = await page.evaluate(() => ({ keys: Object.keys(docs), ens: ensured }));
    eq(d.ens, [], "klient se nezakládá");
    eq(d.keys, ["duchod/lead_c"], "klíč dokumentu");
    await page.click('[data-a="more"]'); await page.click('[data-a="new"]'); await page.fill("#dk_cq", "svobod"); await page.click('#dk_cl button[data-id="lead_c"]');
    eq(await page.inputValue('[data-k="ovz"]'), "30000", "načtená data leadu");
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "import IOLDP: text se rozparsuje (OVZ nebere rok, náhradní doby zvlášť)"() {
    const { ctx, page } = await open();
    const txt = readFileSync(new URL("./fixtures/ioldp-ukazka.txt", import.meta.url), "utf8");
    const r = await page.evaluate(t => DuchodCalc.math.parseIoldp(t), txt);
    eq(r.fields, { ovz: 52300, tY: 22, tD: 120, nY: 2, nD: 30, ret: "2049-05-01", ioldp: "2026-10-09" }, "pole");
    eq(r.missing, [], "nenalezeno");
    const alt = await page.evaluate(() => ["Celkový počet získaných roků a dnů pojištění: 31 roků 45 dnů", "Celkový počet získaných roků a dnů pojištění 31 45", "Celkový počet získaných roků a dnů pojištění\n31\n45"].map(t => DuchodCalc.math.parseIoldp(t).fields));
    eq(alt.map(f => [f.tY, f.tD]), [[31, 45], [31, 45], [31, 45]], "popisek Celkový počet získaných roků a dnů pojištění");
    const e = await page.evaluate(() => DuchodCalc.math.parseIoldp("nic užitečného"));
    eq(e.found, [], "prázdný soubor");
    await ctx.close();
  },
  async "import IOLDP: výpočtový základ, odhad starobního a datum z ePortálu"() {
    const { ctx, page } = await open();
    const txt = ["Vyhodnocení dle získaných dat", " Odhad výše starobního důchodu                    14 300 Kč", " Celkový počet získaných roků a dnů pojištění      6 roků a 0 dnů", " Výpočtový základ                                  12 861 Kč", "Údaje byly získány prostřednictvím ePortálu České správy sociálního zabezpečení (10.10.2026,"].join("\n");
    const f = await page.evaluate(t => DuchodCalc.math.parseIoldp(t).fields, txt);
    eq([f.vz, f.staIoldp, f.tY, f.ioldp], [12861, 14300, 6, "2026-10-10"], "pole");
    const r = await page.evaluate(() => DuchodCalc.math.calc({ evt: "2026-10-10", ret: "2069-11-08", ovz: 12990, vz: 12861, tY: 6, tD: 0, staIoldp: 14300 }).sta);
    eq([r.total, r.fromIoldp], [14300, true], "starobní z IOLDP");
    await ctx.close();
  },
  async "import IOLDP: PDF i .txt vyplní formulář a rovnou se spočítá"() {
    for (const f of ["ioldp-ukazka.pdf", "ioldp-ukazka.txt"]) {
      const { ctx, page, errors } = await open();
      await page.setInputFiles("#dkFile", new URL("./fixtures/" + f, import.meta.url).pathname);
      await page.waitForFunction(() => document.querySelector("#dkImp .dk-warn"));
      eq(await page.inputValue('[data-k="ovz"]'), "52300", f + " OVZ");
      eq([await page.inputValue('[data-k="tY"]'), await page.inputValue('[data-k="tD"]'), await page.inputValue('[data-k="nY"]'), await page.inputValue('[data-k="ret"]')], ["22", "120", "2", "2049-05-01"], f + " doba a věk");
      assert((await page.textContent("#dkImp")).includes("Načteno"), f + " hláška");
      assert((await tiles(page)).length === 6, f + " dlaždice");
      assert(!errors.length, "chyby: " + errors.join(" | "));
      await ctx.close();
    }
  },
  async "UI: nahoře jen Uložit + Import IOLDP, Tisk a Nová kalkulace v menu ⋯ (Escape a klik mimo zavře)"() {
    const { ctx, page, errors } = await open({ width: 390, height: 844 });
    assert(await page.isVisible('.dk-acts > [data-a="save"]') && await page.isVisible('.dk-acts > [data-a="import"]'), "hlavní akce viditelné");
    assert(!(await page.$('[data-a="pdf"]')) && !(await page.$('[data-a="new"]')), "Tisk a Nová kalkulace schované");
    await page.click('[data-a="more"]');
    assert(await page.isVisible('.dk-menu [data-a="pdf"]') && await page.isVisible('.dk-menu [data-a="new"]'), "menu otevřené");
    await page.keyboard.press("Escape"); assert(!(await page.$(".dk-menu")), "Escape zavře");
    await page.click('[data-a="more"]'); await page.mouse.click(200, 700); assert(!(await page.$(".dk-menu")), "klik mimo zavře");
    await fill(page, "ovz", 30000); await page.click('[data-a="more"]'); await page.click('.dk-menu [data-a="new"]');
    eq(await page.inputValue('[data-k="ovz"]'), "", "nová kalkulace vyčistí formulář");
    const small = await page.$$eval(".dk input, .dk select", els => els.filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).length);
    eq(small, 0, "pole mají min. 16 px");
    const tiny = await page.$$eval(".dk button, .dk input, .dk select", els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.dataset.a || e.id || e.tagName));
    eq(tiny, [], "dotykové cíle min. 40 px");
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: chybějící údaje a chybějící datum důchodového věku mají upozornění"() {
    const { ctx, page } = await open();
    assert((await page.textContent("#dkRes")).includes("Vyplň osobní vyměřovací základ"), "prázdný stav");
    await fill(page, "ovz", 30000); await fill(page, "tY", 20);
    assert((await page.textContent("#dkRes")).includes("Chybí datum dosažení důchodového věku"), "varování bez data");
    await ctx.close();
  },
  async "UI: mobil a tmavý režim bez chyb a bez vodorovného přetečení"() {
    for (const o of [{ width: 390, height: 844 }, { width: 1300, height: 900, dark: true }]) {
      const { ctx, page, errors } = await open(o);
      await fill(page, "ovz", 52300); await fill(page, "tY", 22); await page.fill('[data-k="ret"]', "2049-05-01");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(over <= 0, "vodorovné přetečení o " + over + " px");
      if (SHOTS) await page.screenshot({ path: `/tmp/dk-${o.width}${o.dark ? "-dark" : ""}.png`, fullPage: true });
      assert(!errors.length, "chyby: " + errors.join(" | "));
      await ctx.close();
    }
  }
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
