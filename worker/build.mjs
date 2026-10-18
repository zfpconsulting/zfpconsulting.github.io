/* spojí pushcrypto.js + push.js do jednoho souboru pro webový editor Cloudflare (worker/bundle.js) */
import {readFileSync,writeFileSync} from "node:fs";
const pc=readFileSync(new URL("../pipeline/pushcrypto.js",import.meta.url),"utf8");
const w=readFileSync(new URL("./push.js",import.meta.url),"utf8").replace(/^import "\.\.\/pipeline\/pushcrypto\.js";\n/m,"");
writeFileSync(new URL("./bundle.js",import.meta.url),"/* SESTAVENO z pipeline/pushcrypto.js + worker/push.js (node worker/build.mjs) – neupravovat ručně */\n"+pc+"\n"+w);
console.log("bundle.js",(pc.length+w.length)+" znaků");
