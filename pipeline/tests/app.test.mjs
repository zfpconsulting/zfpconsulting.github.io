import { readFileSync } from "node:fs";
// Testy appky Pipeline – každý test dostane env {browser,url,key} a otevře si vlastní stránku.
import { openApp, assert, eq } from "./helpers.mjs";

const TABS = ["pipe", "money", "cli", "cal", "fp", "uv", "net", "tax", "akv", "pf", "calc", "duch", "db"];
const closeDialogs = p => p.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
const STORE = {
  "settings/main": { manual: {}, sign: "Test", career: { cpts: 30000, cAsOf: "2026-06-15", cBase: 0 }, tabHidden: [], _u: 1 },
  "leads/r1": { name: "Skutečný Klient", stage: "nabidka", items: [], _u: 1 },
  "team/a": { name: "A", pos: "P4", parent: null, m: { "2026-07": 400, "2026-08": 300, "2026-09": 200 }, _u: 1 },
};


/* ---------- šablony potvrzení schůzky a termín „za n dní“ ---------- */
const TPL_ONLINE = { id: "potvrzeni", name: "Potvrzení schůzky", text: "Dobrý den, {osloveni}, potvrzuji naši schůzku {den} {datum} {vcas}{kde}.\n{podpis}" };
const TPL_MEET = { id: "onl", name: "Potvrzení online konzultace", text: "Dobrý den, {osloveni}, potvrzuji naši schůzku {den} {datum} {vcas}{kde}. Zde Vám zasílám odkaz pro připojení: {meet}.\n{podpis}" };
const DAY_PH = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];
/* „za n dní“ jako česká věta a jako ISO čas – n = 2…6, ať se nikdy netrefí na dnešek ani na „zítra“ */
const inDays = (n, hour) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0);
  const z = x => String(x).padStart(2, "0"); return { say: DAY_PH[d.getDay()], iso: d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(hour) + ":00" }; };

export default {
  async "potvrzení e-mailem: vlastní šablona v nastavení (osobně / online), předmět + text, uložení"(env) {
    const { ctx, page, errors } = await openApp(env, { store: { ...STORE, "settings/main": { ...STORE["settings/main"], tpls: [TPL_ONLINE, TPL_MEET] } } });
    const d = inDays(3, 15);
    /* výchozí text: osobně končí termínem a místem (Trnitá, když místo chybí), online odkazem; bez podpisu a poděkování */
    let r = await page.evaluate(iso => [confMailOut({ name: "Ing. Jan Novák", start: new Date(iso).toISOString(), online: false, place: "" }),
      confMailOut({ name: "Eva Pirková", start: new Date(iso).toISOString(), online: true, meetLink: "https://meet.google.com/x" })], d.iso);
    assert(r[0].body.startsWith("Dobrý den, pane inženýre,") && r[0].body.endsWith("Místo: Brno, Trnitá 500/9"), "osobně: " + r[0].body);
    assert(r[0].body.includes("Termín: " + d.say + " "), "termín: " + r[0].body);
    assert(/^Potvrzení konzultace \d+\. \d+\.$/.test(r[0].subject), "předmět: " + r[0].subject);
    assert(r[1].body.endsWith("Odkaz pro připojení: https://meet.google.com/x") && /^Potvrzení online konzultace/.test(r[1].subject), "online: " + JSON.stringify(r[1]));
    assert(!/Test|Děkuji|S pozdravem/.test(r[0].body + r[1].body), "bez podpisu a poděkování");
    /* nastavení: dvě karty, úprava se uloží a použije */
    await page.evaluate(() => renderTpls());
    eq(await page.$$eval("#mailConfList .tpl", n => n.length), 2, "osobně + online");
    /* nastavení je skryté okno – hodnoty se zapíšou přímo do polí a vyvolá se change */
    await page.evaluate(() => { const set = (sel, v) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event("change")); };
      set('#mailConfList input[aria-label="Předmět – Osobně"]', "Schůzka {datum}");
      set('#mailConfList textarea[aria-label="Text e-mailu – Osobně"]', "Dobrý den, {osloveni}, vidíme se {den} {vcas} – {misto}."); });
    await page.waitForTimeout(200);
    r = await page.evaluate(iso => ({ s: settings.mailConf, o: confMailOut({ name: "Jan Novák", start: new Date(iso).toISOString(), online: false, place: "Kavárna" }) }), d.iso);
    eq(r.s.osobne.subject, "Schůzka {datum}", "uložený předmět");
    assert(/^Schůzka \d/.test(r.o.subject) && r.o.body === "Dobrý den, pane Nováku, vidíme se " + d.say + " v 15:00 – Kavárna.", "vlastní text: " + JSON.stringify(r.o));
    /* okno zprávy: u potvrzení osobní schůzky je i pole na e-mail s tlačítkem Potvrdit e-mailem */
    await page.evaluate(iso => openMsg({ name: "Jan Novák", phone: "777111222", email: "n@example.com", start: new Date(iso).toISOString(), online: false, place: "", meetId: null }, "potvrzeni"), d.iso);
    await page.waitForSelector("dialog[open] input[type=email]");
    assert(await page.evaluate(() => [...document.querySelectorAll("dialog[open] button")].some(b => b.textContent.includes("Potvrdit e-mailem"))), "tlačítko Potvrdit e-mailem");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "appka naběhne a všechny záložky se vykreslí bez chyb"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    for (const v of TABS) { await page.evaluate(v => setView(v), v); await page.waitForTimeout(300); }
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "úkoly s časem deadlinu: push notifikace v čas / X min předem, hotové a bez času ne"(env) {
    const { ctx, page } = await openApp(env);
    const r = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 1); const due = ymd(d);
      myTasks = [
        { id: "a1", text: "Zavolat Novákovi", client: "Novák", due, dueTime: "14:30", remind: 15, done: "" },
        { id: "a2", text: "V čas", client: "", due, dueTime: "09:00", remind: 0, done: "" },
        { id: "a3", text: "Hotový", due, dueTime: "10:00", done: "2026-01-01T00:00:00Z" },
        { id: "a4", text: "Bez času", due, dueTime: "", done: "" },
        { id: "a5", text: "Skrytý", due, dueTime: "11:00", hidden: true, done: "" }];
      const pl = pushPlan(Date.now()).filter(x => x.pl.tag.startsWith("task-"));
      const at = (h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
      const tag = asDueTag({ due, time: "14:30", st: "nový" });
      return { n: pl.length, ats: pl.map(x => x.at), want: [at(9, 0), at(14, 15)], t0: pl[0] && pl[0].pl.t, b1: pl[1] && pl[1].pl.b, tag: tag && tag.txt.endsWith("14:30") };
    });
    eq(r.n, 2, "počet naplánovaných notifikací úkolů");
    eq(r.ats, r.want, "časy notifikací");
    assert(/termín teď/.test(r.t0), "titulek v čas termínu");
    assert(/Novák/.test(r.b1) && /14:30/.test(r.b1), "tělo s klientem a časem");
    assert(r.tag, "štítek s časem u úkolu");
    await ctx.close();
  },

  async "nahrávka: lead s překlepem ve jménu se sloučí do klienta, termín z textu do Deadline/Čas; pole úkolu podle textu"(env) {
    const now = new Date().toISOString(), y = new Date(Date.now() - 864e5 * 30).toISOString();
    const tmr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") })();
    const store = { ...STORE,
      "leads/al": { name: "Alois Mareš", stage: "schuzka", items: [], phone: "777111222", note: "", log: [], createdAt: y, _u: 1 },
      "leads/dup": { name: "Aloys Mareš", stage: "novy", items: [], meetings: [], note: "Nahrávka 26. 10.\n• chce DIP", log: [{ d: now, t: "Nahrávka z 26. 10." }], createdAt: now, _u: 1 },
      "mytasks/t1": { text: "• Zavolat a domluvit schůzku\n• Zavolat panu Marešovi a domluvit si s ním schůzku (deadline zítra 11:00)", client: "Aloys Mareš", leadId: "dup", due: tmr, done: "", createdAt: now, _u: 1 },
      "files/f1": { owner: "l:dup", name: "Přepis schůzky.txt", mime: "text/plain", size: 10, at: now, drv: null, _u: 1 } };
    const { ctx, page, errors } = await openApp(env, { store });
    await page.waitForFunction(() => !leads.some(l => l.id === "dup"), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ names: leads.map(l => l.name).sort(), al: leads.find(l => l.id === "al"),
      tasks: myTasks.filter(t => !t.done && !t.hidden).map(t => ({ text: t.text, client: t.client, leadId: t.leadId, due: t.due, time: t.dueTime || "" })),
      file: (window.Docs && Docs.filesFor(["l:al"]) || []).map(f => f.name) }));
    assert(!r.names.includes("Aloys Mareš"), "duplicitní lead smazaný: " + r.names);
    eq(r.tasks.length, 1, "jeden úkol: " + JSON.stringify(r.tasks));
    eq([r.tasks[0].client, r.tasks[0].leadId, r.tasks[0].due, r.tasks[0].time], ["Alois Mareš", "al", tmr, "11:00"], "úkol u Aloise, deadline + čas");
    assert(!/deadline/i.test(r.tasks[0].text) && /Zavolat panu Marešovi a domluvit si s ním schůzku$/m.test(r.tasks[0].text), "termín zmizel z textu: " + r.tasks[0].text);
    assert(/chce DIP/.test(r.al.note || "") && (r.al.log || []).some(x => /Nahrávka z/.test(x.t)), "poznámka a historie u Aloise");
    eq(r.file, ["Přepis schůzky.txt"], "přepis přesunutý k Aloisovi");
    /* pole úkolu: přesně na obsah */
    const h = await page.evaluate(async () => {
      asOpenMine(asAllTasks().find(t => t.st !== "hotovo"));await new Promise(z => setTimeout(z, 400));
      const ta = document.querySelector('#edDlg textarea[aria-label="Text úkolu"]'), one = ta.scrollHeight, H = ta.offsetHeight;
      ta.value += "\n• další řádek\n• a ještě jeden"; ta.dispatchEvent(new Event("input"));
      const H2 = ta.offsetHeight, fits = ta.scrollHeight <= ta.clientHeight + 1;
      ta.value = "krátký"; ta.dispatchEvent(new Event("input"));
      return { H, one, H2, fits, H3: ta.offsetHeight, lh: parseFloat(getComputedStyle(ta).lineHeight) };
    });
    assert(h.H2 > h.H && h.fits, "pole se zvětší, vše se vejde: " + JSON.stringify(h));
    assert(h.H3 < h.H && Math.abs(h.H3 - h.lh) <= 2, "krátký text = jeden řádek: " + JSON.stringify(h));
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },

  async "synchronizace slučuje změny ze dvou zařízení po položkách"(env) {
    const { ctx, page } = await openApp(env);
    const r = await page.evaluate(() => {
      const base = { sjetiny: { "2026-08/1": 10 }, tax: { 2026: { a: 1 } }, sign: "A", _u: 1, _f: {} };
      const A = structuredClone(base); A.sjetiny["2026-09/1"] = 50; A._f = stampDoc(base, A, 100); A._u = 100;
      const B = structuredClone(base); B.tax = { 2026: { a: 2 } }; B.sign = "B"; B._f = stampDoc(base, B, 200); B._u = 200;
      const m1 = mergeDoc(A, B), m2 = mergeDoc(B, A);
      const C = structuredClone(base); C.sjetiny = {}; C._f = stampDoc(base, C, 300); C._u = 300;
      const m3 = mergeDoc(m1, C);
      return { sj: m1.sjetiny, tax: m1.tax, sign: m1.sign, sym: JSON.stringify(m1) === JSON.stringify(m2), sj3: m3.sjetiny };
    });
    eq(r.sj, { "2026-08/1": 10, "2026-09/1": 50 }, "sjetina z prvního zařízení");
    eq(r.tax, { 2026: { a: 2 } }, "daně z druhého zařízení");
    eq(r.sign, "B", "novější podpis");
    assert(r.sym, "výsledek nezávisí na pořadí");
    eq(r.sj3, { "2026-09/1": 50 }, "pozdější smazání sjetiny se propíše");
    await ctx.close();
  },

  async "krok zpět a vpřed"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const act = async f => { await page.mouse.click(200, 500); await page.evaluate(f); await page.waitForTimeout(250); };
    await act(async () => { await db.collection("leads").add({ name: "Undo", stage: "novy", items: [] }) });
    await act(async () => { const l = leads.find(x => x.name === "Undo"); await db.doc("leads/" + l.id).update({ stage: "schuzka" }) });
    await act(async () => { const l = leads.find(x => x.name === "Undo"); await db.doc("leads/" + l.id).delete() });
    const st = () => page.evaluate(() => leads.find(x => x.name === "Undo")?.stage || null);
    eq(await st(), null, "smazáno");
    await page.click("#undoBtn"); await page.waitForTimeout(200); eq(await st(), "schuzka", "zpět 1");
    await page.click("#undoBtn"); await page.waitForTimeout(200); eq(await st(), "novy", "zpět 2");
    await page.click("#redoBtn"); await page.waitForTimeout(200); eq(await st(), "schuzka", "vpřed");
    await page.keyboard.press("Control+z"); await page.waitForTimeout(200); eq(await st(), "novy", "Ctrl+Z");
    await ctx.close();
  },

  async "prezentační režim: fiktivní data, pravidla a návrat ke skutečným"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    const before = await page.evaluate(() => localStorage.getItem("crm_store_v1"));
    await page.evaluate(() => demoSwitch(true, true)); await page.waitForTimeout(2500); await closeDialogs(page);
    const r = await page.evaluate(() => {
      const lv = x => { const l = obratLevelFor(x); return l ? PROFI.indexOf(l) + 1 : 0 };
      const qs = [qShift(CURQ(), -3), qShift(CURQ(), -2), qShift(CURQ(), -1)];
      return { demo: DEMO, team: team.length, maxPos: Math.max(...team.map(m => +m.pos.slice(1))), stat: +career().stat.slice(1),
        me: qs.map(q => lv(quarterTotal(q))), tm: qs.map(q => lv(Math.max(...team.map(m => memberQPts(m, q))))),
        clients: clientEntries().length, miss: leads.filter(l => l.stage !== "lost" && !clientEntries().some(e => (e.lead && e.lead.id === l.id) || sameName(e.name, l.name))).length, open: leads.filter(l => !SIGNED(l.stage)).length, sign: settings.sign };
    });
    assert(r.demo, "běží demo"); eq(r.team, 8, "8 obchodníků"); assert(r.clients >= 10, "klienti"); eq(r.miss, 0, "všichni z pipeline (kromě Lost) jsou i v klientech"); assert(r.open >= 5, "rozjednané leady");
    assert(r.stat > r.maxPos, "statická kariéra výš než tým");
    r.me.forEach((l, i) => assert(l > r.tm[i], `obratová výš než tým (kvartál ${i}: ${l} vs ${r.tm[i]})`));
    assert(/^V\S* K/.test(r.sign), "iniciály VK");
    for (const v of TABS) { await page.evaluate(v => setView(v), v); await page.waitForTimeout(250); }
    await page.evaluate(() => demoSwitch(false)); await page.waitForTimeout(1800);
    eq(await page.evaluate(() => [DEMO, leads.map(l => l.name)]), [false, ["Skutečný Klient"]], "zpět na skutečná data");
    eq(await page.evaluate(() => localStorage.getItem("crm_store_v1")), before, "skutečná data beze změny");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "čistý režim: prázdná appka, úpravy oddělené od skutečných dat"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    const before = await page.evaluate(() => localStorage.getItem("crm_store_v1"));
    await page.evaluate(() => demoSwitch("clean")); await page.waitForTimeout(2000); await closeDialogs(page);
    const r = await page.evaluate(() => ({ demo: DEMO, clean: CLEAN, leads: leads.length, team: team.length, clients: clientEntries().length, sj: Object.keys(settings.sjetiny || {}).length, sync: $("syncBtn").textContent }));
    eq(r, { demo: true, clean: true, leads: 0, team: 0, clients: 0, sj: 0, sync: "Čistý režim" }, "prázdná appka");
    for (const v of TABS) { await page.evaluate(v => setView(v), v); await page.waitForTimeout(250); }
    await page.evaluate(() => db.collection("leads").add({ name: "Zkušební Lead", stage: "osloven", createdAt: new Date().toISOString() })); await page.waitForTimeout(300);
    await page.evaluate(() => demoSwitch(false)); await page.waitForTimeout(1800);
    eq(await page.evaluate(() => localStorage.getItem("crm_store_v1")), before, "skutečná data beze změny");
    await page.evaluate(() => demoSwitch("clean")); await page.waitForTimeout(1800); await closeDialogs(page);
    eq(await page.evaluate(() => leads.map(l => l.name)), ["Zkušební Lead"], "vyzkoušené zůstává");
    await page.evaluate(() => demoSwitch("clean", true)); await page.waitForTimeout(1800); await closeDialogs(page);
    eq(await page.evaluate(() => leads.length), 0, "začít znovu načisto");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "daně: režim s.r.o."(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const r = await page.evaluate(() => { const c = { ...taxCfg(), sroPay: 40000, sroIns: false, sroAcc: 36000, sroDiv: 100, kids: 2, oth: 0, pre: {}, exp: [], autoM: 0, autoReal: 0, gifts: [], dps: 0, zp: 0, dip: 0, dlp: 0, hy: {} };
      const R = taxCalc(c, 1500000, "sro"); return { dppo: R.dppo, divTax: R.divTax, wageTax: R.wageTax, net: Math.round(R.net) } });
    eq(r, { dppo: 172410, divTax: 97403, wageTax: 3636, net: 972631 }, "výpočet s.r.o.");
    await page.evaluate(() => setView("tax")); await page.waitForTimeout(300);
    await ctx.close();
  },

  async "body celkem = vlastní + skupinové, skupinové rostou z bodů týmu"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const r0 = await page.evaluate(() => ({ cum: cumPts(), gs: groupSince("2026-06-15") }));
    eq(r0.gs, groupSinceExpected(), "body týmu za uzavřené měsíce");
    await page.click("#c_cpts"); await page.waitForTimeout(300);
    const ins = page.locator("#edBody input");
    await ins.nth(0).fill("11000"); await ins.nth(0).press("Enter");
    await ins.nth(1).fill("20500"); await ins.nth(1).press("Enter"); await page.waitForTimeout(400);
    eq(await page.evaluate(() => [cumPts(), ownPts(), groupPts()]), [31500, 11000, 20500], "uloženo");
    await ctx.close();
    function groupSinceExpected() { const now = new Date(), cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"); return ["2026-07", "2026-08", "2026-09"].filter(m => m < cur).reduce((s, m) => s + ({ "2026-07": 400, "2026-08": 300, "2026-09": 200 })[m], 0) }
  },

  async "schůzky podle iniciálů vedle bodů celkem"(env) {
    const store = { ...STORE, "settings/main": { ...STORE["settings/main"], calPrefix: "VK:", calId: "primary" } };
    const { ctx, page, errors } = await openApp(env, { store });
    eq(await page.evaluate(() => ["VK: Novák", "Vk: Novák", "MB a VK: Herka", "VK+MB Trnka", "JT + VK podpis", "VK podpis Chloupek", "Konzultace VK", "Porada", "MB: Novák"].map(x => meetInitials(x, "VK"))),
      ["VK", "VK", "VK+MB", "VK+MB", "VK+JT", "VK", null, null, null], "iniciály v názvu");
    const ev = (id, summary, dateTime, extra = {}) => ({ id, summary, start: { dateTime }, ...extra });
    await page.evaluate(items => { calHist = items; _msMemo = null; render(); }, [
      ev("a", "VK: Novák", "2025-03-01T10:00:00+01:00"), ev("b", "VK: Dvořák", "2025-04-01T10:00:00+02:00"), ev("c", "Vk: Svoboda podpis", "2026-01-05T10:00:00+01:00"),
      ev("d", "MB a VK: Herka", "2024-10-18T13:00:00+02:00"), ev("e", "VK: Budoucí", "2099-01-01T10:00:00+01:00"),
      ev("f", "VK: Zrušená", "2025-05-01T10:00:00+02:00", { status: "cancelled" }), ev("g", "Konzultace VK", "2025-06-01T10:00:00+02:00"),
      ev("h", "VK: Úkoly", "2025-07-01T10:00:00+02:00", { extendedProperties: { private: { pipeline: "tasks" } } })]);
    eq(await page.evaluate(() => meetStats()), { total: 4, planned: 1, groups: [["VK", 3], ["VK+MB", 1]] }, "počty odehraných schůzek podle iniciálů");
    eq(await page.locator("#c_meets").textContent(), "4", "celkem vedle bodů celkem");
    assert(/VK 3 · VK\+MB 1/.test(await page.locator("#careerBar").textContent()), "rozpad podle iniciálů v pruhu");
    eq(errors, [], "bez chyb v konzoli");
    await ctx.close();
  },

  async "oddělovače tisíců v číselných polích"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    await page.evaluate(() => openEdit({ name: "T", stage: "nabidka", items: [{ p: "Investice", amt: 400000, var: "ZFPI", fee: 3, mode: "jednorazove" }] }));
    await page.waitForTimeout(500);
    const amt = page.locator("#dlg input.numfmt").first();
    eq(await amt.inputValue(), "400 000", "zobrazení");
    await amt.fill(""); await amt.type("1234567,5");
    eq([await amt.inputValue(), await amt.evaluate(i => i.value)], ["1 234 567,5", "1234567.5"], "psaní a čistá hodnota");
    const left = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while (n = w.nextNode()) { const el = n.parentElement; if (!el || el.closest("script,style") || (!el.offsetParent && !el.closest("svg"))) continue;
        for (const m of n.textContent.matchAll(/(^|[^\d.:\/+\-])(\d{4,})(?![\d.:\/-])/g)) if (!/^(19|20)\d\d$/.test(m[2])) out.push(m[2]) } return out });
    eq(left, [], "čísla bez oddělovače v textu");
    await ctx.close();
  },

  async "měření času v aplikaci odesílá záznamy"(env) {
    const { ctx, page, hb } = await openApp(env, { store: STORE });
    await page.evaluate(() => { Trk.lastIn = Date.now(); for (let i = 0; i < 8; i++) Trk.tick() });
    await page.waitForTimeout(800);
    assert(hb.length >= 1 && hb[0].secs >= 120, "odeslán záznam aspoň 2 min (" + JSON.stringify(hb) + ")");
    eq(await page.evaluate(() => Trk.pend()), 0, "nic nečeká na odeslání");
    await ctx.close();
  },

  async "zámek aplikace: biometrie (virtuální) a PIN"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    await page.evaluate(async () => { await AppLock.enableBio(); await AppLock.enablePin("1234") });
    await page.reload(); await page.waitForTimeout(1200);
    eq(await page.evaluate(() => [AppLock.isLocked(), document.documentElement.classList.contains("applocked")]), [true, true], "po otevření zamčeno");
    await page.click("#lockBio"); await page.waitForTimeout(700);
    eq(await page.evaluate(() => AppLock.isLocked()), false, "odemčeno biometrií");
    await page.evaluate(() => AppLock.show());
    await page.fill("#lockPin", "9999"); await page.waitForTimeout(400);
    eq(await page.evaluate(() => AppLock.isLocked()), true, "špatný PIN neodemkne");
    await page.fill("#lockPin", "1234"); await page.waitForTimeout(600);
    eq(await page.evaluate(() => AppLock.isLocked()), false, "správný PIN odemkne");
    await ctx.close();
  },

  async "výdělek: přepínání měsíců a pipeline nabízí minulý měsíc"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const prevYm = await page.evaluate(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") });
    assert(await page.evaluate(ym => perList().includes(ym), prevYm), "minulý měsíc v nabídce Pipeline");
    await page.evaluate(() => { settings.sjetiny = { ...(settings.sjetiny || {}), "2026-01/1": 1 }; setView("money") }); await page.waitForTimeout(300);
    const now = await page.textContent("#m_qlabel");
    await page.click("#mPrevM"); await page.waitForTimeout(250);
    const prev = await page.textContent("#m_qlabel");
    assert(prev !== now && /vyplaceno|vyplatí/.test(prev), "přepnuto na minulý měsíc: " + prev);
    await page.click("#mNextM"); await page.waitForTimeout(250);
    eq(await page.textContent("#m_qlabel"), now, "zpět na aktuální");
    await ctx.close();
  },

  async "import výpisu ZFP: přesné body, tým po kolezích v bodech, žádné osobní údaje"(env) {
    const store = { ...STORE, "team/k1": { name: "Jeden Podřízený", pos: "P3", parent: null, m: {}, _u: 1 } };
    const { ctx, page } = await openApp(env, { store });
    const ym = await page.evaluate(() => lastMonths(2)[1]), yp = ym.replace("-", "/");
    const raw = readFileSync(new URL("./fixtures/zfp-vypis.txt", import.meta.url), "utf8").replaceAll("2026/08", yp);
    /* záludnost ze skutečného výpisu: číslo smlouvy končící 3 číslicemi hned před body (dřív se slilo v 234 336,9) */
    const raw2 = raw.replace("2026/08/1", yp + "/2").replaceAll(yp + "/1", yp + "/2").replace("Tyrkysová Jana   ZFP realitní fond   PZ1   1112223340   17,98   150,00   2 696,84", "Tyrkysová Jana   Hypotéka ČS   PZ1   234   336,90   150,00   50 535,00")
      .replace("Tarif / statická kariéra:   Body:   35,77", "Tarif / statická kariéra:   Body:   354,69").replace("Celkem provize [Kč]:   6 222,20", "Celkem provize [Kč]:   54 060,36");
    const r2 = await page.evaluate(t => parseClosingText(t, "x.pdf"), raw2);
    const pm = await page.evaluate(ym => clShiftPer(ym + "/1", -1).slice(0, 7), ym);
    eq([r2.stmtPer, r2.per, r2.pts, r2.chk.rows, r2.chk.bad], [ym + "/2", pm + "/2", 354.69, 354.69, 0], "výpis = výplata, produkce o měsíc dřív; číslo smlouvy se neslije s body");
    /* vklady do investic pod 50 000 Kč (odhad z bodů za vstupní poplatek) = pravidelné vklady: WI 2,27 b ≈ 25 000 Kč, 0,33 b, převzaté 0,04 a 0,31 b;
       ZFP realitní fond 17,98 b ≈ 200 000 Kč je jednorázový vklad → aktivní produkce */
    const r1 = await page.evaluate(t => parseClosingText(t, "x.pdf"), raw);
    eq([r1.reg, r1.regN, r2.reg], [2.95, 4, 2.95], "pravidelné vklady");
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(300);
    await page.locator("#edBody input[type=file]").setInputFiles([
      { name: "vypis1.pdf.txt", mimeType: "text/plain", buffer: Buffer.from(raw) }, { name: "vypis2.pdf.txt", mimeType: "text/plain", buffer: Buffer.from(raw2) }]);
    await page.waitForTimeout(800);
    const txt = await page.textContent("#edBody");
    assert(/1\. uzávěrka/.test(txt) && /2\. uzávěrka/.test(txt), "obě uzávěrky poznané");
    assert(/✓ sedí s řádky výpisu/.test(txt), "výplata sedí: " + txt.slice(0, 600));
    assert(/zapíše se k členovi Jeden Podřízený/.test(txt) && /nový člen týmu/.test(txt), "tým po kolezích");
    assert(!/Nováková|7712345678|Tyrkysová/.test(txt), "v okně nejsou klienti");
    await page.click("#edBody >> text=Uložit do výsledků"); await page.waitForTimeout(900);
    const r = await page.evaluate(ym => ({ sj1: settings.sjetiny[ym + "/1"], sj2: settings.sjetiny[ym + "/2"], bonus: settings.monthlyBonus?.[ym], kcTeam: settings.monthlyTeam?.[ym] ?? null,
      udr: settings.monthlyUdr?.[ym], rate: settings.monthlyRate?.[ym], k1: team.find(m => m.name === "Jeden Podřízený")?.m?.[ym], k2: team.find(m => m.name === "Podřízený Druhý")?.m?.[ym],
      pos2: team.find(m => m.name === "Podřízený Druhý")?.pos, cum: settings.career.cpts }), pm);
    eq(r, { sj1: 35.77, sj2: 354.69, bonus: 4000, kcTeam: null, udr: 24.56, rate: 150, k1: 0.08, k2: 27.44, pos2: "P3", cum: 9081.02 }, "uloženo do výsledků");
    const g = await page.evaluate(ym => { const row = monthRow(ym, { tot: 0, udr: 0, reg: 0 }); return { reg: settings.monthlyReg[ym], pas: settings.passive.regular, own: Math.round(mVal(row, "own")), regKc: Math.round(mVal(row, "reg")) } }, pm);
    eq(g, { reg: 5.9, pas: 5.9, own: Math.round((35.77 + 354.69 - 24.56 - 5.9) * 150 + 4000), regKc: Math.round(5.9 * 150) }, "aktivní produkce bez pravidelných vkladů, celkově v pasivním příjmu");
    const dump = await page.evaluate(() => { let s = ""; for (let i = 0; i < localStorage.length; i++) s += localStorage.getItem(localStorage.key(i)); return s });
    for (const x of ["Nováková", "Dvořák", "Tyrkysová", "7712345678", "ZW998877", "Fiktivní", "Příkop", "12.03.1990"]) assert(!dump.includes(x), "uloženo: " + x);
    await ctx.close();
  },

  async "import: body kolegy už zadané za měsíc se nepřepíšou, nečitelný soubor se nahlásí"(env) {
    const ymP = new Date(); ymP.setDate(1); ymP.setMonth(ymP.getMonth() - 2);
    const ym = ymP.getFullYear() + "-" + String(ymP.getMonth() + 1).padStart(2, "0");
    const pmD = new Date(ymP.getFullYear(), ymP.getMonth() - 1, 1), pm = pmD.getFullYear() + "-" + String(pmD.getMonth() + 1).padStart(2, "0");
    const store = { ...STORE, "team/k2": { name: "Podřízený Druhý", pos: "P3", parent: null, m: { [pm]: 99 }, _u: 1 } };
    const { ctx, page } = await openApp(env, { store });
    const raw = readFileSync(new URL("./fixtures/zfp-vypis.txt", import.meta.url), "utf8").replaceAll("2026/08", ym.replace("-", "/"));
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(300);
    await page.locator("#edBody input[type=file]").setInputFiles([{ name: "v.txt", mimeType: "text/plain", buffer: Buffer.from(raw) }, { name: "sken.txt", mimeType: "text/plain", buffer: Buffer.from("  ") }]);
    await page.waitForTimeout(700);
    const txt = await page.textContent("#edBody");
    assert(/už zadáno 99 b/.test(txt) && /nepřepíšu/.test(txt), "hlášení u už zadaného kolegy");
    assert(/bez textu/.test(txt) && !/null/.test(txt), "nečitelný soubor nahlášen");
    await page.locator("#edBody button", { hasText: "Struktura" }).first().click(); await page.waitForTimeout(200);
    const sk = await page.evaluate(() => document.querySelector(".skeldlg textarea").value);
    assert(!/7712345678/.test(sk), "kostra bez čísel smluv");
    await page.evaluate(() => document.querySelectorAll(".skeldlg").forEach(d => { d.close(); d.remove() }));
    await page.click("#edBody >> text=Uložit do výsledků"); await page.waitForTimeout(800);
    eq(await page.evaluate(ym => team.find(m => m.name === "Podřízený Druhý").m[ym], pm), 99, "nepřepsáno");
    await ctx.close();
  },

  async "oprava dřívějšího importu zapsaného o měsíc vedle"(env) {
    const store = { ...STORE, "team/k2": { name: "Kolega", pos: "P3", parent: null, m: { "2026-08": 13.72, "2026-07": 5 }, _u: 1 },
      "settings/main": { manual: {}, tabHidden: [], sjetiny: { "2026-07/1": 35.8, "2026-08/1": 35.77, "2026-08/2": 100, "2026-09/1": 50 }, monthlyRate: { "2026-08": 150, "2026-09": 160 }, monthlyUdr: { "2026-08": 12.28, "2026-09": 3 },
        monthlyBonus: { "2026-08": 2000, "2026-09": 0 },
        closings: { "2026-08/1": { pts: 35.77, udr: 12.28, rate: 150, bonus: 2000, team: { k2: 13.72 } }, "2026-09/1": { pts: 50, udr: 3, rate: 160, bonus: 0, team: {} } }, _u: 1 } };
    const { ctx, page } = await openApp(env, { store });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ sj: settings.sjetiny, mr: settings.monthlyRate, mu: settings.monthlyUdr, mb: settings.monthlyBonus || {}, k: team.find(m => m.name === "Kolega").m, v: settings.closingsV, keys: Object.keys(settings.closings).sort() }));
    eq(r.sj, { "2026-07/1": 35.77, "2026-08/1": 50, "2026-08/2": 100 }, "body přesunuté o měsíc dřív (ruční 8/2 zůstala)");
    eq(r.mr, { "2026-07": 150, "2026-08": 160 }, "tarif");
    eq(r.mu, { "2026-07": 12.28, "2026-08": 3 }, "udržovačky");
    eq(r.mb, { "2026-07": 2000 }, "mimořádné provize");
    eq(r.k, { "2026-07": 13.72 }, "body kolegy přesunuté");
    eq([r.v, r.keys], [2, ["2026-07/1", "2026-08/1"]], "záznamy importu");
    await ctx.close();
  },

  async "pasivní příjem: proplacená investice se přičte k AUM společnosti, podepsaná zůstane zvlášť, součet se nemění"(env) {
    const inv = (amt, v) => ({ p: "Investice", amt, var: v, fee: 0, mode: "jednorazove" });
    const store = { ...STORE,
      "settings/main": { ...STORE["settings/main"], passive: { aum: { ZFPI: 3000000, WI: 0 } } },
      "leads/pod": { name: "Podepsaný", stage: "podpis", signedAt: "2026-09-01", items: [inv(1000000, "ZFPI")], _u: 1 },
      "leads/pay": { name: "Proplacený", stage: "vyplaceno", signedAt: "2026-09-01", paidAt: "2026-09-20", items: [inv(2000000, "ZFPI"), inv(500000, "WI")], _u: 1 } };
    const { ctx, page, errors } = await openApp(env, { store });
    const snap = () => page.evaluate(() => { const M = passiveModel(0), z = M.base.find(c => c.k === "ZFPI"), w = M.base.find(c => c.k === "WI");
      return { zAum: z.aum, zDeals: z.aumDeals, wAum: w.aum, dealAum: M.dealAum, total: M.aumTotal, udr: M.series[0].udr } });
    const expUdr = 6000000 * 24 / 1555200 / 12 + 500000 * 12 / 276360 / 12;
    const a = await snap();
    eq([a.zAum, a.zDeals, a.wAum, a.dealAum, a.total], [5000000, 2000000, 500000, 1000000, 6500000], "proplacené jsou v AUM společností, podepsané zvlášť");
    assert(Math.abs(a.udr - expUdr) < 1e-6, "udržovací body se proplacením nezměnily: " + a.udr + " vs " + expUdr);
    await page.evaluate(() => openAumSheet()); await page.waitForTimeout(300);
    const first = page.locator("dialog[open] input.aumin").first();
    eq(await first.evaluate(i => i.value), "5000000", "v okně je AUM včetně proplacených obchodů");
    await first.evaluate(i => { i.value = "5500000"; i.dispatchEvent(new Event("change", { bubbles: true })) }); await page.waitForTimeout(400);
    eq(await page.evaluate(() => settings.passive.aum.ZFPI), 3500000, "ruční zadání se ukládá bez proplacených obchodů");
    await closeDialogs(page);
    await page.evaluate(() => moveTo(leads.find(l => l.name === "Podepsaný"), "vyplaceno")); await page.waitForTimeout(700);
    const b = await snap();
    eq([b.zAum, b.zDeals, b.dealAum, b.total], [6500000, 3000000, 0, 7000000], "po přesunu do Vyplaceno částka přejde do AUM, součet zůstane");
    assert(Math.abs(b.udr - (7000000 - 500000) * 24 / 1555200 / 12 - 500000 * 12 / 276360 / 12) < 1e-6, "udržovací body po přesunu: " + b.udr);
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
};
