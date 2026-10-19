// Aktualizace sazeb hypoték pro kalkulačku Úvěr (pipeline/sazby.json).
// Zdroj: Swiss Life Hypoindex – průměrné nabídkové sazby podle fixace a LTV, vychází měsíčně k 5. pracovnímu dni.
// Spouští se týdně z .github/workflows/sazby.yml; nový soubor se zapíše jen když vyšlo novější číslo nebo se změnily hodnoty.
// Použití: node tools/sazby.mjs            – stáhne PDF a obnoví pipeline/sazby.json (potřebuje pdftotext z poppler-utils)
//          node tools/sazby.mjs --text F   – jen rozparsuje už vytažený text z PDF (pro testy)
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = new URL("../pipeline/sazby.json", import.meta.url);
const MONTHS = ["LEDEN", "UNOR", "BREZEN", "DUBEN", "KVETEN", "CERVEN", "CERVENEC", "SRPEN", "ZARI", "RIJEN", "LISTOPAD", "PROSINEC"];
const BASE = "https://www.swisslifeselect.cz/content/dam/sls-cz/pro-media/hypoindex/";

export function candidates(y, m) {
  const mm = String(m).padStart(2, "0"), n = MONTHS[m - 1];
  return [`${BASE}hypoindex-${mm}${y}/TZ_Swiss%20Life_Hypoindex_${n}_${y}.pdf`, `${BASE}TZ_Swiss%20Life_Hypoindex_${n}_${y}.pdf`];
}

/* z textu tiskové zprávy vytáhne tabulku „Fixace / Do 80 % LTV / Nad 80 % LTV“ a hodnotu indexu */
export function parse(text) {
  const t = text.replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const num = s => +s.replace(",", ".");
  const ok = x => isFinite(x) && x > 0.5 && x < 20;
  const fix = {}, hi = t.search(/Fixace\s+Do 80/i), tab = hi >= 0 ? t.slice(hi) : t; // tabulka začíná hlavičkou „Fixace Do 80 % LTV …“
  for (const [k, re] of [[1, "1 rok"], [3, "3 roky"], [5, "5 let"], [10, "10 let"]]) {
    // řádek tabulky: „5 let 5,51 % 5,82 %“ (druhý sloupec může chybět)
    const m = new RegExp(`(?:^|\\n|\\s)${re}\\s+(\\d{1,2},\\d{1,2})\\s*%(?:\\s+(\\d{1,2},\\d{1,2})\\s*%)?`).exec(tab);
    if (!m) continue;
    const a = num(m[1]), b = m[2] ? num(m[2]) : null;
    if (ok(a) && (b == null || ok(b))) fix[k] = { a, b };
  }
  const im = /Hypoindex[^%]{0,120}?(\d{1,2},\d{1,2})\s*%/.exec(t);
  const index = im && ok(num(im[1])) ? num(im[1]) : null;
  if (Object.keys(fix).length < 3) throw new Error("V textu PDF chybí tabulka sazeb podle fixace (formát zprávy se asi změnil) – zkontroluj ručně a uprav tools/sazby.mjs.");
  return { index, fix };
}

async function fetchPdf(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.subarray(0, 5).toString() === "%PDF-" ? buf : null;
}
function pdfText(buf) {
  const dir = mkdtempSync(join(tmpdir(), "hypoindex-")), f = join(dir, "h.pdf");
  writeFileSync(f, buf);
  return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
}

async function main() {
  const ti = process.argv.indexOf("--text");
  if (ti > 0) { console.log(JSON.stringify(parse(readFileSync(process.argv[ti + 1], "utf8")), null, 1)); return; }
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const now = new Date();
  // aktuální měsíc, jinak předchozí (na začátku měsíce ještě nové číslo nevyšlo)
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1), y = d.getFullYear(), m = d.getMonth() + 1;
    const period = `${y}-${String(m).padStart(2, "0")}`;
    if (prev && prev.period > period) break; // starší, než co už máme
    for (const url of candidates(y, m)) {
      const buf = await fetchPdf(url);
      if (!buf) continue;
      const data = { source: "Swiss Life Hypoindex", period, url, ...parse(pdfText(buf)) };
      if (prev && prev.period === period && JSON.stringify(prev.fix) === JSON.stringify(data.fix) && prev.index === data.index) {
        console.log(`Beze změny – ${period} už v sazby.json je.`); return;
      }
      writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
      console.log(`sazby.json → ${period}`, JSON.stringify(data.fix));
      return;
    }
  }
  if (prev && (now.getFullYear() * 12 + now.getMonth() + 1) - (+prev.period.slice(0, 4) * 12 + +prev.period.slice(5)) <= 1) {
    console.log(`Nové číslo zatím nevyšlo, platí ${prev.period}.`); return;
  }
  throw new Error("Hypoindex za poslední měsíce se nepodařilo stáhnout (změnila se adresa PDF?) – kalkulačka ukazuje zastaralé sazby.");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("::error::" + e.message); process.exit(1); });
