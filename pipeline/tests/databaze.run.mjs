// Testy záložky Databáze (databaze.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/databaze.run.mjs [--shots]
// PDF s detailem smlouvy ze Stely se tu generují z fiktivních dat (stejné rozložení tabulky jako na portálu) – žádná skutečná data klientů.
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const SHOTS = process.argv.includes("--shots");
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

/* ---------- fiktivní PDF ve tvaru „Detail smlouvy“ ze Stely ---------- */
const row = (l1, v1, l2, v2) => `<tr><td class="l">${l1}</td><td class="v">${v1 ?? ""}</td><td class="l">${l2}</td><td class="v">${v2 ?? ""}</td></tr>`;
function stelaHtml(o) {
  const d = { name: "Jana Nováková", name2: "Petr Novák", premium: "500 Kč", freq: "měsíčně", start: "20.01.2009", surrender: "123456,78 Kč", key: "9900000001", asOf: "14.10.2026", ...o };
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>
    body{font:11px Arial,sans-serif;margin:24px}table{width:100%;border-collapse:collapse;margin-bottom:8px}td{border:1px solid #ccc;padding:5px 6px;vertical-align:top}
    td.l{width:22%}td.v{width:28%}h4{margin:10px 0 4px}</style></head><body>
    <div>14.10.26 12:12 NN Stela 2.0</div><h3>Detail smlouvy</h3><b>2010 - ZFP DŮCHOD - ${d.key}</b>
    <h4>Pojistník</h4><table>
    ${row("Jméno a příjmení", d.name, "Trvalé bydliště", "Fiktivní 1, Brno")}
    ${row("Datum narození", "", "Kontaktní adresa", "")}
    ${row("Telefon", "", "Email", "")}</table>
    <h4>Údaje o pojištění</h4><table>
    ${row("Pojistné", d.premium, "Datum sepsání smlouvy", "01.12.2008")}
    ${row("Frekvence placení", d.freq, "Datum počátku pojištění", "20.01.2009")}
    ${row("Způsob placení", "bankovním převodem", "Datum technického počátku", d.start)}
    ${row("Indexace", "ne", "Datum zaevidování v systému", "02.12.2008")}</table>
    <h4>Pojištěná osoba</h4><table>
    ${row("Jméno a příjmení", d.name2, "Trvalé bydliště", "Fiktivní 2, Brno")}
    ${row("Datum narození", "", "Email", "")}</table>
    <h4>Podílový účet</h4><p>Hodnota investice: 130000,50 Kč</p><p>Hodnota odkupného: ${d.surrender}</p>
    <p>Platnost dat: ${d.asOf} Poslední přihlášení: 15.12.2015 09:56:33</p>
    <p>https://stela20.nn.cz/Agent/SmlouvaDetail.aspx?cntID=${d.key}</p></body></html>`;
}
async function pdfOf(html) {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.setContent(html); const buf = await p.pdf({ format: "A4" }); await ctx.close(); return buf;
}
const stelaPdf = o => pdfOf(stelaHtml(o));
const file = (name, buffer) => ({ name, mimeType: "application/pdf", buffer });

/* ---------- stránka s modulem ---------- */
async function open({ width = 1100, height = 800, dark = false, pre = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8">
    <style>:root{--bg:#F2F2F7;--bg2:#fff;--label:#000;--label2:rgba(60,60,67,.6);--sep:rgba(60,60,67,.18);--orange:#FF9500;--orange-soft:rgba(255,149,0,.14);--red:#FF3B30;--tint:#007AFF;--card-shadow:0 1px 2px rgba(0,0,0,.04)}
    @media (prefers-color-scheme: dark){:root{--bg:#000;--bg2:#1C1C1E;--label:#fff;--label2:rgba(235,235,245,.6);--sep:rgba(84,84,88,.6)}}body{background:var(--bg);margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif}</style>
    </head><body><div id="box"></div><script src="databaze.js"></script><script>
    window.toasts=[];window.ui=Databaze.mount(document.getElementById("box"),{toast:m=>toasts.push(m)});
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ui);
  return { ctx, page, errors, dialogs };
}
const upload = async (page, files) => {
  await page.setInputFiles('input[type="file"]', files);
  await page.waitForFunction(() => document.querySelector(".db-msg"), null, { timeout: 15000 });
};
const table = page => page.$$eval("tbody tr", trs => trs.map(tr => [...tr.querySelectorAll("input")].map(i => i.value.replace(/[  ]/g, " "))));
const foot = page => page.$eval("tfoot", f => f.textContent.replace(/[\u00a0\u202f]/g, " "));
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("db_rows_v1") || "[]"));

/* text tak, jak ho dává pdf.js z Stely: levý i pravý sloupec na jednom řádku */
const TXT = (o = {}) => {
  const d = { name: "Jana Nováková", start: "20.01.2009", premium: "500 Kč", surrender: "123456,78 Kč", key: "9900000002", ...o };
  return [
    "Detail smlouvy", `2010 - ZFP DŮCHOD - ${d.key}`, "Pojistník",
    `Jméno a příjmení ${d.name} Trvalé bydliště Fiktivní 1, Brno`, "Datum narození Kontaktní adresa", "Údaje o pojištění",
    `Pojistné ${d.premium} Datum sepsání smlouvy 01.12.2008`, "Frekvence placení měsíčně Datum počátku pojištění 20.01.2009",
    `Způsob placení bankovním převodem Datum technického počátku ${d.start}`.trim(), "Indexace ne Datum zaevidování v systému 02.12.2008",
    "Pojištěná osoba", "Jméno a příjmení Petr Novák Trvalé bydliště Fiktivní 2, Brno",
    "Podílový účet", "Hodnota investice: 130000,50 Kč", `Hodnota odkupného: ${d.surrender}`,
    "Funkční zařazení: Broker Platnost dat: 14.10.2026 Poslední přihlášení: 15.12.2015 09:56:33",
    `https://stela20.nn.cz/Agent/SmlouvaDetail.aspx?cntID=${d.key} 1/2`
  ].join("\n");
};

const tests = {
  async "parseStela: čtyři pole, jméno bere z Pojistníka (ne z pojištěné osoby)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(t => Databaze.math.parseStela(t), TXT());
    eq(r.rec, { key: "9900000002", name: "Jana Nováková", premium: 500, surrender: 123456.78, start: "2009-01-20", asOf: "2026-10-14" }, "záznam");
    eq(r.missing, [], "chybějící");
    assert(r.ok, "ok");
    await ctx.close();
  },
  async "parseStela: prázdné jméno a datum (začerněné/chybí) se nepřevezme z jiného řádku"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(t => Databaze.math.parseStela(t), TXT({ name: "", start: "" }));
    eq([r.rec.name, r.rec.start, r.rec.premium, r.rec.surrender], ["", "", 500, 123456.78], "pole");
    eq(r.missing, ["name", "start"], "chybějící");
    assert(r.ok, "částky stačí na ok");
    await ctx.close();
  },
  async "parseStela: tisíce s mezerou, desetinná čárka, text bez diakritiky"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(t => Databaze.math.parseStela(t), TXT({ premium: "6 000 Kč", surrender: "1 234 567,89 Kč" }));
    eq([r.rec.premium, r.rec.surrender], [6000, 1234567.89], "částky");
    const nd = await page.evaluate(t => Databaze.math.parseStela(t.normalize("NFD").replace(/[̀-ͯ]/g, "")), TXT());
    eq([nd.rec.premium, nd.rec.surrender, nd.rec.start], [500, 123456.78, "2009-01-20"], "bez diakritiky");
    await ctx.close();
  },
  async "parseStela: cizí text není smlouva"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => Databaze.math.parseStela("Faktura č. 2026/15\nCelkem k úhradě 12 000 Kč"));
    assert(!r.ok, "nemá být ok");
    await ctx.close();
  },
  async "import PDF: čtyři sloupce se naplní z reálně vygenerovaného PDF"() {
    const { ctx, page, errors } = await open();
    await upload(page, [file("detail.pdf", await stelaPdf())]);
    eq(await table(page), [["Jana Nováková", "500 Kč", "123 456,78 Kč", "2009-01-20"]], "řádek");
    eq((await page.$$eval("th", ths => ths.map(t => t.textContent.replace(/[▲▼]/g, "").trim()))).slice(0, 4), ["Jméno a příjmení", "Pojistné", "Odkupné", "Datum technického počátku"], "hlavičky");
    const st = await stored(page);
    eq([st.length, st[0].key, st[0].asOf], [1, "9900000001", "2026-10-14"], "uložený záznam");
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "import PDF: prázdné jméno a datum → oranžová pole, ruční doplnění se při dalším nahrání nepřepíše"() {
    const { ctx, page } = await open();
    await upload(page, [file("a.pdf", await stelaPdf({ name: "", start: "" }))]);
    eq(await table(page), [["", "500 Kč", "123 456,78 Kč", ""]], "řádek");
    eq(await page.$$eval("input.miss", i => i.length), 2, "počet oranžových polí");
    assert((await page.textContent(".dbx")).includes("chybí jméno, datum technického počátku"), "hláška o chybějících polích");
    /* ruční doplnění */
    await page.fill("tbody tr input >> nth=0", "Ručně Doplněný");
    await page.press("tbody tr input >> nth=0", "Tab");
    /* nové PDF téže smlouvy s jiným odkupným, opět bez jména → jméno zůstane, odkupné se aktualizuje */
    await page.evaluate(() => { document.querySelector(".db-msg")?.remove(); });
    await page.setInputFiles('input[type="file"]', [file("b.pdf", await stelaPdf({ name: "", start: "", surrender: "160000,10 Kč" }))]);
    await page.waitForFunction(() => /aktualizovan/.test(document.querySelector(".dbx").textContent));
    eq(await table(page), [["Ručně Doplněný", "500 Kč", "160 000,1 Kč", ""]], "po aktualizaci");
    eq((await stored(page)).length, 1, "pořád jeden řádek");
    await ctx.close();
  },
  async "import víc PDF najednou + PDF, které není ze Stely, se odmítne"() {
    const { ctx, page } = await open();
    const junk = await pdfOf("<!doctype html><meta charset=utf-8><p>Nabídka pojištění 1 000 Kč</p>");
    await upload(page, [
      file("1.pdf", await stelaPdf({ key: "9900000011", name: "Zdeněk Čermák", premium: "1 250 Kč", surrender: "45678,90 Kč", start: "01.03.2015" })),
      file("2.pdf", await stelaPdf({ key: "9900000012", name: "Alena Dvořáková", premium: "800 Kč", surrender: "9 999 Kč", start: "20.07.2012" })),
      file("3.pdf", junk)
    ]);
    eq(await table(page), [["Alena Dvořáková", "800 Kč", "9 999 Kč", "2012-07-20"], ["Zdeněk Čermák", "1 250 Kč", "45 678,9 Kč", "2015-03-01"]], "seřazeno podle jména (česky)");
    eq(await foot(page), "Celkem55 677,9 Kč", "součet odkupného (45 678,9 + 9 999)");
    const t = await page.textContent(".dbx");
    assert(/Načteno 2 z 3 PDF/.test(t) && t.includes("3.pdf: nevypadá to jako detail smlouvy"), "hlášky: " + t.slice(0, 300));
    await ctx.close();
  },
  async "tabulka: úprava buňky se uloží a přežije znovunačtení, hledání bez diakritiky, řazení, mazání"() {
    const { ctx, page } = await open();
    await upload(page, [
      file("1.pdf", await stelaPdf({ key: "9900000021", name: "Zdeněk Čermák", premium: "1 250 Kč", surrender: "45678,90 Kč", start: "01.03.2015" })),
      file("2.pdf", await stelaPdf({ key: "9900000022", name: "Alena Dvořáková", premium: "800 Kč", surrender: "9 999 Kč", start: "20.07.2012" }))
    ]);
    /* úprava odkupného: při zaměření se ukáže surové číslo, po změně znovu formátované */
    const cell = page.locator("tbody tr").nth(1).locator("input").nth(2);
    await cell.focus(); eq(await cell.inputValue(), "45678,9", "surová hodnota při zaměření");
    await cell.fill("50 000,5"); await cell.press("Tab");
    eq((await stored(page)).find(r => r.key === "9900000021").surrender, 50000.5, "uloženo");
    await cell.fill("abc"); await cell.press("Tab");
    assert(page.evaluate(() => toasts.includes("Zadej částku číslem")), "toast při nesmyslu");
    eq((await stored(page)).find(r => r.key === "9900000021").surrender, 50000.5, "nesmysl se neuloží");
    /* znovunačtení stránky = data zůstala */
    await page.reload(); await page.waitForFunction(() => window.ui);
    eq((await table(page)).length, 2, "po reloadu");
    /* hledání bez diakritiky */
    await page.fill(".db-search", "cermak");
    eq((await table(page)).map(r => r[0]), ["Zdeněk Čermák"], "hledání");
    await page.fill(".db-search", "");
    /* řazení podle odkupného sestupně = dvakrát klik */
    await page.click("th:has-text('Odkupné')"); await page.click("th:has-text('Odkupné')");
    eq((await table(page)).map(r => r[0]), ["Zdeněk Čermák", "Alena Dvořáková"], "řazení sestupně");
    /* smazání řádku a pak všeho */
    await page.locator("td.x button").first().click();
    eq((await stored(page)).length, 1, "po smazání řádku");
    await page.click("text=Smazat vše");
    eq((await stored(page)).length, 0, "po smazání všeho");
    await ctx.close();
  },
  async "součet odkupného: při hledání jen vyhledané, smlouva bez odkupného se nepočítá a je to vidět"() {
    const { ctx, page } = await open();
    await upload(page, [
      file("1.pdf", await stelaPdf({ key: "9900000041", name: "Zdeněk Čermák", surrender: "1 000,50 Kč" })),
      file("2.pdf", await stelaPdf({ key: "9900000042", name: "Alena Dvořáková", surrender: "2 000 Kč" })),
      file("3.pdf", await stelaPdf({ key: "9900000043", name: "Bez Odkupného", surrender: "" }))
    ]);
    eq(await foot(page), "Celkem · 1 bez odkupného nezapočteno3 000,5 Kč", "součet všech");
    await page.fill(".db-search", "cermak");
    eq(await foot(page), "Celkem (vyhledané)1 000,5 Kč", "součet vyhledaných");
    await ctx.close();
  },
  async "CSV export: BOM, středník, desetinná čárka a ochrana před vzorcem"() {
    const { ctx, page } = await open();
    const csv = await page.evaluate(() => Databaze.math.toCsv([
      { name: "Čermák; Zdeněk", premium: 1250, surrender: 45678.9, start: "2015-03-01" },
      { name: "=SUM(A1)", premium: null, surrender: 9999, start: "" }
    ]));
    eq(csv, "﻿Jméno a příjmení;Pojistné;Odkupné;Datum technického počátku\r\n\"Čermák; Zdeněk\";1250;45678,9;01.03.2015\r\n'=SUM(A1);;9999;", "csv");
    await ctx.close();
  },
  async "UI: mobil a tmavý režim bez chyb a bez vodorovného přetečení stránky"() {
    for (const o of [{ width: 390, height: 844 }, { width: 1300, height: 900, dark: true }]) {
      const { ctx, page, errors } = await open(o);
      await upload(page, [file("a.pdf", await stelaPdf({ name: "Zdeněk Čermák" })), file("b.pdf", await stelaPdf({ key: "9900000031", name: "", start: "" }))]);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(over <= 0, "vodorovné přetečení stránky o " + over + " px");
      if (SHOTS) await page.screenshot({ path: `/tmp/db-${o.width}${o.dark ? "-dark" : ""}.png`, fullPage: true });
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
