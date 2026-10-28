// Testy záložky Úvěry (uvery.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/uvery.run.mjs [--shots] [filtr]
import { loadPlaywright, startServer, assert, eq, appCss, smallTargets } from "./helpers.mjs";
const APPCSS = await appCss();

const SHOTS = process.argv.includes("--shots");
const FILTER = process.argv.slice(2).filter(a => !a.startsWith("--"))[0] || "";
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

/* prázdná stránka s barvami jako v Pipeline + paměťové úložiště se stejným API jako LStore + fiktivní klienti */
async function open({ width = 1300, height = 900, dark = false, docs = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(base + "sazby.json*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ source: "Swiss Life Hypoindex", period: "2026-09", index: 5.51, fix: { 1: { a: 5.29, b: 5.58 }, 3: { a: 5.27, b: 5.58 }, 5: { a: 5.51, b: 5.82 }, 10: { a: 5.99, b: 6.24 } } }) }));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${APPCSS}</style><style>body{margin:0;padding:16px}</style>
    </head><body><div id="box"></div><script src="uvery.js"></script><script>
    const docs=${JSON.stringify(docs)},subs=new Set(),emit=()=>subs.forEach(f=>f());let n=0;
    const store={collection:name=>({onSnapshot(cb){const f=()=>cb({docs:Object.entries(docs).filter(([k])=>k.startsWith(name+"/")).map(([k,v])=>({id:k.split("/")[1],data:()=>JSON.parse(JSON.stringify(v))}))});subs.add(f);f()},
      async add(d){const id="u"+(++n);docs[name+"/"+id]=JSON.parse(JSON.stringify(d));emit();return{id}}}),
      doc:p=>({onSnapshot(cb){const f=()=>cb({exists:!!docs[p],data:()=>docs[p]&&JSON.parse(JSON.stringify(docs[p]))});subs.add(f);f()},async set(d){docs[p]=JSON.parse(JSON.stringify(d));emit()},async delete(){delete docs[p];emit()}})};
    const cl=[{id:"c:a",rec:{id:"a",birth:"1990-04-12",phone:"777111222",email:"petr@example.com"},name:"Petr Novák",products:[{id:"p1",type:"Hypotéka",company:"Komerční banka",amt:3200000,from:"2021-12-10",fix:5,status:"active"}]},
      {id:"l:b",lead:{id:"b",phone:"777333444"},name:"Jana Dvořáková",products:[]}];
    window.toasts=[];window.saved=[];window.opened=[];
    window.ui=Uvery.mount(document.getElementById("box"),{store,toast:m=>toasts.push(m),clients:()=>cl,sign:()=>"Kudlička",
      openClient:e=>opened.push(e.id),saveProduct:async(e,p)=>{saved.push({e:e.id,p});return {id:"a"}},docsFor:e=>{const d=document.createElement("div");d.className="docs-stub";d.textContent="Soubory "+e.name;return d}});
    window.docs=docs;
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ui);
  return { ctx, page, errors };
}
const document_has_kb = t => /\d\s*Komerční banka/.test(t);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `/tmp/uv-${name}.png`, fullPage: true }); };
const click = (page, sel) => page.click(sel);
const fillK = async (page, k, v) => { await page.fill(`[data-k="${k}"]`, String(v)); await page.dispatchEvent(`[data-k="${k}"]`, "change"); };

const CASE = {
  name: "Petr Novák", cid: "a", eid: "c:a", stage: "analyza", stageAt: { poptavka: "2026-10-01T10:00:00Z", analyza: "2026-10-05T10:00:00Z" }, createdAt: "2026-10-01T10:00:00Z", nextStep: "Dodat potvrzení o příjmu", nextDate: "2026-10-01",
  q: { typ: "hypo", ucel: "koupe", predmet: "byt", prodavajici: "fo", cena: 5200000, vlastni: 1100000, splatnost: 30, fixace: 5, registry: "ok", priority: ["sazba"],
    zad: [{ jmeno: "Petr Novák", narozen: "1990-04-12", obc: "cz", stav: "manzel", prijmy: [{ typ: "zam", castka: 62000, smlouva: "neurcita", mesicu: 40 }] },
      { jmeno: "Lucie Nováková", narozen: "1992-08-01", vztah: "manzel", obc: "cz", stav: "manzel", prijmy: [{ typ: "osvc", rezim: "pausal", pausal: "60", prijmy: 900000, obor: "sluzby", mesicu: 30, dp: 2 }] }],
    zav: [{ typ: "kk", limit: 40000 }], deti: 1 },
  docs: {}, tasks: {}, offers: [], dates: {}, log: [{ d: "2026-10-01T10:00:00Z", t: "Případ založen" }]
};

const tests = {
  async "matematika: anuita, zůstatek a náklady za fixaci"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => { const M = Uvery.math; const p = M.payment(4000000, 5, 30), f = M.fixCost(4000000, 5, 30, 5);
      return { p: Math.round(p), bal: Math.round(f.balance), int: Math.round(f.interest), back: Math.round(M.principalFor(p, 5, 30)), zero: M.payment(1200000, 0, 10) }; });
    /* 4 mil., 5 %, 30 let → 21 472,86 Kč; po 60 splátkách zůstatek 3 673 149 Kč; úroky za 5 let 961 521 Kč */
    eq(r, { p: 21473, bal: 3673149, int: 961521, back: 4000000, zero: 10000 }, "anuita");
    await ctx.close();
  },
  async "LTV limit: 90 % do 36 let (manželům stačí jeden, nesezdaní oba), jinak 80 %, investiční 70 %"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => { const L = Uvery.math.ltvLimit, y = new Date().getFullYear();
      const z = (a, rel) => ({ narozen: (y - a) + "-01-01", vztah: rel });
      return [L({ zad: [z(30)] }), L({ zad: [z(40)] }), L({ zad: [z(40), z(30, "manzel")] }), L({ zad: [z(40), z(30, "partner")] }), L({ zad: [z(30), z(31, "partner")] }),
        L({ zad: [z(30)], pronajem: "ano", ucel: "koupe" }), L({ typ: "amer", zad: [z(30)] }), L({ zad: [z(30)], nemovitosti: 2 }), L({ zad: [z(30)], pronajem: "ano", ucel: "rekonstrukce" })]; });
    eq(r, [90, 80, 90, 80, 90, 70, 70, 70, 90], "limity");
    await ctx.close();
  },
  async "OSVČ: daňový základ vs. obratová metoda podle banky"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => { const M = Uvery.math, B = Object.fromEntries(Uvery.BANKS.map(b => [b.id, b]));
      const i = { typ: "osvc", rezim: "pausal", pausal: "80", prijmy: 2000000, obor: "remeslo", mesicu: 36, dp: 3 };
      return { net: Math.round(M.osvcNet(i)), kb: Math.round(M.incomeFor(i, B.kb, {}).v), rb: Math.round(M.incomeFor(i, B.rb, {}).v), how: M.incomeFor(i, B.rb, {}).why,
        csBig: M.incomeFor(i, B.cs, { ltv: 85, loan: 4000000 }).why, csOk: M.incomeFor(i, B.cs, { ltv: 75, loan: 4000000 }).why,
        noDp: M.incomeFor({ ...i, dp: 0, mesicu: 4 }, B.cs, {}).warn }; });
    /* 2 mil. obrat, paušál 80 % → ZD 400 000; daň 29 160, SP 64 240, ZP 27 000 → 279 600 / 12 = 23 300 */
    eq(r.net, 23300, "čistý z DZ");
    eq(r.kb, 23300, "KB obratovou metodu nemá – z daňového základu");
    assert(r.rb > r.kb && r.how === "obratová metoda", "RB obratovou metodou víc: " + JSON.stringify(r));
    eq([r.csOk, r.csBig], ["obratová metoda", "z daňového základu"], "ČS obratová metoda jen do LTV 80 %");
    assert(/podané DP/.test(r.noDp), "bez přiznání upozornění");
    await ctx.close();
  },
  async "doporučení: vyřadí banky podle LTV, věku a typu, seřadí zbytek a vysvětlí proč"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(c => { const R = Uvery.math.recommend(c.q, Uvery.BANKS);
      const bad = Uvery.math.recommend({ ...c.q, vlastni: 0 }, Uvery.BANKS);
      const old = Uvery.math.recommend({ ...c.q, zad: [{ ...c.q.zad[0], narozen: "1962-01-01" }] }, Uvery.BANKS);
      const druz = Uvery.math.recommend({ ...c.q, ucel: "druzstvo", predmet: "druzstevni", zajisteni: "jina", zajHodnota: 6000000 }, Uvery.BANKS);
      return { first: R.list[0].id, firstVerdict: R.list[0].verdict, okCount: R.list.filter(x => !x.ko.length).length, na: R.list.filter(x => x.na).map(x => x.id),
        ltvKo: bad.list.filter(x => !x.na && !x.b.ended && !x.model).every(x => x.ko.some(k => /LTV/.test(k))), ltvAlt: bad.alts.some(a => /Chybí/.test(a)),
        ageWarn: old.list.find(x => x.id === "kb").warn.concat(old.list.find(x => x.id === "kb").ko).some(w => /věk/.test(w)),
        druzOk: druz.list.filter(x => !x.ko.length).map(x => x.id),
        bidliLast: (() => { const ok = R.list.filter(x => !x.ko.length); return ok.length > 1 && ok[ok.length - 1].id === "bidli"; })(),
        ended: R.list.filter(x => x.ko.some(k => /skončil|nedává úvěry zajištěné/.test(k))).map(x => x.id).sort() }; }, CASE);
    assert(r.okCount >= 4, "aspoň 4 banky projdou: " + JSON.stringify(r));
    assert(["ok", "cond"].includes(r.firstVerdict), "první je doporučená");
    assert(r.na.includes("trinity") && r.na.includes("inbank"), "spotřebitelské společnosti nejsou pro hypotéku");
    assert(r.ltvKo && r.ltvAlt, "bez vlastních zdrojů vyřadí LTV a nabídne řešení");
    assert(r.ageWarn, "věk 64 → upozornění na splatnost");
    assert(r.druzOk.includes("cs") && r.druzOk.includes("kb") && r.druzOk[r.druzOk.length - 1] === "bidli", "družstevní byt se zástavou jiné nemovitosti: banky ano, BIDLI až na konci – " + r.druzOk);
    assert(r.bidliLast, "BIDLI až za bankami");
    eq(r.ended, ["mp", "rsts", "sscs"], "stavební spořitelny už hypotéky nedávají");
    await ctx.close();
  },
  async "paušální daň: rozhodují měsíce podnikání, banky uznají různý podíl fakturace"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => { const M = Uvery.math, B = Object.fromEntries(Uvery.BANKS.map(b => [b.id, b]));
      const i = { typ: "osvc", rezim: "pausaldan", pasmo: "1", prijmy: 840000, obor: "sluzby", mesicu: 24 };
      const v = id => Math.round(M.incomeFor(i, B[id], {}).v);
      return { mb: v("mb"), cs: v("cs"), kb: v("kb"), csob: v("csob"), why: M.incomeFor(i, B.mb, {}).why, short: M.incomeFor({ ...i, mesicu: 4 }, B.mb, {}).warn,
        remeslo: Math.round(M.incomeFor({ ...i, obor: "remeslo" }, B.kb, {}).v), noDp: M.incomeFor({ ...i, dp: 0 }, B.kb, {}).warn }; });
    /* modelový paušalista 70 tis. měsíčně: mBank 49 tis., ČS 42 tis., KB ~40 tis., ČSOB 38,5 tis. */
    eq([r.mb, r.cs, r.kb, r.csob], [49000, 42000, 40250, 38500], "uznaný příjem");
    assert(/70 % fakturace/.test(r.why), "důvod: " + r.why);
    assert(/6 měsíců/.test(r.short), "krátké podnikání: " + r.short);
    eq(r.remeslo, 20125, "řemeslo (paušál 80 %) – polovina");
    eq(r.noDp, "", "paušalista bez přiznání nevadí");
    await ctx.close();
  },
  async "spotřebitelský úvěr: limity bank, bydlení bez zástavy, s hypotékou max. 8 let"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => { const M = Uvery.math, y = new Date().getFullYear();
      const z = { narozen: (y - 40) + "-01-01", obc: "cz", prijmy: [{ typ: "zam", castka: 55000, smlouva: "neurcita", mesicu: 60 }] };
      const base = { typ: "spotr", uver: 500000, splatnost: 10, registry: "ok", zad: [z], zav: [{ typ: "hypo", splatka: 15000, zustatek: 2500000 }] };
      const R = M.recommend(base, Uvery.BANKS), g = id => R.list.find(x => x.id === id);
      const byd = M.recommend({ ...base, uver: 3000000, splatnost: 25, zav: [], bydleni: "ano", bydUcel: "druz" }, Uvery.BANKS), h = id => byd.list.find(x => x.id === id);
      const cizi = M.recommend({ ...base, zad: [{ ...z, obc: "eu", pobyt: "trvaly" }] }, Uvery.BANKS).list.find(x => x.id === "trinity");
      return { cap: g("cs").years, capWarn: g("cs").warn.join(" "), inbank: g("inbank").ko.join(" "), mpKo: g("mp").ko.join(" "), ucb: [g("ucb").rate, g("ucb").warn.join(" ")],
        mp: [h("mp").ko.length, h("mp").years, h("mp").rate], rsts: h("rsts").ko.join(" "), kbByd: h("kb").ko.join(" "), trinity: cizi.ko.join(" "),
        alts: R.alts.join(" "), sameTop: R.list[0].id }; });
    eq(r.cap, 8, "s hypotékou nejvýš 8 let");
    assert(/8 let \(doporučení ČNB\)/.test(r.capWarn), "upozornění ČNB: " + r.capWarn);
    assert(/300 tis/.test(r.inbank), "Inbank max. 300 tis.");
    assert(/jen účelově na bydlení/.test(r.mpKo), "Modrá pyramida jen na bydlení");
    assert(r.ucb[0] > 7 && /garantovaná sazba jen nad/.test(r.ucb[1]), "UniCredit mimo garanci: " + r.ucb);
    eq(r.mp, [0, 25, 5.79], "družstevní bydlení MP: bez výhrad, 25 let, 5,79 %");
    eq(r.rsts, "", "RSTS družstevní byt do 3,5 mil.");
    assert(/max\. 2,5 mil/.test(r.kbByd), "KB spotřebák max. 2,5 mil.: " + r.kbByd);
    assert(/jen občané ČR/.test(r.trinity), "Trinity jen občané ČR");
    assert(/RPSN/.test(r.alts) && /8 let/.test(r.alts), "rady pro spotřebák");
    await ctx.close();
  },
  async "LTV výjimky a investiční pravidla ČNB: UniCredit 95 % do 36 let, Oberbank 80 %, budoucí nájem, americká DTI 7"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => { const M = Uvery.math, y = new Date().getFullYear();
      const zad = [{ narozen: (y - 29) + "-01-01", obc: "cz", prijmy: [{ typ: "zam", castka: 90000, smlouva: "neurcita", mesicu: 30 }] }];
      const q = { typ: "hypo", ucel: "koupe", predmet: "byt", prodavajici: "fo", cena: 5000000, vlastni: 350000, splatnost: 30, fixace: 3, registry: "ok", zad };
      const R = M.recommend(q, Uvery.BANKS), ok = R.list.filter(x => !x.ko.length && !x.model).map(x => x.id);
      const R85 = M.recommend({ ...q, vlastni: 750000 }, Uvery.BANKS), ober = R85.list.find(x => x.id === "ober").ko.join(" ");
      const amer = M.recommend({ typ: "amer", predmet: "byt", odhad: 9000000, uver: 4000000, splatnost: 20, registry: "ok", zav: [{ typ: "hypo", splatka: 16000, zustatek: 5000000 }], zad: [{ narozen: (y - 45) + "-01-01", obc: "cz", prijmy: [{ typ: "zam", castka: 100000, smlouva: "neurcita", mesicu: 60 }] }] }, Uvery.BANKS);
      return { ok, ucbWarn: R.list.find(x => x.id === "ucb").warn.join(" "), ober,
        inv: [M.isInvest({ typ: "hypo", ucel: "koupe", zad: [{ prijmy: [{ typ: "pronajem", zdroj: "budouci", castka: 15000 }] }] }), M.isInvest({ typ: "hypo", ucel: "refinancovani", pronajem: "ano" }),
          M.isInvest({ typ: "hypo", ucel: "refinancovani", pronajem: "ano", navyseni: 500000 }), M.isInvest({ typ: "hypo", ucel: "rekonstrukce", nemovitosti: 3 }), M.isInvest({ typ: "hypo", ucel: "druzstvo", nemovitosti: 2 })],
        amerWarn: amer.list.filter(x => !x.ko.length).some(x => x.warn.some(w => /DTI .* nad 7/.test(w))), amerAlt: amer.alts.some(a => /investiční účel/.test(a)) }; });
    eq(r.ok, ["ucb"], "LTV 93 % u mladého jen UniCredit");
    assert(/výjimky ČNB/.test(r.ucbWarn), "upozornění na výjimku: " + r.ucbWarn);
    assert(/LTV 85,0 % > 80 %/.test(r.ober), "Oberbank max. 80 %: " + r.ober);
    eq(r.inv, [true, false, true, false, true], "investiční účel");
    assert(r.amerWarn && r.amerAlt, "americká hypotéka – DTI 7 a investiční účel");
    await ctx.close();
  },
  async "podklady na míru: zaměstnanec, OSVČ, koupě od FO, ZFPA interní; text pro klienta jen s chybějícím"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(c => { const L = Uvery.math.docsList(c.q, null), t = Uvery.math.clientDocsText(c.q, { [L[0].k]: "2026-10-10" }, null, "Kudlička");
      return { n: L.length, osvc: L.some(d => /Daňové přiznání/.test(d.t)), zam: L.some(d => /Potvrzení o příjmu/.test(d.t)), rez: L.some(d => /Rezervační/.test(d.t)), zfpa: L.filter(d => d.g === "ZFPA (interní)" && d.c === "").length,
        txt: t, first: L[0].c, vklad: L.find(d => d.k === "vklad").t,
        pd: Uvery.math.docsList({ ...c.q, zad: [{ ...c.q.zad[1], prijmy: [{ typ: "osvc", rezim: "pausaldan", prijmy: 900000, mesicu: 30 }] }] }, null).filter(d => /Příjmy/.test(d.g)).map(d => d.t).join(" | ") }; }, CASE);
    assert(r.osvc && r.zam && r.rez, "typové podklady");
    eq(r.zfpa, 6, "ZFPA interní položky bez textu pro klienta");
    assert(/správní poplatek 2 000 Kč/.test(r.vklad) && !/kolek 2/.test(r.vklad), "vklad: " + r.vklad);
    assert(/platby paušální daně/.test(r.pd) && !/vstupu do paušálního/.test(r.pd), "paušalista: " + r.pd);
    assert(r.txt.startsWith("Dobrý den") && r.txt.endsWith("Kudlička") && !r.txt.includes(r.first), "text pro klienta bez dodaného");
    await ctx.close();
  },
  async "UI: nový případ propojený s klientem, dotazník, živé ukazatele"() {
    const { ctx, page, errors } = await open();
    await shot(page, "01-empty");
    await click(page, '.uv-bar [data-a="new"]');
    await page.fill("#uvNq", "nov");
    await click(page, '[data-a="npick"]');
    await click(page, '[data-a="ntyp"][data-v="hypo"]');
    await click(page, '[data-a="ncreate"]');
    await page.waitForSelector(".uv-wiz");
    const d = await page.evaluate(() => { const k = Object.keys(docs).find(k => k.startsWith("uvery/")); return docs[k]; });
    eq([d.name, d.cid, d.stage, d.q.zad[0].narozen], ["Petr Novák", "a", "poptavka", "1990-04-12"], "založený případ");
    await click(page, '[data-a="step"][data-v="1"]');
    await page.fill('[data-k="q.cena"]', "5 000 000");
    await page.fill('[data-k="q.vlastni"]', "1000000");
    await page.waitForTimeout(600);
    const live = await page.textContent("#uvLive");
    assert(/4 000 000 Kč/.test(live.replace(/ /g, " ")) && /LTV/.test(live), "živé ukazatele: " + live);
    await shot(page, "02-wizard");
    eq(errors, [], "bez chyb v konzoli");
    await ctx.close();
  },
  async "UI: celý případ – banky, výběr, podklady, nabídky, průběh a uložení ke klientovi"() {
    const { ctx, page, errors } = await open({ docs: { "uvery/x1": CASE } });
    await shot(page, "03-board");
    assert((await page.textContent(".uv-board")).includes("Petr Novák"), "karta na nástěnce");
    await click(page, '.uv-card[data-id="x1"]');
    await click(page, '[data-a="tab"][data-v="banky"]');
    await page.waitForSelector(".uv-bank");
    const n = await page.$$eval(".uv-bank", b => b.length);
    assert(n >= 8, "karty bank: " + n);
    await shot(page, "04-banky");
    await click(page, '.uv-bank.top [data-a="pickbank"]');
    await click(page, '[data-a="tab"][data-v="podklady"]');
    await page.waitForSelector(".uv-doc");
    await click(page, '.uv-doc [data-a="dck"]');
    assert(await page.$(".docs-stub"), "soubory klienta v podkladech");
    await shot(page, "05-podklady");
    await click(page, '[data-a="tab"][data-v="nabidky"]');
    await click(page, '[data-a="offertop"]');
    await page.waitForTimeout(100);
    const rows = await page.$$eval('.uv-tab select[data-k$=".bank"]', s => s.length);
    eq(rows, 3, "3 nabídky z doporučení");
    await click(page, '[data-a="offerpick"][data-i="1"]');
    await shot(page, "06-nabidky");
    await click(page, '[data-a="tab"][data-v="prubeh"]');
    await page.selectOption('[data-a="stage"]', "cerpano");
    await page.waitForSelector('[data-a="saveprod"]');
    await click(page, '[data-a="saveprod"]');
    await page.waitForTimeout(150);
    const s = await page.evaluate(() => window.saved);
    eq(s.length, 1, "uloženo ke klientovi");
    eq([s[0].e, s[0].p.type, s[0].p.src.uv, s[0].p.status], ["c:a", "Hypotéka", "x1", "active"], "produkt klienta");
    assert(s[0].p.fix > 0 && s[0].p.company, "fixace a banka u produktu");
    await shot(page, "07-prubeh");
    await page.waitForTimeout(600);
    const d = await page.evaluate(() => docs["uvery/x1"]);
    eq(d.stage, "cerpano", "fáze uložená");
    assert(d.offerId && d.bank && Object.keys(d.docs).length === 1, "výběr a podklady uložené");
    eq(errors, [], "bez chyb v konzoli");
    await ctx.close();
  },
  async "Banky: profily s plusy, minusy a parametry, srovnání, slovníček a návrat do případu"() {
    const { ctx, page, errors } = await open({ docs: { "uvery/x1": CASE } });
    await click(page, '.uv-bar [data-a="katalog"]');
    await page.waitForSelector(".uv-kb");
    eq(await page.$$eval(".uv-kb", x => x.length), 13, "všechny instituce");
    await page.click('#kb-mb summary');
    const mb = await page.textContent("#kb-mb");
    assert(/Plusy/.test(mb) && /Minusy/.test(mb) && /Paušální daň/.test(mb) && /~70 % fakturace/.test(mb) && /40 let/.test(mb), "profil mBank: " + mb.slice(0, 300));
    await shot(page, "08-katalog");
    await page.fill('[data-ui="kq"]', "cizoměn"); await page.dispatchEvent('[data-ui="kq"]', "input"); await page.waitForTimeout(80);
    eq(await page.$$eval(".uv-kb", x => x.map(d => d.id)), ["kb-ucb"], "hledání");
    assert(await page.$eval("#kb-ucb", d => d.open), "jediný výsledek se rozbalí");
    await page.fill('[data-ui="kq"]', ""); await page.dispatchEvent('[data-ui="kq"]', "input");
    await click(page, '[data-a="kf"][data-v="ss"]');
    const ss = await page.$$eval(".uv-kb", x => x.map(d => d.id));
    eq(ss, ["kb-mp", "kb-rsts", "kb-sscs"], "filtr stavebních spořitelen");
    await page.click('#kb-rsts summary');
    assert(/Hyposplátka skončila/.test(await page.textContent("#kb-rsts")) && /65 %/.test(await page.textContent("#kb-rsts")), "RSTS: konec hypoték a OSVČ");
    await click(page, '[data-a="kseg"][data-v="cmp"]');
    const heads = await page.$$eval(".uv-cmp thead th", x => x.map(t => t.textContent.trim()).filter(Boolean));
    eq(heads, ["ČS", "KB", "ČSOB", "RB", "UCB", "mBank", "Oberbank"], "srovnání hypotečních bank");
    assert((await page.textContent(".uv-cmp")).includes("mladí až 95 %"), "UniCredit 95 % ve srovnání");
    await shot(page, "09-srovnani");
    await click(page, '[data-a="kseg"][data-v="pojmy"]');
    const n = await page.$$eval(".uv-gl .t", x => x.length);
    assert(n >= 70, "pojmů: " + n);
    await page.fill('[data-ui="kq"]', "plomba"); await page.dispatchEvent('[data-ui="kq"]', "input"); await page.waitForTimeout(80);
    const hits = await page.$$eval(".uv-gl dt", x => x.map(t => t.textContent));
    assert(hits.includes("Plomba") && hits.includes("Čerpání na plombu") && hits.length < 6, "hledání pojmu: " + hits);
    await shot(page, "10-pojmy");
    await click(page, '[data-a="back"]');
    await click(page, '.uv-card[data-id="x1"]');
    await click(page, '[data-a="tab"][data-v="banky"]');
    await click(page, '.uv-bank [data-a="kprof"][data-v="rb"]');
    await page.waitForSelector("#kb-rb[open]");
    await click(page, '[data-a="kback"]');
    await page.waitForSelector('.uv-tabs [data-v="banky"][aria-selected="true"]');
    await click(page, '.uv-m [data-a="kpojem"][data-v="DSTI"]');
    assert((await page.textContent(".uv-gl")).includes("Debt Service to Income"), "vysvětlivka DSTI z ukazatele");
    await click(page, '[data-a="kback"]');
    await page.waitForSelector(".uv-mgrid");
    await click(page, '[data-a="back"]');
    await click(page, '.uv-bar [data-a="guide"]');
    await click(page, '.uv-ch [data-a="kpojem"]');
    await page.waitForSelector(".uv-gl");
    await click(page, '[data-a="kback"]');
    assert((await page.textContent(".uv-ch h2")).includes("Průvodce"), "zpět do průvodce");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "Banky na mobilu a v tmavém režimu: instituce, srovnání a pojmy bez přetečení stránky"() {
    for (const dark of [false, true]) {
      const { ctx, page, errors } = await open({ width: 390, height: 844, dark });
      const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await click(page, '.uv-bar [data-a="katalog"]');
      for (const id of ["cs", "ucb", "rsts", "bidli", "trinity"]) await page.click(`#kb-${id} summary`);
      eq(await over(), 0, "instituce"); await shot(page, `m-${dark ? "dark" : "light"}-katalog`);
      await click(page, '[data-a="kseg"][data-v="cmp"]'); eq(await over(), 0, "srovnání");
      await click(page, '[data-a="kseg"][data-v="pojmy"]'); eq(await over(), 0, "pojmy");
      eq(errors, [], "bez chyb");
      await ctx.close();
    }
  },
  async "UI: konce fixací z karet klientů → založení refinancování"() {
    const { ctx, page, errors } = await open();
    await click(page, '[data-a="fix"]');
    await page.waitForSelector(".uv-list");
    assert((await page.textContent(".uv-list")).includes("Petr Novák"), "Novák – fixace KB končí 12/2026");
    await click(page, '[data-a="refi"]');
    await page.waitForSelector(".uv-wiz");
    const d = await page.evaluate(() => Object.values(docs).find(x => x.q && x.q.ucel === "refinancovani"));
    assert(d && d.q.refBanka === "Komerční banka" && d.q.refFixDo === "2026-12-10", "refinancování předvyplněné: " + JSON.stringify(d && d.q));
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "UI: parametry bank – úprava se projeví v doporučení"() {
    const { ctx, page, errors } = await open({ docs: { "uvery/x1": CASE } });
    await click(page, '.uv-bar [data-a="katalog"]');
    await click(page, '.uv-ch [data-a="banks"]');
    await page.click('summary[data-v="kb"]');
    await page.click('[data-b="kb"][data-k="off"][data-v="1"]');
    await page.waitForTimeout(500);
    const cfg = await page.evaluate(() => docs["uvcfg/main"]);
    eq(cfg.banks.kb.off, true, "KB vypnutá");
    await click(page, '.uv-ch [data-a="katalog"]');
    assert(/nepoužívám/.test(await page.textContent("#kb-kb summary")), "v profilech je KB označená jako nepoužívaná");
    await click(page, '[data-a="back"]');
    await click(page, '.uv-card[data-id="x1"]');
    await click(page, '[data-a="tab"][data-v="banky"]');
    const t = await page.textContent("#uvTab");
    assert(/Vypnuté v Parametrech bank: KB/.test(t) && !document_has_kb(t), "KB vyřazená z pořadí");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "UI: průvodce, parametry bank, konce fixací a nový případ se vykreslí i na mobilu"() {
    const { ctx, page, errors } = await open({ width: 390, height: 844, docs: { "uvery/x1": CASE } });
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const v of ["guide", "katalog", "fix"]) {
      await click(page, `.uv-bar [data-a="${v}"], .uv-tile[data-a="${v}"]`); await page.waitForTimeout(60);
      eq(await over(), 0, "bez přetečení: " + v); await shot(page, "m-" + v);
      await click(page, '[data-a="back"]');
    }
    await click(page, '.uv-bar [data-a="new"]'); await page.fill("#uvNq", "Jana"); await page.waitForTimeout(50);
    eq(await over(), 0, "nový případ"); await shot(page, "m-new");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "mobil: Orientačně sbalené pod otázkami, statistiky v jednom pásu, pole 16 px a dotykové cíle 40 px"() {
    const { ctx, page, errors } = await open({ width: 390, height: 844, docs: { "uvery/x1": CASE } });
    const tops = await page.$$eval(".uv-tile", ts => [...new Set(ts.map(t => Math.round(t.getBoundingClientRect().top)))]);
    eq(tops.length, 1, "dlaždice v jedné řadě");
    assert(await page.$eval(".uv-tiles", t => t.getBoundingClientRect().height < 110), "pás statistik je nízký");
    eq(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, "pás nepřetéká stránku");
    await click(page, '.uv-card[data-id="x1"]');
    await page.waitForSelector(".uv-wiz");
    assert(!(await page.$eval(".uv-lv", d => d.open)), "Orientačně sbalené");
    const [qTop, lvTop] = await page.evaluate(() => [document.querySelector(".uv-wsteps").getBoundingClientRect().top, document.querySelector(".uv-lv").getBoundingClientRect().top]);
    assert(qTop < lvTop, "otázky jsou nad panelem Orientačně");
    assert(/4\s?100\s?000 Kč/.test((await page.textContent(".uv-lvs")).replace(/ /g, " ")), "souhrn ve sbaleném panelu: " + await page.textContent(".uv-lvs"));
    await click(page, ".uv-lv > summary");
    assert(await page.$eval(".uv-lv", d => d.open), "rozbalí se");
    await click(page, '[data-a="step"][data-v="1"]');
    assert(await page.$eval(".uv-lv", d => d.open), "zůstane rozbalené po překreslení");
    for (const t of ["dotaznik", "podklady", "nabidky", "prubeh"]) {
      await click(page, `[data-a="tab"][data-v="${t}"]`); await page.waitForTimeout(40);
      const small = await page.$$eval(".uv input, .uv select, .uv textarea", els => els.filter(e => e.offsetParent && e.type !== "checkbox" && parseFloat(getComputedStyle(e).fontSize) < 16).length);
      eq(small, 0, "pole min. 16 px: " + t);
      const tiny0 = await smallTargets(page, ".uv button:not(.uv-doc button), .uv input:not([type=checkbox]), .uv select");
      eq(tiny0, [], "dotykové cíle (40 px, malé komponenty 32 px + plocha 44): " + t);
    }
    /* design systém: globální komponenty, bez vlastní palety (--uv-*), vlastních tlačítek a inline stylů */
    await click(page, '[data-a="back"]');
    eq(await page.evaluate(() => (document.getElementById("uvCss").textContent.match(/--uv-[a-z0-9]+|\.uv \.btn|\.uv-seg|\.uv-chip|#[0-9a-fA-F]{6}\b|rgba?\(/g) || [])), [], "bez vlastní palety a tlačítek v CSS modulu");
    assert(await page.$(".uv .tiles .tile") && await page.$(".uv-bar .seg") && await page.$(".uv-bar .field--search"), "dlaždice .tile, filtr .seg, hledání .field--search");
    eq(await page.$$eval(".uv [style]", els => els.map(e => e.getAttribute("style")).filter(s => /color|background|font|margin|width/.test(s))), [], "bez inline stylů");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "smazání případu přes potvrzení (confirmSheet, záloha confirm)"() {
    const { ctx, page, errors } = await open({ docs: { "uvery/x1": CASE } });
    await click(page, '.uv-card[data-id="x1"]'); await click(page, '[data-a="tab"][data-v="prubeh"]');
    page.once("dialog", d => d.dismiss()); await click(page, '[data-a="delcase"]'); await page.waitForTimeout(50);
    assert(await page.evaluate(() => !!docs["uvery/x1"]), "zrušené potvrzení nic nesmaže");
    await page.evaluate(() => { window.cfmAsked = []; window.confirmSheet = (t, o) => { cfmAsked.push([t, o && o.danger]); return Promise.resolve(true); }; });
    await click(page, '[data-a="delcase"]'); await page.waitForFunction(() => !docs["uvery/x1"]);
    assert(await page.evaluate(() => cfmAsked.length === 1 && cfmAsked[0][1] === true), "mazání přes confirmSheet (danger)");
    await page.waitForSelector(".uv-bar");
    eq(errors, [], "bez chyb");
    await ctx.close();
  },
  async "počítač: Orientačně vždy otevřené vpravo"() {
    const { ctx, page } = await open({ docs: { "uvery/x1": CASE } });
    await click(page, '.uv-card[data-id="x1"]'); await page.waitForSelector(".uv-wiz");
    assert(await page.$eval(".uv-lv", d => d.open), "otevřené");
    const [a, b] = await page.evaluate(() => [document.querySelector(".uv-wsteps").getBoundingClientRect(), document.querySelector(".uv-lv").getBoundingClientRect()].map(r => r.left));
    assert(b > a + 200, "panel vpravo");
    await ctx.close();
  },
  async "UI: mobil a tmavý režim bez chyb a bez vodorovného přetečení stránky"() {
    for (const dark of [false, true]) {
      const { ctx, page, errors } = await open({ width: 390, height: 844, dark, docs: { "uvery/x1": CASE } });
      const over = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      eq(await over(), 0, "nástěnka bez přetečení");
      await click(page, '.uv-card[data-id="x1"]');
      for (const t of ["dotaznik", "banky", "podklady", "nabidky", "prubeh"]) {
        await click(page, `[data-a="tab"][data-v="${t}"]`); await page.waitForTimeout(60);
        eq(await over(), 0, "bez přetečení: " + t);
        if (t === "banky" || t === "dotaznik") await shot(page, `m-${dark ? "dark" : "light"}-${t}`);
      }
      for (let s = 0; s < 6; s++) { await click(page, '[data-a="tab"][data-v="dotaznik"]'); await click(page, `[data-a="step"][data-v="${s}"]`); eq(await over(), 0, "krok " + s); }
      eq(errors, [], "bez chyb");
      await ctx.close();
    }
  }
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (FILTER && !name.includes(FILTER)) continue;
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
