(() => {
// Throwaway live preview of the editorial-dark redesign. Injected into the running app; touches no source.
const BAYER=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]], NS='http://www.w3.org/2000/svg';
const on=(d,x,y)=>d>(BAYER[y%4][x%4]+.5)/16;
const tile=(d,c)=>{let r='';for(let y=0;y<4;y++)for(let x=0;x<4;x++)if(on(d,x,y))r+=`<rect x='${x*3}' y='${y*3}' width='2' height='2' fill='${c}'/>`;return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='${NS}' width='12' height='12'>${r}</svg>`)}")`;};
const TRACK='#3a3a40';

document.getElementById('pv-style')?.remove(); document.getElementById('pv-toggle')?.remove();
const css=document.createElement('style'); css.id='pv-style'; css.textContent=`
html[data-pv]{
  --color-ink:#0b0b0c; --color-panel:#111113; --color-panel-2:#18181b;
  --color-edge:#232326; --color-edge-bright:#34343a;
  --color-fg:#ededee; --color-muted:#a0a3aa; --color-faint:#6a6e76;
  --color-signal:#2fe6b0; --color-signal-dim:#22b58a; --color-match:#2fe6b0; --color-manual:#2fe6b0;
  --color-tool:oklch(0.8 0.085 292); --color-alt:oklch(0.84 0.1 201);
  --font-display:"Hanken Grotesk Variable","Hanken Grotesk",system-ui,sans-serif;
}
html[data-pv] body{background:#0b0b0c}
html[data-pv] .font-display{font-family:var(--font-display);letter-spacing:-0.02em;font-weight:700}
html[data-pv] .label, html[data-pv] h2.font-display.uppercase{
  font-family:var(--font-mono)!important;font-size:10.5px!important;font-weight:500!important;
  letter-spacing:.14em!important;text-transform:uppercase;color:var(--color-faint)!important}
html[data-pv] .readout{font-family:var(--font-display);font-weight:700;letter-spacing:-0.03em}
html[data-pv="2"] .rounded-lg, html[data-pv="2"] .rounded-xl, html[data-pv="2"] .rounded-md{border-radius:3px!important}
html[data-pv="2"] section.bg-panel, html[data-pv="2"] div.bg-panel{background:transparent!important}
/* dither: metric bars — value dense, headroom sparse, 8px */
html[data-dither] [data-shot="grade"] .h-1\\.5.rounded-full.bg-edge{height:8px!important;border-radius:1px!important;background:${tile(0.28,TRACK)}!important;background-size:12px 12px!important}
html[data-dither] [data-shot="grade"] .h-1\\.5.rounded-full.bg-edge>div{border-radius:0!important;-webkit-mask:${tile(0.9,'#fff')};mask:${tile(0.9,'#fff')};-webkit-mask-size:12px;mask-size:12px}
/* dither: loudest-moment rows become a full-width ranked bar chart */
html[data-dither] [data-shot="deepdive-stealth"] button.grid[class*="grid-cols-[2.6rem_1fr_3.5rem]"]{grid-template-columns:2.6rem 7rem 1fr!important;padding-top:7px!important;padding-bottom:7px!important}
html[data-dither] [data-shot="deepdive-stealth"] button.grid[class*="grid-cols-[2.6rem_1fr_3.5rem]"]>span:last-child{justify-self:stretch!important}
html[data-dither] [data-shot="deepdive-stealth"] .h-1\\.5.w-12.rounded-full.bg-panel-2{width:100%!important;height:8px!important;border-radius:0!important;background:${tile(0.25,TRACK)}!important;background-size:12px 12px!important}
html[data-dither] [data-shot="deepdive-stealth"] .h-1\\.5.w-12.rounded-full.bg-panel-2>div{border-radius:0!important;-webkit-mask:${tile(0.9,'#fff')};mask:${tile(0.9,'#fff')};-webkit-mask-size:12px;mask-size:12px}
.pv-phase{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:5px;width:56px;height:100%}
html[data-dither] [data-shot="phase-audit"] span.rounded-full:not(.h-14),html[data-dither] [data-shot="phase-audit"] button.rounded-full{background:transparent!important;border:1px solid color-mix(in oklch,currentColor 38%,transparent)!important;border-radius:3px!important;font:500 10.5px/1 var(--font-mono)!important;letter-spacing:.1em;text-transform:uppercase;padding:4px 7px!important}
html[data-dither] [data-shot="phase-audit"] summary span.text-match{border:1px solid color-mix(in oklch,var(--color-signal) 45%,transparent);border-radius:3px;padding:4px 7px 4px 6px;gap:5px!important;font:500 10.5px/1 var(--font-mono)!important;letter-spacing:.1em;text-transform:uppercase}
html[data-dither] [data-shot="phase-audit"] summary span.rounded-full:not(.h-14){color:var(--color-muted)!important;border-color:var(--color-edge-bright)!important}
html[data-dither] [data-shot="phase-audit"] summary span.rounded-full:not(.h-14)::first-letter{color:var(--color-fg)}
.pv-phase .n{font:700 22px/1 var(--font-display);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.pv-phase .bar{position:relative;display:block;width:56px;height:6px}
.pv-phase .bar i{position:absolute;inset:0;background:${tile(0.25,TRACK)};background-size:12px}
.pv-phase .bar b{position:absolute;left:0;top:0;bottom:0;-webkit-mask:${tile(0.9,'#fff')};mask:${tile(0.9,'#fff')};-webkit-mask-size:12px;mask-size:12px}
.pv-meta{display:inline-flex;align-items:center;gap:10px;font:500 10.5px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase}
.pv-meta .m{color:var(--color-muted)} .pv-meta .f{color:var(--color-faint)}
.pv-meta .sep{width:1px;height:11px;background:var(--color-edge-bright)}
.pv-diff{display:inline-flex;align-items:center;gap:7px}
.pv-diff .pips{display:inline-flex;gap:2px}
.pv-diff .pips i{width:6px;height:10px;background:${tile(0.25,TRACK)};background-size:12px}
.pv-diff .pips i.on{background-image:none;-webkit-mask:${tile(0.9,'#fff')};mask:${tile(0.9,'#fff')};-webkit-mask-size:12px;mask-size:12px}
html[data-dither] header button.rounded-full, html[data-dither] header .rounded-full:not(.h-2):not(.w-2):not([class*="h-1"]){border-radius:3px!important}
button.pv-btn{background:transparent!important;border:1px solid color-mix(in oklch,var(--color-signal) 45%,transparent)!important;border-radius:3px!important;padding:6px 11px!important}
button.pv-btn:hover{border-color:var(--color-signal)!important;background:color-mix(in oklch,var(--color-signal) 6%,transparent)!important}
.pv-setup{display:inline-flex;align-items:center;gap:8px;font:500 10.5px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-signal)}
.pv-setup .lamp{width:8px;height:8px;background:var(--color-signal);-webkit-mask:${tile(0.9,'#fff')};mask:${tile(0.9,'#fff')};-webkit-mask-size:12px;mask-size:12px;animation:pvlamp 1.8s ease-in-out infinite}
.pv-setup .arr{font-family:var(--font-sans);letter-spacing:0;transition:transform .2s}
button.pv-btn:hover .arr{transform:translateX(2px)}
@keyframes pvlamp{50%{opacity:.35}}
[data-shot="verdict"] .rounded-lg:has(>.pv-level){padding-bottom:22px!important}
.pv-level{position:absolute;left:0;right:0;bottom:0;height:8px;pointer-events:none}
.pv-level i{position:absolute;inset:0;background:${tile(0.25,TRACK)};background-size:12px}
.pv-level b{position:absolute;left:0;top:0;bottom:0;-webkit-mask:${tile(0.9,'#fff')};mask:${tile(0.9,'#fff')};-webkit-mask-size:12px;mask-size:12px}
#pv-toggle{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;gap:2px;padding:3px;background:#000;border:1px solid #333;border-radius:8px;font:600 12px/1 system-ui}
#pv-toggle button{all:unset;cursor:pointer;padding:8px 12px;border-radius:6px;color:#999}
#pv-toggle button[aria-pressed=true]{background:#2fe6b0;color:#000}
`; document.head.appendChild(css);

// ---- SVG patterns: tile size fixed in SCREEN px (scaled by inverse CTM) ----
const defsOf=svg=>{let d=svg.querySelector(':scope>defs.pv');if(!d){d=document.createElementNS(NS,'defs');d.classList.add('pv');svg.prepend(d);}return d;};
const uid=()=>'pv'+Math.random().toString(36).slice(2,9);
function pattern(svg,color,densityAtRow,rows){
  const m=svg.getScreenCTM(); const kx=m?1/Math.abs(m.a||1):1, ky=m?1/Math.abs(m.d||1):1;
  const p=document.createElementNS(NS,'pattern'),id=uid(); rows=rows||4;
  p.id=id; p.setAttribute('patternUnits','userSpaceOnUse'); p.setAttribute('width',12*kx); p.setAttribute('height',rows*3*ky);
  for(let j=0;j<rows;j++){const d=densityAtRow(j,rows);for(let i=0;i<4;i++)if(on(d,i,j)){const r=document.createElementNS(NS,'rect');r.setAttribute('x',i*3*kx);r.setAttribute('y',j*3*ky);r.setAttribute('width',2*kx);r.setAttribute('height',2*ky);r.setAttribute('fill',color);p.appendChild(r);}}
  defsOf(svg).appendChild(p); return `url(#${id})`;
}
const flat=(svg,c,d)=>pattern(svg,c,()=>d,4);
function paint(el,prop,val,extra){if(el.dataset.pvs)return;el.dataset.pvs=JSON.stringify({[prop]:el.style[prop],sw:el.style.strokeWidth,fo:el.style.fillOpacity});el.style[prop]=val;if(extra)Object.assign(el.style,extra);}
const cs=(el,p)=>getComputedStyle(el)[p];
function applySVG(){
  applyPhase(); applyPhaseEmpty();
  document.querySelectorAll('[data-shot="deepdive-stealth"] svg').forEach(svg=>{
    const area=[...svg.querySelectorAll('path')].find(p=>(p.getAttribute('fill')||'').includes('--color-loud'));
    if(!area||area.dataset.pvs)return; const vb=svg.viewBox.baseVal, H=vb&&vb.height?vb.height:svg.getBBox().height;
    const m=svg.getScreenCTM(), rows=Math.ceil(H/(3/Math.abs(m.d)));
    paint(area,'fill',pattern(svg,'oklch(0.7 0.16 30)',(j,n)=>0.9-0.72*(j/(n-1)),rows),{fillOpacity:1}); // chart-anchored: near budget = dense
  });
}
function clearSVG(){document.querySelectorAll('[data-pvs]').forEach(el=>{const o=JSON.parse(el.dataset.pvs);for(const k in o){if(k==='sw')el.style.strokeWidth=o.sw||'';else if(k==='fo')el.style.fillOpacity=o.fo||'';else el.style[k]=o[k]||'';}delete el.dataset.pvs;});document.querySelectorAll('defs.pv').forEach(d=>d.remove());}

// ---- phase audit: ring -> big number + dithered level bar ----
function applyPhase(){document.querySelectorAll('[data-shot="phase-audit"] svg').forEach(svg=>{
  if(svg.dataset.pvHidden||!svg.querySelector('circle'))return;
  const arc=[...svg.querySelectorAll('circle')].find(c=>!(c.getAttribute('stroke')||'').includes('--color-edge'));
  const txt=(svg.parentElement.textContent.match(/\d+/)||svg.textContent.match(/\d+/)||[null])[0];
  const v=txt==null?null:Math.min(100,+txt), color=arc?cs(arc,'stroke'):'var(--color-faint)';
  svg.dataset.pvHidden=1; const host=svg.parentElement; host.dataset.pvHost=host.getAttribute('style')||'';
  [...host.children].forEach(ch=>{ch.dataset.pvDisp=ch.style.display||'';ch.style.display='none';});
  const w=document.createElement('div');w.className='pv-phase';
  w.innerHTML=v==null?`<span class="n" style="color:var(--color-faint)">—</span><span class="bar"><i></i></span>`:`<span class="n" style="color:${color}">${v}</span><span class="bar"><i></i><b style="width:${v}%;background:${color}"></b></span>`;
  host.appendChild(w);});}
// the "General" phase has no score: an HTML disc with "*" — swap it for the same empty meter (clearPhase restores it)
function applyPhaseEmpty(){document.querySelectorAll('[data-shot="phase-audit"] summary>span.h-14.w-14').forEach(d=>{if(d.dataset.pvDisp!=null)return;
  d.dataset.pvDisp=d.style.display||'';d.style.display='none';const w=document.createElement('div');w.className='pv-phase';w.innerHTML='<span class="n" style="color:var(--color-faint)">—</span><span class="bar"><i></i></span>';d.after(w);});}
function clearPhase(){document.querySelectorAll('.pv-phase').forEach(w=>{const host=w.parentElement;w.remove();[...host.children].forEach(ch=>{ch.style.display=ch.dataset.pvDisp||'';delete ch.dataset.pvDisp;});host.querySelectorAll('[data-pv-hidden]').forEach(s=>delete s.dataset.pvHidden);});}

// ---- identity chips -> metadata line with a dithered difficulty meter ----
const LEVEL={easy:1,medium:2,hard:3,insane:4};
function applyMeta(){document.querySelectorAll('[data-shot="verdict"] .flex.flex-wrap.items-center').forEach(row=>{
  if(row.dataset.pvMeta)return; const pills=[...row.children].filter(c=>c.tagName==='SPAN'); if(!pills.length||!pills.every(p=>p.classList.contains('label')))return;
  row.dataset.pvMeta=1; const parts=[];
  pills.forEach((p,i)=>{p.dataset.pvDisp=p.style.display||'';p.style.display='none';const t=p.textContent.trim(),lv=LEVEL[t.toLowerCase()];
    if(lv){const c=p.style.color||getComputedStyle(p).color;parts.push(`<span class="pv-diff"><span class="pips">${[1,2,3,4].map(n=>`<i class="${n<=lv?'on':''}" style="${n<=lv?`background:${c}`:''}"></i>`).join('')}</span><span style="color:${c}">${t}</span></span>`);}
    else parts.push(`<span class="${/retired|local/i.test(t)?'f':'m'}">${t}</span>`);});
  const m=document.createElement('span');m.className='pv-meta';m.innerHTML=parts.join('<span class="sep"></span>');row.appendChild(m);});}
function clearMeta(){document.querySelectorAll('.pv-meta').forEach(m=>{const row=m.parentElement;m.remove();[...row.children].forEach(c=>{c.style.display=c.dataset.pvDisp||'';delete c.dataset.pvDisp;});delete row.dataset.pvMeta;});}

// ---- Finish setup -> flat instrument button with a dithered lamp ----
function applySetup(){const b=document.querySelector('button[title^="Finish setup"]');if(!b||b.dataset.pvBtn)return;b.dataset.pvBtn=1;
  [...b.childNodes].forEach(n=>{if(n.nodeType===3){n.pvText=n.textContent;n.textContent='';}else{n.dataset.pvDisp=n.style.display||'';n.style.display='none';}});
  const s=document.createElement('span');s.className='pv-setup';s.innerHTML='<i class="lamp"></i><span>Finish setup</span><span class="arr">→</span>';b.appendChild(s);b.classList.add('pv-btn');}
function clearSetup(){const b=document.querySelector('button[data-pv-btn]');if(!b)return;b.querySelector('.pv-setup')?.remove();b.classList.remove('pv-btn');[...b.childNodes].forEach(n=>{if(n.nodeType===3&&n.pvText!=null)n.textContent=n.pvText;else if(n.dataset){n.style.display=n.dataset.pvDisp||'';delete n.dataset.pvDisp;}});delete b.dataset.pvBtn;}

// ---- KPI tiles: dithered level bar sized to the value ----
function applyTiles(){document.querySelectorAll('[data-shot="verdict"] .rounded-lg').forEach(t=>{if(t.querySelector('.pv-level'))return;const m=t.textContent.match(/(\d+(?:\.\d+)?)\s*\/\s*100/);if(!m)return;
  let big=null,fs=0;t.querySelectorAll('*').forEach(e=>{const f=parseFloat(getComputedStyle(e).fontSize);if(f>fs&&!e.childElementCount&&e.textContent.trim()){fs=f;big=e;}});
  t.style.position='relative';t.style.overflow='hidden';const L=document.createElement('div');L.className='pv-level';L.innerHTML=`<i></i><b style="width:${Math.min(100,+m[1])}%;background:${getComputedStyle(big).color}"></b>`;t.appendChild(L);});}
const clearTiles=()=>document.querySelectorAll('.pv-level').forEach(e=>e.remove());

// ---- ASCII fields: header margins + empty states only ----
function mountAscii(host,{inset,mask,alpha}){if(host.querySelector(':scope>canvas.pv-ascii'))return;if(getComputedStyle(host).position==='static')host.style.position='relative';
  const c=document.createElement('canvas');c.className='pv-ascii';Object.assign(c.style,{position:'absolute',pointerEvents:'none',zIndex:0},inset);host.prepend(c);
  [...host.children].forEach(ch=>{if(ch!==c&&getComputedStyle(ch).position==='static'){ch.style.position='relative';ch.style.zIndex=1;}});
  const ctx=c.getContext('2d'),RAMP=[' ','·','.',':','-','+','=','o','x','*','#','%','@'],CELL=14,dpr=Math.min(2,devicePixelRatio||1),t0=performance.now();let W=0,H=0,last=0;
  const rs=()=>{const r=c.getBoundingClientRect();W=r.width;H=r.height;c.width=W*dpr;c.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.font='12px "Spline Sans Mono Variable",monospace';ctx.textBaseline='top';};
  const field=(nx,ny,t)=>{const x=nx*9,y=ny*5;let v=Math.sin(x+t)+Math.sin(y*1.3-t*.7)+Math.sin((x+y)*.8+t*.5)+Math.sin(Math.hypot(x-4.5,y-2)*1.6-t);v=.5+.5*v/4;return Math.max(0,Math.min(1,v))**1.3;};
  const draw=now=>{if(!c.isConnected)return;if(now-last>38){last=now;if(c.clientWidth!==W)rs();const t=(now-t0)/1000*.45;ctx.clearRect(0,0,W,H);
    for(let j=0;j*CELL<H;j++)for(let i=0;i*CELL<W;i++){const nx=i*CELL/W,ny=j*CELL/H,mk=mask(nx,ny);if(mk<=0)continue;const v=field(nx,ny,t),a=v*mk;if(a<.05)continue;const ch=RAMP[Math.min(12,Math.floor(v*13))];if(ch===' ')continue;const al=Math.min(alpha,a*.5);
      ctx.fillStyle=v>.8?`rgba(47,230,176,${al})`:`rgba(237,237,238,${al*.5})`;ctx.fillText(ch,i*CELL,j*CELL);}}requestAnimationFrame(draw);};
  rs();requestAnimationFrame(draw);}
function applyAscii(){
  const v=document.querySelector('[data-shot="verdict"]');
  if(v)mountAscii(v,{inset:{left:'-40vw',width:'calc(100% + 80vw)',top:'-70px',height:'calc(100% + 100px)'},alpha:.34,mask:(nx,ny)=>{const s=Math.abs(nx-.5)*2;return s<.42?0:((s-.42)/.58)**1.2*(1-ny*.9);}});
  [...document.querySelectorAll('#root div')].filter(d=>/^Not enough runs yet|^No (runs|sessions)/.test(d.firstElementChild?.textContent?.trim()||'')&&d.getBoundingClientRect().height>60)
    .forEach(box=>mountAscii(box,{inset:{inset:'0'},alpha:.22,mask:(nx,ny)=>{const r=Math.hypot((nx-.5)*2.2,(ny-.5)*3.2);return r<1.1?0:Math.min(1,(r-1.1)*1.4);}}));
}
const clearAscii=()=>document.querySelectorAll('canvas.pv-ascii').forEach(c=>c.remove());

// ---- toggle ----
let iv=null; const bar=document.createElement('div'); bar.id='pv-toggle'; document.body.appendChild(bar);
function set(m){const root=document.documentElement; if(!m)delete root.dataset.pv; else root.dataset.pv=(m==='3'||m==='4')?'2':m;
  clearInterval(iv); window.__pvHier?.clear(); clearPhase(); clearMeta(); clearSetup(); clearSVG(); clearTiles(); clearAscii(); delete root.dataset.dither; delete root.dataset.hier;
  if(m==='3'||m==='4'){root.dataset.dither='';if(m==='4')root.dataset.hier='';const run=()=>{applySVG();applyTiles();applyMeta();applySetup();applyAscii();if(m==='4')window.__pvHier?.apply();};run();iv=setInterval(run,700);}
  bar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m));}
[['','Current'],['1','New tokens + type'],['2','+ flat surfaces'],['3','+ dither'],['4','+ hierarchy']].forEach(([m,l])=>{const b=document.createElement('button');b.dataset.m=m;b.textContent=l;b.onclick=()=>set(m);bar.appendChild(b);});
window.__pv={set}; set(window.__pvHier?'4':'3');
})();
'preview ready'
