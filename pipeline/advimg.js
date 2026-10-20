/* Náhledový obrázek odkazu (1200×630) se jménem poradce – kreslí se tady v prohlížeči přes bezejmenný podklad og/termin.jpg a og/dotaznik.jpg.
   Stejné rozložení jako tools/og-images.mjs (ikona 33 px + jméno v řádku nad oranžovým pruhem). Výsledek se nahraje na prostředníka
   (/adv/publish) a podává se z adresy /t/<kód>, /d/<kód>. Bez jména (nebo když se podklad nenačte) se nekreslí nic. */
(function(){
  const ICON={
    termin:"M8 3v4M16 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M9 15.5l2.2 2.2L15.5 13.2",
    dotaznik:"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14.5l2.2 2.2L15.5 12.2"};
  const W=1200,H=630,ROW_Y=520,SIZE=31.4,ICON_PX=33,GAP=17,MAXW=1000;
  const FONT=s=>`600 ${s}px Inter,"Inter Display",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`;
  const load=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("podklad "+src));i.src=src});
  function draw(cv,base,kind,name){
    cv.width=W;cv.height=H;const c=cv.getContext("2d");c.drawImage(base,0,0,W,H);
    let s=SIZE;c.font=FONT(s);let w=c.measureText(name).width;
    while(ICON_PX+GAP+w>MAXW&&s>18){s-=1;c.font=FONT(s);w=c.measureText(name).width}
    const total=ICON_PX+GAP+w,x0=(W-total)/2;
    c.save();c.translate(x0,ROW_Y-ICON_PX/2);c.scale(ICON_PX/24,ICON_PX/24);c.strokeStyle="#f37520";c.lineWidth=2;c.lineCap="round";c.lineJoin="round";c.stroke(new Path2D(ICON[kind]));c.restore();
    c.fillStyle="#dfdfdf";c.textBaseline="middle";c.textAlign="left";c.fillText(name,x0+ICON_PX+GAP,ROW_Y+1);
    return cv}
  const blob=(cv,q)=>new Promise(res=>cv.toBlob(res,"image/jpeg",q));
  async function b64(b){const u=new Uint8Array(await b.arrayBuffer());let t="";for(let i=0;i<u.length;i+=8192)t+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(t)}
  /* → {termin, dotaznik} (JPEG v base64) */
  async function render(name,base){
    name=String(name||"").replace(/\s+/g," ").trim();if(!name)throw new Error("bez jména");
    const root=base||location.origin+"/og/",out={};
    try{if(document.fonts&&document.fonts.load)await document.fonts.load(FONT(SIZE),name)}catch(e){}
    for(const kind of ["termin","dotaznik"]){
      const img=await load(root+kind+".jpg"),cv=draw(document.createElement("canvas"),img,kind,name);
      let q=.92,b=await blob(cv,q);while(b&&b.size>140000&&q>.6){q-=.08;b=await blob(cv,q)}
      if(!b||b.size>150000)throw new Error("obrázek je příliš velký");out[kind]=await b64(b)}
    return out}
  window.AdvImg={render,draw};
})();
