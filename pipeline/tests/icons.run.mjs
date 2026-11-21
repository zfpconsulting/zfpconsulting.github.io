// Test ikon appky (bez prohlížeče). apple-touch-icon a maskable musí být čtverce BEZ průhlednosti (iOS / Android je zaoblí samy,
// iOS by průhledné rohy vyplnil černě). Ikony „any“ v manifestu jsou naopak zaoblené s průhlednými rohy – Chrome na Macu je dává
// do Docku beze změny, čtverec by byl hranatý. Generují se příkazem: node tools/make-icons.mjs
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { ROOT } from "./helpers.mjs";

const png = f => { const b = readFileSync(ROOT + f); if (b.toString("ascii", 1, 4) !== "PNG") throw new Error(f + " není PNG"); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], type: b[25] }; };
/* alfa levého horního pixelu (RGBA PNG, 8 bit) – rozbalí první řádek dat */
const cornerAlpha = f => { const b = readFileSync(ROOT + f); let off = 8; const idat = [];
  while (off < b.length) { const len = b.readUInt32BE(off), t = b.toString("ascii", off + 4, off + 8); if (t === "IDAT") idat.push(b.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)); return raw[1 + 3]; };
const html = readFileSync(ROOT + "index.html", "utf8"), mf = JSON.parse(readFileSync(ROOT + "manifest.webmanifest", "utf8")), sw = readFileSync(ROOT + "sw.js", "utf8");
const tests = {
  "apple-touch-icon: 180×180, bez průhlednosti"() { const i = png("apple-touch-icon.png"); if (i.w !== 180 || i.h !== 180) throw new Error(`rozměr ${i.w}×${i.h}`); if (i.type !== 2) throw new Error("má alfa kanál (typ " + i.type + ")"); },
  "ikony v manifestu: správné rozměry; maskable bez průhlednosti, any zaoblené (průhledný roh)"() {
    for (const ic of mf.icons) { const f = ic.src.split("?")[0], i = png(f), [w] = ic.sizes.split("x").map(Number);
      if (i.w !== w || i.h !== w) throw new Error(`${f}: ${i.w}×${i.h}, v manifestu ${ic.sizes}`);
      if (ic.purpose === "maskable") { if (i.type !== 2) throw new Error(f + " (maskable) má alfa kanál"); }
      else { if (i.type !== 6) throw new Error(f + " (any) má být zaoblená s průhlednými rohy – je čtverec bez alfa kanálu");
        if (cornerAlpha(f) !== 0) throw new Error(f + " (any) má neprůhledný roh – v Docku na Macu bude hranatá"); } }
  },
  "favicon-48: 48×48"() { const i = png("favicon-48.png"); if (i.w !== 48 || i.h !== 48) throw new Error(`rozměr ${i.w}×${i.h}`); },
  "stránka odkazuje na existující ikony a service worker je cachuje"() {
    for (const m of html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"?]+)/g)) if (!existsSync(ROOT + m[1])) throw new Error("chybí soubor " + m[1]);
    if (!/rel="apple-touch-icon"/.test(html)) throw new Error("chybí apple-touch-icon");
    for (const f of ["apple-touch-icon.png", "icon-192.png", "icon-512.png"]) if (!sw.includes(f)) throw new Error(f + " není v cache service workeru");
  },
};
let ok = 0, bad = 0;
for (const [n, f] of Object.entries(tests)) { try { f(); ok++; console.log("✓ " + n); } catch (e) { bad++; console.log("✗ " + n + "\n    " + e.message); } }
console.log(`\n${ok} prošlo, ${bad} selhalo`); process.exit(bad ? 1 : 0);
