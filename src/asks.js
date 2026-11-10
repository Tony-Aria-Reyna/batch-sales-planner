/* ================= A helper asks an owner or manager to open a market =================
   A helper can open only today's markets they're ticked on in the calendar. For anything else they tap Ask:
   the request (asks/{id}) goes to every owner and manager. The app pings the business helper, which sends a
   notification straight away; anyone with the app open gets a window over what they're doing, but never in
   the middle of a sale. An approval covers that one market, today only.
   The helper sees each step tick off: Sent → Reached an owner's device → Being looked at → Approved (the till
   opens by itself) or Declined (with the reason). If no owner or manager's device has it after 90 seconds,
   it offers to ring the main owner, or a manager on that market's calendar entry. */
const ASK_CALL_AFTER=90e3;
const askList=()=>S.asks||(S.asks=[]);
const myAsksToday=()=>askList().filter(a=>a.by===SYNC.me()&&a.date===nzDay());
const phoneOf=e=>((S.settings.phones||{})[e]||{}).p||'';
const phoneName=e=>((S.settings.phones||{})[e]||{}).n||(canManage()?personName(e):String(e||'').split('@')[0]);
const askerName=()=>{ const n=servedBy()||((S.settings.phones||{})[SYNC.me()]||{}).n||SYNC.me().split('@')[0]; return n.charAt(0).toUpperCase()+n.slice(1); };

/* ---------- the helper's side ---------- */
// on Start selling, under "Your markets today"
function askCardHtml(){
  const mine=myAsksToday(), wait=mine.filter(a=>a.status==='waiting'), ok=mine.filter(a=>a.status==='approved'&&!a.opened);
  const ticked=new Set(myMarketsToday().map(e=>e.id)), other=todaysMarkets().filter(e=>!ticked.has(e.id));
  const saved=S.places.filter(p=>!p.gone&&p.group==='markets'&&!other.some(e=>e.place===p.id)).sort((a,b)=>a.name.localeCompare(b.name));
  return `${ok.map(a=>`<div class="card nudge"><b>✅ Approved: ${esc(a.placeName)}</b><small style="display:block">${esc(phoneName(a.decidedBy))} said yes, for today.</small><button class="btn bigyes" data-askopen="${a.id}">Open the till</button></div>`).join('')}
    ${wait.map(a=>`<div class="card nudge"><b class="blink">⏳ Waiting for approval: ${esc(a.placeName)}</b> <button class="btn small" data-askshow="${a.id}">Show</button></div>`).join('')}
    <div class="card"><h3>🙋 Ask to open another market</h3><p class="note">An owner or manager approves it from their phone or iPad, for today only.</p>
      <div class="pastnames">${other.map(e=>`<button class="chip big" data-askev="${e.id}">📅 ${esc(e.title)}</button>`).join('')}${saved.map(p=>`<button class="chip big" data-askpl="${p.id}">🧺 ${esc(p.name)}</button>`).join('')}</div>
      <label class="note" for="askN">Or type a new one</label><textarea class="txt grow" rows="1" id="askN" placeholder="Market name"></textarea>
      <button class="btn" id="askGo">🙋 Ask</button></div>`;
}
function wireAskCard(){
  let pick=null;
  const mark=b=>document.querySelectorAll('[data-askev],[data-askpl]').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('[data-askev]').forEach(b=>b.onclick=()=>{ const e=S.events.find(x=>x.id===b.dataset.askev); if(!e) return; pick={eventId:e.id,placeId:e.place||'',placeName:e.title}; $('#askN').value=''; mark(b); });
  document.querySelectorAll('[data-askpl]').forEach(b=>b.onclick=()=>{ const p=S.places.find(x=>x.id===b.dataset.askpl); if(!p) return; pick={eventId:'',placeId:p.id,placeName:p.name}; $('#askN').value=''; mark(b); });
  const n=$('#askN'); if(n) n.oninput=()=>{ pick=null; mark(null); };
  const g=$('#askGo'); if(g) g.onclick=()=>{ const typed=n.value.trim(); const w=pick||(typed?{eventId:'',placeId:'',placeName:typed.slice(0,80)}:null);
    if(!w){ toast('Tap a market or type its name'); return; }
    if(myAsksToday().some(a=>a.status==='waiting'&&a.placeName===w.placeName)){ toast('Already asked: waiting for an answer'); return; }
    const fl=$('#sFloat')&&$('#sFloat').value.trim();
    const a=Object.assign({id:SYNC.newId('asks'),by:SYNC.me(),byName:askerName(),at:Date.now(),date:nzDay(),status:'waiting',float:fl?toCents(fl)||0:0},w);
    askList().push(a); save(); pingHelper('ask-'+a.id); render(); waitAsk(a.id); };
  document.querySelectorAll('[data-askshow]').forEach(b=>b.onclick=()=>waitAsk(b.dataset.askshow));
  document.querySelectorAll('[data-askopen]').forEach(b=>b.onclick=()=>openFromAsk(askList().find(a=>a.id===b.dataset.askopen)));
}
// who to ring: the main owner, and any manager ticked on that market's calendar entry
function askCallList(a){
  const ev=a.eventId&&S.events.find(e=>e.id===a.eventId), l=[SYNC.getMainOwner()];
  ((ev&&ev.attendees)||[]).forEach(e=>{ if(SYNC.roleOf(e)==='manager') l.push(e); });
  return [...new Set(l)].filter(e=>e&&e!==SYNC.me()&&phoneOf(e));
}
function waitAsk(id){
  let tmr=null;
  modal((m,close)=>{
    const done=()=>{ clearInterval(tmr); close(); render(); };
    const draw=()=>{ const a=askList().find(x=>x.id===id); if(!a){ done(); return; }
      if(a.status==='approved'&&!a.opened){ clearInterval(tmr); close(); openFromAsk(a); return; }
      const st=a.status, seen=!!a.seenAt, look=!!a.lookingAt, end=st==='approved'||st==='declined';
      const step=(on,cur,t)=>`<li class="${on?'did':cur?'cur':''}">${on?'✓':cur?'●':'○'} ${t}</li>`;
      const late=!seen&&st==='waiting'&&Date.now()-a.at>ASK_CALL_AFTER, calls=late?askCallList(a):[];
      m.innerHTML=`<h2>🙋 ${esc(a.placeName)}</h2><p class="note">Asking to open the till today.</p>
        <ol class="asksteps">${step(true,false,'Sent')}${step(seen,!seen,'Reached '+(seen?esc(phoneName(a.seenBy))+'\'s':'an owner\'s')+' phone or iPad')}${step(look||end,seen&&!look&&!end,(look?esc(phoneName(a.lookingBy)):'Owner')+' is looking at it')}
          ${st==='declined'?`<li class="no">✕ Declined${a.reason?': '+esc(a.reason):''}</li>`:step(st==='approved',look&&!end,'Approved: the till opens by itself')}</ol>
        ${late?`<div class="card nudge"><b>No owner has seen this yet.</b><small>Their phones may be off or out of signal. The request stays live: if they approve it later, the till still opens.</small>
          ${calls.length?calls.map(e=>`<a class="btn bigyes" href="tel:${esc(phoneOf(e).replace(/[^\d+]/g,''))}">📞 Call ${esc(phoneName(e))} on ${esc(phoneOf(e))}</a>`).join(''):'<small>No phone numbers are set up yet (Setup → People).</small>'}</div>`:''}
        <div class="mact">${st==='waiting'?'<button class="btn danger" id="akX">Cancel the request</button>':''}<button class="btn alt" id="akH">${end?'Close':'Hide (keeps waiting)'}</button></div>`;
      const x=m.querySelector('#akX'); if(x) x.onclick=()=>{ Object.assign(a,{status:'cancelled',decidedAt:Date.now()}); save(); done(); };
      m.querySelector('#akH').onclick=done; };
    draw(); tmr=setInterval(()=>{ if(!document.body.contains(m)){ clearInterval(tmr); return; } draw(); },1000);
  },{sticky:true});
}
function openFromAsk(a){
  if(!a||a.status!=='approved'||a.opened) return;
  if(openDay()){ toast('A till is already open'); return; }
  const pl=a.placeId&&S.places.find(p=>p.id===a.placeId), fl=a.float||(pl&&pl.float)||S.settings.defaultFloat||0;
  if(!servedBy()) lsSet('rs.servedBy',a.byName||askerName());
  S.sessions.push(Object.assign({id:SYNC.newId('sessions'),type:'market',name:a.placeName,date:nzDay(),openedAt:Date.now(),openedBy:SYNC.me(),float:fl,status:'open',askId:a.id,approvedBy:a.decidedBy||''},a.eventId?{eventId:a.eventId}:{},a.placeId?{placeId:a.placeId}:{}));
  a.opened=true; a.openedAt=Date.now(); cart=[]; saveCart(); save(); stack=['home','sell']; render(); toast('Approved. The till is open.');
}

/* ---------- the owner's and manager's side ---------- */
let askShowing=null; const askLater={};
function askWatch(){
  if(!SYNC.businessId||!SYNC.businessId()||!canManage()||tillLock()||missingCols.has('asks')) return;
  const l=askList().filter(a=>a.status==='waiting'&&a.date===nzDay()&&a.by!==SYNC.me());
  let ch=false; l.forEach(a=>{ if(!a.seenAt){ a.seenAt=Date.now(); a.seenBy=SYNC.me(); ch=true; } }); if(ch) save();
  if(askShowing){ const a=askList().find(x=>x.id===askShowing.id); if(!a||a.status!=='waiting'){ const c=askShowing.close; askShowing=null; c(); if(a&&a.status!=='waiting'&&a.decidedBy!==SYNC.me()) toast(a.status==='cancelled'?'They cancelled the request':'Already answered by '+phoneName(a.decidedBy)); } return; }
  // never in the middle of a sale, or over another window
  if((typeof cart!=='undefined'&&cart.length)||modalStack.length) return;
  const a=l.find(x=>!(askLater[x.id]>Date.now())); if(a) askWindow(a);
}
function askWindow(a){
  a.lookingAt=Date.now(); a.lookingBy=SYNC.me(); save();
  const close=modal((m,close)=>{
    m.innerHTML=`<h2>🙋 ${esc(a.byName||phoneName(a.by))} asks to open the till</h2>
      <p class="chkline">at <b>${esc(a.placeName)}</b> today${a.eventId?'':' (it isn\'t on today\'s calendar)'}</p>
      <p class="note">Approving lets them open this one market, today only. They're waiting on their phone.</p>
      <button class="btn bigyes" id="akOk">✅ Approve</button>
      <div class="mact"><button class="btn danger" id="akNo">Decline</button><button class="btn alt" id="akL">Later</button></div>`;
    m.querySelector('#akOk').onclick=()=>approve('let '+(a.byName||'a helper')+' open '+a.placeName,who=>{ askShowing=null; close(); Object.assign(a,{status:'approved',decidedBy:who||SYNC.me(),decidedAt:Date.now()}); save(); toast('Approved. Their till opens now.'); },a.placeName);
    m.querySelector('#akL').onclick=()=>{ askLater[a.id]=Date.now()+5*60e3; askShowing=null; close(); };
    m.querySelector('#akNo').onclick=()=>{ askShowing=null; close(); askDecline(a); };
  },{sticky:true});
  askShowing={id:a.id,close};
}
function askDecline(a){
  modal((m,close)=>{ m.innerHTML=`<h2>Decline: ${esc(a.placeName)}</h2><p class="note">They'll see why.</p>
      <div class="pastnames">${['We\'re not doing that market today','I\'m on my way','Call me'].map(r=>`<button class="chip big" data-akr="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <textarea class="txt grow" rows="1" id="akR" placeholder="Or type a reason (optional)"></textarea>
      <div class="mact"><button class="btn alt" id="akC">Back</button><button class="btn danger" id="akD">Decline</button></div>`;
    m.querySelectorAll('[data-akr]').forEach(b=>b.onclick=()=>{ m.querySelector('#akR').value=b.dataset.akr; });
    m.querySelector('#akC').onclick=()=>{ close(); askWindow(a); };
    m.querySelector('#akD').onclick=()=>{ Object.assign(a,{status:'declined',reason:m.querySelector('#akR').value.trim().slice(0,160),decidedBy:SYNC.me(),decidedAt:Date.now()}); save(); close(); toast('Declined'); };
  },{sticky:true});
}
setInterval(()=>{ try{ askWatch(); }catch(e){} },1500);

/* ---------- phone numbers for the Call button (Setup → People) ---------- */
function editPhone(e){
  modal((m,close)=>{ const cur=(S.settings.phones||{})[e]||{};
    m.innerHTML=`<h2>📞 ${esc(e)}</h2><p class="note">Shown to people in the business, so a helper can ring if a request isn't seen.</p>
      <label class="note" for="phN">Name helpers see</label><textarea class="txt grow" rows="1" id="phN">${esc(cur.n||personName(e))}</textarea>
      <label class="note" for="phP">Mobile</label><input class="txt" id="phP" type="tel" inputmode="tel" value="${esc(cur.p||'')}" placeholder="021 123 4567">
      <div class="mact"><button class="btn alt" id="phC">Cancel</button><button class="btn" id="phOk">Save</button></div>`;
    m.querySelector('#phC').onclick=close;
    m.querySelector('#phOk').onclick=()=>{ const p=m.querySelector('#phP').value.trim(), n=m.querySelector('#phN').value.trim();
      if(p&&!/^\+?[\d ()-]{7,20}$/.test(p)){ toast('That doesn\'t look like a phone number'); return; }
      S.settings.phones=Object.assign({},S.settings.phones,{[e]:{n:n.slice(0,40),p}}); if(!p&&!n) delete S.settings.phones[e]; save(); close(); render(); toast('Saved'); };
  });
}
