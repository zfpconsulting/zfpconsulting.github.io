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
/* podvržený Firebase (app/auth/firestore z gstatic) – databáze v paměti stránky (window.__fb), žádná síť.
   Zapisuje se čas importu (ať jde ověřit, že se Firebase nenačítá hned při startu). */
const FB_FAKE = {
  "firebase-app.js": `const F=globalThis.__fb||(globalThis.__fb={docs:{},subs:[],log:[],apps:[]});F.log.push(["app",performance.now()]);
export const initializeApp=(c,n)=>{const a={name:n||"[DEFAULT]"};F.apps.push(a);return a};export const getApps=()=>F.apps;`,
  "firebase-auth.js": `const F=globalThis.__fb;F.log.push(["auth",performance.now()]);
export const getAuth=a=>a.auth||(a.auth={currentUser:null,authStateReady:async()=>{}});
export const GoogleAuthProvider={credential:(i,t)=>({t})};
export const signInWithCredential=async(au,c)=>{au.currentUser={email:F.me,displayName:"Test Poradce"};return{user:au.currentUser}};
export const signOut=async au=>{au.currentUser=null;F.signedOut=true};`,
  "firebase-firestore.js": `const F=globalThis.__fb;F.log.push(["fs",performance.now()]);
export const initializeFirestore=a=>({a});export const getFirestore=a=>({a});export const persistentLocalCache=()=>({});export const persistentMultipleTabManager=()=>({});
export const doc=(db,c,id)=>({c:c.c||c,id:id||(c.c?Math.random().toString(36).slice(2):undefined)});export const collection=(db,c)=>({c});
export const where=(f,op,v)=>({f,op,v});export const query=(c,...w)=>({c:c.c,w});
const snap=q=>{const docs=Object.entries(F.docs).filter(([k,d])=>k.startsWith(q.c+"/")&&q.w.every(w=>d[w.f]===w.v)).map(([k,d])=>({id:k.slice(q.c.length+1),data:()=>d}));return{docs,metadata:{fromCache:false}}};
const fire=()=>F.subs.forEach(s=>{try{s.q.w?s.cb(snap(s.q)):s.cb({id:s.q.id,exists:()=>!!F.docs[s.q.c+"/"+s.q.id],data:()=>F.docs[s.q.c+"/"+s.q.id]})}catch(e){}});
F.fire=fire;
export const onSnapshot=(q,cb)=>{const s={q,cb};F.subs.push(s);F.listens=(F.listens||[]).concat(q.c);setTimeout(()=>fire(),0);return()=>{F.subs=F.subs.filter(x=>x!==s)}};
export const setDoc=async(d,v)=>{F.docs[d.c+"/"+d.id]=v;fire()};export const updateDoc=async(d,v)=>{F.docs[d.c+"/"+d.id]={...F.docs[d.c+"/"+d.id],...v};fire()};
export const deleteDoc=async d=>{delete F.docs[d.c+"/"+d.id];fire()};
export const writeBatch=()=>{const o=[];return{set:(d,v)=>o.push(()=>setDoc(d,v)),update:(d,v)=>o.push(()=>updateDoc(d,v)),delete:d=>o.push(()=>deleteDoc(d)),commit:async()=>{for(const f of o)await f()}}};
export const runTransaction=async(db,fn)=>fn({get:async d=>({exists:()=>!!F.docs[d.c+"/"+d.id]}),delete:d=>{delete F.docs[d.c+"/"+d.id]}});
export const terminate=async()=>{F.terminated=true};export const clearIndexedDbPersistence=async()=>{F.cleared=true};`,
};
const fbFake = (docs = {}) => async (page, ctx) => {
  await ctx.route(/gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, r => r.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: FB_FAKE[/firebase-[a-z]+\.js/.exec(r.request().url())[0]] }));
  await ctx.addInitScript(([docs, me]) => { if (!globalThis.__fb) globalThis.__fb = { docs, subs: [], log: [], apps: [], me }; }, [docs, "kudlicka.vojtech2002@gmail.com"]);
};
const TOK = JSON.stringify({ at: "test-token-123456789012345", exp: Date.now() + 36e5, scope: "calendar.events" });

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
    /* desktop: tlačítka zpět/vpřed v hlavičce */
    const { ctx, page } = await openApp(env, { store: STORE, width: 1200 });
    const act = async f => { await page.click("#bigTitle"); await page.evaluate(f); await page.waitForTimeout(250); };
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
    /* iPhone: tlačítka v hlavičce nejsou, smazání i přesun leadu vrátí „Vrátit“ v toastu */
    const m = await openApp(env, { store: { ...STORE, "leads/u1": { name: "Mobil Undo", stage: "kontaktovan", phone: "777000111", items: [], _u: 1 } }, width: 390, height: 844 });
    const mst = () => m.page.evaluate(() => leads.find(x => x.name === "Mobil Undo")?.stage || null);
    assert(!(await m.page.isVisible("#undoBtn")), "na mobilu je zpět v hlavičce skryté");
    await m.page.mouse.click(200, 500);
    await m.page.evaluate(() => moveTo(leads.find(x => x.name === "Mobil Undo"), "schuzka")); await m.page.waitForTimeout(300);
    eq(await mst(), "schuzka", "přesunuto");
    await m.page.click("#toast .tundo"); await m.page.waitForTimeout(300); eq(await mst(), "kontaktovan", "Vrátit v toastu po přesunu");
    await m.page.waitForTimeout(500);
    await m.page.evaluate(() => openEdit(leads.find(x => x.name === "Mobil Undo"))); await m.page.waitForTimeout(400); await m.page.evaluate(() => { $("delBtn").click(); $("delYes").click() }); await m.page.waitForTimeout(500);
    eq(await mst(), null, "smazáno");
    await m.page.click("#toast .tundo"); await m.page.waitForTimeout(300); eq(await mst(), "kontaktovan", "Vrátit v toastu po smazání");
    eq(m.errors, [], "bez chyb");
    await m.ctx.close();
  },

  async "detail leadu: Esc / Zrušit se změnou se zeptá (Uložit / Zahodit), klik na pozadí nezavře; nový úkol uloží Uložit v hlavičce"(env) {
    const { ctx, page, errors } = await openApp(env, { store: { ...STORE, "leads/d1": { name: "Dana Testová", stage: "kontaktovan", phone: "777000222", items: [], _u: 1 } }, width: 390, height: 844 });
    const open = () => page.evaluate(() => openEdit(leads.find(l => l.name === "Dana Testová")));
    await open(); await page.waitForTimeout(400);
    /* beze změny: Esc zavře rovnou */
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    assert(!(await page.evaluate(() => $("dlg").open)), "beze změny Esc zavře");
    /* klik na pozadí nic nezahodí */
    await open(); await page.waitForTimeout(400);
    await page.fill("#f_note", "Zahodit tohle"); await page.mouse.click(5, 5); await page.waitForTimeout(400);
    assert(await page.evaluate(() => $("dlg").open), "klik na pozadí detail nezavře");
    /* Zrušit → dotaz → Zahodit */
    await page.click("#cancelBtn"); await page.waitForSelector("#dlg .unsv");
    await page.click("#dlg .unsv button:not(.sv):not(.unsv-k)"); await page.waitForTimeout(500);
    eq(await page.evaluate(() => [$("dlg").open, leads.find(l => l.name === "Dana Testová").note || ""]), [false, ""], "zahozeno");
    /* Esc → dotaz → Uložit */
    await open(); await page.waitForTimeout(400);
    await page.fill("#f_note", "Uložit tohle"); await page.keyboard.press("Escape"); await page.waitForSelector("#dlg .unsv");
    await page.click("#dlg .unsv .sv"); await page.waitForTimeout(600);
    eq(await page.evaluate(() => [$("dlg").open, leads.find(l => l.name === "Dana Testová").note]), [false, "Uložit tohle"], "uloženo");
    /* nový úkol: vlevo Zrušit, vpravo Uložit, dole žádné druhé Uložit */
    await page.evaluate(() => asNewTask()); await page.waitForTimeout(400);
    eq(await page.evaluate(() => [getComputedStyle($("edCancel")).visibility, $("edClose").textContent, [...$("edBody").querySelectorAll("button")].some(b => /^Uložit/.test(b.textContent.trim()))]), ["visible", "Uložit", false], "hlavička nového úkolu");
    await page.fill('#edBody textarea[aria-label="Text úkolu"]', "Zavolat Daně"); await page.click("#edClose"); await page.waitForTimeout(500);
    assert(await page.evaluate(() => !$("edDlg").open && myTasks.some(t => t.text === "Zavolat Daně")), "úkol uložen z hlavičky");
    /* zobrazovací okno: jen Hotovo */
    await page.evaluate(() => openToday()); await page.waitForTimeout(400);
    eq(await page.evaluate(() => [getComputedStyle($("edCancel")).visibility, $("edClose").textContent]), ["hidden", "Hotovo"], "okno Dnes jen Hotovo");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },

  async "pipeline: hledání bez diakritiky / e-mail / telefon, Dnes udělat bez duplicit, karta bez Otevřít"(env) {
    const tmr = new Date(Date.now() + 864e5).toISOString().slice(0, 10), yst = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const store = { ...STORE,
      "leads/a": { name: "Petra Černá", stage: "kontaktovan", phone: "777 101 201", email: "petra@firma.cz", nextStep: "Zavolat kvůli schůzce", nextDate: yst, items: [], _u: 1 },
      "leads/b": { name: "Karel Dvořák", stage: "novy", phone: "777 102 202", email: "karel@example.com", items: [], _u: 1 },
      "leads/c": { name: "Ivo Bez", stage: "kontaktovan", phone: "", nextStep: "Poslat nabídku", nextDate: tmr, items: [], _u: 1 } };
    const { ctx, page, errors } = await openApp(env, { store, width: 1200 });
    await page.waitForTimeout(2500);   /* auto-úkol z dalšího kroku */
    const names = () => page.evaluate(() => [...document.querySelectorAll("#cols .card .name")].map(x => x.textContent).sort());
    await page.fill("#q", "cerna"); await page.waitForTimeout(300); eq(await names(), ["Petra Černá"], "bez diakritiky");
    eq(await page.evaluate(() => document.querySelector("#tiles .tile .v").textContent), "1", "dlaždice z výsledků");
    await page.fill("#q", "firma.cz"); await page.waitForTimeout(300); eq(await names(), ["Petra Černá"], "e-mail");
    await page.fill("#q", "777102202"); await page.waitForTimeout(300); eq(await names(), ["Karel Dvořák"], "telefon bez mezer");
    await page.fill("#q", "+420 777 102"); await page.waitForTimeout(300); eq(await names(), ["Karel Dvořák"], "telefon s předvolbou");
    await page.fill("#q", ""); await page.waitForTimeout(300);
    /* Dnes udělat: Petra jen jednou (úkol z dalšího kroku), Karel bez kroku jako lead; po termínu první */
    const rows = await page.evaluate(() => [...document.querySelectorAll("#todayList .row")].map(r => r.innerText));
    eq(rows.filter(r => r.includes("Petra Černá")).length, 1, "Petra bez duplicity: " + rows.join(" | "));
    assert(rows[0].includes("Petra Černá") && rows.some(r => r.includes("Karel Dvořák")), "řazení po termínu → bez termínu: " + rows.join(" | "));
    eq(await page.evaluate(() => [...document.querySelectorAll("#todaySec button")].filter(b => /Volací blok/.test(b.textContent)).length), 0, "jen Začít volat");
    /* karta: bez Otevřít a Kopírovat, telefon jako tel:, šipka zpět jen v detailu, klik na kartu otevře */
    const card = await page.evaluate(() => { const c = [...document.querySelectorAll("#cols .card")].find(c => c.textContent.includes("Petra Černá"));
      return { txt: c.querySelector(".foot").innerText, tel: c.querySelector(".tel a")?.getAttribute("href"), back: !!c.querySelector('[aria-label="O fázi zpět"]') }; });
    assert(!/Otevřít|Kopírovat/.test(card.txt) && /Nezvedl/.test(card.txt) && /Zpráva/.test(card.txt), "patička karty: " + card.txt);
    eq([card.tel, card.back], ["tel:777101201", false], "tel: a bez ‹");
    await page.evaluate(() => [...document.querySelectorAll("#cols .card")].find(c => c.textContent.includes("Karel Dvořák")).querySelector(".tags").click()); await page.waitForTimeout(400);
    eq(await page.evaluate(() => [$("dlg").open, $("f_name").value, $("callNo").textContent, $("msgBtn").textContent, $("fpLeadBox").hidden]), [true, "Karel Dvořák", "Nezvedl", "Zpráva", true], "klik na kartu otevře detail; FP banner skrytý u nového leadu");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },

  async "hlavička: + podle záložky, ikona synchronizace otevře Nastavení i odhlášeně, hledání jen v Pipeline; Akvizice"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE, width: 1200 });
    const st = () => page.evaluate(() => [$("addBtn").hidden ? "" : $("addBtn").title, $("searchBox").hidden]);
    eq(await st(), ["Nový lead", false], "pipeline");
    for (const [v, t] of [["cli", "Nový klient"], ["uv", "Nový úvěrový případ"], ["fp", "Nový finanční plán"], ["akv", "Nová firma"], ["net", "Nový kandidát"], ["pf", "Nová investice klienta"], ["money", ""], ["cal", ""]]) {
      await page.evaluate(v => setView(v), v); await page.waitForTimeout(200); eq(await st(), [t, true], v); }
    assert(!(await page.$("#addClient")) && !(await page.$("#akvAddF")) && !(await page.$("#addRecruit")), "lokální + tlačítka pryč");
    /* odhlášeně: ikona s tečkou, klik → Nastavení s výzvou, žádný redirect na Google */
    await page.evaluate(() => GSync.status("out")); await page.click("#syncBtn"); await page.waitForTimeout(300);
    eq(await page.evaluate(() => [!!document.querySelector("#syncBtn .sdot"), $("dataDlg").open, !$("dLoginAsk").hidden, location.host.includes("localhost")]), [true, true, true, true], "Nastavení odhlášeně");
    await page.evaluate(() => { $("dataDlg").close(); GSync.status("ok") });
    assert(!(await page.$("#syncBtn .sdot")), "přihlášeně bez tečky");
    /* Akvizice: + firma založí záznam až s názvem; chip „Ukázat i nezájem“ u kolegů */
    await page.evaluate(() => setView("akv")); await page.click("#addBtn"); await page.waitForTimeout(300);
    eq(await page.evaluate(() => akvFirmy.length), 0, "prázdná firma se nezaloží");
    await page.evaluate(() => $("edDlg").close()); await page.waitForTimeout(400);
    eq(await page.evaluate(() => akvFirmy.length), 0, "po zavření nic");
    await page.click("#addBtn"); await page.waitForTimeout(300);
    await page.fill('#edBody input[placeholder="Název firmy"]', "Test s.r.o."); await page.press('#edBody input[placeholder="Název firmy"]', "Tab"); await page.waitForTimeout(400);
    eq(await page.evaluate(() => akvFirmy.map(f => f.name)), ["Test s.r.o."], "firma s názvem uložena");
    await page.evaluate(() => $("edDlg").close()); await page.waitForTimeout(400);
    assert(await page.evaluate(() => [...$("akvPType").querySelectorAll("button")].some(b => /nezájem/.test(b.textContent))), "chip nezájem u kolegů");
    assert(await page.evaluate(() => !$("akvLi").querySelector(".chipbtn") && $("akvLi").querySelectorAll("a.row").length > 0), "LinkedIn jako řádky");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },

  async "kalendář: nová událost se jménem leadu jde přes saveMeeting (fáze, potvrzení), 45 min, titulek s celým jménem"(env) {
    const store = { ...STORE, "settings/main": { ...STORE["settings/main"], calPrefix: "VK:" },
      "leads/k1": { name: "Ing. Jana Kalendářová", stage: "kontaktovan", phone: "777000333", items: [], meetings: [], _u: 1 } };
    const { ctx, page, errors } = await openApp(env, { store, width: 1200 });
    const posts = [];
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    await ctx.route(/googleapis\.com\/calendar/, r => { const q = r.request(); if (q.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
      if (q.method() === "POST") { posts.push(JSON.parse(q.postData())); return r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: '{"id":"ev1"}' }) }
      return r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: '{"items":[]}' }) });
    await page.evaluate(() => lsSet("g_tok", { at: "test-token-123456789012345", exp: Date.now() + 36e5, scope: "calendar.events" }));
    const r0 = await page.evaluate(() => [meetTitle("Ing. Jana Kalendářová", true, "VK:"), meetTitle("Jan Novák", false, "VK")]);
    eq(r0, ["VK: Ing. Jana Kalendářová (online)", "VK: Jan Novák"], "formát titulku");
    eq(await page.evaluate(() => [parseEvent({ id: "1", summary: "VK: Jan Novák (online)", start: { dateTime: "2026-11-02T10:00:00+01:00" } }).online, parseEvent({ id: "2", summary: "VK: Jan Novák", location: "Teams", start: { dateTime: "2026-11-02T10:00:00+01:00" } }).online, parseEvent({ id: "3", summary: "VK: Jan Novák", location: "Trnitá", start: { dateTime: "2026-11-02T10:00:00+01:00" } }).online]), [true, true, false], "online podle (online), fallback teams");
    await page.evaluate(() => ctEventSheet(null, { date: "2026-11-20", time: "10:00" })); await page.waitForTimeout(300);
    eq(await page.evaluate(() => [...$("edBody").querySelectorAll('input[type=time]')].map(i => i.value)), ["10:00", "10:45"], "výchozí délka 45 min");
    await page.fill('#edBody input[aria-label="Klient / název"]', "Ing. Jana Kalendářová");
    await page.evaluate(() => { const sw = [...$("edBody").querySelectorAll("input.switch")].pop(); sw.click() });
    await page.click("#edClose"); await page.waitForTimeout(1200);
    eq(posts.map(p => p.summary), ["VK: Ing. Jana Kalendářová (online)"], "zápis do kalendáře");
    const l = await page.evaluate(() => { const l = leads.find(x => x.id === "k1"); return { st: l.stage, m: (l.meetings || []).map(m => m.id) } });
    eq(l, { st: "schuzka", m: ["ev1"] }, "schůzka u leadu a fáze");
    eq(await page.evaluate(() => [$("edTitle").textContent, [...$("edBody").querySelectorAll("button")].some(b => /Potvrdit SMS/.test(b.textContent))]), ["Schůzka domluvena", true], "nabídka potvrzení");
    eq(errors, [], "bez chyb");
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
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300); /* kariérní karta je v Obratu */
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
    await page.evaluate(items => { calHist = items; _msMemo = null; setView("money"); render(); }, [
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

  async "odhlášení smaže z přístroje data klientů: úložiště, koncepty, PDF z Databáze, soubory, mezipaměť Firebase"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE, pre: fbFake(), extra: { g_tok: TOK, dk_draft_v1: '{"jmeno":"Klient"}', uv_ui_v1: "{}", meet_links: '{"x":"https://meet"}', dz_failed: "[1]", "demo:crm_store_v1": "{}", deal_rc: "[]", lock: "null", wp: '"static"' } });
    await page.waitForFunction(() => typeof AsNet !== "undefined" && AsNet.on, null, { timeout: 15000 });
    await page.evaluate(() => setView("db")); await page.waitForFunction(() => window.Databaze);
    await page.evaluate(() => Promise.all([["pp_dbpdf", "pdf"], ["pp_docs", "blobs"]].map(([n, s]) => new Promise(r => { const q = indexedDB.open(n, 1); q.onupgradeneeded = () => q.result.createObjectStore(s);
      q.onsuccess = () => { const t = q.result.transaction(s, "readwrite"); t.objectStore(s).put(new Blob(["%PDF"]), "a"); t.oncomplete = () => { q.result.close(); r() } } }))));
    /* modul Databáze má svoje spojení otevřené (jako po nahrání PDF) – mazání nesmí čekat na zavření stránky */
    await page.evaluate(() => { localStorage.setItem("db_rows_v1", '[{"id":"x","name":"Jan"}]'); dbUI.refresh() });
    const t0 = Date.now(); await page.evaluate(() => wipeLocal()); const ms = Date.now() - t0;
    const r = await page.evaluate(async () => ({ dbs: (await indexedDB.databases()).map(d => d.name).sort(), ls: Object.keys(localStorage).sort(), fb: { out: !!__fb.signedOut, cleared: !!__fb.cleared }, leads: Object.keys(LStore.docs()).length,
      docs: await new Promise(res => { const q = indexedDB.open("pp_docs"); q.onsuccess = () => { try { const c = q.result.transaction("blobs").objectStore("blobs").count(); c.onsuccess = () => { q.result.close(); res(c.result) } } catch (e) { q.result.close(); res(0) } } }) }));
    assert(ms < 1600, "mazání trvalo " + ms + " ms");
    eq(r.dbs.filter(n => /pp_dbpdf|firestore|firebase/.test(n)), [], "IndexedDB s daty klientů");
    eq(r.docs, 0, "soubory u klientů (pp_docs) prázdné");
    eq(r.ls.filter(k => !["acc", "g_owner", "g_tok", "lock", "pp_key", "today_seen", "wp", "pipe_view", "dev_id", "trk_pend", "t_init"].includes(k)), [], "zbylé klíče v localStorage");
    eq(r.fb, { out: true, cleared: true }, "Firebase odhlášený a jeho mezipaměť smazaná");
    eq(r.leads, 0, "úložiště appky prázdné");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "start: Firebase se nenačítá před prvním vykreslením; sdílený obchod a schránka dotazníku po odloženém načtení fungují"(env) {
    const docs = { "deals/kolega@x.cz__kudlicka.vojtech2002@gmail.com__L1": { o: "kolega@x.cz", r: "kudlicka.vojtech2002@gmail.com", lid: "L1", st: "žádost", oName: "Petr Kolega", rName: "", at: "2026-10-01T10:00:00Z", ut: "2026-10-01T10:00:00Z", sh: false } };
    const st = { ...STORE, "settings/main": { ...STORE["settings/main"], dzKey: { pub: "p", priv: "k" } } };
    const { ctx, page, errors } = await openApp(env, { store: st, pre: fbFake(docs), extra: { g_tok: TOK, g_synced: "1" } });
    const t = await page.evaluate(() => ({ fb: __fb.log.length, ready: performance.now() }));
    eq(t.fb, 0, "Firebase se při startu nenačetl");
    await page.waitForFunction(() => AsNet.on && AsNet.settled(), null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ first: Math.min(...__fb.log.map(x => x[1])), fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0, imports: __fb.log.length, pend: Deals.pendingIn().map(d => d.oName) }));
    assert(r.first > r.fcp && r.fcp > 0, `Firebase až po prvním vykreslení (${Math.round(r.first)} ms vs. FCP ${Math.round(r.fcp)} ms)`);
    eq(r.imports, 3, "každý modul Firebase se stáhl jen jednou");
    eq(r.pend, ["Petr Kolega"], "žádost o sdílený obchod dorazila");
    /* přijetí žádosti se zapíše do databáze */
    eq(await page.evaluate(async () => (await Deals.respond("kolega@x.cz__kudlicka.vojtech2002@gmail.com__L1", true)).status), "ok", "přijetí");
    eq(await page.evaluate(() => __fb.docs["deals/kolega@x.cz__kudlicka.vojtech2002@gmail.com__L1"].st), "sdílí", "stav v databázi");
    /* schránka dotazníku: dzStart (ten samý Firebase, druhá instance „dz“) poslouchá dzinbox a doručí zprávu do dzHandle */
    await page.evaluate(() => { window.__dz = []; window.dzHandle = d => { __dz.push(...d.map(x => x.id)) }; });
    await page.waitForFunction(() => DZI.on && DZI.fdb, null, { timeout: 15000 });
    await page.evaluate(() => { __fb.docs["dzinbox/m1"] = { to: "kudlicka.vojtech2002@gmail.com", g: "g1", n: 1, i: 0 }; __fb.fire() });
    await page.waitForFunction(() => window.__dz.includes("m1"), null, { timeout: 5000 });
    eq(await page.evaluate(() => [__fb.log.length, __fb.apps.map(a => a.name).sort()]), [3, ["[DEFAULT]", "dz"]], "Firebase sdílený pro obchody i schránku");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "tapeta: výchozí statický pás bez animace, Animovaná / Vypnuto v nastavení, fotka jen se zapnutou tapetou"(env) {
    const imgs = [];
    const { ctx, page, errors } = await openApp(env, { store: STORE, pre: async (p) => p.on("request", r => { if (/image\.(jpg|png)/.test(r.url())) imgs.push(r.url()) }) });
    await page.waitForTimeout(400);
    let r = await page.evaluate(() => ({ mode: window.__wp && window.__wp.mode, band: !!document.getElementById("wpB"), canvas: !!document.getElementById("wpC"), h: document.getElementById("wpB").getBoundingClientRect().height, title: document.querySelector(".large").getBoundingClientRect().bottom }));
    eq([r.mode, r.band, r.canvas], ["static", true, false], "výchozí = statická");
    assert(r.h > r.title && r.h < r.title + 80, `pás končí pod nadpisem (pás ${r.h}, nadpis ${r.title})`);
    eq(imgs.filter(u => /image\.png/.test(u)), [], "image.png se nestahuje");
    /* Animovaná: plátno + běží; skrytí stránky ji zastaví */
    await page.evaluate(() => { const s = document.getElementById("dWpMode"); s.value = "anim"; s.dispatchEvent(new Event("change")) });
    await page.waitForTimeout(200);
    r = await page.evaluate(() => ({ w: window.__wp, band: !!document.getElementById("wpB"), canvas: !!document.getElementById("wpC"), ls: localStorage.getItem("wp"), sceneHidden: document.getElementById("dWpM").hidden }));
    eq([r.w.mode, r.w.running, r.band, r.canvas, r.ls, r.sceneHidden], ["anim", true, false, true, "anim", false], "animovaná");
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")) });
    eq(await page.evaluate(() => __wp.running), false, "skrytá stránka = animace stojí");
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")) });
    eq(await page.evaluate(() => __wp.running), true, "po návratu běží");
    /* Vypnuto: nic */
    await page.evaluate(() => { const s = document.getElementById("dWpMode"); s.value = "off"; s.dispatchEvent(new Event("change")) });
    r = await page.evaluate(() => ({ m: __wp.mode, n: document.querySelectorAll("#wpB,#wpC,#wpS").length, cls: document.documentElement.className }));
    eq([r.m, r.n, /\bwpb?\b/.test(r.cls)], ["off", 0, false], "vypnuto");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
    /* vypnutá tapeta → fotka se vůbec nestáhne; „omezit pohyb“ → animovaná stojí */
    imgs.length = 0;
    const b = await openApp(env, { store: STORE, extra: { wp: "off" }, pre: async (p) => p.on("request", r => { if (/image\.(jpg|png)/.test(r.url())) imgs.push(r.url()) }) });
    await b.page.waitForTimeout(500); eq(imgs, [], "bez tapety se image.jpg nestahuje"); await b.ctx.close();
    const c = await openApp(env, { store: STORE, extra: { wp: "anim" }, pre: async (p) => p.emulateMedia({ reducedMotion: "reduce" }) });
    eq(await c.page.evaluate(() => [__wp.mode, __wp.running, __wp.rm]), ["anim", false, true], "omezit pohyb = nehybná");
    eq(c.errors, [], "chyby (omezit pohyb)"); await c.ctx.close();
  },
  async "finanční plán – záložka: jedno pole (plány nahoře, pod nimi Vytvořit pro… / Nový klient), aktivní lead jen jednou, odkaz pro klienta v menu"(env) {
    const store = { ...STORE,
      "leads/f1": { name: "Jan Novák", phone: "777 111 222", stage: "novy", items: [], meetings: [], log: [], _u: 1 },
      "leads/f2": { name: "Petr Podepsaný", stage: "podpis", items: [], meetings: [], log: [], _u: 1 },
      "leads/f3": { name: "Karel Ztracený", stage: "lost", items: [], meetings: [], log: [], _u: 1 },
      "clients/c1": { name: "Eva Klientová", phone: "", products: [], log: [], _u: 1 },
      "fplan/c1": { clientId: "c1", name: "Eva Klientová", plan: { klient: { jmeno: "Eva Klientová" } }, updatedAt: Date.now(), _u: 1 } };
    const { ctx, page, errors } = await openApp(env, { store, width: 390, height: 844 });
    await page.evaluate(() => setView("fp")); await page.waitForTimeout(300);
    const rows = () => page.$$eval("#fpBox .row .main", r => r.map(x => x.firstChild.textContent.trim()));
    eq(await page.$$eval("#view_fp .pfsearch > *", e => e.map(x => x.id || x.className)), ["fpSearchI", "fplink", "fpNewBtn"], "jedno pole + Odkaz pro klienta + Nový plán");
    await page.fill("#fpSearchI", "nov");
    let r = await rows();
    eq(r.filter(x => /Novák/.test(x)), ["Vytvořit pro Jan Novák"], "aktivní lead nabídnutý jen jednou");
    assert(r.includes("Nový klient „nov“"), "pod nabídkou založení nového klienta");
    await page.fill("#fpSearchI", "eva");
    r = await rows(); eq(r, ["Eva Klientová", "Nový klient „eva“"], "existující plán nahoře, klient s plánem se znovu nenabízí");
    await page.fill("#fpSearchI", "Eva Klientová");
    r = await rows(); eq(r, ["Eva Klientová"], "přesné jméno existujícího plánu nenabízí založení duplicitního klienta");
    await page.fill("#fpSearchI", "");
    await page.click("#fpNewBtn"); r = await rows();
    eq([r.filter(x => /Novák/.test(x)).length, r.some(x => /Podepsaný/.test(x)), r.some(x => /Ztracený/.test(x)), r.some(x => /Vytvořit pro Eva/.test(x))], [1, true, false, false], "Nový plán: každý jednou, lost ne, kdo má plán ne");
    eq(await page.evaluate(() => document.activeElement.id), "fpSearchI", "kurzor v poli");
    /* vytvoření pro lead → plán k leadu, opakované vytvoření už se nenabízí */
    await page.evaluate(() => { fplans.push({ id: "lead_f1", name: "Jan Novák", plan: {}, updatedAt: Date.now() }); renderFpTab(); });
    r = await rows(); eq(r.filter(x => /Novák/.test(x)), ["Jan Novák"], "lead s plánem už jen jako existující plán");
    /* odkaz pro klienta: jedno tlačítko, rozbalí dotazník i rezervaci */
    assert(await page.$eval("#fpLinkMenu", m => m.hidden), "menu zavřené");
    await page.click("#fpLinkBtn");
    eq(await page.$$eval("#fpLinkMenu button:not([hidden])", b => b.filter(x => x.offsetParent).map(x => x.querySelector("b").textContent)), ["Dotazník", "Rezervace"], "obě volby v menu");
    await page.click("#fpSearchI"); assert(await page.$eval("#fpLinkMenu", m => m.hidden), "klik mimo menu zavře");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
};
