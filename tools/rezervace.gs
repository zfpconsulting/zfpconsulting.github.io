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

   API (GET nebo POST text/plain JSON):
   a=busy&days=22                 → {ok, busy:[[od_ms, do_ms],…], len, buf}      (jen časy, žádné názvy)
   a=book&start=ISO&online=0|1    → {ok:true, id} | {ok:false, err:"busy"|"time"|"rate"|"lock"}
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
function busy(from, to, C) {
  var ids = [C.cal, "primary"].concat(C.cals).filter(function (v, i, a) { return a.indexOf(v) === i; });
  var r = Calendar.Freebusy.query({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: ids.map(function (id) { return { id: id }; }) });
  var B = [];
  Object.keys(r.calendars || {}).forEach(function (k) { (r.calendars[k].busy || []).forEach(function (b) { B.push([Date.parse(b.start), Date.parse(b.end)]); }); });
  return B;
}
function handle(p) {
  var C = cfg(), now = Date.now();
  if (p.a === "busy") {
    var days = Math.min(60, Math.max(1, +p.days || 22));
    return { ok: true, busy: busy(new Date(now), new Date(now + days * 864e5), C), len: C.len, buf: C.buf };
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
      if (busy(new Date(b0), new Date(b1), C).some(function (x) { return x[0] < b1 && x[1] > b0; })) return { ok: false, err: "busy" };
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
