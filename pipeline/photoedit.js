/* Editor profilové fotky (kolegové v týmu i „Ty“): posun tažením, zoom posuvníkem / kolečkem / dvěma prsty, otočení.
   PhotoEdit.pick() → Promise<dataURL|null>  vybere soubor a zmenší ho na max. 720 px (uloží se jako zdroj pro pozdější úpravy)
   PhotoEdit.create({src,crop,onSave,onCancel,onRemove}) → element editoru; onSave({photo,src,crop}) dostane čtvercový JPEG 320 px.
   crop = {z,x,y,r}: zoom (1 = fotka právě vyplní kruh), posun v podílech šířky výřezu, otočení ve stupních. */
(()=>{
"use strict";
const OUT=320,SRC_MAX=720,V=280,ZMAX=5;
const CSS=`
.pe{display:grid;gap:16px;justify-items:center}
.pe-view{position:relative;width:min(${V}px,100%);aspect-ratio:1;overflow:hidden;border-radius:var(--r-l);background:#000;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.pe-view:active{cursor:grabbing}
.pe-view:focus-visible{outline:3px solid var(--accent-soft);outline-offset:2px}
.pe-img{position:absolute;left:50%;top:50%;max-width:none;pointer-events:none;-webkit-user-drag:none}
.pe-mask{position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px rgba(0,0,0,.55);pointer-events:none;border:2px solid rgba(255,255,255,.85)}
.pe-zoom{display:flex;align-items:center;gap:var(--sp-3);width:min(${V}px,100%)}
.pe-zoom span{font-size:20px;line-height:1;color:var(--ink-2);width:18px;text-align:center}
.pe-zoom input{flex:1;accent-color:var(--accent)}
.pe .hint{text-align:center;margin:-6px 0 0}
.pe-tools{display:flex;flex-wrap:wrap;gap:var(--sp-2);justify-content:center}
.pe-foot{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);width:min(${V+40}px,100%)}`;
/* liniové ikony appky (ICON z index.html); záloha pro samostatné testy modulu */
const icoH=n=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+((typeof ICON==="object"&&ICON&&ICON[n])||{reset:'<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4"/>',image:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 17.5 5-5 4 4 2.5-2.5 5 5"/>'}[n]||"")+'</svg>';
function css(){if(document.getElementById("peCss"))return;const s=document.createElement("style");s.id="peCss";s.textContent=CSS;document.head.append(s)}
const loadImg=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src});
async function shrink(dataUrl,max=SRC_MAX){
  const i=await loadImg(dataUrl),k=Math.min(1,max/Math.max(i.naturalWidth,i.naturalHeight));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.naturalWidth*k));c.height=Math.max(1,Math.round(i.naturalHeight*k));
  const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(i,0,0,c.width,c.height);
  return c.toDataURL("image/jpeg",.85);
}
/* musí se volat přímo z kliknutí (iPhone jinak výběr souboru neotevře) */
function pick(){
  return new Promise(res=>{
    const inp=document.createElement("input");inp.type="file";inp.accept="image/*";inp.style.display="none";document.body.append(inp);
    const done=v=>{inp.remove();res(v)};
    inp.addEventListener("cancel",()=>done(null));
    inp.addEventListener("change",()=>{const f=inp.files&&inp.files[0];if(!f)return done(null);
      const r=new FileReader();r.onload=()=>shrink(r.result).then(done,()=>done(null));r.onerror=()=>done(null);r.readAsDataURL(f)});
    inp.click();
  });
}
function create({src,crop,onSave,onCancel,onRemove}={}){
  css();
  const st={z:1,x:0,y:0,r:0,...(crop||{})};
  const root=document.createElement("div");root.className="pe";
  root.innerHTML=`<div class="pe-view" tabindex="0" role="img" aria-label="Výřez fotky – táhni pro posun, šipkami posuneš, + a − přiblížíš"><img class="pe-img" alt=""><div class="pe-mask"></div></div>
    <div class="pe-zoom"><span aria-hidden="true">−</span><input type="range" min="1" max="${ZMAX}" step="0.01" aria-label="Přiblížení"><span aria-hidden="true">+</span></div>
    <p class="hint">Táhni fotku prstem nebo myší, přibliž posuvníkem nebo dvěma prsty.</p>
    <div class="pe-tools"><button type="button" class="btn btn--secondary btn--s" data-pe="rot">${icoH("reset")}Otočit</button><button type="button" class="btn btn--secondary btn--s" data-pe="pick">${icoH("image")}Jiná fotka</button>${onRemove?'<button type="button" class="btn btn--danger btn--s pe-del" data-pe="del">Odebrat fotku</button>':""}</div>
    <div class="pe-foot"><button type="button" class="btn btn--secondary" data-pe="cancel">Zrušit</button><button type="button" class="btn btn--primary pe-ok" data-pe="save">Uložit</button></div>`;
  const view=root.querySelector(".pe-view"),im=root.querySelector(".pe-img"),zr=root.querySelector("input[type=range]");
  let img=null;
  const dims=()=>{const w=img.naturalWidth,h=img.naturalHeight,rot=((st.r%180)+180)%180!==0,W=rot?h:w,H=rot?w:h;return{w,h,W,H,s:Math.max(V/W,V/H)*st.z}};
  const clamp=()=>{st.z=Math.min(ZMAX,Math.max(1,st.z));if(!img)return;const d=dims(),mx=Math.max(0,(d.W*d.s-V)/2)/V,my=Math.max(0,(d.H*d.s-V)/2)/V;
    st.x=Math.min(mx,Math.max(-mx,st.x));st.y=Math.min(my,Math.max(-my,st.y))};
  const paint=()=>{if(!img)return;clamp();const d=dims(),vs=view.clientWidth||V,k=vs/V;
    im.style.width=d.w+"px";im.style.height=d.h+"px";
    im.style.transform=`translate(-50%,-50%) translate(${st.x*vs}px,${st.y*vs}px) rotate(${st.r}deg) scale(${d.s*k})`;
    zr.value=st.z;zr.style.setProperty("--p",((st.z-1)/(ZMAX-1)*100)+"%")};
  async function setSrc(s,c){src=s;img=await loadImg(s);im.src=s;Object.assign(st,{z:1,x:0,y:0,r:0},c||{});paint()}
  setSrc(src,crop).catch(()=>{});
  /* tažení a dva prsty */
  const pts=new Map();let last=null;
  const snap=()=>{const a=[...pts.values()];if(a.length===1)return{x:a[0].x,y:a[0].y,d:0};const[p,q]=a;return{x:(p.x+q.x)/2,y:(p.y+q.y)/2,d:Math.hypot(p.x-q.x,p.y-q.y)}};
  view.addEventListener("pointerdown",e=>{view.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});last=snap();e.preventDefault()});
  view.addEventListener("pointermove",e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});const n=snap(),vs=view.clientWidth||V;
    if(last){if(pts.size>1&&last.d>0&&n.d>0)st.z*=n.d/last.d;st.x+=(n.x-last.x)/vs;st.y+=(n.y-last.y)/vs;paint()}last=n});
  const up=e=>{pts.delete(e.pointerId);last=pts.size?snap():null};
  view.addEventListener("pointerup",up);view.addEventListener("pointercancel",up);
  view.addEventListener("wheel",e=>{e.preventDefault();st.z*=Math.exp(-e.deltaY*.0018);paint()},{passive:false});
  view.addEventListener("keydown",e=>{const m={ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.02],ArrowDown:[0,.02]}[e.key];
    if(m){st.x+=m[0];st.y+=m[1];paint();e.preventDefault()}else if(e.key==="+"||e.key==="="){st.z*=1.08;paint()}else if(e.key==="-"){st.z/=1.08;paint()}});
  zr.addEventListener("input",()=>{st.z=+zr.value;paint()});
  root.addEventListener("click",async e=>{const b=e.target.closest("[data-pe]");if(!b)return;const a=b.dataset.pe;
    if(a==="rot"){st.r=(st.r+90)%360;paint()}
    else if(a==="pick"){const s=await pick();if(s)setSrc(s).catch(()=>{})}
    else if(a==="del"){if(onRemove)onRemove()}
    else if(a==="cancel"){if(onCancel)onCancel()}
    else if(a==="save"&&img){b.disabled=true;clamp();const d=dims(),c=document.createElement("canvas");c.width=c.height=OUT;const x=c.getContext("2d");
      x.fillStyle="#fff";x.fillRect(0,0,OUT,OUT);x.translate(OUT/2+st.x*OUT,OUT/2+st.y*OUT);x.rotate(st.r*Math.PI/180);x.scale(d.s*OUT/V,d.s*OUT/V);x.drawImage(img,-d.w/2,-d.h/2);
      try{await onSave({photo:c.toDataURL("image/jpeg",.88),src,crop:{z:+st.z.toFixed(4),x:+st.x.toFixed(4),y:+st.y.toFixed(4),r:st.r}})}finally{b.disabled=false}}
  });
  let rT;const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(()=>{clearTimeout(rT);rT=setTimeout(paint,50)}):null;if(ro)ro.observe(view);
  root._state=st;
  return root;
}
window.PhotoEdit={pick,create,shrink};
})();
