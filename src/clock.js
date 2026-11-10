/* ================= Time clock (owners only) and helpers' hours =================
   Owners tap a job to start the clock, tap Stop (or another job) when done. Market days aren't clocked:
   their hours come from the calendar entry and the check-in. Helpers' hours are kept with their pay
   (Reports → Costs), linked to the market they worked. All of it is in "clock", which only owners can read. */
const CLOCK_CODES={brewing:'🫙 Brewing',orders:'📦 Orders and packing',admin:'🗂️ Admin',buying:'🛒 Buying supplies'};
const clockList=()=>S.clock||(S.clock=[]);
const clockMins=c=>c.end?(c.mins!=null?c.mins:Math.round((c.end-c.start)/60e3)):Math.round((Date.now()-c.start)/60e3);
const clockRunning=()=>role()==='owner'?clockList().find(c=>c.kind==='owner'&&c.who===SYNC.me()&&!c.end):null;
// minutes clocked on a job on a day (by any owner), for the brew check-in and the Profit screen
function clockMinsFor(code,date){ return role()==='owner'?clockList().filter(c=>c.kind==='owner'&&c.code===code&&c.date===date).reduce((n,c)=>n+clockMins(c),0):0; }
function clockStart(code){
  const r=clockRunning(); if(r&&r.code===code) return;
  if(r) clockStop(r,true);
  clockList().push({id:SYNC.newId('clock'),kind:'owner',who:SYNC.me(),code,start:Date.now(),end:null,date:nzDay()});
  save(); toast('⏱️ Clock started: '+CLOCK_CODES[code].replace(/^\S+ /,''));
}
function clockStop(c,quiet,at){ c.end=at||Date.now(); c.mins=Math.max(0,Math.round((c.end-c.start)/60e3)); save(); if(!quiet) toast('Stopped · '+hmTxt(c.mins)); }
// the running clock on the home screen; after 10 hours it asks
function clockBanner(){
  const r=clockRunning(); if(!r||tillLock()) return '';
  const mins=clockMins(r), long=mins>=600&&(!r.checked||Date.now()-r.checked>4*3600e3);
  return `<div class="card clockbar ${long?'long':''}"><div class="row" style="border:0;padding:0;min-height:0"><div class="grow" ${cur()==='clock'?'':'data-goclock="1" style="cursor:pointer"'}><b>⏱️ ${esc(CLOCK_CODES[r.code]||r.code)}</b><small data-clockel="${r.id}">${hmTxt(mins)} since ${esc(nzTime(r.start))}</small></div>
    <button class="btn small" id="clkStop">Stop</button></div>
    ${long?`<p class="note" style="margin:6px 0 0">The clock has been on for over 10 hours. Still working?</p><div class="mact" style="justify-content:flex-start"><button class="btn alt small" id="clkGo">Yes, still going</button><button class="btn alt small" id="clkEarly">I stopped earlier…</button></div>`:''}</div>`;
}
function wireClockBanner(){
  const r=clockRunning(); if(!r) return;
  const s=$('#clkStop'); if(s) s.onclick=()=>{ clockStop(r); render(); };
  const gc=document.querySelector('[data-goclock]'); if(gc) gc.onclick=()=>go('clock');
  const g=$('#clkGo'); if(g) g.onclick=()=>{ r.checked=Date.now(); save(); toast('OK, still going'); render(); };
  const e=$('#clkEarly'); if(e) e.onclick=()=>stoppedEarlier(r);
}
function stoppedEarlier(r){
  modal((m,close)=>{ const d=new Date(r.start), def=new Date(r.start+8*3600e3);
    m.innerHTML=`<h2>When did you stop?</h2><p class="note">Started ${esc(nzDate(d,{weekday:'short',day:'numeric',month:'short'}))} at ${esc(nzTime(r.start))}.</p>
      <div class="formrow"><div><label class="note" for="clD">Day</label><input class="txt" id="clD" type="date" value="${dk(def)}"></div><div><label class="note" for="clT">Time</label><input class="txt" id="clT" type="time" value="${String(def.getHours()).padStart(2,'0')}:${String(def.getMinutes()).padStart(2,'0')}"></div></div>
      <div class="mact"><button class="btn alt" id="clC">Cancel</button><button class="btn" id="clOk">Stop the clock</button></div>`;
    m.querySelector('#clC').onclick=close;
    m.querySelector('#clOk').onclick=()=>{ const t=new Date(m.querySelector('#clD').value+'T'+(m.querySelector('#clT').value||'00:00')).getTime();
      if(!(t>r.start)){ toast('That\'s before it started'); return; } if(t>Date.now()){ toast('That\'s in the future'); return; }
      clockStop(r,false,t); close(); render(); }; });
}
setInterval(()=>{ document.querySelectorAll('[data-clockel]').forEach(el=>{ const c=clockList().find(x=>x.id===el.dataset.clockel); if(c&&!c.end) el.textContent=hmTxt(clockMins(c))+' since '+nzTime(c.start); }); },30e3);

SCREENS.clock={
  title:()=>({h:'Time clock',s:'Your hours, by job'}),
  html(){
    if(role()!=='owner') return '<div class="card"><p>Only owners use the time clock.</p></div>';
    const r=clockRunning(), wk=dk(monday(kd(nzDay()))), mine=clockList().filter(c=>c.kind==='owner'&&c.date>=dk(addDays(kd(wk),-7))).sort((a,b)=>b.start-a.start);
    const week=clockList().filter(c=>c.kind==='owner'&&c.date>=wk), tot=k=>week.filter(c=>c.code===k).reduce((n,c)=>n+clockMins(c),0);
    const mk=S.sessions.filter(s=>s.date>=wk&&s.type==='market'), mkMins=mk.reduce((n,s)=>n+sessionMins(s),0);
    return `${r?clockBanner():''}<div class="card"><h3>${r?'Switch to another job':'Start the clock'}</h3><p class="note">Tap what you're doing. Tapping another job stops the first. Markets aren't clocked: they come from the calendar and the check-in.</p>
      <div class="clockgrid">${Object.entries(CLOCK_CODES).map(([k,t])=>`<button class="btn ${r&&r.code===k?'':'alt'} big" data-clk="${k}">${t}${r&&r.code===k?'<small>running</small>':''}</button>`).join('')}</div></div>
      <div class="card"><h3>This week</h3>${Object.entries(CLOCK_CODES).map(([k,t])=>`<div class="row"><div class="grow">${t}</div><b>${hmTxt(tot(k))}</b></div>`).join('')}
        <div class="row"><div class="grow">🧺 Markets (travel to unpacking)</div><b>${hmTxt(mkMins)}</b></div>
        <div class="row"><div class="grow"><b>All</b></div><b>${hmTxt(Object.keys(CLOCK_CODES).reduce((n,k)=>n+tot(k),0)+mkMins)}</b></div></div>
      <div class="card"><h3>Recent</h3>${mine.length?mine.map(c=>`<button class="row prow" data-clke="${c.id}"><div class="grow">${esc(CLOCK_CODES[c.code]||c.code)}<small>${esc(nzDate(new Date(c.start),{weekday:'short',day:'numeric',month:'short'}))} · ${esc(nzTime(c.start))}${c.end?' – '+esc(nzTime(c.end)):' · running'}${c.note?' · '+esc(c.note):''}</small></div><b>${hmTxt(clockMins(c))}</b></button>`).join(''):'<p class="note">Nothing clocked yet.</p>'}
        <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="clkAdd">＋ Add time I forgot to clock</button></div></div>`;
  },
  wire(){
    document.querySelectorAll('[data-clk]').forEach(b=>b.onclick=()=>{ clockStart(b.dataset.clk); render(); });
    wireClockBanner();
    const a=$('#clkAdd'); if(a) a.onclick=()=>editClock({kind:'owner',who:SYNC.me(),code:'brewing',date:nzDay()});
    document.querySelectorAll('[data-clke]').forEach(b=>b.onclick=()=>{ const c=clockList().find(x=>x.id===b.dataset.clke); if(c) editClock(c); });
  }
};
// add or change a block of time (owners), or a helper's hours on a market (kind 'helper')
function editClock(src,done){
  const isNew=!src.id, c=Object.assign({},src), helper=c.kind==='helper', running=!isNew&&!c.end, mins=isNew?(c.mins||0):clockMins(c);
  modal((m,close)=>{
    m.innerHTML=`<h2>${helper?'⏱️ '+esc(c.who||'Helper')+'\'s hours':isNew?'Add time':'Change this time'}</h2>
      ${helper?`<p class="note">${esc(c.label||'')}</p>`:`<label class="note" for="ceC">Job</label><select class="txt" id="ceC">${Object.entries(CLOCK_CODES).map(([k,t])=>`<option value="${k}" ${c.code===k?'selected':''}>${t}</option>`).join('')}</select>
      <label class="note" for="ceD">Day</label><input class="txt" id="ceD" type="date" value="${esc(c.date||nzDay())}">`}
      ${running?'<p class="note">This one is still running. Stop it from the banner, or change the job here.</p>':`<div class="formrow"><div><label class="note" for="ceH">Hours</label><input class="txt" id="ceH" inputmode="numeric" value="${Math.floor(mins/60)}"></div><div><label class="note" for="ceM">Minutes</label><input class="txt" id="ceM" inputmode="numeric" value="${mins%60}"></div></div>`}
      <label class="note" for="ceN">Note (optional)</label><textarea class="txt grow" rows="1" id="ceN" placeholder="${helper?'e.g. helped pack down too':'e.g. labels for the Kowhai order'}">${esc(c.note||'')}</textarea>
      <div class="mact">${isNew?'':'<button class="btn danger" id="ceDel">Delete</button>'}<button class="btn alt" id="ceX">Cancel</button><button class="btn" id="ceOk">Save</button></div>`;
    m.querySelector('#ceX').onclick=close;
    const del=m.querySelector('#ceDel'); if(del) del.onclick=()=>{ const i=clockList().findIndex(x=>x.id===c.id); if(i>=0) clockList().splice(i,1); save(); close(); render(); done&&done(); };
    m.querySelector('#ceOk').onclick=()=>{
      if(!helper){ c.code=m.querySelector('#ceC').value; c.date=m.querySelector('#ceD').value||nzDay(); }
      c.note=m.querySelector('#ceN').value.trim().slice(0,200);
      if(!running){ const n=minsIn(m.querySelector('#ceH').value)*60+minsIn(m.querySelector('#ceM').value); if(!(n>0)){ toast('Type the hours'); return; }
        c.mins=n; if(isNew){ c.start=kd(c.date).getTime()+9*3600e3; c.end=c.start+n*60e3; } else c.end=c.start+n*60e3; }
      if(isNew){ c.id=SYNC.newId('clock'); clockList().push(c); } else { const x=clockList().find(y=>y.id===c.id); if(x) Object.assign(x,c); }
      save(); close(); toast('Saved'); render(); done&&done(); };
  });
}

/* ---------- a market's whole time: travel, set up, selling, pack down, drive home, unpack ---------- */
function sessionMins(s){
  const sell=Math.max(0,Math.round(((s.closedAt||s.openedAt)-s.openedAt)/60e3)), ck=s.checkin&&!s.checkin.skipped?s.checkin.times:null;
  if(ck) return sell+(ck.there||0)+(ck.setup||0)+(ck.pack||0)+(ck.home||0)+(ck.unpack||0);
  const ev=S.events.find(e=>e.id===s.eventId), p=ev?marketPlan(ev):null;
  if(p&&p.ok) return p.total+(+S.settings.unpackMins||15);
  return sell;
}

/* ---------- helpers' hours, kept with their pay (Reports → Costs) ---------- */
// each recent selling day and who served on it, with the hours recorded (or the till's estimate)
function helperShifts(days){
  const from=dk(addDays(kd(nzDay()),-(days||28))), out=[];
  S.sessions.filter(s=>s.date>=from&&s.status==='closed').sort((a,b)=>b.date.localeCompare(a.date)).forEach(s=>{
    const names=[...new Set(S.sales.filter(x=>x.sessionId===s.id&&x.servedBy).map(x=>x.servedBy))].filter(n=>(S.pay||[]).some(p=>(p.name||'').toLowerCase()===n.toLowerCase()));
    names.forEach(n=>{ const rec=clockList().find(c=>c.kind==='helper'&&c.session===s.id&&(c.who||'').toLowerCase()===n.toLowerCase());
      out.push({session:s,name:n,rec,est:sessionMins(s)}); }); });
  return out;
}
function helperHoursCard(){
  const l=helperShifts(28);
  return `<div class="card"><h3>⏱️ Helpers' hours</h3><p class="note">The last four weeks, from who was serving on the till. Tap to confirm or change the hours: they're used for pay on each market's profit.</p>
    ${l.length?l.map(x=>`<button class="row prow" data-hh="${x.session.id}|${esc(x.name)}"><div class="grow">${esc(x.name)} · ${esc(x.session.name||'Selling day')}<small>${esc(nzDate(kd(x.session.date),{weekday:'short',day:'numeric',month:'short'}))} · ${x.rec?'✓ '+hmTxt(x.rec.mins)+' recorded':'about '+hmTxt(x.est)+' (not confirmed)'}</small></div><span class="chev">›</span></button>`).join(''):'<p class="note">No helpers with a pay rate have served on a till in the last four weeks.</p>'}</div>`;
}
function wireHelperHours(){
  document.querySelectorAll('[data-hh]').forEach(b=>b.onclick=()=>{ const [sid,name]=b.dataset.hh.split('|'), x=helperShifts(28).find(y=>y.session.id===sid&&y.name===name); if(!x) return;
    editClock(x.rec||{kind:'helper',who:x.name,code:'market',session:sid,date:x.session.date,mins:x.est,label:(x.session.name||'Selling day')+' · '+nzDate(kd(x.session.date),{weekday:'long',day:'numeric',month:'long'})}); });
}

/* ---------- the clock on the home screen and on every screen (round 4) ----------
   A tile beside Sell, and a small chip top right of every screen while it runs, each showing the job's icon
   and the time. Tapping either opens one window: the jobs as big buttons and Stop. Changing job or stopping
   asks first. */
const CLOCK_IC={brewing:'🫙',orders:'📦',admin:'🗂️',buying:'🛒'};
const clockName=k=>(CLOCK_CODES[k]||k).replace(/^\S+ /,'');
const hm2=n=>{ n=Math.max(0,n); return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); };
function clockTile(){
  const r=clockRunning();
  return r?`<button class="tile clock running" data-go="clock"><span class="ic">${CLOCK_IC[r.code]||'⏱️'}</span><span><h2>${esc(clockName(r.code))}</h2><p><span class="tick" data-clocktick="${r.id}">⏱️ ${hm2(clockMins(r))}</span> · tap to change or stop</p></span></button>`
    :`<button class="tile clock" data-go="clock"><span class="ic">⏱️</span><span><h2>Time clock</h2><p>Tap to start: brewing, orders, admin, buying</p></span></button>`;
}
function clockChip(){ const r=role()==='owner'&&!tillLock()?clockRunning():null; return r?`<button class="clockchip" id="clkChip" aria-label="Time clock: ${esc(clockName(r.code))}">${CLOCK_IC[r.code]||'⏱️'} <span data-clocktick="${r.id}">${hm2(clockMins(r))}</span></button>`:''; }
setInterval(()=>{ document.querySelectorAll('[data-clocktick]').forEach(el=>{ const c=clockList().find(x=>x.id===el.dataset.clocktick); if(c&&!c.end) el.textContent=(el.classList.contains('tick')?'⏱️ ':'')+hm2(clockMins(c)); }); },20e3);
// the one window: the jobs, and Stop
function clockSheet(){
  if(role()!=='owner') return;
  modal((m,close)=>{
    const r=clockRunning();
    m.innerHTML=`<h2>⏱️ ${r?'You\'re on '+esc(clockName(r.code))+' · '+hm2(clockMins(r)):'What are you working on?'}</h2>
      <p class="note">${r?'Tap another job to switch, or Stop.':'Tap a job to start the clock.'} Markets aren't clocked: they come from the calendar.</p>
      <div class="clockjobs">${Object.keys(CLOCK_CODES).map(k=>`<button class="btn ${r&&r.code===k?'':'alt'}" data-cj="${k}"><span class="big">${CLOCK_IC[k]}</span>${esc(clockName(k))}${r&&r.code===k?'<small>running · '+hm2(clockMins(r))+'</small>':''}</button>`).join('')}</div>
      ${r?'<button class="btn danger bigbtn" id="cjStop" style="width:100%">⏹ Stop the clock</button>':''}
      <div class="mact"><button class="btn alt" id="cjHours">See my hours</button><button class="btn alt" id="cjX">Close</button></div>`;
    m.querySelector('#cjX').onclick=close;
    m.querySelector('#cjHours').onclick=()=>{ close(); go('clock'); };
    m.querySelectorAll('[data-cj]').forEach(b=>b.onclick=()=>{ const k=b.dataset.cj, now=clockRunning();
      if(now&&now.code===k){ close(); return; }
      if(now) confirmBox('Switch to '+clockName(k)+'?','Stops '+esc(clockName(now.code))+' at '+hmTxt(clockMins(now))+' and starts '+esc(clockName(k))+'.','Switch',()=>{ clockStart(k); close(); render(); });
      else { clockStart(k); close(); render(); } });
    const st=m.querySelector('#cjStop'); if(st) st.onclick=()=>{ const now=clockRunning(); if(!now) return;
      confirmBox('Stop the clock?',esc(clockName(now.code))+': '+hmTxt(clockMins(now))+'.','Stop',()=>{ clockStop(now); close(); render(); }); };
  });
}
// over 10 hours: the home screen asks
function clockLongBanner(){ const b=clockBanner(); return b&&/still working/i.test(b)?b:''; }
