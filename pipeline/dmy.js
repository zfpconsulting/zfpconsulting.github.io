/* Datumy se všude píšou ručně ve tvaru dd.mm.rrrr (žádný kalendář ani formát podle systému).
   Každé <input type="date"> se po vložení do stránky změní na textové pole; kód okolo dál čte i zapisuje .value ve tvaru rrrr-mm-dd. */
(()=>{
  const D=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
  const pad=n=>String(n).padStart(2,"0");
  const ok=(y,m,d)=>{const t=new Date(y,m-1,d);return t.getFullYear()===y&&t.getMonth()===m-1&&t.getDate()===d};
  /* text → ISO; "" když není platné datum. Bere 1.2.2026, 01.02.26, 01022026, 1/2/2026, 2026-02-01 */
  const toISO=t=>{t=String(t||"").trim();let m,d,mo,y;
    if(m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)){y=+m[1];mo=+m[2];d=+m[3]}
    else if(m=t.match(/^(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{4}|\d{2})$/)){d=+m[1];mo=+m[2];y=+m[3];if(m[3].length===2)y+=y<=(new Date().getFullYear()%100)+10?2000:1900}
    else if(m=t.match(/^(\d{2})(\d{2})(\d{4})$/)){d=+m[1];mo=+m[2];y=+m[3]}
    else if(m=t.match(/^(\d{2})(\d{2})(\d{2})$/)){d=+m[1];mo=+m[2];y=+m[3]+(+m[3]<=(new Date().getFullYear()%100)+10?2000:1900)}
    else return "";
    return ok(y,mo,d)?`${y}-${pad(mo)}-${pad(d)}`:""};
  const toDisp=v=>{const m=String(v||"").match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}.${m[2]}.${m[1]}`:""};
  function up(el){
    if(el._dmy||el.tagName!=="INPUT"||el.type!=="date")return;
    const iso=el.value;el._dmy=1;
    el.type="text";el.inputMode="numeric";el.autocomplete="off";el.maxLength=10;
    if(!el.placeholder)el.placeholder="dd.mm.rrrr";
    Object.defineProperty(el,"value",{configurable:true,get(){return toISO(D.get.call(this))},set(v){D.set.call(this,toDisp(v))}});
    D.set.call(el,toDisp(iso));
    const norm=()=>{const raw=D.get.call(el).trim(),i=toISO(raw);
      if(!raw){el.style.outline="";return}
      if(i){D.set.call(el,toDisp(i));el.style.outline=""}else el.style.outline="2px solid #DF6A6A"};
    el.addEventListener("blur",norm);
    el.addEventListener("change",()=>{norm();/* pro kód, který poslouchá jen „input“ */const e=new Event("input",{bubbles:true});e._dmy=1;el.dispatchEvent(e)});
  }
  /* rozepsané datum nesmí vyvolat uložení/překreslení (a smazat napsané) – „input“ z klávesnice se zastaví, propustí se až ten po dokončení */
  document.addEventListener("input",e=>{if(e.target&&e.target._dmy&&!e._dmy)e.stopPropagation()},true);
  const scan=r=>{if(r.nodeType!==1)return;if(r.matches&&r.matches('input[type="date"]'))up(r);r.querySelectorAll&&r.querySelectorAll('input[type="date"]').forEach(up)};
  new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(scan))).observe(document.documentElement,{childList:true,subtree:true});
  scan(document.documentElement);
  window.DMY={toISO,toDisp,upgrade:up};
})();
