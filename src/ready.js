/* ================= Getting started, the error log, and the assistant's monthly limit ================= */

/* ---------- first-run checklist (owners, home screen) ----------
   Six steps from a new business to its first sale. It hides itself once all six are done, or when an owner
   taps "Hide"; it comes back if something important goes missing (e.g. no products). */
function readySteps(){
  const st=S.settings||{};
  return [
    {k:'gst',t:'Add the GST number',d:'Printed on every receipt and invoice',ok:!!st.gstNumber,go:()=>openSetupArea('setup',()=>setTimeout(()=>{ const g=$('#gstNo'); if(g){ g.scrollIntoView({block:'center'}); g.focus(); } },200))},
    {k:'products',t:'Add your products and prices',d:'What the till sells, prices including GST',ok:S.products.some(p=>p.active!==false&&p.price>0),go:()=>openSetupArea('products')},
    {k:'pin',t:'Choose your PIN',d:'For approvals, discounts and opening Setup',ok:typeof myPin==='function'&&!!myPin(),go:()=>setPinFlow(()=>render())},
    {k:'float',t:'Set your usual cash float',d:'Filled in when a selling day starts',ok:!!st.defaultFloat,go:()=>openSetupArea('setup',()=>setTimeout(()=>{ const f=$('#defFloat'); if(f){ f.scrollIntoView({block:'center'}); f.focus(); } },200))},
    {k:'people',t:'Add a helper or co-owner (optional)',d:'They sign in with their own Google account',ok:(SYNC.getMembers?SYNC.getMembers().length:1)>1||!!st.readySkipPeople,go:()=>openSetupArea('setup'),skip:true},
    {k:'sale',t:'Try a sale',d:'Start selling, tap a product, pay. Undo it straight after if it was a test',ok:S.sales.length>0,go:()=>go('sell')}];
}
function readyCardHtml(){
  if(role()!=='owner'||tillLock()||(typeof practice!=='undefined'&&practice)) return '';
  const l=readySteps(), done=l.filter(x=>x.ok).length;
  if(done===l.length||(S.settings.readyHidden&&l.slice(0,2).every(x=>x.ok))) return '';
  return `<div class="card readycard"><h3>🌱 Getting started · ${done} of ${l.length}</h3><div class="readybar"><i style="width:${Math.round(done/l.length*100)}%"></i></div>
    ${l.map((x,i)=>`<div class="lrow"><div class="grow ltxt"><b>${x.ok?'✅':'⬜'} ${esc(x.t)}</b><small>${esc(x.d)}</small></div>${x.ok?'':`<button class="btn small" data-ready="${i}">Go ›</button>`}${!x.ok&&x.skip?`<button class="btn alt small" data-readyskip="${x.k}">Skip</button>`:''}</div>`).join('')}
    <div class="mact" style="justify-content:flex-start"><button class="linkb" id="readyHide">Hide this list</button></div></div>`;
}
function wireReady(){
  const l=readySteps();
  document.querySelectorAll('[data-ready]').forEach(b=>b.onclick=()=>l[+b.dataset.ready].go());
  document.querySelectorAll('[data-readyskip]').forEach(b=>b.onclick=()=>{ S.settings.readySkipPeople=true; save(); render(); });
  const h=$('#readyHide'); if(h) h.onclick=()=>{ S.settings.readyHidden=true; save(); render(); };
}

/* ---------- error log ----------
   Anything that goes wrong in the app on any device is noted (what, on which screen, which device), at most
   20 a day per device, so faults are seen before anyone has to ring. Owners see them in Setup. Kept in the
   business's own data (errors/), within Firebase's free amounts. */
let errCount=0, errDay='';
function logError(msg,where){
  try{
    if(!SYNC.businessId||!SYNC.businessId()||missingCols.has('errors')) return;
    const day=nzDay(); if(day!==errDay){ errDay=day; errCount=0; } if(++errCount>20) return;
    const m=String(msg||'').slice(0,300); if(/ResizeObserver|Script error\.?$|NetworkError|Failed to fetch|Load failed/i.test(m)) return;
    S.errors=S.errors||[]; if(S.errors.some(e=>e.msg===m&&e.day===day&&e.by===SYNC.me())) return;
    S.errors.push({id:SYNC.newId('errors'),at:Date.now(),day,by:SYNC.me(),msg:m,where:String(where||'').slice(0,200),screen:typeof cur==='function'?cur():'',device:(typeof deviceLabel==='function'?deviceLabel():'')+' · '+String(navigator.userAgent).slice(0,120),version:typeof APP_VERSION!=='undefined'?APP_VERSION:''});
    save();
  }catch(e){}
}
addEventListener('error',e=>logError(e.message,(e.filename||'').split('/').pop()+':'+(e.lineno||'')));
addEventListener('unhandledrejection',e=>logError(e.reason&&(e.reason.message||e.reason),'promise'));
function errorsCardHtml(){
  if(role()!=='owner') return ''; const l=(S.errors||[]).slice().sort((a,b)=>b.at-a.at), recent=l.filter(e=>Date.now()-e.at<30*864e5);
  return `<div class="card"><h3>🩺 App health</h3><div class="row"><div class="grow"><b>${recent.length?recent.length+' problem'+(recent.length===1?'':'s')+' noted in the last 30 days':'No problems noted in the last 30 days'}</b><small>Faults on any device are noted here automatically, so they can be fixed.</small></div>${l.length?'<button class="btn alt small" id="errShow">Show</button>':''}</div></div>`;
}
document.addEventListener('click',e=>{ if(!(e.target.closest&&e.target.closest('#errShow'))) return;
  const l=(S.errors||[]).slice().sort((a,b)=>b.at-a.at).slice(0,40);
  modal((m,close)=>{ m.innerHTML=`<h2>🩺 Problems noted</h2>${l.map(x=>`<div class="lrow"><div class="grow ltxt"><b>${esc(x.msg)}</b><small>${nzDate(new Date(x.at),{day:'numeric',month:'short'})} · ${esc(x.screen||'')} · ${esc(personName(x.by))} · ${esc(x.device||'')} · v${esc(x.version||'')}</small></div></div>`).join('')}
      <div class="mact"><button class="btn alt" id="errClr">Clear the list</button><button class="btn" id="errC">Close</button></div>`;
    m.querySelector('#errC').onclick=close;
    m.querySelector('#errClr').onclick=()=>{ S.errors.splice(0,S.errors.length); save(); close(); render(); }; },{big:true}); });

/* ---------- the assistant's monthly limit ----------
   The helper adds up what the assistant has used this month and pauses it when the estimate reaches the
   limit (default NZ$5). The estimate uses the helper's per-token rates, so it is approximate. */
const aiLimit=()=>S.settings.aiLimit!=null?+S.settings.aiLimit:5;
const aiSpent=()=>{ const u=S.aiUsage; return u&&u.month===nzDay().slice(0,7)&&u.nzd!=null?u.nzd:null; };
