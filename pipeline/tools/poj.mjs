// Sazby pojišťoven (NN, Kooperativa, UNIQA, Allianz, Generali) jsou ve fp.html zašifrované stejně jako provizní příloha v index.html
// (AES-256-GCM, klíč z přístupového kódu přes PBKDF2-SHA256), aby nebyly čitelné ve veřejném repozitáři ani na webu.
// Fp.html si přístupový kód bere z úložiště zařízení (uložila ho tam Pipeline), sám si ho nikde nepamatuje v kódu.
//
//   PP_KEY=XXXXX-XXXXX-XXXXX-XXXXX node tools/poj.mjs dec   → dešifruje sazby do poj.plain.json (NECOMMITOVAT – je v .gitignore)
//   PP_KEY=XXXXX-XXXXX-XXXXX-XXXXX node tools/poj.mjs enc   → zašifruje poj.plain.json zpět do fp.html (a soubor smaže)
//
// poj.plain.json = { NN_T: {...}, KOOP_T: {...}, … } – klíče odpovídají tabulkám v engine (prázdné objekty, které doplní FPE.setSazby).
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

const HTML = new URL("../fp.html", import.meta.url), PLAIN = new URL("../poj.plain.json", import.meta.url);
const ITER = 250000;
const norm = k => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const b64 = u => Buffer.from(u).toString("base64url"), unb64 = s => new Uint8Array(Buffer.from(s, "base64url"));
async function keyFrom(code, salt) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(norm(code)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const code = process.env.PP_KEY, mode = process.argv[2];
if (!code || !["enc", "dec"].includes(mode)) { console.error("Použití: PP_KEY=… node tools/poj.mjs enc|dec"); process.exit(1); }
let html = readFileSync(HTML, "utf8");
const RE = /const FP_POJ_ENC="([^"]*)";/;
if (!RE.test(html)) { console.error("Ve fp.html chybí const FP_POJ_ENC"); process.exit(1); }
if (mode === "dec") {
  const [, salt, iv, data] = html.match(RE)[1].split(".");
  const key = await keyFrom(code, unb64(salt));
  const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(data)));
  writeFileSync(PLAIN, JSON.stringify(JSON.parse(plain)));
  console.log("Dešifrováno do poj.plain.json – po úpravě spusť enc.");
} else {
  if (!existsSync(PLAIN)) { console.error("Chybí poj.plain.json"); process.exit(1); }
  const plain = JSON.stringify(JSON.parse(readFileSync(PLAIN, "utf8")));
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(code, salt);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  html = html.replace(RE, () => `const FP_POJ_ENC="v1.${b64(salt)}.${b64(iv)}.${b64(data)}";`);
  writeFileSync(HTML, html);
  unlinkSync(PLAIN);
  console.log("Zašifrováno do fp.html, poj.plain.json smazán.");
}
