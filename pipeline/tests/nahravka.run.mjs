// Testy nahrávek schůzek (tools/nahravka.py → schránka → Pipeline): schválení Přijmout / Odmítnout a zápis ke klientovi
// (karta – datum narození, schůzka do kalendáře s kontrolou kolizí). Funkce se vytáhnou přímo ze zdroje index.html.
// Použití: node tests/nahravka.run.mjs
import { readFileSync } from "node:fs";
import { assert, eq } from "./helpers.mjs";
const src = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const grab = re => { const m = re.exec(src); assert(m, "ve zdroji chybí: " + re); return m[0]; };
/* kód se spustí nad podvrženým prostředím S (with), takže stačí podvrhnout jen to, co funkce opravdu volají */
const run = (code, S, ret) => new Function("S", "with(S){" + code + ";return " + ret + "}")(S);

const NR = grab(/const NRQ=new Map\(\);[\s\S]*?\nfunction nrQueue\([^\n]*\n/);
function nrEnv({ exists = true } = {}) {
  const S = { toasts: [], recs: [], sheets: [], deleted: [], dlg: { open: false, close() { this.open = false } } };
  Object.assign(S, {
    $: () => S.dlg, document: { hidden: false, addEventListener() {} }, setTimeout: f => f(),
    el: (t, a, ...k) => ({ t, a, k, onclick: null, disabled: false }), meetDateTxt: s => s.slice(0, 10),
    openSheet: (t, n) => { S.dlg.open = true; S.sheets.push({ t, n: n.flat().filter(Boolean) }) },
    toast: t => S.toasts.push(t), lsGet: () => [], lsSet() {}, console,
    dzRecording: async x => { S.recs.push(x.rec.client) },
    DZI: { busy: new Set(), fdb: {}, F: { doc: (_, c, id) => id, deleteDoc: async id => { S.deleted.push(id) }, runTransaction: async (_, fn) => fn({ get: async id => ({ exists: () => exists }), delete: id => S.deleted.push(id) }) } },
  });
  S.api = run(NR, S, "{NRQ,nrQueue,nrDecide,nrReview,nrSync}");
  return S;
}
const rec = (g, client) => [g, [{ id: g + "-0" }, { id: g + "-1" }], { type: "fp-nahravka", rec: { client, at: "2026-10-25T18:45", summary: ["Shrnutí " + client] } }];
const btn = (S, label) => { const ch = S.sheets.at(-1).n.find(x => x.a && x.a.class === "chips"); return ch.k.find(b => b.k[0] === label) };

const tests = {
  async "nahrávka se nezapíše sama – ukáže se ke schválení jen s volbami Přijmout / Odmítnout"() {
    const S = nrEnv(); S.api.nrQueue(...rec("g1", "Tomáš Novák"));
    eq(S.recs, [], "nic se nezapsalo"); eq(S.deleted, [], "ze schránky nic nezmizelo");
    eq(S.sheets.length, 1, "otevřelo se schválení"); eq(S.sheets[0].t, "Nahrávka ke schválení", "titulek");
    const ch = S.sheets[0].n.find(x => x.a && x.a.class === "chips"); eq(ch.k.map(b => b.k[0]), ["Přijmout", "Odmítnout"], "jen dvě volby");
  },
  async "Přijmout → zapíše se ke klientovi a zmizí ze schránky; další čekající se ukáže hned po ní"() {
    const S = nrEnv(); S.api.nrQueue(...rec("g1", "Tomáš Novák")); S.api.nrQueue(...rec("g2", "Eva Malá"));
    await btn(S, "Přijmout").onclick(); await new Promise(r => setTimeout(r, 0));
    eq(S.recs, ["Tomáš Novák"], "zapsaná první"); eq(S.deleted, ["g1-0", "g1-1"], "obě části smazané ze schránky");
    assert(S.dlg.open && S.sheets.length >= 2, "ukázala se další nahrávka");
  },
  async "Odmítnout → nic se nezapíše, nahrávka zmizí ze schránky"() {
    const S = nrEnv(); S.api.nrQueue(...rec("g1", "Tomáš Novák"));
    await btn(S, "Odmítnout").onclick(); await new Promise(r => setTimeout(r, 0));
    eq(S.recs, [], "nic nezapsáno"); eq(S.deleted, ["g1-0", "g1-1"], "smazáno"); assert(!S.dlg.open, "okno zavřené");
    assert(S.toasts.some(t => /odmítnuta/.test(t)), "hláška o odmítnutí");
  },
  async "rozhodlo jiné zařízení → nic se nezapíše podruhé; zmizelá nahrávka se ze seznamu sama odebere"() {
    const S = nrEnv({ exists: false }); S.api.nrQueue(...rec("g1", "Tomáš Novák"));
    await S.api.nrDecide("g1", true); eq(S.recs, [], "nezapsáno podruhé");
    const T = nrEnv(); T.api.nrQueue(...rec("g1", "A")); T.api.nrSync(new Map()); eq(T.api.NRQ.size, 0, "odebráno"); assert(!T.dlg.open, "okno zavřené");
  },
  async "zápis: datum narození do karty jen když chybí; schůzka do kalendáře, při kolizi úkol místo schůzky"() {
    const fn = grab(/async function dzRecording\(x\)\{[\s\S]*?\n\}\n/);
    const mk = ({ busy = [], birth = "" } = {}) => {
      const S = { writes: [], tasks: [], meets: [], notes: [] }, client = { id: "c1", name: "Tomáš Novák", birth }, lead = { id: "l1", name: "Tomáš Novák", stage: "probehla", meetings: [] };
      Object.assign(S, {
        meetDateTxt: s => s.slice(0, 10), leads: [lead], clients: [client], clientOfLead: () => client, aiAddLead: async () => lead,
        db: { doc: p => ({ update: async o => S.writes.push([p, o]), set: async o => S.writes.push([p, o]) }), collection: () => ({ add: async o => S.tasks.push(o.text) }) },
        linkPushToLeads: async () => {}, linkPushToClient: async () => {}, plural: (n, a) => a, aiUpdateLead: async () => {},
        DNY_V: ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"], fmtHM: s => new Date(s).toTimeString().slice(0, 5), todayStr: () => "2026-10-26",
        dzBusy: async () => busy, dzBlocks: e => !e.allDay, dzDayOff: e => !!e.allDay, surnameOf: n => n.split(" ").pop().toLowerCase(),
        saveMeeting: async (l, st, on) => { S.meets.push([st.toISOString(), on]); return { evId: "ev1" } }, ensureMeet: async () => {},
        NR_FP_L: {}, NR_FP: [], document: { getElementById: () => null }, window: {}, dzNotify: n => S.notes.push(n), console, Date,
      });
      return { S, f: run(fn, S, "dzRecording") };
    };
    const x = (m) => ({ type: "fp-nahravka", rec: { client: "Tomáš Novák", at: "2026-10-25T18:45", birth: "1988-03-14", meeting: m, notes: [], tasks: [] } });
    const start = "2030-11-12T15:00";
    let { S, f } = mk(); await f(x({ start, online: false }));
    assert(S.writes.some(([p, o]) => p === "clients/c1" && o.birth === "1988-03-14"), "datum narození do karty");
    eq(S.meets.length, 1, "schůzka založená"); eq(S.tasks, [], "žádný úkol");
    ({ S, f } = mk({ birth: "1980-01-01", busy: [{ allDay: false, title: "PV: Rozsypal Jakub", start: "2030-11-12T14:30:00+01:00" }] })); await f(x({ start, online: true }));
    assert(!S.writes.some(([p, o]) => o.birth), "existující datum narození se nepřepíše");
    eq(S.meets.length, 0, "při kolizi se schůzka nezaloží"); assert(/^Kolize v kalendáři.*PV: Rozsypal Jakub/.test(S.tasks[0] || ""), "úkol domluvit nový termín: " + S.tasks[0]);
    ({ S, f } = mk({ busy: [{ allDay: false, title: "VK: Novák", start: new Date(start).toISOString() }] })); await f(x({ start }));
    eq([S.meets.length, S.tasks.length], [0, 0], "stejná schůzka už v kalendáři je → nic dalšího");
    ({ S, f } = mk()); await f(x({ start: "2020-01-01T10:00" })); eq([S.meets.length, S.tasks.length], [0, 0], "termín v minulosti se ignoruje");
  },
};
let fail = 0;
for (const [name, fn] of Object.entries(tests)) { try { await fn(); console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "\n      ", e.message); } }
if (fail) { console.log(fail + " testů selhalo"); process.exit(1); }
console.log("Všechny testy nahrávek prošly (" + Object.keys(tests).length + ").");
