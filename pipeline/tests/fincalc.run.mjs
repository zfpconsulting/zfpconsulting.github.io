// Testy kalkulačky (fincalc.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/fincalc.run.mjs [--shots]
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const SHOTS = process.argv.includes("--shots");
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

/* prázdná stránka s tokeny barev jako v Pipeline + paměťové úložiště se stejným API jako LStore */
async function open({ width = 1300, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept(d.type() === "prompt" ? "Test klient" : undefined));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8">
    <style>:root{--bg:#F2F2F7;--bg2:#fff;--label:#000;--red:#FF3B30;--card-shadow:0 1px 2px rgba(0,0,0,.04)}
    @media (prefers-color-scheme: dark){:root{--bg:#000;--bg2:#1C1C1E;--label:#fff}}body{background:var(--bg);margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif}</style>
    </head><body><div id="box"></div><script src="fincalc.js"></script><script src="photoedit.js"></script><script>
    const docs={},subs=new Set(),emit=()=>subs.forEach(f=>f());let n=0;
    const store={collection:name=>({onSnapshot(cb){const f=()=>cb({docs:Object.entries(docs).filter(([k])=>k.startsWith(name+"/")).map(([k,v])=>({id:k.split("/")[1],data:()=>v}))});subs.add(f);f()},
      async add(d){const id="d"+(++n);docs[name+"/"+id]=d;emit();return{id}}}),
      doc:p=>({onSnapshot(cb){const f=()=>cb({exists:!!docs[p],data:()=>docs[p]});subs.add(f);f()},async set(d){docs[p]=d;emit()},async delete(){delete docs[p];emit()}})};
    window.toasts=[];window.__store=store;window.ui=FinCalc.mount(document.getElementById("box"),{store,toast:m=>toasts.push(m)});window.docs=docs;
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ui);
  return { ctx, page, errors };
}
const tiles = page => page.$$eval(".fc-tile", ts => Object.fromEntries(ts.map(t => [t.querySelector(".k").textContent, t.querySelector(".v").textContent])));

const tests = {
  async "výpočty: investice podle kalkulačky ZFP (100 000 + 5 000/měs., 6 %, 20 let)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { solve } = FinCalc.math, b = { pv: 100000, pmt: 5000, years: 20, rate: 6, freq: "m" };
      const fv = solve("inv", b, "fv").val;
      return {
        fv, pmt: solve("inv", { ...b, fv }, "pmt").val, pv: solve("inv", { ...b, fv }, "pv").val,
        years: solve("inv", { ...b, fv }, "years").val, rate: solve("inv", { ...b, fv }, "rate").val,
        neg: solve("inv", { ...b, fv: 200000 }, "pmt")
      };
    });
    eq(Math.round(r.fv), 2641225, "konečná hodnota");
    assert(Math.abs(r.pmt - 5000) < 0.01, "zpětně měsíční investice: " + r.pmt);
    assert(Math.abs(r.pv - 100000) < 0.01, "zpětně jednorázový vklad: " + r.pv);
    assert(Math.abs(r.years - 20) < 1e-6, "zpětně doba: " + r.years);
    assert(Math.abs(r.rate - 6) < 1e-6, "zpětně zhodnocení: " + r.rate);
    assert(!r.neg.ok && /záporn/.test(r.neg.err), "záporná investice se hlásí chybou");
    await ctx.close();
  },
  async "výpočty: úvěr a renta"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { solve } = FinCalc.math;
      const loan = { pv: 3000000, years: 30, rate: 5, freq: "m" };
      const pmt = solve("loan", loan, "pmt").val;
      return {
        pmt, rate: solve("loan", { ...loan, pmt }, "rate").val,
        never: solve("loan", { ...loan, pmt: 12000 }, "years"),
        yrs: solve("loan", { ...loan, pmt: 20000 }, "years").val,
        renta: solve("renta", { pv: 3000000, years: 20, rate: 4, fv: 0, freq: "m" }, "pmt").val,
        rentaKeep: solve("renta", { pv: 3000000, years: 20, rate: 4, fv: 3000000, freq: "m" }, "pmt").val,
        zero: solve("inv", { pv: 1000, pmt: 100, years: 10, rate: 0, freq: "m" }, "fv").val,
        q: solve("inv", { pv: 100000, pmt: 0, years: 1, rate: 12, freq: "q" }, "fv").val
      };
    });
    assert(Math.abs(r.pmt - 16104.65) < 0.01, "anuitní splátka 3 mil./30 let/5 %: " + r.pmt);
    assert(Math.abs(r.rate - 5) < 1e-6, "zpětně sazba úvěru");
    assert(!r.never.ok && /úroky/.test(r.never.err), "splátka pod úroky = chyba");
    assert(Math.abs(r.yrs - 19.657424624271) < 1e-6, "doba splácení při 20 000/měs.: " + r.yrs);
    assert(Math.abs(r.renta - 18179.41) < 0.01, "renta 3 mil./20 let/4 %: " + r.renta);
    assert(Math.abs(r.rentaKeep - 10000) < 0.01, "renta s ponecháním jistiny = jen úrok 10 000: " + r.rentaKeep);
    eq(r.zero, 13000, "nulové zhodnocení");
    assert(Math.abs(r.q - 112550.88) < 0.01, "čtvrtletní připisování 12 % = 12,55 % ročně: " + r.q);
    await ctx.close();
  },
  async "UI: výchozí investice, psaní, vlajka, režimy, uložení"() {
    const { ctx, page, errors } = await open();
    let t = await tiles(page);
    eq(t["Konečná hodnota inv."], "2 641 225 Kč", "dlaždice konečná hodnota");
    eq(t["Celkem vložíte"], "1 300 000 Kč", "dlaždice vloženo");
    assert(await page.$eval('input[data-k="fv"]', i => i.disabled), "dopočítávané pole je zamčené");
    assert(await page.$("#fcChart svg"), "graf se vykreslil");
    // psaní do pole přepočítá výsledky a kurzor zůstane v poli
    await page.click('input[data-k="pmt"]');
    await page.keyboard.press("Control+A");
    await page.keyboard.type("10000");
    t = await tiles(page);
    eq(t["Pravidelná měs. inv."], "10 000 Kč", "nová měsíční investice");
    assert(await page.evaluate(() => document.activeElement?.dataset.k === "pmt"), "kurzor zůstal v poli");
    // + / − tlačítka
    await page.click('button[data-a="inc"][data-k="years"]');
    eq((await tiles(page))["Splatnost"], "21 let", "plus u splatnosti");
    // vlajka: dopočítat měsíční investici k cíli 3 mil.
    await page.click('button[data-a="flag"][data-k="pmt"]');
    assert(await page.$eval('input[data-k="pmt"]', i => i.disabled), "měsíční investice je teď dopočítávaná");
    await page.fill('input[data-k="fv"]', "3000000");
    await page.keyboard.press("Tab");
    t = await tiles(page);
    eq(t["Konečná hodnota inv."], "3 000 000 Kč", "cíl");
    assert(/Kč$/.test(t["Pravidelná měs. inv."]) && t["Pravidelná měs. inv."] !== "10 000 Kč", "dopočtená investice: " + t["Pravidelná měs. inv."]);
    // nesmyslné zadání ukáže chybu, ne NaN
    await page.fill('input[data-k="fv"]', "1000");
    await page.keyboard.press("Tab");
    assert(await page.$eval(".fc-errm", e => !e.hidden && /záporn/.test(e.textContent)), "chybová hláška");
    assert(!(await page.content()).includes("NaN"), "nikde NaN");
    // úvěr
    await page.click('button[data-a="mode"][data-k="loan"]');
    t = await tiles(page);
    eq(t["Měsíční splátka"], "16 105 Kč", "splátka úvěru");
    eq(t["Přeplatek na úrocích"], "2 797 674 Kč", "přeplatek");
    // renta
    await page.click('button[data-a="mode"][data-k="renta"]');
    eq((await tiles(page))["Měsíční renta"], "18 179 Kč", "renta");
    // uložení + načtení ze seznamu
    await page.click('button[data-a="save"]');
    assert(await page.$eval(".fc-title", e => e.textContent.includes("Test klient")), "název v hlavičce");
    assert(await page.evaluate(() => Object.keys(docs).length === 1), "uloženo do úložiště");
    await page.click('button[data-a="new"]');
    assert(await page.$eval(".fc-title", e => /Koncept$/.test(e.textContent)), "nová kalkulace = Koncept");
    await page.click('button[data-a="menu"]');
    await page.click('button[data-a="load"]');
    assert(await page.$eval(".fc-title", e => e.textContent.includes("Test klient")), "načtená kalkulace");
    // stav přežije znovunačtení
    await page.reload(); await page.waitForFunction(() => window.ui);
    eq(await page.$eval('.fc-tabs [aria-selected="true"]', b => b.textContent), "Renta", "zapamatovaný režim");
    assert(!errors.length, "chyby v konzoli: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: animace křivky při změně zadání, ne při překreslení"() {
    const { ctx, page, errors } = await open();
    const dNow = () => page.$eval("#fcChart .fc-la", p => p.getAttribute("d"));
    await page.waitForTimeout(1100);
    const final1 = await dNow();
    await page.click('button[data-a="inc"][data-k="years"]');
    await page.waitForTimeout(120);
    const mid = await dNow();
    if (SHOTS) await page.screenshot({ path: "/tmp/fc-anim.png" });
    await page.waitForTimeout(1100);
    const final2 = await dNow();
    assert(mid !== final2, "uprostřed animace je křivka jinde než na konci");
    // pravý konec investice roste zdola: uprostřed animace leží níž (větší y) než na konci
    const lastY = d => +d.trim().split(/[ML]/).filter(Boolean).pop().split(" ")[1];
    assert(lastY(mid) > lastY(final2) + 5, `pravý konec stoupá (${lastY(mid)} → ${lastY(final2)})`);
    assert(final1 !== final2, "změna zadání změnila křivku");
    // otevření nápovědy překreslí panel, ale křivka se znovu neanimuje
    await page.click('button[data-a="help"][data-k="pv"]');
    eq(await dNow(), final2, "bez animace při překreslení");
    // úvěr: levý začátek klesající křivky stoupá zdola
    await page.click('button[data-a="mode"][data-k="loan"]');
    await page.waitForTimeout(120);
    const firstY = d => +d.trim().slice(1).split("L")[0].split(" ")[1];
    const lm = await dNow(); await page.waitForTimeout(1100); const lf = await dNow();
    assert(firstY(lm) > firstY(lf) + 5, `levý začátek úvěru stoupá (${firstY(lm)} → ${firstY(lf)})`);
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: PDF má vodoznak a hodnoty"() {
    const { ctx, page, errors } = await open();
    const popP = ctx.waitForEvent("page");
    await page.click('button[data-a="pdf"]');
    const pop = await popP;
    await pop.waitForLoadState();
    const html = await pop.content();
    assert(html.includes("2 641 225 Kč") && html.includes("CONSULTING") && html.includes("Vývoj hodnoty investice"), "obsah PDF");
    if (SHOTS) await pop.screenshot({ path: "/tmp/fc-pdf.png", fullPage: true });
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "vodoznak: ZFP, text, žádný, vlastní obrázek – v grafu i v PDF, uloží se"() {
    const { ctx, page, errors } = await open();
    assert(await page.$eval("#fcChart svg", s => s.textContent.includes("CONSULTING")), "výchozí ZFP");
    await page.click('button[data-a="menu"]');
    await page.click('button[data-a="wmt"][data-k="text"]');
    assert(await page.$eval(".fc-menu", m => !!m), "menu zůstalo otevřené");
    await page.fill('input[data-w="txt"]', "Vojtěch Kudlička");
    assert(await page.$eval("#fcChart svg .fc-wm", t => t.textContent === "Vojtěch Kudlička"), "textový vodoznak");
    await page.$eval('input[data-w="op"]', i => { i.value = "0.6"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
    eq(await page.$eval("#fcChart svg .fc-wm", t => t.getAttribute("opacity")), "0.6", "průhlednost");
    assert(await page.$eval(".fc-menu", m => !!m), "posuvník menu nezavřel");
    eq(await page.evaluate(() => docs["fcprefs/main"].wm.txt), "Vojtěch Kudlička", "uloženo do úložiště");
    await page.click('button[data-a="wmt"][data-k="none"]');
    assert(!(await page.$("#fcChart svg .fc-wm")) && !(await page.$eval("#fcChart svg", s => s.textContent.includes("CONSULTING"))), "žádný vodoznak");
    // vlastní obrázek: výběr souboru
    const png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "#c00"; x.fillRect(0, 0, 400, 200); return c.toDataURL("image/png").split(",")[1]; }), "base64");
    const fc = page.waitForEvent("filechooser");
    await page.click('button[data-a="wmt"][data-k="img"]');
    await (await fc).setFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => document.querySelector("#fcChart svg image.fc-wm"));
    const r = await page.$eval("#fcChart svg image.fc-wm", i => (+i.getAttribute("width")) / (+i.getAttribute("height")));
    assert(Math.abs(r - 2) < 0.01, "poměr stran obrázku zachován: " + r);
    // PDF použije stejný vodoznak
    const popP = ctx.waitForEvent("page");
    await page.click('button[data-a="pdf"]');
    const pop = await popP; await pop.waitForLoadState();
    assert((await pop.content()).includes('class="fc-wm"'), "vodoznak v PDF");
    // po znovunačtení zůstane
    await page.reload(); await page.waitForFunction(() => window.ui);
    assert(await page.$("#fcChart svg image.fc-wm"), "vodoznak zapamatovaný");
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "editor fotky: posun, zoom, otočení, výstup 320×320, znovu otevření se stejným výřezem"() {
    const { ctx, page, errors } = await open({ width: 430, height: 900 });
    await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 600; c.height = 300; const x = c.getContext("2d");
      x.fillStyle = "#00f"; x.fillRect(0, 0, 300, 300); x.fillStyle = "#f00"; x.fillRect(300, 0, 300, 300);
      window.peOut = null; window.peEl = PhotoEdit.create({ src: c.toDataURL("image/png"), onSave: r => { window.peOut = r }, onCancel: () => { window.peCancel = 1 } });
      document.body.prepend(window.peEl);
    });
    await page.waitForTimeout(200);
    const box = await page.$eval(".pe-view", v => { const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } });
    // táhnout doleva → do kruhu se posune pravá (červená) půlka
    await page.mouse.move(box.x + box.w / 2, box.y + box.w / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.w / 2 - 300, box.y + box.w / 2, { steps: 8 }); await page.mouse.up();
    const st1 = await page.evaluate(() => ({ ...peEl._state }));
    assert(st1.x < -0.4, "posun doleva až k okraji: " + st1.x);
    // zoom posuvníkem
    await page.$eval(".pe-zoom input", i => { i.value = "2"; i.dispatchEvent(new Event("input", { bubbles: true })) });
    eq(await page.evaluate(() => peEl._state.z), 2, "zoom");
    await page.click('[data-pe="save"]');
    await page.waitForFunction(() => window.peOut);
    const out = await page.evaluate(async () => { const i = new Image(); i.src = peOut.photo; await i.decode(); const c = document.createElement("canvas"); c.width = c.height = 320; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
      const d = x.getImageData(160, 160, 1, 1).data; return { w: i.naturalWidth, h: i.naturalHeight, r: d[0], b: d[2], crop: peOut.crop, src: peOut.src.slice(0, 22) } });
    eq([out.w, out.h], [320, 320], "čtverec 320 px");
    assert(out.r > 200 && out.b < 60, "uprostřed je červená půlka fotky");
    eq(out.crop.z, 2, "uložený zoom");
    // znovu otevřít s uloženým výřezem → stejný stav; otočení
    await page.evaluate(() => { peEl.remove(); window.peEl = PhotoEdit.create({ src: peOut.src, crop: peOut.crop, onSave: r => { window.peOut2 = r } }); document.body.prepend(peEl) });
    await page.waitForTimeout(150);
    eq(await page.evaluate(() => ({ z: peEl._state.z, x: peEl._state.x })), { z: out.crop.z, x: out.crop.x }, "výřez obnoven");
    await page.click('[data-pe="rot"]'); eq(await page.evaluate(() => peEl._state.r), 90, "otočení");
    await page.click('[data-pe="save"]'); await page.waitForFunction(() => window.peOut2);
    await page.screenshot({ path: "/tmp/pe.png" });
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "hypotéka: vlastní zdroje, LTV, potřebný příjem, aktuální sazba (výpočty)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { loanInfo, liveRate } = FinCalc.math;
      const L = loanInfo({ price: 3750000, pv: 3000000, pmt: 16000, other: 2000, dsti: 40, dti: 8, ltvType: "own" });
      const D = loanInfo({ price: 0, pv: 3000000, pmt: 8000, other: 0, dsti: 50, dti: 8 });
      const R = { fix: { 5: { a: 5.51, b: 5.82 }, 3: { a: 6.15, b: null } } };
      return { own: L.own, ltv: L.ltv, need: L.need, bind: L.binding, warn: L.warn.length, dti: D.need, dbind: D.binding,
        over: loanInfo({ price: 3500000, pv: 3000000, pmt: 1, ltvType: "own" }).warn[0] || "", young: loanInfo({ price: 3500000, pv: 3000000, pmt: 1, ltvType: "young" }).warn.length,
        r80: liveRate(5, 80, R), r85: liveRate(5, 85, R), only: liveRate(3, 85, R).rate, none: liveRate(10, 50, R) };
    });
    eq([r.own, r.ltv, r.need, r.bind, r.warn], [750000, 80, 45000, "dsti", 0], "vlastní zdroje, LTV 80 %, příjem (16 000 + 2 000) / 40 %");
    eq([r.dti, r.dbind], [31250, "dti"], "DTI 8: 3 mil. / 8 / 12");
    assert(/LTV 85,71 % překračuje limit ČNB 80 %/.test(r.over), "varování LTV: " + r.over);
    eq(r.young, 0, "do 36 let limit 90 %");
    eq([r.r80, r.r85, r.only, r.none], [{ rate: 5.51, band: "do 80 %" }, { rate: 5.82, band: "nad 80 %" }, 6.15, null], "sazba podle fixace a LTV");
    await ctx.close();
  },
  async "UI: úvěr – cena nemovitosti, aktuální sazba ze sazby.json, PDF"() {
    const { ctx, page, errors } = await open();
    await page.click('[data-a="mode"][data-k="loan"]');
    let t = await tiles(page);
    eq([t["Cena nemovitosti"], t["Vlastní zdroje (akontace)"], t["LTV"]], ["3 750 000 Kč", "750 000 Kč", "80,00 %"], "dlaždice nemovitosti");
    assert(t["Potřebný čistý příjem / měs."] && /Kč$/.test(t["Potřebný čistý příjem / měs."]), "potřebný příjem");
    assert(await page.isVisible(".fc-note"), "poznámka o příjmu");
    // aktuální sazba – sazba se zamkne a vezme z sazby.json (fixace 5 let, LTV do 80 %)
    await page.check('input[data-x="live"]');
    await page.waitForFunction(() => document.querySelector('input[data-k="rate"]').disabled);
    const json = await page.evaluate(() => fetch("sazby.json").then(r => r.json()));
    await page.waitForFunction(v => document.querySelector('input[data-k="rate"]').value === v, json.fix[5].a.toFixed(2).replace(".", ",") + " %");
    assert((await page.textContent(".fc-src")).includes("Swiss Life Hypoindex"), "zdroj sazby");
    // vyšší LTV → sazba nad 80 % a varování u vlastního bydlení, u „do 36 let“ bez varování
    await page.fill('input[data-k="price"]', "3400000"); await page.press('input[data-k="price"]', "Enter");
    await page.waitForFunction(v => document.querySelector('input[data-k="rate"]').value === v, json.fix[5].b.toFixed(2).replace(".", ",") + " %");
    assert(await page.isVisible(".fc-note.warn"), "varování LTV");
    await page.selectOption('select[data-x="ltvType"]', "young");
    assert(!(await page.isVisible(".fc-note.warn")), "do 36 let bez varování");
    await page.selectOption('select[data-x="fix"]', "10");
    await page.waitForFunction(v => document.querySelector('input[data-k="rate"]').value === v, json.fix[10].b.toFixed(2).replace(".", ",") + " %");
    t = await tiles(page);
    assert(t["Úroková sazba p.a. (aktuální)"], "dlaždice aktuální sazby");
    if (SHOTS) await page.screenshot({ path: "/tmp/fc-uver-live.png", fullPage: true });
    // vlajka u zamčené sazby nic nedopočítává
    assert(await page.isDisabled('.fc-f[data-k="rate"] .fc-flag'), "vlajka sazby zamčená");
    const popP = ctx.waitForEvent("page");
    await page.click('button[data-a="pdf"]');
    const pop = await popP; await pop.waitForLoadState();
    const html = await pop.content();
    assert(html.includes("Vlastní zdroje (akontace)") && html.includes("Zdroj sazby") && html.includes("Potřebný čistý příjem"), "obsah PDF úvěru");
    // vypnutí → sazba zůstane, jde zase psát
    await page.uncheck('input[data-x="live"]');
    assert(!(await page.isDisabled('input[data-k="rate"]')), "sazba odemčená");
    if (SHOTS) await page.screenshot({ path: "/tmp/fc-uver.png", fullPage: true });
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "RPSN: bez poplatků = efektivní roční sazba, poplatky ji zvednou; kalkulace přiřazená ke klientovi nese hypotéku"() {
    const { ctx, page, errors } = await open();
    const r = await page.evaluate(() => { const { rpsn } = FinCalc.math, v = { pv: 3000000, pmt: 17053, years: 30, feeOnce: 0, feeMonth: 0 };
      const pmt = FinCalc.math.solve("loan", { pv: 3000000, years: 30, rate: 5.51, freq: "m" }, "pmt").val;
      return { a: rpsn({ ...v, pmt }), b: rpsn({ ...v, pmt, feeOnce: 5000, feeMonth: 150 }), bad: rpsn({ pv: 0, pmt: 1, years: 1 }) }; });
    assert(Math.abs(r.a - (Math.pow(1 + 0.0551 / 12, 12) - 1) * 100) < 0.001, "RPSN bez poplatků " + r.a);
    assert(r.b > r.a + 0.05, "poplatky zvyšují RPSN " + r.b);
    assert(Number.isNaN(r.bad), "neplatný vstup");
    // přiřazení ke klientovi (Pipeline předá seznam klientů) a uložení úvěru
    await page.evaluate(() => { const old = document.getElementById("box"), nb = document.createElement("div"); nb.id = "box"; old.replaceWith(nb); localStorage.clear(); window.ui = FinCalc.mount(nb, { store: window.__store || null, toast: m => toasts.push(m), clients: () => [{ id: "c1", name: "Jana Petranová" }, { id: "c2", name: "Petr Novák" }] }); });
    await page.click('[data-a="mode"][data-k="loan"]');
    assert((await tiles(page))["RPSN"].endsWith("%"), "dlaždice RPSN");
    await page.click('button[data-a="menu"]');
    await page.selectOption('select[data-x="client"]', "c1");
    assert((await page.textContent(".fc-title")).includes("Jana Petranová"), "klient v názvu");
    eq(await page.evaluate(() => ui.state().clientId), "c1", "klient ve stavu");
    if (!(await page.evaluate(() => !!window.__store))) { eq(errors, [], "chyby"); await ctx.close(); return; }
    await page.click('button[data-a="save"]');
    const d = await page.waitForFunction(() => Object.values(docs).find(x => x.clientId === "c1")).then(h => h.jsonValue());
    eq([d.clientName, d.mode, d.hypo.pv, d.hypo.price, d.hypo.own], ["Jana Petranová", "loan", 3000000, 3750000, 750000], "uložená hypotéka u klienta");
    assert(d.hypo.rpsn > d.hypo.rate && d.hypo.need > 0, "RPSN a potřebný příjem v uložené kalkulaci");
    eq(errors, [], "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: starší uložená kalkulace úvěru bez nových polí se načte"() {
    const { ctx, page, errors } = await open();
    await page.evaluate(() => { const old = { mode: "loan", titles: {}, m: { loan: { v: { pv: 2000000, pmt: 0, years: 25, rate: 5, fv: 0, freq: "m" }, calc: "pmt" }, inv: { v: { pv: 1, pmt: 1, fv: 0, years: 1, rate: 1, freq: "m" }, calc: "fv" }, renta: { v: { pv: 1, pmt: 1, years: 1, rate: 1, fv: 0, freq: "m" }, calc: "pmt" } } };
      localStorage.setItem("fc_draft_v1", JSON.stringify(old)); });
    await page.reload(); await page.waitForFunction(() => window.ui);
    const t = await tiles(page);
    eq([t["Výše úvěru"], t["Cena nemovitosti"]], ["2 000 000 Kč", "3 750 000 Kč"], "doplněné výchozí hodnoty");
    assert(/Kč$/.test(t["Potřebný čistý příjem / měs."]), "příjem spočten");
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: mobil a tmavý režim bez chyb"() {
    for (const o of [{ width: 390, height: 844 }, { width: 1300, height: 900, dark: true }]) {
      const { ctx, page, errors } = await open(o);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(over <= 0, "vodorovné přetečení o " + over + " px");
      if (SHOTS) { await page.waitForTimeout(1100); await page.screenshot({ path: `/tmp/fc-${o.width}${o.dark ? "-dark" : ""}.png`, fullPage: true }); }
      assert(!errors.length, "chyby: " + errors.join(" | "));
      await ctx.close();
    }
  }
};

let ok = 0, bad = 0;
if (SHOTS) { const { ctx, page } = await open(); await page.waitForTimeout(1100); await page.screenshot({ path: "/tmp/fc-1300.png", fullPage: true }); await ctx.close(); }
for (const [name, fn] of Object.entries(tests)) {
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
