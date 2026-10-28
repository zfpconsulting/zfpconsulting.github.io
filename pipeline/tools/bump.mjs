// Srovná seznam souborů appky v service workeru (sw.js → CORE) s verzemi `?v=` v index.html a zvedne verzi mezipaměti (CACHE),
// aby si telefon po vydání stáhl nové soubory a ukázal „Je nová verze appky“.
//
//   node tools/bump.mjs           → přepíše CORE podle index.html a zvedne CACHE (pipeline-vN → pipeline-vN+1). Spustit před vydáním.
//   node tools/bump.mjs --check   → jen kontrola (CI / testy): selže, když CORE nesedí s index.html nebo když dvě stránky
//                                   načítají stejný soubor s jinou verzí (index.html, fp.html, dotaznik.html).
//
// Do CORE patří všechno, co index.html načítá s ?v= (skripty, ikony), kromě LAZY – ty se uloží až při prvním otevření
// (finanční plán ~1,2 MB, dotazník), a kromě knihoven ve vendor/ (mají vlastní mezipaměť).
import { readFileSync, writeFileSync } from "node:fs";

const R = new URL("..", import.meta.url).pathname;
const LAZY = new Set(["fp.html", "dotaznik.html"]);
const BASE = ["./", "./index.html", "./manifest.webmanifest"];
const PAGES = ["index.html", "fp.html", "dotaznik.html"];

const refs = f => {
  const s = readFileSync(R + f, "utf8"), out = new Map();
  for (const m of s.matchAll(/["'(`\s]((?:\.\/)?[A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-]+)*\.(?:js|mjs|html|png|svg|jpg|json|webmanifest|ico))\?v=(\d+)/g)) {
    const n = m[1].replace(/^\.\//, "");
    if (n.startsWith("/") || n.startsWith("og/")) continue;
    (out.get(n) || out.set(n, new Set()).get(n)).add(m[2]);
  }
  return out;
};

const errs = [];
/* 1) stejný soubor = stejná verze na všech stránkách */
const all = new Map();
for (const p of PAGES) for (const [n, vs] of refs(p)) for (const v of vs) (all.get(n) || all.set(n, new Map()).get(n)).set(v, [...(all.get(n)?.get(v) || []), p]);
for (const [n, m] of all) if (m.size > 1) errs.push(`${n} se načítá v různých verzích: ` + [...m].map(([v, ps]) => `?v=${v} (${ps.join(", ")})`).join(" × "));

/* 2) CORE podle index.html (+ ikony z manifestu) */
const idx = refs("index.html");
const man = readFileSync(R + "manifest.webmanifest", "utf8");
for (const m of man.matchAll(/"src"\s*:\s*"([^"?]+)\?v=(\d+)"/g)) if (!/maskable/.test(m[1])) (idx.get(m[1]) || idx.set(m[1], new Set()).get(m[1])).add(m[2]);
const want = [...BASE];
for (const [n, vs] of idx) { if (LAZY.has(n) || n.startsWith("vendor/")) continue; want.push(`./${n}?v=${Math.max(...[...vs].map(Number))}`); }

const swP = R + "sw.js";
let sw = readFileSync(swP, "utf8");
const cm = /const CORE=(\[[^\]]*\]);/.exec(sw), vm = /CACHE="pipeline-v(\d+)"/.exec(sw);
if (!cm || !vm) throw new Error("sw.js: nenašel jsem CORE nebo CACHE");
const have = JSON.parse(cm[1]);
const key = a => [...a].sort().join("\n");
if (key(have) !== key(want)) {
  const miss = want.filter(x => !have.includes(x)), extra = have.filter(x => !want.includes(x));
  errs.push("sw.js CORE nesedí s index.html" + (miss.length ? " – chybí: " + miss.join(", ") : "") + (extra.length ? " – navíc / stará verze: " + extra.join(", ") : "") + " → spusť node tools/bump.mjs");
}

if (process.argv.includes("--check")) {
  if (errs.length) { console.error("✗ " + errs.join("\n✗ ")); process.exit(1); }
  console.log(`✓ sw.js: CORE (${have.length} souborů) sedí s index.html, CACHE pipeline-v${vm[1]}`);
} else {
  const other = errs.filter(e => !e.startsWith("sw.js"));
  if (other.length) { console.error("✗ " + other.join("\n✗ ") + "\n(oprav ?v= ve stránkách a spusť znovu)"); process.exit(1); }
  const nv = +vm[1] + 1;
  sw = sw.replace(cm[0], "const CORE=" + JSON.stringify(want) + ";").replace(vm[0], `CACHE="pipeline-v${nv}"`);
  writeFileSync(swP, sw);
  console.log(`sw.js: CACHE pipeline-v${vm[1]} → pipeline-v${nv}, CORE ${want.length} souborů`);
}
