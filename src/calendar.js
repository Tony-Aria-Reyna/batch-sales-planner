/* ================= Calendar =================
   Works like Family Screen's calendar: Month or Week, a day panel that slides up and down with a finger
   (Day / Week / Split / Month), swipe left or right to move a day, week or month, a Today button, and the
   back button steps out one level before leaving.
   On it: markets, brew days, orders due and other entries, the selling days that actually happened, and
   to-dos with a date. Helpers see every market so they know what's on; markets they aren't rostered on
   are greyed out. Only owners and managers add or change entries. */
const CAL_TYPES={
  market:{ic:'🧺',t:'Market',bg:'#e4d8ee'},
  brew:{ic:'🫙',t:'Brew day',bg:'#f6e2bf'},
  order:{ic:'📦',t:'Order due',bg:'#dce8cc'},
  other:{ic:'📌',t:'Other',bg:'#e8e4d8'}
};
const REPEATS={'':'Does not repeat',week:'Every week','2weeks':'Every second week',month:'Every month'};
const REMINDERS={day:'The day before',hour:'1 hour before'};
const dk=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const kd=k=>new Date(k+'T12:00:00');
const addDays=(d,n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const monday=d=>{ const x=new Date(d); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
const fmtD=(d,o)=>new Intl.DateTimeFormat('en-NZ',o).format(d);
const t12=t=>{ if(!t) return ''; let [h,m]=t.split(':').map(Number); const ap=h<12?'am':'pm'; h=h%12||12; return h+(m?':'+String(m).padStart(2,'0'):'')+ap; };
const nzHM=ts=>new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ts));
const calType=e=>CAL_TYPES[e.type]||CAL_TYPES.other;

// does entry e fall on day key? (one-off, several days in a row, or repeating)
function occursOn(e,key){
  if(!e||!e.date||key<e.date) return false;
  if(e.until&&key>e.until) return false;
  if((e.skip||[]).includes(key)) return false;
  const days=Math.max(1,Math.min(14,+e.days||1)), k=kd(key), d0=kd(e.date), diff=Math.round((k-d0)/864e5), within=n=>n>=0&&n<days;
  if(e.rpt==='week') return within(diff%7);
  if(e.rpt==='2weeks') return within(diff%14);
  if(e.rpt==='month'){ for(let i=0;i<days;i++){ const s=addDays(k,-i); if(s>=d0&&s.getDate()===d0.getDate()) return true; } return false; }
  return within(diff);
}
const eventsOn=key=>S.events.filter(e=>occursOn(e,key));
// helpers see every market, but the ones they aren't rostered on are greyed out
const rostered=e=>canManage()||(e.attendees||[]).includes(SYNC.me());

// everything shown on one day, earliest first
function calItems(key){
  const out=[];
  for(const e of eventsOn(key)){ const ty=calType(e), dim=e.type==='market'&&!rostered(e);
    out.push({kind:'ev',time:e.time||'',end:e.end||'',title:ty.ic+' '+(e.title||ty.t),sub:[e.time?t12(e.time)+(e.end?'–'+t12(e.end):''):'All day',e.rpt?'🔁':'',dim?'not rostered':''].filter(Boolean).join(' · '),bg:ty.bg,dim,attr:`data-ev="${e.id}" data-occ="${key}"`}); }
  for(const s of S.sessions) if(s.date===key&&!(s.eventId&&out.some(o=>o.attr.includes('"'+s.eventId+'"')))){
    const nm=(s.name||(DAY_TYPES[s.type]||'').replace(/^\S+ /,''));
    out.push({kind:'day',time:nzHM(s.openedAt),end:s.closedAt?nzHM(s.closedAt):'',title:'💵 '+nm,sub:s.status==='open'?'Selling now':'Selling day',bg:'#d6e8cf',attr:`data-sess="${s.id}"`}); }
  for(const o of S.orders) if(o.due===key&&(o.status==='new'||o.status==='packed'))
    out.push({kind:'order',time:'',end:'',title:'📦 Send: '+((o.customer||{}).name||'order'),sub:(ORDER_STATUS[o.status]||'')+' · '+orderUnits(o)+' items',bg:CAL_TYPES.order.bg,attr:`data-order="${o.id}"`});
  for(const t of S.todos) if(t.due===key)
    out.push({kind:'todo',time:t.time||'',end:'',title:(t.done?'✅ ':'☐ ')+t.text,sub:t.who?personName(t.who):'',bg:'#eef0e4',done:!!t.done,attr:`data-todo="${t.id}"`});
  return out.sort((a,b)=>(a.time||'00:00').localeCompare(b.time||'00:00'));
}

/* ---------- the day's timeline (shared by the month and week views) ---------- */
const HOUR=58;
function dayBlocks(key){
  const all=[], timed=[];
  for(const it of calItems(key)){
    if(!it.time){ all.push(it); continue; }
    const [h,m]=it.time.split(':').map(Number), s=h*60+m; let e=s+60;
    if(it.end){ const [h2,m2]=it.end.split(':').map(Number); if(h2*60+m2>s) e=h2*60+m2; }
    timed.push(Object.assign({s,e:Math.min(1440,e)},it));
  }
  // side by side when entries overlap
  timed.sort((a,b)=>a.s-b.s||b.e-a.e);
  let cluster=[], end=-1;
  const flush=()=>{ const cols=[]; for(const t of cluster){ let c=cols.findIndex(x=>x<=t.s); if(c<0){ c=cols.length; cols.push(0); } cols[c]=t.e; t.col=c; } cluster.forEach(t=>t.cols=cols.length); cluster=[]; };
  for(const t of timed){ if(t.s>=end&&cluster.length){ flush(); end=-1; } cluster.push(t); end=Math.max(end,Math.max(t.e,t.s+30)); }
  if(cluster.length) flush();
  return {all,timed};
}
function timelineHTML(key){
  const {all,timed}=dayBlocks(key), isToday=key===nzDay();
  const hours=Array.from({length:24},(_,h)=>`<div class="tl-h" style="top:${h*HOUR}px"><span>${h===0?'':((h%12)||12)+(h<12?' am':' pm')}</span></div>`).join('');
  const blocks=timed.map(t=>{ const top=t.s/60*HOUR, h=Math.max(28,(t.e-t.s)/60*HOUR-2), w=`calc((100% - 58px) / ${t.cols})`, left=`calc(56px + (100% - 58px) * ${t.col} / ${t.cols})`;
    return `<button class="tb ${t.dim?'dim':''} ${t.done?'done':''} ${h<44?'short':''}" ${t.attr} style="top:${top}px;height:${h}px;left:${left};width:${w};background:${t.bg}"><b>${esc(t.title)}</b><small>${esc(t.sub)}</small></button>`; }).join('');
  const now=new Date(), nm_=now.getHours()*60+now.getMinutes();
  return {
    allday: all.map(o=>`<button class="ad ${o.dim?'dim':''} ${o.done?'done':''}" style="background:${o.bg}" ${o.attr}><b>${esc(o.title)}</b>${o.sub?`<small>${esc(o.sub)}</small>`:''}</button>`).join(''),
    tl:`<div class="tl" data-tlday="${key}" style="height:${24*HOUR}px">${hours}${blocks}${isToday?`<div class="tl-now" style="top:${nm_/60*HOUR}px"><span>${t12(String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'))}</span></div>`:''}</div>`,
    scrollTo: isToday?Math.max(0,(nm_/60-1.5)*HOUR):Math.max(0,((timed[0]?timed[0].s:7*60)/60-0.75)*HOUR)
  };
}
function wireItems(box,key){
  box.querySelectorAll('[data-ev]').forEach(b=>b.onclick=()=>{ if(calSuppress) return; const e=S.events.find(x=>x.id===b.dataset.ev); if(e) openEvent(e,b.dataset.occ); });
  box.querySelectorAll('[data-sess]').forEach(b=>b.onclick=()=>{ if(calSuppress) return; const s=S.sessions.find(x=>x.id===b.dataset.sess); if(s) openSession(s); });
  box.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>{ if(calSuppress) return; openOrder(S.orders.find(o=>o.id===b.dataset.order)); });
  box.querySelectorAll('[data-todo]').forEach(b=>b.onclick=()=>{ if(calSuppress) return; const t=S.todos.find(x=>x.id===b.dataset.todo); if(t&&typeof openTodo==='function') openTodo(t); });
  const tl=box.querySelector('.tl');
  if(tl&&canManage()) tl.onclick=e=>{ if(calSuppress||(e.target!==tl&&!e.target.classList.contains('tl-h'))) return; const r=tl.getBoundingClientRect(), m=Math.max(0,Math.min(1425,Math.floor((e.clientY-r.top)/HOUR*4)*15));
    editEvent({date:key,time:String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}); };
}

/* ---------- state kept on this device ---------- */
let calSel=null, calMonth=null, calView=lsGet('rs.calview','month'), calMode=lsGet('rs.calmode','split'), calSnap=lsGet('rs.calsnap','split');
let calSuppress=false, calY=0, calSnaps=null, calScroll=null, calWkScroll=null;
const CAL_MODES=['day','week','split','month'], ROWH=58;
const suppressTap=()=>{ calSuppress=true; setTimeout(()=>calSuppress=false,350); };
function setCalView(v){ calView=v; lsSet('rs.calview',v); calWkScroll=null; drawCal(); }
// back button: a stretched-out view steps back to the usual one first (returns true if it did)
function calBack(){
  if(cur()!=='calendar') return false;
  if(calView==='month'&&calMode!=='split'){ calMode='split'; lsSet('rs.calmode','split'); drawCal(); return true; }
  if(calView==='week'&&calSnap!=='low'){ calSnap='low'; lsSet('rs.calsnap','low'); drawCal(); return true; }
  return false;
}

SCREENS.calendar={
  title:()=>({h:'Calendar',s:canManage()?'Markets, brew days, orders and to-dos':'What\'s on'}),
  html(){ if(missingCols.has('events')) return rulesNotice();   // the rules haven't caught up yet: say so, keep everything else working
    return `<div class="rcal" id="rcal"></div>${canManage()&&!tillLock()?'<button class="cal-fab" id="calFab"></button>':''}`; },
  wire(){ if(!calSel) calSel=nzDay(); drawCal(); }
};
const segHtml=()=>`<div class="pv-seg"><button data-pv="month" class="${calView==='month'?'on':''}">Month</button><button data-pv="week" class="${calView==='week'?'on':''}">Week</button></div>`;
function headHtml(label,prevId,nextId,what){
  return `<div class="pc-head"><h2>${label}</h2>${segHtml()}<button id="${prevId}" aria-label="Previous ${what}">‹</button><button id="${nextId}" aria-label="Next ${what}">›</button><button class="pc-today" id="calToday" aria-label="Today">${kd(nzDay()).getDate()}</button></div>`;
}
function sheetHead(sel,todayK,pid,nid){
  return `<div class="ps-head" id="psHead"><b>${sel.getDate()}</b><span>${fmtD(sel,{weekday:'short'})}${calSel===todayK?' · Today':''}</span><span class="ps-mon">${fmtD(sel,{month:'short'})}</span><button id="${pid}" aria-label="Previous day">‹</button><button id="${nid}" aria-label="Next day">›</button></div>`;
}
function placeCal(el){
  const t=$('#top'); el.style.top=(t?t.offsetHeight:72)+'px';
  const f=$('#calFab'); if(f){ const d=kd(calSel); f.innerHTML=`<span>Add on ${d.getDate()} ${fmtD(d,{month:'short'})}</span><b>＋</b>`; f.onclick=()=>editEvent({date:calSel}); }
}
function drawCal(){
  const el=$('#rcal'); if(!el) return; placeCal(el);
  if(calView==='week') drawWeek(el); else drawMonth(el);
  el.querySelectorAll('[data-pv]').forEach(b=>b.onclick=()=>{ if(calView!==b.dataset.pv) setCalView(b.dataset.pv); });
  $('#calToday').onclick=()=>{ calSel=nzDay(); calMonth=null; calWkScroll=null; drawCal(); };
}
const pick=k=>{ calSel=k; const d=kd(k); if(calMonth&&(d.getMonth()!==calMonth.getMonth()||d.getFullYear()!==calMonth.getFullYear())) calMonth=null; drawCal(); };
const slideDay=(box,next)=>{ if(!box) return; box.classList.remove('slideL','slideR'); void box.offsetWidth; box.classList.add(next?'slideL':'slideR'); };

/* ---------- month: a grid with a sliding day panel ---------- */
function drawMonth(el){
  const sel=kd(calSel), todayK=nzDay();
  if(!calMonth) calMonth=new Date(sel.getFullYear(),sel.getMonth(),1);
  const first=new Date(calMonth), start=monday(first), lastDay=new Date(first.getFullYear(),first.getMonth()+1,0);
  let days=[]; for(let i=0;i<42;i++) days.push(addDays(start,i)); if(dk(days[35])>dk(lastDay)) days=days.slice(0,35);
  const rows=days.length/7, at=days.findIndex(d=>dk(d)===calSel), selRow=at>=0?Math.floor(at/7):0;
  const cells=days.map(d=>{ const k=dk(d), ls=calItems(k), other=d.getMonth()!==calMonth.getMonth();
    return `<button class="pc-cell ${other?'other':''} ${k===todayK?'ctoday':''} ${k===calSel?'sel':''} ${d.getDay()===0?'sun':''}" data-pd="${k}"><span class="n">${d.getDate()}</span>
      <span class="lines">${ls.slice(0,4).map(l=>`<i class="ln ${l.dim?'dim':''}" style="background:${l.bg}"></i>`).join('')}</span>
      <span class="titles">${ls.slice(0,3).map(l=>`<span class="tt ${l.dim?'dim':''}" style="background:${l.bg}">${esc(l.title)}</span>`).join('')}${ls.length>3?`<span class="more">+${ls.length-3}</span>`:''}</span></button>`; }).join('');
  const T=timelineHTML(calSel), keep=el.querySelector('#psScroll');
  calScroll=keep&&el.dataset.day===calSel?keep.scrollTop:null; el.dataset.day=calSel;
  const yr=calMonth.getFullYear()===new Date().getFullYear()?undefined:'numeric';
  el.innerHTML=headHtml(fmtD(calMonth,{month:'long',year:yr}),'calPrev','calNext','month')+`
    <div class="pc-dow">${['M','T','W','T','F','S','S'].map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="pc-gridwrap" id="pcWrap"><div class="pc-grid" id="pcGrid">${cells}</div></div>
    <div class="pc-sheet" id="pcSheet"><div class="pc-grab" id="pcGrab"></div>${sheetHead(sel,todayK,'psPrev','psNext')}
      ${T.allday?`<div class="ps-allday">${T.allday}</div>`:''}<div class="ps-scroll" id="psScroll">${T.tl}</div></div>`;
  const H=el.clientHeight, head=el.querySelector('.pc-head').offsetHeight, gridTop=head+el.querySelector('.pc-dow').offsetHeight;
  calSnaps={day:head, week:gridTop+ROWH+6, split:gridTop+rows*ROWH+6, month:H-96-fabRoom()};
  if(calSnaps.month<calSnaps.split+40) calSnaps.month=calSnaps.split+40;
  const layout=(y,anim)=>{ calY=y; const sh=$('#pcSheet'), wrap=$('#pcWrap'), grid=$('#pcGrid'); if(!sh) return;
    const avail=Math.max(0,y-gridTop-6); let rowH=ROWH, off=0;
    if(avail>=rows*ROWH) rowH=Math.min(avail/rows,160); else off=-Math.min(selRow*ROWH,rows*ROWH-avail);
    [sh,wrap,grid].forEach(x=>x.style.transition=anim?'all .26s ease':'none');
    sh.style.top=y+'px'; wrap.style.height=avail+'px'; grid.style.transform=`translateY(${off}px)`;
    grid.style.gridAutoRows=rowH+'px'; grid.classList.toggle('titles',rowH>=92);
    el.querySelector('.pc-dow').style.opacity=y<=gridTop?0:1; };
  layout(calSnaps[calMode]??calSnaps.split,false);
  const sc=$('#psScroll'); sc.scrollTop=calScroll!=null?calScroll:T.scrollTo;
  el.querySelectorAll('[data-pd]').forEach(b=>b.onclick=()=>{ if(calSuppress) return; const k=b.dataset.pd;
    if(k===calSel&&calMode==='month'){ calMode='split'; lsSet('rs.calmode','split'); drawCal(); return; }
    calSel=k; const d=kd(k); if(d.getMonth()!==calMonth.getMonth()) calMonth=new Date(d.getFullYear(),d.getMonth(),1); drawCal(); });
  const month=n=>{ if(!calEnter) calEnter=n>0?'L':'R'; calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+n,1); drawCal(); };
  $('#calPrev').onclick=()=>month(-1); $('#calNext').onclick=()=>month(1);
  const step=n=>{ calSel=dk(addDays(kd(calSel),n)); const d=kd(calSel); if(d.getMonth()!==calMonth.getMonth()) calMonth=new Date(d.getFullYear(),d.getMonth(),1); drawCal(); slideDay($('#pcSheet .ps-scroll'),n>0); };
  $('#psPrev').onclick=e=>{ e.stopPropagation(); step(-1); }; $('#psNext').onclick=e=>{ e.stopPropagation(); step(1); };
  wireItems($('#pcSheet'),calSel);
  // the day panel follows the finger, then settles on the nearest view (a quick flick moves one view)
  const drag=(zone,needDecide)=>{ let st=null;
    zone.addEventListener('pointerdown',e=>{ if(e.target.closest('button')&&zone.id==='psHead') return; st={y0:e.clientY,x0:e.clientX,top0:calY,live:!needDecide,t0:Date.now(),id:e.pointerId}; if(st.live) try{ zone.setPointerCapture(e.pointerId); }catch(x){} });
    zone.addEventListener('pointermove',e=>{ if(!st) return; const dy=e.clientY-st.y0, dx=e.clientX-st.x0;
      if(!st.live){ if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)*1.3){ st.live=true; try{ zone.setPointerCapture(st.id); }catch(x){} } else if(Math.abs(dx)>12){ st=null; return; } else return; }
      layout(Math.max(calSnaps.day,Math.min(calSnaps.month,st.top0+dy)),false); });
    const end=()=>{ if(!st) return; const s=st; st=null; if(!s.live) return; suppressTap();
      const moved=calY-s.top0, fast=Math.abs(moved)>30&&Date.now()-s.t0<300;
      let best=CAL_MODES.reduce((a,m)=>Math.abs(calSnaps[m]-calY)<Math.abs(calSnaps[a]-calY)?m:a,'split');
      const from=CAL_MODES.reduce((a,m)=>Math.abs(calSnaps[m]-s.top0)<Math.abs(calSnaps[a]-s.top0)?m:a,'split');
      if(fast&&best===from){ const i=CAL_MODES.indexOf(from); best=CAL_MODES[Math.max(0,Math.min(3,i+(moved>0?1:-1)))]; }
      calMode=best; lsSet('rs.calmode',best); layout(calSnaps[best],true); };
    zone.addEventListener('pointerup',end); zone.addEventListener('pointercancel',end);
  };
  drag($('#pcGrab'),false); drag($('#psHead'),false); drag($('#pcWrap'),true);
  swipePage($('#pcWrap'),()=>[$('#pcWrap')],next=>month(next?1:-1)); enterSlide([$('#pcWrap')]);
  swipeX($('#pcSheet'),next=>step(next?1:-1));
}

/* ---------- week: seven columns on a time grid, with the same day panel ---------- */
function drawWeek(el){
  const HW=46, m=monday(kd(calSel)), todayK=nzDay(), now=new Date(), nmin=now.getHours()*60+now.getMinutes();
  const days=Array.from({length:7},(_,i)=>addDays(m,i)), e6=days[6];
  const label=m.getMonth()===e6.getMonth()?`${m.getDate()}–${e6.getDate()} ${fmtD(e6,{month:'short'})}`:`${m.getDate()} ${fmtD(m,{month:'short'})} – ${e6.getDate()} ${fmtD(e6,{month:'short'})}`;
  const keep=el.querySelector('.pw-scroll'); if(keep&&el.dataset.week===dk(m)) calWkScroll=keep.scrollTop;
  const keepDay=el.querySelector('#pwDay'), dayScroll=keepDay&&el.dataset.day===calSel?keepDay.scrollTop:null;
  el.dataset.week=dk(m); el.dataset.day=calSel;
  const B=days.map(d=>{ const k=dk(d); return Object.assign({k,d},dayBlocks(k)); });
  let firstT=24*60; B.forEach(b=>b.timed.forEach(t=>firstT=Math.min(firstT,t.s)));
  const hours=Array.from({length:24},(_,h)=>`<div class="pw-h" style="top:${h*HW}px"><span>${h===0?'':((h%12)||12)+(h<12?'a':'p')}</span></div>`).join('');
  const cols=B.map(b=>`<div class="pw-col ${b.k===todayK?'ctoday':''} ${b.k===calSel?'sel':''}" data-pwcol="${b.k}">${b.timed.map(t=>{ const top=t.s/60*HW, h=Math.max(20,(t.e-t.s)/60*HW-2);
      return `<button class="pw-b ${t.dim?'dim':''} ${t.done?'done':''}" ${t.attr} style="top:${top}px;height:${h}px;left:calc(${t.col} * 100% / ${t.cols});width:calc(100% / ${t.cols} - 2px);background:${t.bg}">${esc(t.title)}</button>`; }).join('')}
      ${b.k===todayK?`<div class="pw-now" style="top:${nmin/60*HW}px"></div>`:''}</div>`).join('');
  const anyAll=B.some(b=>b.all.length), sel=kd(calSel), T=timelineHTML(calSel);
  el.innerHTML=headHtml(label,'pwPrev','pwNext','week')+`
    <div class="pw-days" id="pwDays"><span></span>${B.map((b,i)=>`<button class="pw-d ${b.k===todayK?'ctoday':''} ${b.k===calSel?'sel':''}" data-pwd="${b.k}"><small>${'MTWTFSS'[i]}</small><b>${b.d.getDate()}</b></button>`).join('')}</div>
    <div class="pw-top" id="pwTop">
      ${anyAll?`<div class="pw-all"><span></span>${B.map(b=>`<div>${b.all.slice(0,2).map(o=>`<button class="pw-a ${o.dim?'dim':''}" style="background:${o.bg}" ${o.attr}>${esc(o.title)}</button>`).join('')}${b.all.length>2?`<button class="pw-more" data-pwd="${b.k}">+${b.all.length-2}</button>`:''}</div>`).join('')}</div>`:''}
      <div class="pw-scroll"><div class="pw-grid" style="height:${24*HW}px">${hours}<div class="pw-cols">${cols}</div></div></div>
    </div>
    <div class="pc-sheet" id="pwSheet"><div class="pc-grab" id="pwGrab"></div>${sheetHead(sel,todayK,'pwDPrev','pwDNext')}
      ${T.allday?`<div class="ps-allday">${T.allday}</div>`:''}<div class="ps-scroll" id="pwDay">${T.tl}</div></div>`;
  const H=el.clientHeight, topY=$('#pwDays').offsetTop+$('#pwDays').offsetHeight+2;
  const snaps={top:topY, split:Math.round(topY+(H-topY)*0.42), low:H-96-fabRoom()};
  const layout=(y,anim)=>{ const sh=$('#pwSheet'), tp=$('#pwTop'); if(!sh) return; calY=y;
    sh.style.transition=anim?'top .26s ease':'none'; sh.style.top=y+'px'; tp.style.height=Math.max(0,y-tp.offsetTop+14)+'px'; };
  layout(snaps[calSnap]??snaps.low,false);
  const sc=el.querySelector('.pw-scroll');
  sc.scrollTop=calWkScroll!=null?calWkScroll:Math.max(0,((B.some(b=>b.k===todayK)?nmin-90:Math.min(firstT,7*60)-30)/60)*HW);
  const ds=$('#pwDay'); ds.scrollTop=dayScroll!=null?dayScroll:T.scrollTo;
  wireItems($('#pwSheet'),calSel); wireItems(sc,calSel); const pa=el.querySelector('.pw-all'); if(pa) wireItems(pa,calSel);
  const setSnap=(s,anim=true)=>{ calSnap=s; lsSet('rs.calsnap',s); layout(snaps[s],anim); };
  const choose=k=>{ calSel=k; if(calSnap==='low') calSnap='split'; calWkScroll=sc.scrollTop; drawCal(); };
  const week=n=>{ if(!calEnter) calEnter=n>0?'L':'R'; calSel=dk(addDays(kd(calSel),7*n)); calMonth=null; calWkScroll=sc.scrollTop; drawCal(); };
  $('#pwPrev').onclick=()=>week(-1); $('#pwNext').onclick=()=>week(1);
  $('#pwDPrev').onclick=e=>{ e.stopPropagation(); choose(dk(addDays(kd(calSel),-1))); }; $('#pwDNext').onclick=e=>{ e.stopPropagation(); choose(dk(addDays(kd(calSel),1))); };
  el.querySelectorAll('[data-pwd]').forEach(b=>b.onclick=()=>{ if(!calSuppress) choose(b.dataset.pwd); });
  if(canManage()) el.querySelectorAll('[data-pwcol]').forEach(c=>c.onclick=e=>{ if(e.target!==c||calSuppress) return; const r=c.getBoundingClientRect(), mm=Math.max(0,Math.min(1425,Math.floor((e.clientY-r.top)/HW*4)*15));
    editEvent({date:c.dataset.pwcol,time:String(Math.floor(mm/60)).padStart(2,'0')+':'+String(mm%60).padStart(2,'0')}); });
  const ORDER=['top','split','low'];
  const drag=zone=>{ let st=null;
    zone.addEventListener('pointerdown',e=>{ if(e.target.closest('button')) return; st={y0:e.clientY,top0:calY,t0:Date.now(),live:false}; try{ zone.setPointerCapture(e.pointerId); }catch(x){} });
    zone.addEventListener('pointermove',e=>{ if(!st) return; const dy=e.clientY-st.y0; if(!st.live){ if(Math.abs(dy)<6) return; st.live=true; } layout(Math.max(snaps.top,Math.min(snaps.low,st.top0+dy)),false); });
    const end=()=>{ if(!st) return; const s=st; st=null; if(!s.live) return; suppressTap();
      const moved=calY-s.top0, fast=Math.abs(moved)>30&&Date.now()-s.t0<300;
      let best=ORDER.reduce((a,k)=>Math.abs(snaps[k]-calY)<Math.abs(snaps[a]-calY)?k:a,'split');
      const from=ORDER.reduce((a,k)=>Math.abs(snaps[k]-s.top0)<Math.abs(snaps[a]-s.top0)?k:a,'split');
      if(fast&&best===from){ const i=ORDER.indexOf(from); best=ORDER[Math.max(0,Math.min(2,i+(moved>0?1:-1)))]; }
      setSnap(best); };
    zone.addEventListener('pointerup',end); zone.addEventListener('pointercancel',end);
  };
  drag($('#pwGrab')); drag($('#psHead'));
  $('#psHead').addEventListener('click',e=>{ if(calSuppress||e.target.closest('button')) return; if(calSnap==='low') setSnap('split'); });
  const movers=()=>[$('#pwDays'),el.querySelector('.pw-all'),el.querySelector('.pw-cols')];
  swipePage($('#pwTop'),movers,next=>week(next?1:-1)); swipePage($('#pwDays'),movers,next=>week(next?1:-1)); enterSlide(movers());
  swipeX($('#pwSheet'),next=>choose(dk(addDays(kd(calSel),next?1:-1))));
}
// room for the floating "Add on …" button, so the day panel's header (date and ‹ ›) is never under it
const fabRoom=()=>{ const f=$('#calFab'); return f&&f.offsetHeight?f.offsetHeight+16:0; };
// weeks and months follow the finger sideways; let go past a quarter of the width (or flick) and it
// slides on to the next one and snaps there (a week always starts on Monday), otherwise it springs back
let calEnter=null;
function swipePage(zone,movers,go){
  if(!zone) return; let sx=null,sy=0,t0=0,horiz=null,dx=0;
  const set=(x,anim)=>movers().forEach(m=>{ if(!m) return; m.style.transition=anim?'transform .18s ease-out':'none'; m.style.transform=x?`translateX(${x}px)`:''; });
  zone.addEventListener('touchstart',e=>{ if(e.touches.length!==1){ sx=null; return; } sx=e.touches[0].clientX; sy=e.touches[0].clientY; t0=Date.now(); horiz=null; dx=0; },{passive:true});
  zone.addEventListener('touchmove',e=>{ if(sx==null) return; const t=e.touches[0]; dx=t.clientX-sx; const dy=t.clientY-sy;
    if(horiz==null){ if(Math.abs(dx)<8&&Math.abs(dy)<8) return; horiz=Math.abs(dx)>Math.abs(dy)*1.2; }
    if(horiz) set(dx,false); },{passive:true});
  zone.addEventListener('touchend',()=>{ if(sx==null) return; sx=null; if(!horiz) return;
    const W=zone.clientWidth||innerWidth, fast=Math.abs(dx)>40&&Date.now()-t0<300;
    if(Math.abs(dx)>W*0.25||fast){ suppressTap(); const next=dx<0; set(next?-W:W,true); setTimeout(()=>{ calEnter=next?'L':'R'; go(next); },170); }
    else set(0,true); },{passive:true});
  zone.addEventListener('touchcancel',()=>{ if(sx!=null&&horiz) set(0,true); sx=null; },{passive:true});
}
// the new week or month slides in from the side it was swiped towards
function enterSlide(els){ if(!calEnter) return; const from=calEnter==='L'?'35%':'-35%'; calEnter=null;
  els.forEach(m=>{ if(!m) return; m.style.transition='none'; m.style.transform=`translateX(${from})`; m.style.opacity='.4'; void m.offsetWidth; m.style.transition='transform .2s ease-out, opacity .2s'; m.style.transform=''; m.style.opacity=''; }); }
// a sideways swipe (clearly more across than down, and quick) calls go(true) for next, go(false) for previous
function swipeX(zone,go){
  if(!zone) return; let sx=null,sy=0,t0=0;
  zone.addEventListener('touchstart',e=>{ if(e.touches.length!==1){ sx=null; return; } sx=e.touches[0].clientX; sy=e.touches[0].clientY; t0=Date.now(); },{passive:true});
  zone.addEventListener('touchend',e=>{ if(sx==null) return; const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy; sx=null;
    if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.6&&Date.now()-t0<700){ suppressTap(); go(dx<0); } },{passive:true});
}
setInterval(()=>{ if(cur()!=='calendar') return; document.querySelectorAll('.tl-now').forEach(n=>{ const d=new Date(); n.style.top=((d.getHours()*60+d.getMinutes())/60*HOUR)+'px'; }); },60000);
addEventListener('resize',()=>{ if(cur()==='calendar') drawCal(); });

/* ---------- looking at an entry ---------- */
function openEvent(e,occ){
  if(canManage()&&!tillLock()){ editEvent(e,occ); return; }
  const ty=calType(e), pl=S.places.find(p=>p.id===e.place), who=(e.attendees||[]).map(personName);
  modal((m,close)=>{ m.innerHTML=`<h2>${ty.ic} ${esc(e.title||ty.t)}</h2>
      <p><b>${esc(nzDate(kd(occ||e.date)))}</b>${e.days>1?' · '+e.days+' days':''}<br>${e.time?t12(e.time)+(e.end?' – '+t12(e.end):''):'All day'}${e.rpt?' · 🔁 '+esc(REPEATS[e.rpt]):''}</p>
      ${pl&&pl.address?`<p>📍 <a href="https://maps.google.com/?q=${encodeURIComponent(pl.address)}" target="_blank" rel="noopener">${esc(pl.address)}</a></p>`:''}
      ${e.type==='market'?`<p>${who.length?'On the stall: '+esc(who.join(', ')):'Nobody rostered yet.'}</p>${rostered(e)?'':'<p class="note">You\'re not rostered on this one. It\'s here so you know it\'s on.</p>'}`:''}
      ${e.note?`<p class="note">${esc(e.note)}</p>`:''}<div class="mact"><button class="btn" id="eOk">OK</button></div>`;
    m.querySelector('#eOk').onclick=close; });
}
function openSession(s){
  const money=canManage()&&!tillLock()&&Date.now()<moneyUntil, t=money?dayTotals(s):null;
  modal((m,close)=>{ m.innerHTML=`<h2>💵 ${esc(s.name||(DAY_TYPES[s.type]||'').replace(/^\S+ /,''))}</h2>
      <p>${esc(nzDate(kd(s.date)))}<br>Started ${nzTime(s.openedAt)}${s.status==='open'?' · selling now':' · closed '+nzTime(s.closedAt||s.openedAt)}</p>
      ${money?`<p><b>${t.count} sale${t.count===1?'':'s'}, ${c2(t.total)}</b></p>`:canManage()&&!tillLock()?'<p class="note">Takings are hidden. Use 🔒 Show on the home screen to see them for a minute.</p>':''}
      <div class="mact"><button class="btn" id="sOk">OK</button></div>`;
    m.querySelector('#sOk').onclick=close; });
}

/* ---------- adding or changing an entry (owners and managers) ---------- */
function editEvent(src,occ){
  if(!canManage()||tillLock()) return;
  const isNew=!src.id, e=Object.assign({type:'market',title:'',date:calSel||nzDay(),time:'',end:'',days:1,rpt:'',until:'',attendees:[],remind:['day'],note:'',place:''},JSON.parse(JSON.stringify(src)));
  const people=SYNC.getMembers();
  modal((m,close)=>{
    const markets=()=>S.places.filter(p=>!p.gone&&(p.group==='markets'||p.channel==='retail'));
    const draw=()=>{ const ty=calType(e);
      m.innerHTML=`<h2>${isNew?'Add to the calendar':ty.ic+' '+esc(e.title||ty.t)}</h2>
        <div class="bigseg">${Object.entries(CAL_TYPES).map(([k,v])=>`<button data-ty="${k}" class="${e.type===k?'on':''}">${v.ic} ${v.t}</button>`).join('')}</div>
        ${e.type==='market'?`<label class="note" for="eP">Which market?</label><select class="txt" id="eP"><option value="">Choose…</option>${markets().map(p=>`<option value="${p.id}" ${e.place===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}<option value="+">＋ Add a new market…</option></select>`:''}
        <label class="note" for="eT">${e.type==='market'?'Name on the calendar':'What'}</label><input class="txt" id="eT" value="${esc(e.title)}" autocapitalize="sentences" placeholder="${e.type==='brew'?'e.g. Lavender lip balm':e.type==='order'?'e.g. Kowhai Store order':''}">
        <div class="formrow"><div><label class="note" for="eD">Date</label><input class="txt" id="eD" type="date" value="${e.date}"></div>
          <div><label class="note" for="eN">Days</label><select class="txt" id="eN">${[1,2,3,4,5,6,7].map(n=>`<option ${+e.days===n?'selected':''}>${n}</option>`).join('')}</select></div></div>
        <div class="formrow"><div><label class="note" for="eS">Starts (optional)</label><input class="txt" id="eS" type="time" value="${e.time}"></div>
          <div><label class="note" for="eE">Finishes</label><input class="txt" id="eE" type="time" value="${e.end}"></div></div>
        <label class="note" for="eR">Repeats</label><select class="txt" id="eR">${Object.entries(REPEATS).map(([k,v])=>`<option value="${k}" ${e.rpt===k?'selected':''}>${v}</option>`).join('')}</select>
        ${e.rpt?`<label class="note" for="eU">Until (optional)</label><input class="txt" id="eU" type="date" value="${e.until||''}">`:''}
        ${e.type==='market'?`<p class="note" style="margin-bottom:4px">Who's on the stall? (helpers who aren't ticked see it greyed out)</p><div class="pastnames">${people.map(p=>`<button class="chip big ${(e.attendees||[]).includes(p)?'on':''}" data-who="${esc(p)}">${esc(personName(p))}</button>`).join('')}</div>`:''}
        <p class="note" style="margin-bottom:4px">Remind me</p><div class="pastnames">${Object.entries(REMINDERS).map(([k,v])=>`<button class="chip ${(e.remind||[]).includes(k)?'on':''}" data-rem="${k}">${v}</button>`).join('')}</div>
        <p class="note">Reminders arrive as notifications once those are switched on (coming with the alerts stage).</p>
        <label class="note" for="eNo">Notes (optional)</label><textarea class="txt" id="eNo" rows="2">${esc(e.note||'')}</textarea>
        <div class="mact">${isNew?'':'<button class="btn danger" id="eDel">Delete…</button>'}<button class="btn alt" id="eC">Cancel</button><button class="btn" id="eOk">Save</button></div>`;
      const grab=()=>{ e.title=m.querySelector('#eT').value.trim(); e.date=m.querySelector('#eD').value||e.date; e.days=+m.querySelector('#eN').value||1; e.time=m.querySelector('#eS').value; e.end=m.querySelector('#eE').value; e.rpt=m.querySelector('#eR').value; const u=m.querySelector('#eU'); e.until=u?u.value:''; e.note=m.querySelector('#eNo').value.trim(); };
      m.querySelectorAll('[data-ty]').forEach(b=>b.onclick=()=>{ grab(); e.type=b.dataset.ty; draw(); });
      m.querySelector('#eR').onchange=()=>{ grab(); draw(); };
      const ps=m.querySelector('#eP'); if(ps) ps.onchange=()=>{ grab();
        if(ps.value==='+'){ editPlace({group:'markets',channel:'retail'},p=>{ e.place=p.id; e.title=p.name; draw(); }); ps.value=e.place||''; return; }
        const p=S.places.find(x=>x.id===ps.value); const old=S.places.find(x=>x.id===e.place); if(p&&(!e.title||(old&&e.title===old.name))) e.title=p.name; e.place=ps.value; draw(); };
      m.querySelectorAll('[data-who]').forEach(b=>b.onclick=()=>{ const w=b.dataset.who, a=e.attendees||(e.attendees=[]); const i=a.indexOf(w); if(i<0) a.push(w); else a.splice(i,1); b.classList.toggle('on',i<0); });
      m.querySelectorAll('[data-rem]').forEach(b=>b.onclick=()=>{ const r=b.dataset.rem, a=e.remind||(e.remind=[]); const i=a.indexOf(r); if(i<0) a.push(r); else a.splice(i,1); b.classList.toggle('on',i<0); });
      m.querySelector('#eC').onclick=close;
      const del=m.querySelector('#eDel'); if(del) del.onclick=()=>deleteEvent(e,occ,close);
      m.querySelector('#eOk').onclick=()=>{ grab();
        if(!e.title&&e.type!=='market'){ toast('Type what it is'); return; }
        if(e.type==='market'&&!e.title&&!e.place){ toast('Choose the market'); return; }
        if(e.time&&e.end&&e.end<=e.time&&+e.days===1){ toast('The finish time is before the start'); return; }
        if(e.until&&e.until<e.date){ toast('"Until" is before the first date'); return; }
        if(!e.title){ const p=S.places.find(x=>x.id===e.place); e.title=p?p.name:calType(e).t; }
        if(e.type!=='market'){ e.attendees=[]; e.place=''; }
        if(!e.rpt) e.until='';
        e.by=e.by||SYNC.me(); e.changed=Date.now();
        if(isNew){ e.id=SYNC.newId('events'); S.events.push(e); } else { const x=S.events.find(y=>y.id===e.id); if(x) Object.assign(x,e); }
        save(); close(); calSel=e.date; calMonth=null; if(cur()==='calendar') drawCal(); toast('Saved'); };
    };
    draw();
  });
}
function deleteEvent(e,occ,closeEdit){
  const del=()=>{ const i=S.events.findIndex(x=>x.id===e.id); if(i>=0) S.events.splice(i,1); save(); closeEdit(); drawCal(); toast('Deleted'); };
  if(!e.rpt){ confirmBox('Delete this entry?',esc(e.title||'')+' will be removed from the calendar.','Delete',del,true); return; }
  modal((m,close)=>{ m.innerHTML=`<h2>Delete a repeating entry</h2><p>${esc(e.title||'')} repeats. Remove just ${esc(nzDate(kd(occ||e.date),{day:'numeric',month:'long'}))}, or every one?</p>
      <div class="mact"><button class="btn alt" id="dC">Cancel</button><button class="btn" id="dOne">Just this one</button><button class="btn danger" id="dAll">Every one</button></div>`;
    m.querySelector('#dC').onclick=close;
    m.querySelector('#dOne').onclick=()=>{ const x=S.events.find(y=>y.id===e.id); if(x){ x.skip=[...(x.skip||[]),occ||x.date]; save(); } close(); closeEdit(); drawCal(); toast('Removed that day'); };
    m.querySelector('#dAll').onclick=()=>{ close(); del(); }; });
}
