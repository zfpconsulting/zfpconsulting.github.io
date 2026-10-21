// Testy rezervace termínu (dotaznik.html, odkaz m=r) – volné termíny, kancelář obsazená kolegou, uvolnění zrušené schůzky.
// Firestore i skript poradce (tools/rezervace.gs) jsou podvržené. Použití: node tests/booking.run.mjs
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";
import { readFileSync } from "node:fs";

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const BASE = url.replace(/index\.html$/, "dotaznik.html");
const BKURL = "https://script.google.com/macros/s/AKfycbTEST_ID/exec";
const LINK = `${BASE}#v=1&to=poradce%40example.com&k=AAAA&p=${encodeURIComponent("Jana Nováková")}&m=r&b=${encodeURIComponent(BKURL)}`;

/* termín za d dní v h:mm místního času */
const at = (d, h = 10, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x; };
const iso = x => x.toISOString();
const win = (x, min) => [x.getTime(), x.getTime() + min * 60000];

async function open({ slots, script, bk = true, link = LINK }) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(e.message));
  await ctx.route(/firestore\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ fields: { slots: { arrayValue: { values: slots.map(s => ({ stringValue: s })) } }, len: { integerValue: "45" }, addr: { stringValue: "Trnitá 500/9, 602 00 Brno" }, ...(bk ? { bk: { stringValue: BKURL } } : {}) } }) }));
  await ctx.route(/script\.google\.com/, r => {
    const body = JSON.parse(r.request().postData() || "{}"); calls.push(body);
    const o = script(body); if (o === null) return r.fulfill({ status: 500, body: "x" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  });
  await ctx.route(/pushcrypto|workers\.dev/, r => r.fulfill({ status: 200, body: "" }));
  await page.goto(link);
  await page.waitForFunction(() => typeof BK !== "undefined" && BK.slots !== null, null, { timeout: 15000 });
  return { ctx, page, errors, calls };
}
const view = page => page.evaluate(() => BK.slots.map(s => ({ t: s.t, o: s.o })));

const tests = {
  async "zrušená schůzka: termín blokovaný jen poradcovou schůzkou se vrátí, obsazený zůstane skrytý"() {
    const a = at(3), b = at(4), c = at(5), d = at(6);
    const { ctx, page, errors } = await open({
      slots: [iso(a), iso(b) + "|x|90", iso(c) + "|x|90", iso(d) + "|ox|90"],
      script: q => q.a === "busy" ? { ok: true, v: 2, busy: [win(c, 45)], office: [], len: 45, buf: 15 } : { ok: false } });
    eq((await view(page)).map(s => s.t), [iso(a), iso(b), iso(d)], "b (schůzka zrušena) a d se vracejí, c je pořád obsazené");
    eq((await view(page)).map(s => s.o), [false, false, false], "kancelář volná (skript nevidí kolegu)");
    eq(errors, [], "chyby v konzoli"); await ctx.close();
  },
  async "blok 90 min: schůzka kdekoli v bloku termín drží, i když se nepřekrývá s 45 min konzultace"() {
    const b = at(4);
    const late = new Date(b.getTime() + 70 * 60000); /* schůzka 11:10–11:55 v bloku 10:00–11:30, konzultace 10:00–10:45 */
    const { ctx, page } = await open({ slots: [iso(b) + "|x|90"], script: q => q.a === "busy" ? { ok: true, v: 2, busy: [win(late, 45)], office: [], len: 45, buf: 15 } : { ok: false } });
    eq((await view(page)).length, 0, "blok je obsazený");
    await ctx.close();
  },
  async "kolega osobně v kanceláři → jen online; kolega online → osobně i online; zrušená schůzka kolegy kancelář uvolní"() {
    const a = at(3), b = at(4), c = at(5);
    const { ctx, page } = await open({
      slots: [iso(a), iso(b), iso(c) + "|o"],   /* c: ve zveřejněném seznamu bylo „jen online“, kolega schůzku mezitím zrušil */
      script: q => q.a === "busy" ? { ok: true, v: 2, busy: [], office: [win(a, 45)], len: 45, buf: 15 } : { ok: false } });
    eq(await view(page), [{ t: iso(a), o: true }, { t: iso(b), o: false }, { t: iso(c), o: false }], "a jen online, b volné, c znovu osobně");
    await ctx.close();
  },
  async "starší skript bez pole office: používá se příznak ze zveřejněného seznamu; vlastní zrušené termíny se vrací"() {
    const a = at(3), b = at(4);
    const { ctx, page } = await open({ slots: [iso(a) + "|o", iso(b) + "|x|90"], script: q => q.a === "busy" ? { ok: true, busy: [], len: 45, buf: 15 } : { ok: false } });
    eq(await view(page), [{ t: iso(a), o: true }, { t: iso(b), o: false }], "příznaky");
    await ctx.close();
  },
  async "živá kontrola nedostupná: termíny blokované vlastní schůzkou se NEukazují (jistota proti dvojí rezervaci)"() {
    const a = at(3), b = at(4), c = at(5);
    const { ctx, page } = await open({ slots: [iso(a), iso(b) + "|x|90", iso(c) + "|o"], script: () => null });
    eq(await view(page), [{ t: iso(a), o: false }, { t: iso(c), o: true }], "bez živé kontroly jako dřív");
    await ctx.close();
  },
  async "bez adresy skriptu (není v odkazu ani ve zveřejněných údajích): termíny blokované vlastní schůzkou se neukazují"() {
    const a = at(3), b = at(4), c = at(5);
    const { ctx, page, calls } = await open({ slots: [iso(a), iso(b) + "|x|90", iso(c) + "|o"], script: () => ({ ok: true, busy: [] }), bk: false, link: LINK.replace(/&b=[^&]*/, "") });
    eq(calls.length, 0, "žádné volání skriptu");
    eq(await view(page), [{ t: iso(a), o: false }, { t: iso(c), o: true }], "jako dřív");
    await ctx.close();
  },
  async "rezervace osobně, když mezitím kolega obsadil kancelář: nabídne online, nic se neodešle"() {
    const a = at(3);
    const { ctx, page, calls } = await open({ slots: [iso(a)], script: q => q.a === "busy" ? { ok: true, v: 2, busy: [], office: [], len: 45, buf: 15 } : { ok: false, err: "office" } });
    await page.click(`[data-time="${iso(a)}"]`); await page.click('[data-mode="osobne"]');
    await page.fill('[data-bkc="jmeno"]', "Petr Novák"); await page.fill('[data-bkc="email"]', "petr@example.com"); await page.fill('[data-bkc="telefon"]', "777111222");
    await page.click("#bBook"); await page.waitForFunction(() => /kancelář obsazená/.test(document.body.innerText));
    eq(calls.filter(c => c.a === "book").length, 1, "jedno volání book");
    eq(await page.evaluate(() => [BK.mode, BK.slots[0].o, BK.done]), ["online", true, null], "přepnuto na online, nerezervováno");
    await ctx.close();
  },
};

/* skript poradce (rezervace.gs): kolegové v CAL neblokují, osobní schůzka kolegy obsadí kancelář – logika bez Google služeb */
tests["rezervace.gs: inPerson rozlišuje osobní a online schůzky kolegy"] = async function () {
  const src = readFileSync(new URL("../../tools/rezervace.gs", import.meta.url), "utf8");
  const m = /function inPerson\(e\) \{[\s\S]*?\n\}/.exec(src); assert(m, "inPerson ve skriptu");
  const inPerson = new Function(m[0] + "; return inPerson;")();
  eq([
    inPerson({ summary: "JT: Novák", location: "Brno, Trnitá 500/9" }),
    inPerson({ summary: "JT: Novák (online)", location: "" }),
    inPerson({ summary: "JT: Novák", location: "", hangoutLink: "https://meet.google.com/x" }),
    inPerson({ summary: "porada", location: "" }),
    inPerson({ summary: "JT: Novák", location: "Kavárna Špalíček, Brno" }),
    inPerson({ summary: "JT: Novák", location: "https://zoom.us/j/1" }),
    inPerson({ summary: "Schůzka ZFP", location: "ZFP kancelář" })], [true, false, false, true, false, false, true], "inPerson");
};

/* celý skript poradce se spustí s náhradními službami Googlu */
tests["rezervace.gs: kolegové v společném kalendáři neblokují, osobní schůzka kolegy zablokuje jen osobní rezervaci"] = async function () {
  const src = readFileSync(new URL("../../tools/rezervace.gs", import.meta.url), "utf8");
  const d = at(3), T = (h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  const E = (summary, h, m, mins, o = {}) => ({ status: "confirmed", summary, start: { dateTime: iso(T(h, m)) }, end: { dateTime: iso(new Date(T(h, m).getTime() + mins * 60000)) }, creator: { email: "vojta@example.com" }, ...o });
  const items = [
    E("VK: Novák", 10, 0, 45),                                                               /* moje */
    E("JT: Kolega osobně", 14, 0, 45, { creator: { email: "jt@example.com" }, location: "Brno, Trnitá 500/9" }),
    E("JT: Kolega online (online)", 16, 0, 45, { creator: { email: "jt@example.com" } }),
    E("JT: Kolega mimo", 12, 0, 45, { creator: { email: "jt@example.com" }, location: "Kavárna, Brno" }),
    E("Rezervace z webu", 9, 0, 45, { creator: { email: "vojta@example.com" }, extendedProperties: { private: { zfpHold: "1" } } })];
  const inserted = [], props = { CAL: "shared", PREFIX: "VK:" }, cache = {};
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => "vojta@example.com" }) },
    Calendar: { Freebusy: { query: () => ({ calendars: { primary: { busy: [{ start: iso(T(18)), end: iso(T(19)) }] } } }) },
      Events: { list: () => ({ items }), insert: (ev, cal) => { inserted.push({ ev, cal }); return { id: "hold1" }; } } },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 1 }, createTextOutput: t => ({ t, setMimeType() { return this; } }) } };
  const handle = new Function(...Object.keys(env), src + "; return handle;")(...Object.values(env));
  const r = handle({ a: "busy", days: 10 });
  const has = (L, h) => L.some(([a]) => new Date(a).getHours() === h);
  eq([r.ok, r.v, has(r.busy, 10), has(r.busy, 9), has(r.busy, 18), has(r.busy, 14), has(r.busy, 16), has(r.busy, 12)], [true, 2, true, true, true, false, false, false], "busy = moje + osobní kalendář, ne kolegové");
  eq([has(r.office, 14), has(r.office, 16), has(r.office, 12)], [true, false, false], "office = jen kolega osobně v kanceláři");
  eq(handle({ a: "book", start: iso(T(14, 0)), online: "0" }).err, "office", "osobně v obsazené kanceláři");
  const on = handle({ a: "book", start: iso(T(14, 0)), online: "1" });
  eq([on.ok, inserted.length, inserted[0].ev.summary], [true, 1, "VK: Rezervace z webu (online)"], "online u kolegy osobně jde");
  eq(handle({ a: "book", start: iso(T(16, 0)), online: "0" }).ok, true, "osobně, když má kolega online");
  eq(handle({ a: "book", start: iso(T(10, 0)), online: "1" }).err, "busy", "moje vlastní schůzka blokuje");
  props.PREFIX = ""; /* bez PREFIX se vše bere jako moje (starší chování) */
  const old = handle({ a: "busy", days: 10 });
  eq([has(old.busy, 14), old.office.length], [true, 0], "bez PREFIX");
};

/* Pipeline (index.html): kdy je kancelář obsazená a které termíny poradce zveřejní jako „uvolnitelné“ – funkce se vytáhnou ze zdroje a běží s náhradními závislostmi */
function pipelineFns() {
  const src = readFileSync(new URL("../index.html", import.meta.url), "utf8").split("\n");
  const grab = name => { const i = src.findIndex(l => new RegExp(`^(async )?function ${name}\\(|^const ${name}=`).test(l)); assert(i >= 0, "v Pipeline chybí " + name);
    let j = i + 1; while (j < src.length && !/^(function|async function|const|let|\/\*|\/\/|document|setInterval)/.test(src[j])) j++; return src.slice(i, j).join("\n"); };
  const code = ["DZS", "dzAfterSchool", "dzFreeSlots", "dzInPerson", "dzBlocks", "dzDayOff", "dzOffice", "dzDaySlots"].map(grab).join("\n");
  return new Function("ctKind", "ctMinutesOf", "ymd", "SCHOOL_AFTER", "settings", code + "; return {dzOffice,dzDaySlots};")(
    ev => ev.kind, iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }, d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"), 0, {});
}
let wd = 4; while ([0, 6].includes(at(wd).getDay())) wd++;   /* všední den (víkend nemá žádné bloky) */
const day = at(wd); const key = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
const ev = (kind, h, m, mins, extra = {}) => { const s = new Date(day); s.setHours(h, m, 0, 0); return { kind, title: "x", allDay: false, start: s.toISOString(), end: new Date(s.getTime() + mins * 60000).toISOString(), ...extra }; };
tests["Pipeline: kancelář obsadí jen osobní schůzka kolegy (online ne)"] = async function () {
  const { dzOffice } = pipelineFns();
  eq([
    dzOffice(ev("off", 10, 0, 45, { place: "Brno, Trnitá 500/9" })),
    dzOffice(ev("off", 10, 0, 45, { title: "JT: Novák (online)", place: "" })),
    dzOffice(ev("off", 10, 0, 45, { place: "", meet: true })),
    dzOffice(ev("off", 10, 0, 45, { title: "porada", place: "" })),
    dzOffice(ev("off", 10, 0, 45, { place: "Kavárna, Brno" })),
    dzOffice(ev("mine", 10, 0, 45, { place: "Brno, Trnitá 500/9" })),
    dzOffice(ev("off", 0, 0, 1440, { allDay: true }))], [true, false, false, true, false, false, false], "dzOffice");
};
tests["Pipeline: volné bloky – kolega online neruší, kolega osobně = jen online, moje schůzka blok drží a po zrušení se uvolní"] = async function () {
  const { dzDaySlots } = pipelineFns();
  const hm = s => s.map(x => Math.floor(x.m / 60) + ":" + String(x.m % 60).padStart(2, "0") + (x.online ? "o" : ""));
  const free = evs => hm(dzDaySlots(key, evs)).slice(0, 3);
  eq(free([]), ["8:30", "10:00", "11:30"], "bez událostí");
  eq(free([ev("off", 10, 0, 45, { title: "JT: A (online)", place: "" })]), ["8:30", "10:00", "11:30"], "kolega online – nic se nemění");
  eq(free([ev("off", 10, 0, 45, { place: "Brno, Trnitá 500/9" })]), ["8:30", "10:00o", "11:30"], "kolega osobně – 10:00 jen online");
  const mine = ev("mine", 10, 0, 45);
  eq(free([mine]), ["8:30", "11:30", "13:00"], "moje schůzka blok drží");
  eq(hm(dzDaySlots(key, [mine], true)).slice(0, 3), ["8:30", "10:00", "11:30"], "bez mojí schůzky (kandidát na uvolnění) je blok zpět");
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
