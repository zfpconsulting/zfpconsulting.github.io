/* Zvuky kliků – tři krátké „blob“ zvuky syntetizované přes Web Audio (žádné soubory, nic se nestahuje).
   bloop = potvrzení a přidání (primární tlačítko, „+“, Uložit) – stoupající bublina
   pop   = navigace a výběr (záložky, přepínač .seg, chipy, řádky, karty, odkazy) – měkké „plop“
   tick  = lehké ovládání (přepínače, ikony, sekundární tlačítka, zavřít) – krátké cvaknutí
   Zapíná se v Nastavení → Vzhled (uloženo v localStorage „snd“, na zařízení). Hraje se jen na skutečný klik uživatele. */
(()=>{
  if(window.Snd)return;
  const KEY="snd",DEF={
    bloop:{f0:300,f1:720,dur:.14,gain:.30,over:.22},
    pop:{f0:540,f1:320,dur:.10,gain:.26,over:.10},
    tick:{f0:980,f1:720,dur:.05,gain:.16,over:0}
  };
  let ctx=null,master=null,on=true,lastAt=0;
  try{on=localStorage.getItem(KEY)!=="0"}catch(e){}
  const ac=()=>{
    if(ctx)return ctx;
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
    try{ctx=new C({latencyHint:"interactive"});master=ctx.createGain();master.gain.value=.55;master.connect(ctx.destination)}catch(e){ctx=null}
    return ctx;
  };
  /* jeden hlas: sinus s rychlým sklouznutím výšky + lowpass + obálka (útok ~6 ms, exponenciální doznění) */
  const voice=(c,t,f0,f1,dur,gain)=>{
    const o=c.createOscillator(),g=c.createGain(),lp=c.createBiquadFilter();
    o.type="sine";o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur*.85);
    lp.type="lowpass";lp.frequency.value=2200;
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.006);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(lp);lp.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.03);
  };
  function play(kind){
    if(!on||document.hidden)return;
    const d=DEF[kind];if(!d)return;
    const now=performance.now();if(now-lastAt<35)return;lastAt=now;   /* dva klepnutí v rychlém sledu nesplynou do jednoho šumu */
    const c=ac();if(!c)return;
    if(c.state==="suspended")c.resume().catch(()=>{});
    const t=c.currentTime+.005;
    voice(c,t,d.f0,d.f1,d.dur,d.gain);
    if(d.over)voice(c,t,d.f0*2,d.f1*2,d.dur*.7,d.gain*d.over);   /* tichá oktáva = „vodnatější“ barva */
    Snd.last=kind;
  }
  /* který zvuk patří ke kterému prvku; data-snd="bloop|pop|tick|off" na prvku (nebo předkovi) má přednost */
  const PRIMARY=".btn--primary,.icon-btn--primary,#addBtn,.oadd,.tb-save",
        NAV="#tabBar button,.tabs button,.seg button,.chip,.row-btn,.row,.card,summary,a[href],[role=tab],.ohit,.tile,#moreSheet button",
        LIGHT="input.switch,input[type=checkbox],input[type=radio],select,.icon-btn,.btn--ghost,.btn--secondary,.btn--danger";
  const TEXTY=/^(text|search|email|tel|url|number|password|date|time|datetime-local|month|week)$/i;
  function kindOf(t){
    if(!(t instanceof Element))return null;
    const ov=t.closest("[data-snd]");if(ov)return ov.dataset.snd==="off"?null:(DEF[ov.dataset.snd]?ov.dataset.snd:null);
    let n=t.closest("input,textarea");
    if(n&&(n.tagName==="TEXTAREA"||TEXTY.test(n.type||"text")))return null;   /* psaní do pole je bez zvuku */
    const lab=t.closest("label");if(lab&&!n){const i=lab.control||lab.querySelector("input");if(i&&i.matches("input.switch,input[type=checkbox],input[type=radio]"))n=i}
    if(n&&n.matches("input.switch,input[type=checkbox],input[type=radio]")){if(n.disabled)return null;return "tick"}
    const b=t.closest("button,a[href],summary,select,[role=button],[role=tab],[role=switch],[onclick],.card,.row,.ohit,.tile,.chip,.icon-btn");
    if(b){if(b.disabled||b.getAttribute("aria-disabled")==="true")return null;
      if(b.closest(PRIMARY))return "bloop";
      if(b.closest(NAV))return "pop";
      if(b.matches(LIGHT)||b.closest(LIGHT))return "tick";
      return "tick"}
    /* prvek bez sémantiky, ale s ručkou (klikací div/span, karta leadu…) */
    for(let e=t,i=0;e&&e!==document.body&&i<6;e=e.parentElement,i++){
      if(getComputedStyle(e).cursor==="pointer")return e.closest(NAV)?"pop":"tick"}
    return null;
  }
  document.addEventListener("click",e=>{
    if(!e.isTrusted)return;   /* programové .click() (appka si jimi otevírá dialogy) nehraje */
    const k=kindOf(e.target);if(k)play(k);
  },true);
  const Snd={play,last:null,kindOf,
    get on(){return on},
    set(v){on=!!v;try{localStorage.setItem(KEY,on?"1":"0")}catch(e){}if(on)play("bloop")}};
  window.Snd=Snd;
})();
