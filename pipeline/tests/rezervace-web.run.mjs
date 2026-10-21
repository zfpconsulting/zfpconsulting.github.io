// Testy veřejné rezervační webovky (/rezervace/) a stránky se zásadami (/rezervace/zasady/).
// Firestore, skript poradce i push jsou podvržené. Kontroluje: rezervace funguje a odešle jen ZAŠIFROVANÝ kontakt, stránka nevolá
// nic mimo povolené hosty, nepoužívá cookies ani úložiště, bez potvrzení zásad se neodešle, past na roboty.
// Použití: node tests/rezervace-web.run.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright, assert, eq } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const srv = createServer(async (req, rsp) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
    const f = normalize(join(ROOT, p)); if (!f.startsWith(ROOT)) throw 0;
    rsp.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" }); rsp.end(await readFile(f));
  } catch { rsp.writeHead(404); rsp.end("x"); }
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const BASE = `http://localhost:${srv.address().port}`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ALLOWED = /^(localhost|firestore\.googleapis\.com|script\.google\.com|script\.googleusercontent\.com|zfp-push\.kudlicka-vojtech2002\.workers\.dev)$/;

const at = (d, h = 10) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x; };
const iso = x => x.toISOString();

async function open({ slots, script }) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  const errors = [], hosts = new Set(), calls = [], posts = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => hosts.add(new URL(r.url()).hostname));
  await ctx.route(/firestore\.googleapis\.com/, r => {
    if (r.request().method() === "POST") { posts.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fields: { slots: { arrayValue: { values: slots.map(s => ({ stringValue: s })) } }, len: { integerValue: "45" }, addr: { stringValue: "Trnitá 500/9, 602 00 Brno" } } }) });
  });
  await ctx.route(/script\.google\.com/, r => { const b = JSON.parse(r.request().postData() || "{}"); calls.push(b); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(script(b)) }); });
  await ctx.route(/workers\.dev/, r => r.fulfill({ status: 200, body: "" }));
  await page.goto(BASE + "/rezervace/");
  await page.waitForFunction(() => BK.slots !== null, null, { timeout: 15000 });
  return { ctx, page, errors, hosts, calls, posts };
}
const free = { busy: () => ({ ok: true, v: 2, busy: [], office: [], len: 45, buf: 15 }) };
const script = q => q.a === "busy" ? free.busy() : { ok: true, id: "hold1" };

async function fill(page, { jmeno = "Jana Nováková", email = "jana@example.com", telefon = "777 123 456", ack = true } = {}) {
  await page.fill('[data-c="jmeno"]', jmeno); await page.fill('[data-c="email"]', email); await page.fill('[data-c="telefon"]', telefon);
  if (ack) await page.check("#ack");
}

const tests = {
  async "týdny: zobrazí jen jeden týden (po–ne), šipky přepínají týdny, data mají tečky"() {
    /* tři týdny po sobě: dny +3, +10, +17 (a +4 ve stejném týdnu jako +3 jen když to kalendář dovolí) */
    const d = [at(3), at(10), at(17)];
    const { ctx, page, errors } = await open({ slots: d.map(iso), script });
    const lab = () => page.$$eval("[data-day]", els => els.map(e => e.textContent.trim()));
    const first = await lab();
    eq(first.length, 1, "v prvním týdnu je jen jeden den");
    assert(/^\S+ \d{1,2}\. \d{1,2}\.$/.test(first[0]), "datum s tečkami, ne „pá 23 10“: " + first[0]);
    assert(/^\d{1,2}\. \d{1,2}\. – \d{1,2}\. \d{1,2}\.$/.test((await page.textContent(".wkl")).trim()), "popisek týdne s tečkami");
    eq(await page.$eval('[data-wk="-1"]', e => e.disabled), true, "zpět nejde na prvním týdnu");
    await page.click('[data-wk="1"]');
    eq((await lab()).length, 1, "druhý týden"); eq(await page.$eval('[data-wk="-1"]', e => e.disabled), false, "zpět jde");
    await page.click('[data-wk="1"]');
    eq(await page.$eval('[data-wk="1"]', e => e.disabled), true, "dál nejde na posledním týdnu");
    await page.click('[data-wk="-1"]'); await page.click('[data-wk="-1"]');
    eq(await page.$$eval("[data-time]", e => e.length), 1, "zpět na prvním týdnu se časy vrátí");
    eq(errors, [], "chyby v konzoli"); await ctx.close();
  },
  async "hotovo: datum v potvrzení má tečky"() {
    const a = at(3, 10);
    const { ctx, page } = await open({ slots: [iso(a)], script });
    await page.waitForTimeout(4200);
    await page.click("[data-time]"); await page.click('[data-mode="online"]'); await fill(page); await page.click("#bBook"); await page.waitForSelector(".done");
    assert(/\d{1,2}\. \d{1,2}\. v \d{2}:\d{2}/.test(await page.textContent(".done")), "datum s tečkami v potvrzení: " + await page.textContent(".done p"));
    await ctx.close();
  },
  async "nabídne jen volné časy, čas zobrazí v pražském čase i pro návštěvníka z jiného pásma"() {
    const a = at(3, 10), b = at(3, 14);
    const { ctx, page, errors } = await open({ slots: [iso(a), iso(b)], script: q => q.a === "busy" ? { ok: true, v: 2, busy: [[b.getTime(), b.getTime() + 45 * 60000]], office: [], len: 45, buf: 15 } : { ok: true, id: "x" } });
    const times = await page.$$eval("[data-time]", els => els.map(e => e.textContent.trim()));
    const prague = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(a);
    eq(times, [prague], "14:00 je obsazené, zůstane jen první čas, v pražském čase (ne v New Yorku, ani v pásmu CI)");
    eq(errors, [], "chyby v konzoli"); await ctx.close();
  },
  async "rezervace: zablokuje termín, odešle jen šifrový text a ping bez dat klienta, nic mimo povolené hosty, žádné cookies ani úložiště"() {
    const a = at(3, 10);
    const { ctx, page, errors, hosts, calls, posts } = await open({ slots: [iso(a)], script });
    await page.waitForTimeout(4200); /* past na roboty: dřív než 4 s se nic neodešle */
    await page.click("[data-time]"); await page.click('[data-mode="online"]'); await fill(page);
    await page.click("#bBook"); await page.waitForSelector(".done", { timeout: 15000 });
    eq(calls.filter(c => c.a === "book").map(c => [c.start, c.online]), [[iso(a), 1]], "blokace termínu v kalendáři");
    assert(posts.length === 1, "do schránky šel jeden zápis");
    const f = posts[0].fields, blob = JSON.stringify(posts[0]);
    eq(f.to.stringValue, "kudlicka.vojtech2002@gmail.com", "schránka poradce");
    for (const s of ["Jana", "Nováková", "jana@example.com", "777 123 456"]) assert(!blob.includes(s), "v odeslaných datech nesmí být čitelné: " + s);
    assert(f.ct.stringValue.length > 20 && f.epk.stringValue && f.salt.stringValue && f.iv.stringValue, "je to šifrový balík");
    for (const h of hosts) assert(ALLOWED.test(h), "nepovolený host: " + h);
    eq(await ctx.cookies(), [], "žádné cookies");
    eq(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], "nic v úložišti prohlížeče");
    eq(await page.evaluate(() => BK.c), { jmeno: "", email: "", telefon: "" }, "po odeslání se údaje z formuláře smažou");
    eq(errors, [], "chyby v konzoli"); await ctx.close();
  },
  async "bez potvrzení zásad, s neplatným e-mailem nebo bez jména se nic neodešle"() {
    const { ctx, page, posts, calls } = await open({ slots: [iso(at(3, 10))], script });
    await page.waitForTimeout(4200);
    await page.click("[data-time]"); await page.click('[data-mode="online"]');
    await fill(page, { ack: false }); await page.click("#bBook");
    assert((await page.textContent(".emsg")).includes("informacemi o zpracování"), "chce potvrdit zásady");
    await page.check("#ack"); await page.fill('[data-c="email"]', "ne-email"); await page.click("#bBook");
    assert((await page.textContent(".emsg")).includes("e-mail"), "neplatný e-mail");
    await page.fill('[data-c="email"]', "jana@example.com"); await page.fill('[data-c="jmeno"]', "Jana"); await page.click("#bBook");
    assert((await page.textContent(".emsg")).includes("jméno a příjmení"), "chce jméno i příjmení");
    eq([posts.length, calls.filter(c => c.a === "book").length], [0, 0], "nic se neodeslalo");
    await ctx.close();
  },
  async "past na roboty: vyplněné skryté pole se tváří jako úspěch, ale neodešle nic"() {
    const { ctx, page, posts, calls } = await open({ slots: [iso(at(3, 10))], script });
    await page.waitForTimeout(4200);
    await page.click("[data-time]"); await page.click('[data-mode="online"]'); await fill(page);
    await page.fill('[data-c="hp"]', "http://spam.example"); await page.click("#bBook");
    await page.waitForSelector(".done");
    eq([posts.length, calls.filter(c => c.a === "book").length], [0, 0], "nic se neodeslalo");
    await ctx.close();
  },
  async "obsazeno mezitím: klient dostane hlášku a termín zmizí z nabídky"() {
    const a = at(3, 10), b = at(3, 14);
    const { ctx, page, posts } = await open({ slots: [iso(a), iso(b)], script: q => q.a === "busy" ? free.busy() : { ok: false, err: "busy" } });
    await page.waitForTimeout(4200);
    await page.click(`[data-time="${iso(a)}"]`); await page.click('[data-mode="online"]'); await fill(page); await page.click("#bBook");
    await page.waitForFunction(() => document.querySelector(".emsg") && document.querySelector(".emsg").textContent.includes("obsadil"));
    eq(posts.length, 0, "nic se neuložilo");
    await ctx.close();
  },
  async "kancelář obsazená kolegou: nabídne jen online"() {
    const a = at(3, 10);
    const { ctx, page } = await open({ slots: [iso(a)], script: q => q.a === "busy" ? { ok: true, v: 2, busy: [], office: [[a.getTime(), a.getTime() + 45 * 60000]], len: 45, buf: 15 } : { ok: true, id: "x" } });
    await page.click("[data-time]");
    eq(await page.$eval('[data-mode="osobne"]', e => e.disabled), true, "osobně nejde");
    eq(await page.$eval('[data-mode="online"]', e => e.classList.contains("on")), true, "online předvybráno");
    await ctx.close();
  },
  async "mapa se bez kliknutí nenačte (žádný požadavek na Google Maps)"() {
    const { ctx, page, hosts } = await open({ slots: [iso(at(3, 10))], script });
    await page.click("[data-time]"); await page.click('[data-mode="osobne"]');
    assert(await page.$("#bMap"), "tlačítko Zobrazit mapu");
    assert(![...hosts].some(h => /google\.com$/.test(h) && h !== "script.google.com"), "Google Maps se nesmí načíst před kliknutím");
    await ctx.close();
  },
  async "stránka se zásadami: načte se bez chyb, bez cizích požadavků, obsahuje povinné informace"() {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); const hosts = new Set(), errors = [];
    page.on("request", r => hosts.add(new URL(r.url()).hostname)); page.on("pageerror", e => errors.push(e.message));
    await page.goto(BASE + "/rezervace/zasady/");
    const t = await page.textContent("main");
    for (const s of ["Kdo údaje zpracovává", "Právní základ", "Jak dlouho", "Vaše práva", "uoou.gov.cz", "Google", "Cloudflare", "GitHub", "cookies", "čl. 6 odst. 1 písm. b"]) assert(t.includes(s) || (await page.content()).includes(s), "chybí: " + s);
    for (const h of hosts) assert(h === "localhost", "cizí požadavek: " + h);
    eq(errors, [], "chyby"); await ctx.close();
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { await fn(); console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "\n      ", e.message); }
}
await browser.close(); srv.close();
if (fail) { console.log(fail + " testů selhalo"); process.exit(1); }
console.log("Všechny testy rezervační webovky prošly (" + Object.keys(tests).length + ").");
