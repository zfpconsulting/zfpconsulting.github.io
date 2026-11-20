// Testy záložky Formuláře (formulare.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/formulare.run.mjs [filtr]
import { loadPlaywright, startServer, assert, eq, appCss } from "./helpers.mjs";
const APPCSS = await appCss();
const filter = process.argv[2] || "";
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");
const CLIENTS = [
  { id: "c:1", name: "Jana Nováková", rec: { address: "Květinová 5, 602 00 Brno", birth: "1985-03-07" }, lead: null },
  { id: "l:2", name: "Petr Svoboda", rec: null, lead: { id: "L2", address: "Lipová 1, 614 00 Brno" } },
];
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><style>${APPCSS}</style><style>body{margin:0;padding:16px}</style></head>
    <body><div id="box"></div><script src="formulare.js"></script><script>
    const LS={};const toasts=[];window.toasts=toasts;window.LS=LS;
    window.F=Formulare.mount(document.getElementById("box"),{toast:t=>toasts.push(t),ls:{get:k=>LS[k]??null,set:(k,v)=>{LS[k]=JSON.parse(JSON.stringify(v))}},
      clients:()=>${JSON.stringify(CLIENTS)},birthOf:e=>e.lead&&e.lead.id==="L2"?"1979-12-24":""});
    </script></body></html>` }));
  await page.goto(base + "harness.html"); await page.waitForSelector(".fl-paper");
  return { ctx, page, errors };
}
const T = {
  "text dopisu: výpověď bez odkupného a s ním; chybějící údaje jsou vidět": async () => {
    const { ctx, page, errors } = await open();
    await page.selectOption(".frm select >> nth=0", "c:1");
    const t0 = await page.evaluate(() => F.text());
    assert(t0.includes("Jana Nováková") && t0.includes("Květinová 5, 602 00 Brno"), "jméno a adresa z karty");
    assert(t0.includes("Allianz pojišťovna, a. s.\nKe Štvanici 656/3\n186 00 Praha 8"), "adresát Allianz");
    assert(t0.includes("DOPORUČENĚ") && t0.includes("Žádost o výpověď smlouvy") && t0.includes("k co nejbližšímu datu."), "základ");
    assert(t0.includes("č. XXXXXXXXXX"), "prázdné číslo smlouvy = XXXXXXXXXX");
    assert(!t0.includes("odkupné"), "bez odkupného odstavec není");
    assert(t0.includes("Pojistník a pojištěný, nar. 7. 3. 1985, trvale bytem Květinová 5, 602 00 Brno"), "řádek klienta");
    await page.fill("input[placeholder=XXXXXXXXXX]", "1234567890");
    await page.check("input.switch >> nth=0");   // odkupné
    await page.fill("input[placeholder='123456789/0800']", "19-2000145399/0800");
    await page.fill(".frm .row2 >> nth=0 >> input >> nth=0", "9988"); // VS
    const t1 = await page.evaluate(() => F.text());
    assert(t1.includes("č. 1234567890") && t1.includes("Případné odkupné či přeplatek prosím zašlete na:\nČíslo účtu: 19-2000145399/0800\nVS: 9988"), "odkupné s účtem a VS");
    assert(!t1.includes("SS:"), "prázdné SS se nevypisuje");
    eq(await page.textContent(".frm .pst"), "Číslo účtu sedí (kontrolní součet)", "platný účet");
    await page.fill("input[placeholder='123456789/0800']", "19-2000145398/0800");
    assert((await page.textContent(".frm .pst")).includes("neprošlo"), "překlep v účtu je vidět");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "typy žádostí a údaje klienta z leadu (adresa, datum narození přes birthOf)": async () => {
    const { ctx, page, errors } = await open();
    await page.selectOption(".frm select >> nth=0", "l:2");
    const s = await page.evaluate(() => F.state());
    eq([s.name, s.addr, s.birth], ["Petr Svoboda", "Lipová 1, 614 00 Brno", "1979-12-24"], "z leadu");
    await page.selectOption("select >> nth=3", "navaz");   // typ
    await page.fill("label:has-text('Nová smlouva') input", "č. 55, Conseq");
    let t = await page.evaluate(() => F.text());
    assert(t.includes("v návaznosti na uzavření nové smlouvy (č. 55, Conseq)."), "v návaznosti");
    await page.selectOption("select >> nth=3", "posun");
    await page.fill("input[type=date] >> nth=0", "2027-02-01");
    t = await page.evaluate(() => F.text());
    assert(t.includes("žádám o posunutí počátku smlouvy č. XXXXXXXXXX na 1. února 2027."), "posunutí");
    await page.selectOption("select >> nth=3", "zmena");
    await page.fill("textarea >> nth=2", "Změna pojistné částky na 2 000 000 Kč.");
    t = await page.evaluate(() => F.text());
    assert(t.includes("žádám o změnu smlouvy") && t.includes("Změna pojistné částky na 2 000 000 Kč."), "změna");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "vlastní instituce se uloží do nabídky a pamatuje se; stav se obnoví": async () => {
    const { ctx, page, errors } = await open();
    await page.selectOption(".frm select >> nth=2", "__new");
    await page.fill("label:has-text('Název nové instituce') input", "Česká spořitelna, a. s.");
    await page.fill("label:has-text('Adresa instituce') textarea", "Olbrachtova 1929/62\n140 00 Praha 4");
    await page.click("button:has-text('Uložit instituci')");
    eq(await page.evaluate(() => LS.frm_custom_v1), [{ n: "Česká spořitelna, a. s.", a: "Olbrachtova 1929/62\n140 00 Praha 4" }], "uloženo");
    assert((await page.evaluate(() => F.text())).includes("Česká spořitelna, a. s.\nOlbrachtova 1929/62\n140 00 Praha 4"), "adresát v textu");
    eq((await page.evaluate(() => LS.frm_state_v1)).inst, "Česká spořitelna, a. s.", "rozpracovaný stav je uložen");
    eq(errors, [], "chyby"); await ctx.close();
  },
  "náhled A4 se vejde a tisk vytvoří skrytý iframe s dopisem": async () => {
    const { ctx, page, errors } = await open();
    const box = await page.evaluate(() => { const r = document.querySelector(".frm-prev").getBoundingClientRect(), p = document.querySelector(".fl-paper").getBoundingClientRect(); return { pw: p.width, bw: r.width }; });
    assert(box.pw <= box.bw, "náhled se vejde do panelu (" + box.pw + " ≤ " + box.bw + ")");
    await page.click("button:has-text('Tisk / PDF')");
    await page.waitForTimeout(500);
    const fr = await page.evaluate(() => { const f = document.querySelector("iframe"); return f ? f.contentDocument.body.textContent.includes("Žádost o výpověď smlouvy") : false; });
    assert(fr, "iframe s dopisem existuje");
    eq(errors, [], "chyby"); await ctx.close();
  },
};
let bad = 0;
for (const [name, fn] of Object.entries(T)) { if (filter && !name.includes(filter)) continue;
  try { await fn(); console.log("✓", name); } catch (e) { bad++; console.log("✗", name, "\n   ", String(e.stack || e).split("\n").slice(0, 4).join("\n    ")); } }
await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
