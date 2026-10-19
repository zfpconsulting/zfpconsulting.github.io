// Test parseru tiskové zprávy Hypoindexu (tools/sazby.mjs) – bez sítě. Použití: node tools/sazby.test.mjs
import { parse, candidates } from "./sazby.mjs";
import assert from "node:assert/strict";
const zari = `Hypoteční sazby rostou už šestý měsíc v řadě a Swiss Life Hypoindex v září vystoupal na 5,51 %, nejvýše od léta 2024. Za 1 rok 3,10 % jinde.
Průměrné nabídkové sazby u jednotlivých fixací
Úrokové sazby – září 2026
Fixace        Do 80 % LTV       Nad 80 % LTV
1 rok          5,29 %             5,58 %
3 roky         5,27 %             5,58 %
5 let          5,51 %             5,82 %
10 let         5,99 %             6,24 %
Zdroj: Swiss Life Hypoindex`;
assert.deepEqual(parse(zari), { index: 5.51, fix: { 1: { a: 5.29, b: 5.58 }, 3: { a: 5.27, b: 5.58 }, 5: { a: 5.51, b: 5.82 }, 10: { a: 5.99, b: 6.24 } } });
assert.deepEqual(parse("Fixace Do 80 % LTV Nad 80 % LTV\n1 rok 5,42 % 5,71 %\n3 roky 5,53 % 5,84 %\n5 let 6,15 %\n").fix[5], { a: 6.15, b: null });
assert.throws(() => parse("žádná tabulka"));
assert.match(candidates(2026, 10)[0], /hypoindex-102026\/TZ_Swiss%20Life_Hypoindex_RIJEN_2026\.pdf$/);
console.log("✓ parser Hypoindexu");
