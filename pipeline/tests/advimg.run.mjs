// Test náhledového obrázku se jménem poradce (advimg.js): výsledek je JPEG 1200×630 do 150 kB, jméno + oranžová ikona jsou v řádku nad pruhem,
// dlouhé jméno se vejde, podklad mimo řádek zůstane netknutý. Použití: node tests/advimg.run.mjs
import { loadPlaywright, startServer, assert } from "./helpers.mjs";
import { readFileSync } from "node:fs";

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const OG = new URL("../../og/", import.meta.url);
const page = await (await browser.newContext()).newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
await page.route(/\/og\/(termin|dotaznik)\.jpg/, r => r.fulfill({ status: 200, contentType: "image/jpeg", body: readFileSync(new URL(r.request().url().split("/og/")[1], OG)) }));
await page.goto(url.replace("index.html", "dotaznik.html"));
await page.addScriptTag({ url: url.replace("index.html", "advimg.js") });

/* rozměry z hlavičky JPEG – stejně jako na prostředníku */
const sof = b => { let i = 2; while (i + 9 < b.length) { if (b[i] !== 0xFF) { i++; continue } const m = b[i + 1]; if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]]; i += 2 + ((b[i + 2] << 8) | b[i + 3]); } return null; };

const run = async name => page.evaluate(async n => {
  const out = await AdvImg.render(n);
  const px = async (b64, base) => { const im = new Image(); im.src = base ? b64 : "data:image/jpeg;base64," + b64; await im.decode(); const c = document.createElement("canvas"); c.width = 1200; c.height = 630; const x = c.getContext("2d"); x.drawImage(im, 0, 0); return x; };
  const res = {};
  for (const k of ["termin", "dotaznik"]) {
    const a = await px(out[k]), b = await px("/og/" + k + ".jpg", true);
    const diff = (x0, y0, w, h) => { const A = a.getImageData(x0, y0, w, h).data, B = b.getImageData(x0, y0, w, h).data; let d = 0, orange = 0, light = 0, minX = 1e9, maxX = -1;
      for (let i = 0; i < A.length; i += 4) { const dd = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); if (dd > 60) { d++; const X = x0 + (i / 4) % w; minX = Math.min(minX, X); maxX = Math.max(maxX, X); }
        if (A[i] > 200 && A[i + 1] > 80 && A[i + 1] < 160 && A[i + 2] < 70) orange++; if (A[i] > 190 && A[i + 1] > 190 && A[i + 2] > 190) light++; }
      return { d, orange, light, minX, maxX }; };
    res[k] = { b64: out[k], row: diff(0, 490, 1200, 60), outside: diff(0, 0, 1200, 470), len: out[k].length };
  }
  return res;
}, name);

const bytes = b64 => Buffer.from(b64, "base64");
for (const nm of ["Jan Novák", "Ing. Alexandra Wolfgang-Schmidtová-Kratochvílová, MBA, Ph.D. (ZFP)"]) {
  const r = await run(nm);
  for (const k of ["termin", "dotaznik"]) {
    const b = bytes(r[k].b64), s = sof(b);
    assert(b[0] === 0xFF && b[1] === 0xD8, `${nm}/${k}: není JPEG`);
    assert(s && s[0] === 1200 && s[1] === 630, `${nm}/${k}: rozměry ${s}`);
    assert(b.length < 150000, `${nm}/${k}: velikost ${b.length}`);
    assert(r[k].row.d > 400 && r[k].row.orange > 40 && r[k].row.light > 150, `${nm}/${k}: v řádku chybí jméno/ikona ${JSON.stringify(r[k].row)}`);
    assert(r[k].row.minX >= 100 && r[k].row.maxX <= 1100, `${nm}/${k}: jméno přesahuje ${r[k].row.minX}–${r[k].row.maxX}`);
    assert(r[k].outside.d < 400, `${nm}/${k}: mimo řádek se obrázek změnil (${r[k].outside.d} px)`);
  }
  console.log("✓ " + (nm.length > 20 ? "dlouhé jméno se vejde" : "jméno + ikona v řádku nad pruhem, JPEG 1200×630 do 150 kB"));
}
let rejected = false; try { await page.evaluate(() => AdvImg.render("   ")); } catch (e) { rejected = true; }
assert(rejected, "prázdné jméno se musí odmítnout");
console.log("✓ prázdné jméno se neodešle");

/* logika odkazů z Pipeline (funkce se vytáhnou přímo ze zdroje index.html) */
{
  const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const a = src.indexOf("const advName=("), b = src.indexOf("/* výroční schůzka: odkaz");
  assert(a > 0 && b > a, "v index.html chybí advName/dzLinkSync");
  const mk = (settings, { host = "zfpconsulting.github.io", me = "jan@zfpa.cz", short = [] } = {}) => {
    const timers = [];
    const f = new Function("settings", "DEMO", "dzMe", "DZ_SHORT", "PUSH_URL", "location", "setTimeout", "GAuth", "$", "document", "navigator",
      src.slice(a, b) + "\nreturn {advName,advContact,advSigNow,dzLinkSync}");
    const loc = { hostname: host, origin: "https://" + host, pathname: "/pipeline/index.html" };
    return { ...f(settings, false, () => me, short, "https://zfp-push.x.workers.dev", loc, fn => timers.push(fn), {}, () => null, {}, {}), timers };
  };
  const K = "K".repeat(87), BK = "https://script.google.com/macros/s/AKfycbXYZ_1/exec";
  const base = { dzKey: { pub: K }, bkUrl: BK, sign: "Jan Novák, ZFP Consulting, jan@zfpa.cz, +420 777 123 456" };
  let L = mk({ ...base });
  assert(L.advName() === "Jan Novák", "jméno z podpisu");
  assert(mk({ ...base, advName: "  Ing.  Jan Novák " }).advName() === "Ing. Jan Novák", "jméno z Nastavení má přednost a čistí mezery");
  let u = L.dzLinkSync(true);
  assert(u.startsWith("https://zfpconsulting.github.io/pipeline/dotaznik.html#") && /[#&]p=Jan\+Nov%C3%A1k/.test(u) && /[&]m=r/.test(u) && u.includes("e=jan%40zfpa.cz") && u.includes("b=" + encodeURIComponent(BK)), "bez zveřejnění: dlouhý odkaz se jménem: " + u);
  assert(L.timers.length === 1, "pozadí: spustí se zveřejnění");
  const sig = L.advSigNow();
  L = mk({ ...base, advPub: { code: "jan-novak-1a2b", sig, url: "https://zfp-push.x.workers.dev", at: 1 } });
  assert(L.dzLinkSync(true) === "https://zfp-push.x.workers.dev/t/jan-novak-1a2b" && L.dzLinkSync(false) === "https://zfp-push.x.workers.dev/d/jan-novak-1a2b", "zveřejněný odkaz /t/ a /d/");
  assert(L.timers.length === 0, "aktuální odkaz nespouští nové zveřejnění");
  L = mk({ ...base, advName: "Jan Nový", advPub: { code: "jan-novak-1a2b", sig, url: "https://zfp-push.x.workers.dev", at: 1 } });
  assert(L.dzLinkSync(true).endsWith("/t/jan-novak-1a2b") && L.timers.length === 1, "změněné jméno: odkaz zůstává, zveřejní se znovu");
  L = mk({ ...base, advPub: { code: "x-1111", sig, url: "https://stary.workers.dev", at: 1 } });
  assert(L.dzLinkSync(false).includes("dotaznik.html#"), "odkaz z jiného prostředníka se nepoužije");
  L = mk({ dzKey: { pub: K } });
  u = L.dzLinkSync(false);
  assert(!/[#&]p=/.test(u) && L.timers.length === 0, "bez jména: žádné p a nic se nezveřejňuje: " + u);
  L = mk({ ...base, advName: "Jan Nový" }, { short: [{ c: "vk", k: K }] });
  assert(L.dzLinkSync(true) === "https://zfpconsulting.github.io/termin/vk/", "zaregistrovaný krátký odkaz (vk) zůstává");
  assert(mk(base, { me: "" }).dzLinkSync(true) === "", "bez přihlášení žádný odkaz");
  console.log("✓ logika odkazů: jméno z Nastavení/podpisu, zveřejněný odkaz, opětovné zveřejnění, krátký odkaz");
}
assert(!errors.length, "chyby stránky: " + errors.join("; "));
await browser.close(); srv.close();
console.log("\nOK");
