/* Rezervace z webu (termin/…, dotaznik/…) – živá kontrola volna a okamžitá blokace termínu v Google kalendáři poradce.
   Proč: Pipeline zveřejňuje volné časy jen když je otevřená; bez tohohle skriptu si klient může vybrat čas, který mezitím
   obsadíš z telefonu, nebo dva klienti tentýž čas. Skript běží pod tvým Google účtem a vidí jen obsazenost (časy), ne názvy.

   NASAZENÍ (jednou, ~3 min):
   1. script.google.com → Nový projekt → sem vložit celý tento soubor (nahradit Code.gs).
   2. Vlevo „Služby“ (+) → Google Calendar API → Přidat (identifikátor Calendar).
   3. Nastavení projektu → Vlastnosti skriptu: CAL = ID kalendáře, kam Pipeline zapisuje schůzky (primary, pokud hlavní),
      PREFIX = začátek názvu schůzek (např. VK:), volitelně CALS = další kalendáře k ověření (čárkou), LEN = 45, BUF = 15.
   4. Nasadit → Nové nasazení → Webová aplikace · Spouštět jako: Já · Přístup: Kdokoli → Nasadit → povolit přístup ke kalendáři.
   5. Adresu webové aplikace (…/exec) vlož v Pipeline: Nastavení → Dotazník a rezervace → „Živá kontrola kalendáře“.

   KOLEGOVÉ V JEDNOM KALENDÁŘI (verze 2): v CAL smí být i schůzky kolegů (společný kalendář). Jejich schůzka tě NEBLOKUJE:
   – kolega má osobně (v kanceláři) → kancelář je obsazená, ty můžeš jen online (pole office),
   – kolega má online → ty můžeš osobně i online.
   Tvoje schůzky poznáme podle PREFIX (nebo že je založil tvůj účet); všechno ostatní v CAL je kolega. Bez PREFIX se vše bere jako tvoje.
   Po změně kódu: Nasadit → Spravovat nasazení → ✎ → Verze: Nová verze → Nasadit (adresa /exec zůstává stejná).

   API (GET nebo POST text/plain JSON):
   a=busy&days=22                 → {ok, v:2, busy:[[od_ms, do_ms],…], office:[[od_ms, do_ms],…], len, buf}   (jen časy, žádné názvy)
   a=book&start=ISO&online=0|1    → {ok:true, id} | {ok:false, err:"busy"|"office"|"time"|"rate"|"lock"}
     Pod zámkem znovu ověří volno (± BUF minut) a hned vloží událost „PREFIX Rezervace z webu“ s extendedProperties.private.zfpHold=1.
     Pipeline ji po přijetí šifrované rezervace přejmenuje na klienta; blokace, ke které rezervace do 3 h nedorazí, Pipeline smaže. */
function doGet(e) { return out(handle((e && e.parameter) || {})); }
function doPost(e) { var p = {}; try { p = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) {} return out(handle(p)); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function cfg() {
  var P = PropertiesService.getScriptProperties();
  return { cal: P.getProperty("CAL") || "primary", prefix: (P.getProperty("PREFIX") || "").trim(),
    cals: (P.getProperty("CALS") || "").split(",").map(function (s) { return s.trim(); }).filter(String),
    len: +(P.getProperty("LEN") || 45), buf: +(P.getProperty("BUF") || 15), addr: P.getProperty("ADDR") || "Trnitá 500/9, 602 00 Brno" };
}
/* kolega má schůzku osobně v kanceláři? (online v názvu, odkaz na Meet/Zoom/Teams nebo místo mimo kancelář = kancelář zůstává volná; stejné pravidlo jako v Pipeline) */
function inPerson(e) {
  var t = e.summary || "", pl = (e.location || "").trim();
  if (/\bonline\b/i.test(t) || e.hangoutLink || e.conferenceData || /^https?:|meet\.google|zoom\.|teams\./i.test(pl)) return false;
  return !pl || /trnit|zfp|kancel/i.test(pl);
}
/* rozdělení: busy = tvoje časy (osobní kalendáře + tvoje schůzky v CAL), office = kolegové osobně v CAL */
function split(from, to, C) {
  var B = [], O = [], me = "";
  try { me = String(Session.getEffectiveUser().getEmail() || "").toLowerCase(); } catch (x) {}
  var pre = C.prefix.toLowerCase();
  /* osobní kalendáře a CALS: vše je tvoje */
  var ids = ["primary"].concat(C.cals).filter(function (v, i, a) { return v !== C.cal && a.indexOf(v) === i; });
  var r = Calendar.Freebusy.query({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: ids.map(function (id) { return { id: id }; }) });
  Object.keys(r.calendars || {}).forEach(function (k) { (r.calendars[k].busy || []).forEach(function (b) { B.push([Date.parse(b.start), Date.parse(b.end)]); }); });
  /* kalendář se schůzkami: tvoje = PREFIX / založil je tvůj účet / blokace z webu; ostatní = kolega */
  var tok = "";
  do {
    var L = Calendar.Events.list(C.cal, { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, maxResults: 250, pageToken: tok || undefined });
    (L.items || []).forEach(function (e) {
      if (e.status === "cancelled" || e.transparency === "transparent" || !e.start || !e.start.dateTime) return;
      var s = Date.parse(e.start.dateTime), en = Date.parse((e.end && e.end.dateTime) || e.start.dateTime);
      var hold = e.extendedProperties && e.extendedProperties["private"] && e.extendedProperties["private"].zfpHold != null;
      var cr = e.creator && e.creator.email ? String(e.creator.email).toLowerCase() : "";
      var mine = hold || !pre || String(e.summary || "").toLowerCase().indexOf(pre) === 0 || !cr || !me || cr === me;
      if (mine) B.push([s, en]); else if (inPerson(e)) O.push([s, en]);
    });
    tok = L.nextPageToken;
  } while (tok);
  return { busy: B, office: O };
}
function busy(from, to, C) { return split(from, to, C).busy; }
function handle(p) {
  var C = cfg(), now = Date.now();
  if (p.a === "busy") {
    var days = Math.min(60, Math.max(1, +p.days || 22));
    var sp = split(new Date(now), new Date(now + days * 864e5), C);
    return { ok: true, v: 2, busy: sp.busy, office: sp.office, len: C.len, buf: C.buf };
  }
  if (p.a === "book") {
    var s = Date.parse(p.start);
    if (!s || s < now + 6 * 3600e3 || s > now + 60 * 864e5) return { ok: false, err: "time" };
    var e = s + C.len * 60000, online = String(p.online) === "1" || p.online === true;
    /* ochrana kalendáře proti zahlcení: nejvýš 8 blokací za hodinu */
    var cache = CacheService.getScriptCache(), k = "n" + Math.floor(now / 3600e3), n = +(cache.get(k) || 0);
    if (n >= 8) return { ok: false, err: "rate" };
    var L = LockService.getScriptLock();
    if (!L.tryLock(15000)) return { ok: false, err: "lock" };
    try {
      var b0 = s - C.buf * 60000, b1 = e + C.buf * 60000;
      var sp = split(new Date(b0), new Date(b1), C);
      if (sp.busy.some(function (x) { return x[0] < b1 && x[1] > b0; })) return { ok: false, err: "busy" };
      /* osobně jen když kolega v tu dobu nemá osobní schůzku v kanceláři */
      if (!online && sp.office.some(function (x) { return x[0] < e && x[1] > s; })) return { ok: false, err: "office" };
      var ev = Calendar.Events.insert({
        summary: (C.prefix ? C.prefix + " " : "") + "Rezervace z webu" + (online ? " (online)" : ""),
        description: "Termín si klient vybral na webu. Jméno a kontakt doplní Pipeline po přijetí šifrované rezervace.",
        location: online ? "" : C.addr,
        start: { dateTime: new Date(s).toISOString() }, end: { dateTime: new Date(e).toISOString() },
        extendedProperties: { "private": { zfpHold: "1", zfpAt: String(now) } }
      }, C.cal);
      cache.put(k, String(n + 1), 3700);
      return { ok: true, id: ev.id };
    } finally { L.releaseLock(); }
  }
  return { ok: false, err: "a" };
}
