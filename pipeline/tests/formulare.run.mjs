// Testy záložky Formuláře (formulare.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/formulare.run.mjs [filtr]
import { loadPlaywright, startServer, assert, eq, appCss, smallTargets } from "./helpers.mjs";
const APPCSS = await appCss();
const filter = process.argv[2] || "";
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");
const CLIENTS = [
  { id: "c:1", name: "Ing. Jana Nováková", phone: "774 222 617", rec: { address: "Květinová 5, 602 00 Brno", birth: "1985-03-07", email: "jana@example.cz" }, lead: null,
    products: [{ company: "NN Životní pojišťovna", no: "1234567890", type: "Životní pojištění" }, { company: "Conseq penzijní společnost", no: "55443322" }] },
  { id: "l:2", name: "Petr Svoboda", rec: null, lead: { id: "L2", address: "Lipová 1, 614 00 Brno" } },
];
async function open({ width = 1300, height = 900, ls = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>${APPCSS}</style><style>body{margin:0;padding:16px}</style></head>
    <body><div id="box"></div><script src="formulare.js"></script><script>
    const LS=${JSON.stringify(ls)};const toasts=[];window.toasts=toasts;window.LS=LS;
    window.F=Formulare.mount(document.getElementById("box"),{toast:t=>toasts.push(t),ls:{get:k=>LS[k]??null,set:(k,v)=>{LS[k]=JSON.parse(JSON.stringify(v))}},
      clients:()=>${JSON.stringify(CLIENTS)},birthOf:e=>e.lead&&e.lead.id==="L2"?"1979-12-24":""});
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.F && F.catalog().forms.length > 0, null, { timeout: 15000 });
  return { ctx, page, errors };
}
const mode = (page, i) => page.click(`.frm-top .seg button >> nth=${i}`);
const chipInst = (page, t) => page.click(`.ipick .chip:text-is("${t}"), .ipick .chip:has-text("${t}")`);
const T = {
  "katalog: všechny instituce ze zadání, formuláře mají soubor, druh a zdroj": async () => {
    const { ctx, page, errors } = await open();
    const c = await page.evaluate(() => F.catalog());
    const ids = c.inst.map(i => i.id);
    for (const id of ["allianz", "generali", "uniqa", "koop", "cpp", "csob", "nn", "allianzps", "conseqps", "csps", "csobps", "genps", "kbps", "nnps", "rentea", "uniqaps", "zfpi", "zfpwi", "conseq"]) assert(ids.includes(id), "instituce " + id);
    assert(c.forms.length >= 60, "aspoň 60 formulářů (" + c.forms.length + ")");
    for (const f of c.forms) { assert(["vyp", "navaz", "zmena", "prevod"].includes(f.kind), "druh " + f.id); assert(/^https?:\/\//.test(f.src), "zdroj " + f.id); assert(ids.includes(f.inst), "instituce u " + f.id); }
    for (const id of ids) if (!c.forms.some(f => f.inst === id)) assert(c.inst.find(i => i.id === id).note, "bez formulářů musí mít vysvětlení: " + id);
    const r = await page.evaluate(async () => (await fetch("formulare/" + F.catalog().forms.find(f => f.inst === "nn").file)).status);
    eq(r, 200, "PDF se servíruje");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "první volba oficiální / volná forma; klient z karty, jeho smlouva vybere instituci i číslo": async () => {
    const { ctx, page, errors } = await open();
    eq(await page.textContent(".frm-top .seg button[aria-selected=true]"), "Oficiální formulář", "výchozí volba");
    await page.selectOption("#frm-cid", "c:1");
    let s = await page.evaluate(() => F.state());
    eq([s.name, s.addr, s.birth, s.phone, s.email], ["Ing. Jana Nováková", "Květinová 5, 602 00 Brno", "7. 3. 1985", "774 222 617", "jana@example.cz"], "údaje z karty");
    await page.click(".mine .chip >> nth=0");
    s = await page.evaluate(() => F.state());
    eq([s.inst, s.cnum], ["nn", "1234567890"], "smlouva klienta → NN + číslo");
    assert(await page.isVisible(".flist .row-btn"), "seznam formulářů NN");
    await mode(page, 1);
    eq(await page.evaluate(() => F.state().mode), "vol", "přepnuto na volnou formu");
    assert((await page.evaluate(() => F.text())).includes("NN Životní pojišťovna N.V., pobočka pro Českou republiku\nNádražní 344/25\n150 00 Praha 5"), "adresát NN");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "volná forma: výpověď, otázka na odkupné, VS/SS jen když jsou vyplněné": async () => {
    const { ctx, page, errors } = await open();
    await mode(page, 1);
    await page.selectOption("#frm-cid", "c:1");
    await page.fill(".group input[placeholder=XXXXXXXXXX]", "1234567890");
    let t = await page.evaluate(() => F.text());
    assert(t.includes("Allianz pojišťovna, a. s.\nKe Štvanici 656/3\n186 00 Praha 8"), "adresát Allianz");
    assert(t.includes("DOPORUČENĚ") && t.includes("žádám o výpověď pojistné smlouvy č. 1234567890 k nejbližšímu možnému datu."), "text výpovědi");
    assert(!/odkupné/i.test(t), "bez odkupného odstavec není");
    assert(t.includes("Pojistník, nar. 7. 3. 1985, trvale bytem Květinová 5, 602 00 Brno"), "řádek klienta");
    assert(await page.isVisible("text=Je tam odkupné?"), "u pojišťovny je otázka na odkupné");
    await page.click(".frow:has-text('Je tam odkupné?') .seg button:text-is('Ano')");
    await page.fill("input[placeholder='123456789/0800']", "19-2000145399/0800");
    await page.fill(".frow:has-text('Variabilní symbol') input", "9988");
    t = await page.evaluate(() => F.text());
    assert(t.includes("Případné odkupné prosím zašlete na:\nČíslo účtu: 19-2000145399/0800\nVS: 9988"), "odkupné s účtem a VS");
    assert(!t.includes("SS:"), "prázdné SS se nevypisuje");
    eq(await page.textContent(".frow .pst.ok"), "Číslo účtu sedí (kontrolní součet)", "platný účet");
    await page.fill("input[placeholder='123456789/0800']", "19-2000145398/0800");
    assert((await page.textContent(".frow .pst.bad")).includes("neprošlo"), "překlep v účtu je vidět");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "v návaznosti: stejná pojišťovna, stará i nová smlouva; typy podle druhu instituce": async () => {
    const { ctx, page, errors } = await open();
    await mode(page, 1);
    await chipInst(page, "Kooperativa");
    await page.click(".seg button:text-is('V návaznosti')");
    await page.fill(".frow:has-text('Vypovídaná smlouva') input", "111");
    await page.fill(".frow:has-text('Nová smlouva') input", "222");
    let t = await page.evaluate(() => F.text());
    assert(t.includes("Kooperativa pojišťovna, a. s., Vienna Insurance Group\nCentrum zákaznické podpory"), "adresát Kooperativa");
    assert(t.includes("žádám o výpověď pojistné smlouvy č. 111 k nejbližšímu možnému datu, a to v návaznosti na uzavření nové pojistné smlouvy č. 222 u Vaší pojišťovny."), "text v návaznosti");
    // penzijní společnost: bez návaznosti, odbytné
    await chipInst(page, "NN PS");
    const types = await page.$$eval(".frow.col .seg button", b => b.map(x => x.textContent));
    eq(types, ["Výpověď", "Změna"], "typy u penzijní společnosti");
    assert(await page.isVisible("text=Vyplatit odbytné na účet?"), "u PS otázka na odbytné");
    eq(await page.evaluate(() => F.state().role), "Účastník", "postavení u PS");
    // investice: odkup
    await chipInst(page, "ZFP Investments");
    await page.click(".seg button:text-is('Odkup')");
    await page.fill(".group input[placeholder=XXXXXXXXXX]", "777");
    t = await page.evaluate(() => F.text());
    assert(t.includes("žádám o odkup všech podílových listů evidovaných na smlouvě č. 777") && t.includes("Prostředky z odkupu prosím zašlete na:"), "odkup podílových listů");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "oficiální formulář: předvyplněné PDF (diakritika, odkupné), RČ se neukládá": async () => {
    const { ctx, page, errors } = await open();
    await page.selectOption("#frm-cid", "c:1");
    await chipInst(page, "NN");
    await page.click(".flist .row-btn:has-text('Žádost o ukončení pojistné smlouvy')");
    await page.fill(".frow:has-text('Rodné číslo') input", "855307/1234");
    await page.fill(".frow:has-text('Číslo smlouvy') input", "1234567890");
    await page.click(".frow:has-text('Je tam odkupné?') .seg button:text-is('Ano')");
    await page.fill("input[placeholder='123456789/0800']", "19-2000145399/0800");
    await page.waitForFunction(() => F.filled().done.includes("account") && F.filled().done.includes("rc"), null, { timeout: 20000 });
    const done = await page.evaluate(() => F.filled().done);
    for (const k of ["cnum", "surname", "firstname", "rc", "birth", "streetcp", "psc", "city", "phone", "email", "account", "accpre", "bank"]) assert(done.includes(k), "předvyplněno " + k);
    await page.waitForSelector(".pv-pages canvas", { timeout: 20000 });
    const vals = await page.evaluate(async () => {
      const r = await fetch(F.filled().url); const b = await r.arrayBuffer();
      const doc = await PDFLib.PDFDocument.load(b); const f = doc.getForm();
      const g = n => { try { return f.getTextField(n).getText() } catch (e) { return "?" } };
      return [g("Příjmení"), g("Jméno"), g("cisloSmlouvy"), g("Obec, země"), g("Předčíslí"), g("Číslo účtu"), g("Kód banky")];
    });
    eq(vals, ["Nováková", "Jana", "1234567890", "Brno", "19", "2000145399", "0800"], "hodnoty v PDF");
    assert(!("rc" in (await page.evaluate(() => LS.frm_state_v2))), "rodné číslo se do úložiště neukládá");
    assert((await page.textContent(".pv-meta")).includes("Předvyplněno: číslo smlouvy"), "přehled předvyplněných údajů");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "instituce bez veřejných formulářů nabídne volnou formu": async () => {
    const { ctx, page, errors } = await open();
    await chipInst(page, "ČPP");
    assert((await page.textContent(".note")).includes("ČPP"), "vysvětlení u ČPP");
    await page.click(".note button:has-text('Napsat volnou formou')");
    const s = await page.evaluate(() => F.state());
    eq([s.mode, s.inst], ["vol", "cpp"], "volná forma s ČPP");
    assert((await page.evaluate(() => F.text())).includes("P. O. BOX 28\n664 42 Modřice"), "korespondenční adresa ČPP");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "vlastní instituce se uloží; starý stav (v1) se převede": async () => {
    const { ctx, page, errors } = await open({ ls: { frm_state_v1: { name: "Petr Svoboda", inst: "UNIQA pojišťovna, a. s.", typ: "navaz", cnum: "9", nova: "č. 55", odk: false, reg: true } } });
    let s = await page.evaluate(() => F.state());
    eq([s.mode, s.inst, s.typ, s.cnumNew], ["vol", "uniqa", "navaz", "č. 55"], "převod starého stavu");
    await page.click(".chip:has-text('+ Jiná instituce')");
    await page.fill(".frow:has-text('Název instituce') input", "Česká spořitelna, a. s.");
    await page.fill(".frow:has-text('Adresa instituce') textarea", "Olbrachtova 1929/62\n140 00 Praha 4");
    await page.click("button:has-text('Uložit do nabídky')");
    eq(await page.evaluate(() => LS.frm_custom_v1), [{ n: "Česká spořitelna, a. s.", a: "Olbrachtova 1929/62\n140 00 Praha 4", g: "poj" }], "uloženo");
    assert((await page.evaluate(() => F.text())).includes("Česká spořitelna, a. s.\nOlbrachtova 1929/62\n140 00 Praha 4"), "adresát v textu");
    eq(await page.evaluate(() => LS.frm_state_v2.inst), "x:Česká spořitelna, a. s.", "rozpracovaný stav je uložen");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "náhled A4 se vejde, tisk vytvoří iframe; na telefonu nic nepřetéká a ovládání je dost velké": async () => {
    const { ctx, page, errors } = await open();
    await mode(page, 1);
    const box = await page.evaluate(() => { const r = document.querySelector(".pv-box").getBoundingClientRect(), p = document.querySelector(".fl-paper").getBoundingClientRect(); return { pw: p.width, bw: r.width }; });
    assert(box.pw <= box.bw, "náhled se vejde do panelu (" + box.pw + " ≤ " + box.bw + ")");
    await page.click("button:has-text('Tisk / PDF')");
    await page.waitForTimeout(500);
    assert(await page.evaluate(() => { const f = document.querySelector("iframe"); return f ? f.contentDocument.body.textContent.includes("Žádost o výpověď smlouvy") : false; }), "iframe s dopisem existuje");
    eq(errors, [], "chyby"); await ctx.close();
    for (const m of [0, 1]) {
      const { ctx: c2, page: p2, errors: e2 } = await open({ width: 390, height: 844 });
      if (m) await mode(p2, 1);
      await p2.selectOption("#frm-cid", "c:1");
      const ov = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(ov <= 1, "vodorovné přetečení na telefonu: " + ov);
      eq(await smallTargets(p2, "#box button, #box input, #box select"), [], "malé dotykové cíle");
      eq(e2, [], "chyby"); await c2.close();
    }
  },
};
let bad = 0;
for (const [name, fn] of Object.entries(T)) { if (filter && !name.includes(filter)) continue;
  try { await fn(); console.log("✓", name); } catch (e) { bad++; console.log("✗", name, "\n   ", String(e.stack || e).split("\n").slice(0, 4).join("\n    ")); } }
await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
