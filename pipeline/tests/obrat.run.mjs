// Testy čísel – Obrat, Klienti, Rozvoj sítě, Daně, Sazebník. Datum je pevně dané (page.clock), ať výsledky nezávisí na dni spuštění.
// Použití: PP_KEY=… node tests/obrat.run.mjs [filtr]
import { loadPlaywright, startServer, openApp, assert, eq } from "./helpers.mjs";

const key = process.env.PP_KEY;
if (!key) { console.log("Chybí PP_KEY – testy Obratu přeskakuji."); process.exit(0); }
const filter = process.argv[2] || "";
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const env = { browser, url, key };

/* appka s pevným dnem (časovače běží dál) */
const at = (day, store, o = {}) => openApp(env, { store, ...o, pre: async page => { await page.clock.setFixedTime(new Date(day + "T10:00:00")); if (o.pre) await o.pre(page) } });
const L = (name, stage, signedAt, points, extra = {}) => ({ name, phone: "777 000 000", stage, source: "Cold call", createdAt: "2026-10-02T09:00:00Z", signedAt, points, pointsManual: points, items: [], meetings: [], log: [], _u: 1, ...extra });
const S = (extra = {}) => ({ manual: {}, tabHidden: [], career: { cpts: 30000, cAsOf: "2026-06-15", cBase: 0 }, _u: 1, ...extra });

const tests = {
  async "body kvartálu: odhad pasivu jen do běžící uzávěrky, do tarifu vůbec; Obrat = Pipeline"() {
    const store = { "settings/main": S({ passive: { aum: { ZFPI: 50000000 }, regular: 20 } }),
      "leads/a": L("Jan Novák", "podpis", "2026-10-05T10:00:00Z", 120), "leads/b": L("Petra Černá", "vyplaceno", "2026-10-12T10:00:00Z", 80, { paidAt: "2026-10-25T10:00:00Z" }),
      "leads/c": L("Karel Dvořák", "podpis", "2026-10-20T10:00:00Z", 200) };
    const { ctx, page, errors } = await at("2026-10-28", store, { width: 1440 });
    const r = await page.evaluate(() => { const pn = passiveNow(), cur = quarterRow(CURQ());
      return { pas: pn.tot, total: cur.total, earned: cur.earned, rate: cur.rate, p1: periodVal("2026-10/1").pas, p2: periodVal("2026-10/2").pas, p3: periodVal("2026-11/1").pas, p4: periodVal("2026-12/2").pas, p0: periodVal("2026-09/2").pas,
        paidQ: paidQuarterTotal("2026-Q4"), qual: qualPts("2026-Q4").pts } });
    assert(r.pas > 1, "pasivní odhad je nenulový: " + r.pas);
    eq([r.total, r.qual, r.earned], [400, 400, 400 * r.rate], "body pro tarif = jen podpisy, Kč bez zaokrouhlovacího šumu");
    eq(r.paidQ, 80, "vyplacené body kvartálu bez pasivu");
    assert(r.p1 > 0 && r.p2 > 0, "běžící a uplynulá uzávěrka mají odhad pasivu (výdělek)");
    eq([r.p3, r.p4, r.p0], [0, 0, 0], "budoucí uzávěrky a minulý kvartál bez odhadu pasivu");
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    eq(await page.textContent("#m_pts"), "400 b", "Body tento kvartál");
    assert(await page.locator("#qchip").isHidden(), "čip kvartálu není v Obratu");
    assert(await page.locator("#careerBar").isVisible(), "kariérní karta je v Obratu");
    await page.evaluate(() => setView("pipe")); await page.waitForTimeout(300);
    assert(await page.locator("#qchip").isVisible(), "čip kvartálu na Pipeline");
    assert(/400 b/.test(await page.textContent("#qchip")), "čip = 400 b");
    const tile = await page.locator("#tiles .tile", { hasText: "Podepsáno" }).textContent();
    assert(/400 b/.test(tile) && /68\s000 Kč|68 000 Kč/.test(tile.replace(/ /g, " ")), "dlaždice Podepsáno = Obrat: " + tile);
    const meta = await page.locator('.col[data-stage="podpis"] .colmeta').textContent();
    assert(/320 b/.test(meta) && /celkem 400 b/.test(meta), "sloupec Podpis ukáže i celek kvartálu: " + meta);
    eq(await page.locator("#careerBar").isVisible(), false, "kariérní karta není na Pipeline");
    eq(errors, [], "chyby");
    await ctx.close();
  },

  async "tempo: uplynulé dny včetně dneška, ne týdny"() {
    const store = { "settings/main": S({ manual: {} }), "leads/a": L("Jan Novák", "podpis", "2026-10-01T08:00:00Z", 100) };
    for (const [day, el] of [["2026-10-01", 1], ["2026-10-28", 28], ["2026-12-31", 92]]) {
      const { ctx, page } = await at(day, store);
      const g = await page.evaluate(() => { const g = goalInfo(); return { fr: g.elapsedFr, pace: g.pctPace, target: g.nx.from, total: g.cur.total } });
      assert(Math.abs(g.fr - el / 92) < 1e-9, day + ": podíl " + g.fr);
      assert(Math.abs(g.pace - Math.min(999, (g.total / (el / 92)) / g.target * 100)) < 1e-9, day + ": tempo " + g.pace);
      await ctx.close();
    }
  },

  async "cíl při vyšším tarifu = hranice udržení (goalInfo, callout, Dnes)"() {
    const store = { "settings/main": S({ manual: { "2026-Q3": 3200 } }), "leads/a": L("Jan Novák", "podpis", "2026-10-05T10:00:00Z", 1200) };
    const { ctx, page, errors } = await at("2026-10-28", store, { width: 1440 });
    const g = await page.evaluate(() => { const g = goalInfo(); return { rate: g.cur.rate, byPts: rateFor(g.cur.total), nx: g.nx, need: g.need } });
    assert(g.rate > g.byPts, "aktuální tarif je vyšší než podle bodů");
    eq([g.nx.from, g.nx.rate, g.nx.keep, g.need], [3000, g.rate, true, 1800], "cílem je udržení tarifu " + g.rate);
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    const co = (await page.textContent("#m_callout")).replace(/ /g, " ");
    assert(/zůstala/.test(co) && /1 800 b/.test(co), "callout: " + co);
    await page.evaluate(() => openToday()); await page.waitForTimeout(300);
    const td = (await page.textContent(".tdgoal")).replace(/ /g, " ");
    assert(/1 800 b/.test(td) && /k udržení/.test(td), "Co tě dneska čeká: " + td);
    eq(errors, [], "chyby");
    await ctx.close();
  },

  async "daně: měsíce bez sjetiny odhadem z pipeline a týmu, zálohy nezadány"() {
    const store = { "settings/main": S({ sjetiny: { "2026-07/1": 100, "2026-07/2": 150 } }),
      "leads/a": L("Jan Novák", "podpis", "2026-09-20T10:00:00Z", 120, { createdAt: "2026-09-01T00:00:00Z" }),
      "team/t1": { name: "Mirek", pos: "P1", parent: null, m: { "2026-08": 400, "2026-09": 300 }, _u: 1 } };
    const { ctx, page, errors } = await at("2026-10-28", store, { width: 1440 });
    await page.evaluate(() => setView("tax")); await page.waitForTimeout(300);
    const I = await page.evaluate(() => { const I = taxIncome(); return { paid: I.paid, estN: I.estN, sum: I.sum, left: I.left,
      sep: Math.round(I.rows.find(r => r.ym === "2026-09").tot), aug: Math.round(I.rows.find(r => r.ym === "2026-08").tot), jul: Math.round(I.rows.find(r => r.ym === "2026-07").tot), rate: monthRate("2026-09"),
      teamSep: teamOverride({ ym: "2026-09" }, monthRate("2026-09")).total, teamAug: teamOverride({ ym: "2026-08" }, monthRate("2026-08")).total } });
    eq([I.paid, I.left], [10, 2], "10 výplat do října, 2 budoucí");
    assert(I.teamSep > 0, "meziprovize z týmu se počítá");
    eq(I.sep, Math.round(120 * I.rate + I.teamSep), "září: pipeline + tým");
    eq(I.aug, Math.round(I.teamAug), "srpen: jen tým");
    eq(I.jul, 250 * I.rate, "červenec: sjetina");
    assert(I.estN >= 2, "odhadnuté výplaty: " + I.estN);
    eq(Math.round(I.sum), I.sep + I.aug + I.jul, "součet vyplaceného");
    const tiles = (await page.textContent("#xTiles")).replace(/ /g, " ");
    assert(/vč\. odhadu 2 budoucích měsíců/.test(tiles), "popisek budoucích měsíců: " + tiles);
    assert(/bez sjetiny odhadem/.test(tiles), "označení odhadu: " + tiles);
    assert(/zálohy nezadány/.test(tiles) && !/zálohy za 10/.test(tiles), "nulové zálohy: " + tiles);
    eq(errors, [], "chyby");
    await ctx.close();
  },

  async "klienti: filtry Všichni / V pipeline / Se smlouvou / Jen z kalendáře"() {
    const now = new Date("2026-10-28T10:00:00Z").toISOString();
    const store = { "settings/main": S({ calPrefix: "VK:", calId: "primary" }),
      "leads/a": L("Jan Novák", "podpis", "2026-10-05T10:00:00Z", 120, { items: [{ p: "ŽP", v: "NN_OR", amt: 1500, pts: 120 }] }),
      "leads/b": L("Eva Malá", "podpis", "2026-09-10T10:00:00Z", 300),
      "leads/c": L("Tomáš Bílý", "nabidka", null, 0),
      "leads/d": L("Lucie Zelená", "schuzka", null, 0, { meetings: [{ id: "ev2", start: "2026-11-03T09:00:00Z", title: "VK: Zelená" }] }),
      "leads/e": L("Martin Ztracený", "lost", null, 0) };
    const { ctx, page, errors } = await at("2026-10-28", store, { width: 1440 });
    await page.evaluate(() => { calHist = [{ id: "ev1", summary: "VK: Karel Kalendářový", start: { dateTime: "2026-09-01T10:00:00+02:00" } }, { id: "ev2", summary: "VK: Lucie Zelená", start: { dateTime: "2026-11-03T10:00:00+01:00" } }]; setView("cli") });
    await page.waitForTimeout(300);
    const pick = async f => { await page.evaluate(f => { cliFilter = f; renderClients() }, f); await page.waitForTimeout(100);
      return page.$$eval("#cliList .crow .t", els => els.map(e => e.firstChild.textContent.trim()).sort()) };
    eq(await pick("all"), ["Eva Malá", "Jan Novák", "Karel Kalendářový", "Lucie Zelená", "Tomáš Bílý"], "Všichni (bez Lost)");
    eq(await pick("pipe"), ["Lucie Zelená", "Tomáš Bílý"], "V pipeline");
    eq(await pick("prod"), ["Eva Malá", "Jan Novák"], "Se smlouvou – i podepsaný lead bez položek");
    eq(await pick("cal"), ["Karel Kalendářový"], "Jen z kalendáře – žádné leady z pipeline");
    eq(await page.$$eval("#cFilter button", b => b.map(x => x.textContent)), ["Všichni", "V pipeline", "Se smlouvou", "Jen z kalendáře"], "filtry");
    const tile = (await page.locator("#cTiles .tile").first().textContent()).replace(/\s+/g, " ");
    assert(/^Klienti ?2 ?\+ 2 v pipeline · 1 jen z kalendáře$/.test(tile.trim()), "dlaždice bez duplicity: " + tile);
    assert(!/\b2 klient/.test(await page.textContent("#sub")), "podnadpis neopakuje číslo z dlaždice");
    eq(await page.locator("#view_cli button", { hasText: "Výstup do Numbers" }).count(), 0, "Výstup do Numbers jen ve Štafli");
    eq(errors, [], "chyby");
    await ctx.close();
  },

  async "hodnota klientů v Kč podle tarifu kvartálu podpisu"() {
    const store = { "settings/main": S({ manual: { "2026-Q2": 3200 } }),
      "leads/a": L("Jan Novák", "vyplaceno", "2026-07-05T10:00:00Z", 100, { paidAt: "2026-08-01T10:00:00Z" }), "leads/b": L("Eva Malá", "podpis", "2026-10-05T10:00:00Z", 100) };
    const { ctx, page } = await at("2026-10-28", store, { width: 1440 });
    await page.evaluate(() => setView("cli")); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ q3: quarterRate("2026-Q3"), q4: quarterRate("2026-Q4") }));
    assert(r.q3 !== r.q4, "tarify kvartálů se liší");
    const rows = await page.$$eval("#stGrid .panel:nth-child(3) tr", tr => tr.slice(1).map(x => [...x.children].map(td => td.textContent.replace(/ /g, " "))));
    const kc = n => Math.round(n).toLocaleString("cs-CZ").replace(/ /g, " ") + " Kč";
    eq(rows.find(x => x[0] === "Jan Novák")[3], kc(100 * r.q3), "Q3 tarifem Q3");
    eq(rows.find(x => x[0] === "Eva Malá")[3], kc(100 * r.q4), "Q4 tarifem Q4");
    await ctx.close();
  },

  async "Obrat a Síť: tým jen v Síti, jedno + Člen týmu, benchmarky v listu, pasiv měsíčně"() {
    const store = { "settings/main": S(), "team/t1": { name: "Mirek", pos: "P1", parent: null, m: { "2026-10": 300 }, _u: 1 } };
    const { ctx, page, errors } = await at("2026-10-28", store, { width: 1440 });
    eq(await page.evaluate(() => ["teamTree", "careerBar", "pTiles", "mBenchBtn"].map(id => document.getElementById(id).closest("section").id)), ["view_net", "view_money", "view_money", "view_money"], "umístění");
    eq(await page.locator("text=+ Člen týmu").count(), 1, "jedno tlačítko + Člen týmu");
    eq(await page.locator("[id^=mBenchRow]").count(), 0, "posuvníky nejsou nad grafy");
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    eq(await page.locator("#view_money .sechead", { hasText: "Pasivní příjem" }).count(), 1, "jedna sekce pasivního příjmu");
    const tiles = await page.$$eval("#pTiles .tile .v", v => v.map(x => x.textContent));
    assert(tiles.length === 4 && tiles.every(t => /\/měs$/.test(t)), "všechny pasivní dlaždice měsíčně: " + tiles);
    await page.click("#mBenchBtn"); await page.waitForTimeout(200);
    eq(await page.locator("#edBody input[type=range]").count(), 5, "5 benchmarků v listu");
    await page.evaluate(() => $("edDlg").close());
    await page.locator("#pTiles .tile", { hasText: "Meziprovize" }).click(); await page.waitForTimeout(300);
    eq(await page.evaluate(() => view), "net", "dlaždice Meziprovize vede do Sítě");
    assert(await page.locator("#teamTree .onode").count() >= 2, "strom týmu v Síti");
    eq(errors, [], "chyby");
    await ctx.close();
  },

  async "sazebník na iPhonu: název vždy viditelný, bez „bez ohledu na dobu“, DPS ze struktury"() {
    const { ctx, page, errors } = await at("2026-10-28", { "settings/main": S() }, { width: 390, height: 844 });
    await page.evaluate(() => setView("pp")); await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const rows = [...document.querySelectorAll("#ppList .row")].filter(x => x.querySelector(".end"));
      return { n: rows.length, narrow: rows.filter(x => x.querySelector(".main .t").getBoundingClientRect().width < 100).map(x => x.textContent.slice(0, 30)),
        flat: document.getElementById("ppList").textContent.includes("bez ohledu na dobu"), dps: rows.filter(x => /penzijní$/.test(x.querySelector(".t").textContent)).length,
        tables: [...document.querySelectorAll("#ppList table")].filter(t => /NN/.test(t.textContent) && /UNIQA/.test(t.textContent) && /max 10,4/.test(t.textContent)).length,
        overflow: document.documentElement.scrollWidth > innerWidth } });
    assert(r.n > 20, "řádky sazeb: " + r.n);
    eq(r.narrow, [], "řádky s neviditelným názvem");
    eq([r.flat, r.dps, r.tables, r.overflow], [false, 8, 0, false], "flat bez opakování, DPS 8 společností jako řádky, bez vodorovného posunu");
    eq(errors, [], "chyby");
    await ctx.close();
  },
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (filter && !name.includes(filter)) continue;
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
