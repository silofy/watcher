(() => {
// Throwaway preview, part 2: content hierarchy. (1) Ghost sentences -> pivot strip. (2) Lesson as hero,
// numbered sections each led by one figure. Reads the live zustand store; touches no source.
const BAYER=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]], NS='http://www.w3.org/2000/svg';
const on=(d,x,y)=>d>(BAYER[y%4][x%4]+.5)/16;
const tile=(d,c)=>{let r='';for(let y=0;y<4;y++)for(let x=0;x<4;x++)if(on(d,x,y))r+=`<rect x='${x*3}' y='${y*3}' width='2' height='2' fill='${c}'/>`;return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='${NS}' width='12' height='12'>${r}</svg>`)}")`;};
const MASK=tile(0.9,'#fff'), TRACK=tile(0.25,'#3a3a40');
let STORE=null; import(location.origin+'/src/store/report.ts').then(m=>{STORE=m.useReport;});
const report=()=>STORE?.getState().report;

document.getElementById('pv-hier-css')?.remove();
const st=document.createElement('style'); st.id='pv-hier-css'; st.textContent=`
/* ---------- 2. numbered sections + lead figure ---------- */
html[data-hier] main h2[data-num]::before{content:attr(data-num);color:var(--color-signal);margin-right:12px}
.pv-lead{display:flex;align-items:baseline;gap:12px;margin:2px 0 14px}
.pv-lead .big{font:700 40px/1 var(--font-display);letter-spacing:-.035em;color:var(--color-fg);font-variant-numeric:tabular-nums}
.pv-lead .big small{font-size:.5em;color:var(--color-muted);letter-spacing:-.01em;margin-left:2px}
.pv-lead .cap{font:500 13px/1.3 var(--font-sans);color:var(--color-muted)}
html[data-hier] main section + section{margin-top:28px}

/* ---------- 2. lesson as hero ---------- */
html[data-hier] [data-shot="one-lesson"]{background:transparent!important;border:0!important;border-top:1px solid var(--color-edge)!important;border-bottom:1px solid var(--color-edge)!important;border-radius:0!important;padding:28px 0 26px!important}
.pv-hero{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:40px;align-items:end;text-align:left}
.pv-hero .eyebrow{font:500 10.5px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-signal)}
.pv-hero h3{margin:12px 0 0;font:700 34px/1.08 var(--font-display);letter-spacing:-.03em;color:var(--color-fg);text-wrap:balance}
.pv-hero h3 em{font-style:normal;color:var(--color-loud)}
.pv-hero .jump{display:inline-block;margin-top:14px;font:500 10.5px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-signal)}
.pv-fig .nums{display:flex;align-items:baseline;justify-content:space-between;font:500 10.5px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--color-faint)}
.pv-fig .nums b{display:block;margin-top:6px;font:700 30px/1 var(--font-display);letter-spacing:-.03em;color:var(--color-fg)}
.pv-fig .nums .late b{color:var(--color-loud)}
.pv-fig .cells{display:grid;gap:2px;margin-top:12px;height:14px}
.pv-fig .cells i{background:${TRACK};background-size:12px}
.pv-fig .cells i.gap{background:var(--color-loud);-webkit-mask:${MASK};mask:${MASK};-webkit-mask-size:12px;mask-size:12px}
.pv-fig .cells i.pt{background:var(--color-signal)}
.pv-fig .cells i.pt.late{background:var(--color-loud)}
.pv-fig .foot{margin-top:8px;font:500 12px/1.3 var(--font-sans);color:var(--color-muted)}

/* ---------- 1. ghost pivot strip ---------- */
.pv-ghost{display:flex;flex-direction:column;gap:18px}
.pv-ghost .head{font:600 17px/1.35 var(--font-sans);color:var(--color-fg);max-width:60ch}
.pv-ghost .head em{font-style:normal;color:var(--color-loud)}
.pv-tally{display:flex;height:10px;gap:2px}
.pv-tally i{-webkit-mask:${MASK};mask:${MASK};-webkit-mask-size:12px;mask-size:12px}
.pv-tally-key{display:flex;flex-wrap:wrap;gap:18px;margin-top:8px;font:500 10.5px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--color-faint)}
.pv-tally-key b{color:var(--color-fg);font-weight:600;margin-right:5px}
.pv-tally-key span::before{content:"";display:inline-block;width:8px;height:8px;margin-right:7px;background:var(--k);vertical-align:-1px}
.pv-strip{position:relative}
.pv-strip svg{display:block;width:100%;overflow:visible}
.pv-strip .row{cursor:pointer}
.pv-strip .row .hl{transition:fill .15s}
.pv-strip .row:hover .hl,.pv-strip .row.on .hl{fill:var(--color-panel-2)}
.pv-strip .row .acc{opacity:0}
.pv-strip .row:hover .acc,.pv-strip .row.on .acc{opacity:1}
.pv-strip text{font-family:var(--font-sans);font-size:13px}
.pv-strip text.ax{font-family:var(--font-mono);font-size:10.5px}
/* ---------- 3. self-describing subtitles off ---------- */
html[data-hier] main section>header span.text-xs.text-faint,
html[data-hier] main details>summary span.text-xs.text-faint{display:none}

/* ---------- 01. route bar + change list ---------- */
.pv-path{display:flex;flex-direction:column;gap:22px}
.pv-route .cells{display:grid;gap:3px;height:22px}
.pv-route .cells i{position:relative;cursor:default;-webkit-mask:${MASK};mask:${MASK};-webkit-mask-size:12px;mask-size:12px}
.pv-route .cells i.skipped{-webkit-mask:${tile(0.3,'#fff')};mask:${tile(0.3,'#fff')};-webkit-mask-size:12px;mask-size:12px;outline:1px dashed var(--color-skipped);outline-offset:-1px}
.pv-route .ends{display:flex;justify-content:space-between;margin-top:7px;font:500 10.5px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--color-faint)}
.pv-change .eyebrow{font:500 10.5px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-faint);margin-bottom:10px}
.pv-change .row{display:grid;grid-template-columns:110px minmax(0,1fr) auto;align-items:center;gap:16px;padding:12px 0;border-top:1px solid var(--color-edge)}
.pv-change .row:last-child{border-bottom:1px solid var(--color-edge)}
.pv-change .tag{justify-self:start;font:500 10.5px/1 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;padding:4px 7px;border:1px solid color-mix(in oklch,currentColor 40%,transparent);border-radius:3px}
.pv-change .obj{font:600 15px/1.3 var(--font-sans);color:var(--color-fg)}
.pv-change .fix{font:500 13px/1 var(--font-sans);color:var(--color-muted)}
.pv-change .fix code{font:500 13px/1 var(--font-mono);color:var(--color-signal);margin-left:6px}
.pv-change .none{font:600 15px/1.3 var(--font-sans);color:var(--color-signal);padding:12px 0;border-top:1px solid var(--color-edge);border-bottom:1px solid var(--color-edge)}
.pv-maptoggle{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:44px;font:500 11.5px/1 var(--font-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted);border:1px solid var(--color-edge-bright);border-radius:3px;transition:color .2s,border-color .2s,background-color .2s}
.pv-maptoggle:hover{color:var(--color-fg);border-color:var(--color-muted);background:var(--color-panel)}
.pv-maptoggle:focus-visible{outline:2px solid var(--color-signal);outline-offset:2px}
/* ---------- 02. phase rows: sentence -> stat cells ---------- */
.pv-prow{display:flex!important;align-items:center;justify-content:space-between;gap:24px}
.pv-pstats{display:flex;gap:28px;margin-right:8px}
.pv-pstats div{display:flex;flex-direction:column;align-items:flex-end;gap:5px;min-width:64px}
.pv-pstats span{font:500 10px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-faint)}
.pv-pstats b{font:700 18px/1 var(--font-display);letter-spacing:-.02em;color:var(--color-fg);font-variant-numeric:tabular-nums}
.pv-pstats b small{font-size:.72em;color:var(--color-muted);font-weight:600}
.pv-pstats b.loss{color:var(--color-loud)} .pv-pstats b.zero{color:var(--color-muted)}
html[data-hier] section[data-shot="phase-audit"] details>summary>div.shrink-0{min-width:140px;justify-content:flex-end}
.pv-pnote{font:500 10px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-faint)}
.pv-tip{position:absolute;z-index:5;width:300px;transform:translateY(-50%);pointer-events:none;opacity:0;transition:opacity .12s;
  background:var(--color-panel-2);border:1px solid var(--color-edge-bright);border-radius:3px;padding:11px 13px;box-shadow:0 10px 30px rgba(0,0,0,.55)}
.pv-tip.show{opacity:1}
.pv-tip .tag{display:inline-block;font:500 10px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;padding:3px 6px;border:1px solid color-mix(in oklch,currentColor 45%,transparent);border-radius:3px}
.pv-tip b{display:block;margin-top:8px;font:600 15px/1.25 var(--font-sans);color:var(--color-fg)}
.pv-tip p{margin:4px 0 0;font:500 13px/1.4 var(--font-sans);color:var(--color-muted)}
.pv-tip i{display:block;margin-top:9px;font:500 10px/1 var(--font-mono);font-style:normal;letter-spacing:.14em;text-transform:uppercase;color:var(--color-signal)}
.pv-caption{min-height:18px;font:500 12.5px/1.4 var(--font-sans);color:var(--color-muted)}
.pv-caption b{color:var(--color-fg);font-weight:600}
`; document.head.appendChild(st);

const hidden=[];
function hide(el){if(el.dataset.pvhDisp!=null)return;el.dataset.pvhDisp=el.style.display||'';el.style.display='none';hidden.push(el);}
const V={ahead:{c:'var(--color-signal)',l:'Ahead'},off_path_win:{c:'var(--color-alt)',l:'Off-path win'},on_time:{c:'var(--color-muted)',l:'On time'},late_pivot:{c:'var(--color-loud)',l:'Late pivot'},skipped:{c:'var(--color-skipped)',l:'Skipped'}};
const ORDER=['ahead','off_path_win','on_time','late_pivot','skipped'];
const mins=ms=>Math.round(ms/60000);
const human=id=>{const t=String(id).replace(/[_-]+/g,' ').trim();return t.charAt(0).toUpperCase()+t.slice(1);};

// ---------- 2a. lesson hero ----------
function applyLesson(){
  const b=document.querySelector('[data-shot="one-lesson"]'); if(!b||b.querySelector('.pv-hero'))return;
  const p=b.querySelector('p'); const txt=p?.textContent.trim()||''; const m=txt.match(/step (\d+).*?step (\d+)/i);
  const total=report()?.episodes?.length||0;
  [...b.children].forEach(hide);
  const w=document.createElement('div'); w.className='pv-hero';
  let fig='';
  if(m&&total){const a=+m[1],z=+m[2],cells=[];for(let i=1;i<=total;i++)cells.push(`<i class="${i===a?'pt':i===z?'pt late':(i>a&&i<z)?'gap':''}"></i>`);
    fig=`<div class="pv-fig"><div class="nums"><span>Unlocked<b>Step ${a}</b></span><span class="late" style="text-align:right">You acted<b>Step ${z}</b></span></div>
      <div class="cells" style="grid-template-columns:repeat(${total},1fr)">${cells.join('')}</div><div class="foot">${z-a} steps where the next move was already on the table</div></div>`;}
  // sentence: keep the model's words, but drop the em-dash tail and let the numbers carry it
  const lead=m?`The way forward opened at step ${m[1]}. <em>You took it at step ${m[2]}.</em>`:txt;
  const seq=m?+m[2]:null;
  w.innerHTML=`<div><span class="eyebrow">The one lesson</span><h3>${lead}</h3>${seq?`<span class="jump">Replay step ${seq} →</span>`:''}</div>${fig}`;
  b.appendChild(w);
}

// ---------- 2b. numbered sections + one lead figure ----------
function leadFor(shot,sec){
  const r=report();
  if(shot==='path'){const t=sec.textContent.match(/followed\s+(\d+)%/i);return t&&{big:`${t[1]}<small>%</small>`,cap:"of the write-up's path followed"};}
  if(shot==='phase-audit'){const ns=[...sec.querySelectorAll('summary .pv-phase .n')].map(n=>n.textContent.trim()).filter(t=>/^\d+$/.test(t));if(!ns.length)return null;const full=ns.filter(n=>+n===100).length;return {big:`${full}<small>/${ns.length}</small>`,cap:'phases at full efficiency'};}
  if(shot==='ghost'){const g=r?.ghost;if(!g)return null;return {big:`${mins(g.time_lost_ms||0)}<small> min</small>`,cap:`lost to late pivots${g.human_wins?` · you beat the optimal line ${g.human_wins}×`:''}`};}
  if(shot==='grade'){const lbl=[...sec.querySelectorAll('*')].find(e=>/^weighted total$/i.test(e.textContent.trim()));const tot=lbl?.parentElement?.textContent.match(/(\d+(?:\.\d+)?)\s*$/)?.[1];const letter=sec.querySelector('svg text[font-size="34"]')?.textContent.trim();return (tot||letter)&&{big:`${letter||''}${tot?`<small> · ${tot}</small>`:''}`,cap:'weighted across seven rubric metrics'};}
  return null;
}
function applySections(){
  const secs=[...document.querySelectorAll('main section')].filter(s=>s.querySelector(':scope>header h2'));
  const top=secs.filter(s=>['path','phase-audit','ghost','grade'].includes(s.dataset.shot||s.querySelector('[data-shot]')?.dataset.shot));
  top.forEach((s,i)=>{const h=s.querySelector(':scope>header h2');h.dataset.num=String(i+1).padStart(2,'0');
    const shot=s.dataset.shot||s.querySelector('[data-shot]').dataset.shot; const hdr=s.querySelector(':scope>header');
    if(hdr.nextElementSibling?.classList.contains('pv-lead'))return; const L=leadFor(shot,s); if(!L)return;
    if(shot==='path'){const f=[...s.querySelectorAll('*')].find(e=>/^You followed \d+%/.test(e.textContent.trim())&&e.childElementCount<=2);if(f){hide(f);const sub=f.nextElementSibling;if(sub&&/objectives reached/.test(sub.textContent))hide(sub);}}
    const d=document.createElement('div');d.className='pv-lead';d.innerHTML=`<span class="big">${L.big}</span><span class="cap">${L.cap}</span>`;hdr.after(d);});
}

// ---------- 01. route bar + change list (replaces the summary box; node map collapsed) ----------
const PS={match:{c:'var(--color-match)',l:'Matched'},alternative:{c:'var(--color-alt)',l:'Alt method'},out_of_order:{c:'var(--color-stuck)',l:'Out of order'},skipped:{c:'var(--color-skipped)',l:'Skipped'}};
function applyPath(){
  const sec=document.querySelector('section[data-shot="path"]'); const r=report(); if(!sec||!r?.golden_dag?.length||sec.querySelector('.pv-path'))return;
  const body=sec.querySelector(':scope>header').parentElement.lastElementChild; // Section's content wrapper (pt-3)
  if(!body)return; const ep=new Map(r.episodes.map(e=>[e.seq,e]));
  const rows=r.golden_dag.map(o=>{const seq=o.user_satisfied_by_seq??null;return {o,seq,st:seq==null?'skipped':(ep.get(seq)?.alignment??'match')};})
    .map(x=>({...x,st:PS[x.st]?x.st:'match'}));
  const counts={};rows.forEach(x=>counts[x.st]=(counts[x.st]||0)+1);
  const kids=[...body.children]; kids.forEach(hide);
  const cells=rows.map(x=>`<i class="${x.st}" style="background:${PS[x.st].c}" title="${human(x.o.objective)} · ${PS[x.st].l}${x.seq?` · step ${x.seq}`:''}"></i>`).join('');
  const key=['match','alternative','out_of_order','skipped'].filter(k=>counts[k]).map(k=>`<span style="--k:${PS[k].c}"><b>${counts[k]}</b>${PS[k].l}</span>`).join('');
  const dev=rows.filter(x=>x.st!=='match');
  const fix=x=>x.st==='skipped'?`Try<code>${(x.o.satisfied_by[0]||'').replace(/</g,'&lt;')}</code>`:x.st==='out_of_order'?`Done at step ${x.seq}, earlier than the write-up's order`:`Done at step ${x.seq} with <code>${(ep.get(x.seq)?.binary||'another tool').replace(/</g,'&lt;')}</code>`;
  const list=dev.length?dev.map(x=>`<div class="row"><span class="tag" style="color:${PS[x.st].c}">${PS[x.st].l}</span><span class="obj">${human(x.o.objective)}</span><span class="fix">${fix(x)}</span></div>`).join(''):`<div class="none">You followed the intended path. Nothing to change.</div>`;
  const w=document.createElement('div'); w.className='pv-path';
  w.innerHTML=`<div class="pv-route"><div class="cells" style="grid-template-columns:repeat(${rows.length},1fr)">${cells}</div>
      <div class="ends"><span>Write-up step 1</span><span>Step ${rows.length}</span></div><div class="pv-tally-key">${key}</div></div>
    <div class="pv-change"><div class="eyebrow">Change next time</div>${list}</div>
    <button type="button" class="pv-maptoggle">Show full path map ↓</button>`;
  body.appendChild(w);
  // the map (react-flow) is the last big child; let the user bring it back on demand
  const map=kids.filter(k=>k.querySelector?.('.react-flow')||k.classList.contains('react-flow')); const extra=kids.filter(k=>!map.includes(k)&&k!==kids[0]);
  const btn=w.querySelector('.pv-maptoggle'); let open=false;
  btn.onclick=()=>{open=!open;[...map,...extra].forEach(k=>k.style.display=open?(k.dataset.pvhDisp||''):'none');btn.textContent=open?'Hide path map ↑':'Show full path map ↓';};
}

// ---------- 02. phase rows: the summary sentence becomes two stat cells ----------
function applyPhaseRows(){
  document.querySelectorAll('section[data-shot="phase-audit"] details>summary').forEach(sum=>{
    const box=[...sum.children].find(c=>c.classList.contains('flex-1')); if(!box||box.classList.contains('pv-prow'))return;
    const line=box.querySelector(':scope>div'); if(!line)return; const t=line.textContent.trim();
    const cov=t.match(/(\d+) of (\d+) objectives? reached/i), lost=t.match(/([\dhms ]+?) lost/i);
    hide(line); box.classList.add('pv-prow'); const el=document.createElement('div');
    if(cov||lost||/no time wasted/i.test(t)){
      el.className='pv-pstats';
      el.innerHTML=(cov?`<div><span>Objectives</span><b>${cov[1]}<small>/${cov[2]}</small></b></div>`:'')+
        `<div><span>Time lost</span><b class="${lost?'loss':'zero'}">${lost?lost[1].trim():'0m'}</b></div>`;
    } else { el.className='pv-pnote'; el.textContent=t.split(/\s[—-]\s/)[0]; }
    box.appendChild(el);});
}
function clearPhaseRows(){document.querySelectorAll('.pv-pstats,.pv-pnote').forEach(e=>e.remove());document.querySelectorAll('.pv-prow').forEach(b=>b.classList.remove('pv-prow'));}

// ---------- grade letter carries its grade colour ----------
function gradeColour(){const lead=document.querySelector('section[data-shot="grade"] .pv-lead .big');const t=document.querySelector('section[data-shot="grade"] svg text[font-size="34"]');
  if(lead&&t&&!lead.dataset.col){lead.style.color=getComputedStyle(t).fill;lead.dataset.col=1;}}

// ---------- 1. ghost pivot strip ----------
function applyGhost(){
  const host=document.querySelector('[data-shot="ghost"]'); const r=report(); if(!host||!r?.ghost?.items?.length||host.querySelector('.pv-ghost'))return;
  const items=r.ghost.items, total=r.episodes.length;
  [...host.children].forEach(hide);
  const counts={};items.forEach(it=>counts[it.verdict]=(counts[it.verdict]||0)+1);
  const late=items.filter(i=>i.verdict==='late_pivot');
  const unl={};late.forEach(i=>unl[i.unlock_seq]=(unl[i.unlock_seq]||0)+1);
  const modeU=+Object.entries(unl).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const lastActed=Math.max(...late.map(i=>i.actual_seq||0));
  const head=late.length?`${unl[modeU]} of ${items.length} objectives were reachable from <em>step ${modeU}</em>. You worked through them one at a time until step ${lastActed}.`:`You stayed on the optimal line.`;
  const w=document.createElement('div'); w.className='pv-ghost';
  const tally=ORDER.filter(k=>counts[k]).map(k=>`<i style="flex:${counts[k]};background:${V[k].c}"></i>`).join('');
  const key=ORDER.filter(k=>counts[k]).map(k=>`<span style="--k:${V[k].c}"><b>${counts[k]}</b>${V[k].l}</span>`).join('');
  w.innerHTML=`<div class="head">${head}</div><div><div class="pv-tally">${tally}</div><div class="pv-tally-key">${key}</div></div><div class="pv-strip"></div>`;
  host.appendChild(w);
  drawStrip(w.querySelector('.pv-strip'),items,total);
}
function drawStrip(el,items,total){
  const W=el.clientWidth||900, LBL=200, RH=26, top=24, H=top+items.length*RH+4, x=s=>LBL+(s-0.5)/total*(W-LBL-10);
  const rows=[...items].map((it,i)=>({...it,i})).sort((a,b)=>(a.actual_seq??99)-(b.actual_seq??99)||(a.unlock_seq??0)-(b.unlock_seq??0));
  let s=`<svg xmlns="${NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
    <pattern id="pvh-late" patternUnits="userSpaceOnUse" width="12" height="12">${[...Array(16)].map((_,k)=>{const xx=k%4,yy=k>>2;return on(0.9,xx,yy)?`<rect x="${xx*3}" y="${yy*3}" width="2" height="2" style="fill:var(--color-loud)"/>`:''}).join('')}</pattern>
    <pattern id="pvh-skip" patternUnits="userSpaceOnUse" width="12" height="12">${[...Array(16)].map((_,k)=>{const xx=k%4,yy=k>>2;return on(0.3,xx,yy)?`<rect x="${xx*3}" y="${yy*3}" width="2" height="2" style="fill:var(--color-skipped)"/>`:''}).join('')}</pattern></defs>`;
  // step axis: ticks every 5
  for(let t=1;t<=total;t++){if(t===1||t%5===0){s+=`<line x1="${x(t)}" x2="${x(t)}" y1="${top-6}" y2="${H}" style="stroke:var(--color-edge)" stroke-width="1"/><text x="${x(t)}" y="${top-10}" text-anchor="middle" class="ax" style="fill:var(--color-faint)">${t}</text>`;}}
  s+=`<text x="0" y="${top-10}" class="ax" style="fill:var(--color-faint);letter-spacing:.12em">OBJECTIVE · STEP →</text>`;
  rows.forEach((it,r)=>{const y=top+r*RH, cy=y+RH/2, u=it.unlock_seq, a=it.actual_seq, v=it.verdict;
    s+=`<g class="row" data-r="${r}"><rect class="hl" x="-10" y="${y+1}" width="${W+10}" height="${RH-2}" style="fill:transparent"/><rect class="acc" x="-10" y="${y+1}" width="2" height="${RH-2}" style="fill:${V[v]?.c||'var(--color-muted)'}"/>`;
    s+=`<text x="0" y="${cy+4}" style="fill:${v==='late_pivot'?'var(--color-fg)':'var(--color-muted)'}">${(human(it.objective).length>26?human(it.objective).slice(0,25)+'…':human(it.objective)).replace(/</g,'&lt;')}</text>`;
    if(v==='late_pivot'&&u&&a){s+=`<rect x="${x(u)}" y="${cy-5}" width="${Math.max(2,x(a)-x(u))}" height="10" style="fill:url(#pvh-late)"/><circle cx="${x(u)}" cy="${cy}" r="4" style="fill:var(--color-ink);stroke:var(--color-muted)" stroke-width="1.2"/><rect x="${x(a)-1.5}" y="${cy-8}" width="3" height="16" style="fill:var(--color-loud)"/>`;}
    else if(v==='skipped'){const u0=u||1;s+=`<rect x="${x(u0)}" y="${cy-5}" width="${x(total)-x(u0)}" height="10" style="fill:url(#pvh-skip)"/><circle cx="${x(u0)}" cy="${cy}" r="4" style="fill:var(--color-ink);stroke:var(--color-muted)" stroke-width="1.2"/><text x="${x(total)+4}" y="${cy+4}" style="fill:var(--color-skipped)">×</text>`;}
    else if(a){s+=`<rect x="${x(a)-1.5}" y="${cy-8}" width="3" height="16" style="fill:${V[v]?.c||'var(--color-muted)'}"/>`;if(v==='ahead'||v==='off_path_win')s+=`<circle cx="${x(a)}" cy="${cy}" r="4" style="fill:${V[v].c}"/>`;}
    s+=`</g>`;});
  el.innerHTML=s+'</svg><div class="pv-tip"></div>'; const tip=el.querySelector('.pv-tip');
  el.querySelectorAll('.row').forEach(g=>{const it=rows[+g.dataset.r];
    g.addEventListener('mouseenter',()=>{const why=it.verdict==='late_pivot'?`Open from step ${it.unlock_seq}, done at step ${it.actual_seq}${it.lag_ms?` · ${mins(it.lag_ms)} min later`:''}`:it.verdict==='skipped'?`Open from step ${it.unlock_seq??'?'}, never attempted`:it.verdict==='on_time'?`Done at step ${it.actual_seq}, as soon as it opened`:`Done at step ${it.actual_seq}, before the optimal line expected it`;
      const r=+g.dataset.r, y=top+r*RH, end=it.actual_seq?x(it.actual_seq):x(total), left=Math.min(Math.max(end+14,LBL),W-300), flip=end+14+300>W;
      tip.innerHTML=`<span class="tag" style="color:${V[it.verdict]?.c}">${V[it.verdict]?.l||it.verdict}</span><b>${human(it.objective)}</b><p>${why}</p>${it.actual_seq?`<i>Click to replay step ${it.actual_seq}</i>`:''}`;
      tip.style.left=(flip?Math.max(LBL,end-14-300):left)+'px'; tip.style.top=(y+RH/2)+'px'; tip.classList.add('show');});
    g.addEventListener('mouseleave',()=>tip.classList.remove('show'));
    g.addEventListener('click',()=>{if(it.actual_seq)STORE?.getState().reveal?.(it.actual_seq);});});
}

function apply(){applyLesson();applySections();applyPath();applyPhaseRows();applyGhost();gradeColour();}
function clear(){clearPhaseRows();document.querySelectorAll('.pv-hero,.pv-lead,.pv-ghost,.pv-path').forEach(e=>e.remove());document.querySelectorAll('h2[data-num]').forEach(h=>delete h.dataset.num);
  document.querySelectorAll('[data-pvh-disp]').forEach(el=>{el.style.display=el.dataset.pvhDisp;delete el.dataset.pvhDisp;});hidden.length=0;}
window.__pvHier={apply,clear};
// wait for the store before the first paint so the charts have data
const wait=setInterval(()=>{if(STORE&&window.__pv){clearInterval(wait);window.__pv.set('4');}},100);
})();
'hier ready'
