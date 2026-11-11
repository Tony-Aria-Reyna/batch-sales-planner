/* ================= Today, the morning pop-up, and goals =================
   Everything that needs doing today, in one card at the top of the home screen, each line tappable and tickable;
   a sheet the first time the app opens each day ("Good morning: 3 things today", Done or Later); and goals: a
   monthly takings target and a weekly hours ceiling, with a progress bar on the home screen and charts in
   Real profit. Nothing here calls out; it's all worked out from what's already on the device. */

/* ---------- what's on today ---------- */
function todayItems(){
  const t=nzDay(), me=SYNC.me(), l=[], manage=canManage()&&!tillLock();
  // markets and other calendar entries
  eventsOn(t).filter(e=>e.type!=='todo').forEach(e=>{ const mine=canManage()||(e.attendees||[]).includes(me); if(!mine) return;
    const pl=e.type==='market'?marketPlan(e):null, open=openDay();
    l.push({k:'ev:'+e.id,ic:e.type==='market'?'🧺':e.type==='brew'?'🫙':e.type==='order'?'📦':'📌',t:e.title+(e.time?' · '+t12(e.time):''),d:pl&&pl.ok?'Leave home '+t12(pl.leave)+' · back about '+t12(pl.back):e.note||'',
      done:e.type==='market'&&!!(open&&open.eventId===e.id)||(S.sessions||[]).some(s=>s.eventId===e.id&&s.status==='closed'),act:()=>{ if(e.type==='market'&&!openDay()&&!(S.sessions||[]).some(s=>s.eventId===e.id)) go('sell'); else go('calendar'); },big:e.type==='market'}); });
  // to-dos: overdue, then today's (mine, or anyone's for owners and managers)
  (S.todos||[]).filter(x=>!x.done&&!x.cleared&&x.due&&x.due<=t&&(canManage()||!x.who||x.who===me)).sort((a,b)=>(a.due+(a.time||'99')).localeCompare(b.due+(b.time||'99'))).forEach(x=>{
    l.push({k:'td:'+x.id,ic:x.due<t?'⚠️':'✅',t:x.text,d:(x.due<t?'Was due '+nzDate(kd(x.due),{weekday:'short',day:'numeric',month:'short'}):x.time?'At '+t12(x.time):'Today')+(x.who&&x.who!==me?' · '+personName(x.who):''),tick:()=>{ x.done=true; x.doneAt=Date.now(); x.doneBy=me; save(); },act:()=>openTodo(x)}); });
  if(manage){
    (typeof jars==='function'?jars():[]).filter(b=>b.ready<=t).forEach(b=>l.push({k:'jar:'+b.id,ic:'🌼',t:'Strain '+b.name,d:b.where||'',act:()=>strainJar(b)}));
    (S.orders||[]).filter(o=>o.status==='check').forEach(o=>l.push({k:'oc:'+o.id,ic:'📥',t:'Check the order from '+((o.customer||{}).name||'email'),d:'From email · nothing is final until you confirm',act:()=>openOrder(o)}));
    (S.orders||[]).filter(o=>o.status==='new'&&o.due&&o.due<=t).forEach(o=>l.push({k:'od:'+o.id,ic:'📦',t:'Pack '+((o.customer||{}).name||'the order'),d:o.due<t?'Was due '+nzDate(kd(o.due),{day:'numeric',month:'short'}):'Due today',act:()=>openOrder(o)}));
    if(typeof overdueOrders==='function') overdueOrders().slice(0,3).forEach(o=>l.push({k:'op:'+o.id,ic:'💰',t:((o.customer||{}).name||'A shop')+' hasn\'t paid',d:c2(o.total!=null?o.total:orderTotal(o))+' · past their terms',act:()=>openOrder(o)}));
    (S.asks||[]).filter(a=>a.status==='waiting'&&a.date===t).forEach(a=>l.push({k:'ask:'+a.id,ic:'🙋',t:(a.byName||'A helper')+' asks to open '+a.placeName,d:'Waiting on you',act:()=>askWindow(a)}));
  }
  const ready=(typeof pendingNotes==='function'?pendingNotes():[]).filter(n=>n.status==='ready');
  if(ready.length) l.push({k:'notes',ic:'🎙',t:ready.length+' note'+(ready.length===1?'':'s')+' ready to check',d:(ready[0].say||ready[0].heard||'').slice(0,80),act:()=>reviewNote(ready[0])});
  return l;
}
function todayCardHtml(){
  if(tillLock()) return ''; const l=todayItems(), open=l.filter(x=>!x.done);
  const head=`<h3>📌 Today · ${esc(nzDate(new Date(),{weekday:'long',day:'numeric',month:'long'}))}</h3>`;
  if(!l.length) return `<div class="card todaycard">${head}<p class="chkline">Nothing booked. 🌿 <button class="linkb" data-go="calendar">See the week ›</button></p></div>`;
  return `<div class="card todaycard">${head}${open.length?'':'<p class="chkline">All done for today. 🌿</p>'}
    ${l.map(x=>`<div class="trow ${x.done?'done':''} ${x.big?'big':''}"><button class="tmain" data-tact="${esc(x.k)}"><span class="tic">${x.ic}</span><span class="ttxt"><b>${esc(x.t)}</b>${x.d?`<small>${esc(x.d)}</small>`:''}</span></button>${x.tick&&!x.done?`<button class="ttick" data-ttick="${esc(x.k)}" aria-label="Done">✓</button>`:x.done?'<span class="ttick on">✓</span>':''}</div>`).join('')}</div>`;
}
function wireToday(){
  const l=todayItems();
  document.querySelectorAll('[data-tact]').forEach(b=>b.onclick=()=>{ const x=l.find(y=>y.k===b.dataset.tact); if(x&&x.act) x.act(); });
  document.querySelectorAll('[data-ttick]').forEach(b=>b.onclick=()=>{ const x=l.find(y=>y.k===b.dataset.ttick); if(x&&x.tick){ x.tick(); toast('Done ✓'); render(); } });
}

/* ---------- the morning pop-up ---------- */
// once a day on each device, the first time the app is opened (owners and managers; helpers see their markets and to-dos)
function morningSheet(force){
  if(tillLock()||(typeof practice!=='undefined'&&practice)) return; const t=nzDay();
  if(!force&&(lsGet('rs.morning','')===t||modalStack.length)) return;
  const until=+lsGet('rs.morningLater','')||0; if(!force&&until>Date.now()) return;
  const items=todayItems().filter(x=>!x.done); if(!items.length&&!force){ lsSet('rs.morning',t); return; }
  const h=new Date().getHours(), greet=h<12?'Good morning':h<17?'Good afternoon':'Good evening', who=(S.settings.phones||{})[SYNC.me()]&&(S.settings.phones||{})[SYNC.me()].n||(typeof personName==='function'?personName(SYNC.me()):'');
  modal((m,close)=>{ const draw=()=>{ const l=todayItems().filter(x=>!x.done);
      m.innerHTML=`<h2>☀️ ${greet}${who?', '+esc(who.split(' ')[0]):''}</h2><p class="note">${l.length?l.length+' thing'+(l.length===1?'':'s')+' for today.':'Nothing left for today. 🌿'}</p>
        ${l.map(x=>`<div class="trow ${x.big?'big':''}"><button class="tmain" data-mact="${esc(x.k)}"><span class="tic">${x.ic}</span><span class="ttxt"><b>${esc(x.t)}</b>${x.d?`<small>${esc(x.d)}</small>`:''}</span></button>${x.tick?`<button class="ttick" data-mtick="${esc(x.k)}" aria-label="Done">✓</button>`:''}</div>`).join('')}
        ${goalBarHtml()}
        <div class="mact"><button class="btn alt" id="mLater">⏰ Later (1 hour)</button><button class="btn bigyes" id="mOk">👍 Got it</button></div>`;
      m.querySelectorAll('[data-mtick]').forEach(b=>b.onclick=()=>{ const x=todayItems().find(y=>y.k===b.dataset.mtick); if(x&&x.tick){ x.tick(); toast('Done ✓'); draw(); } });
      m.querySelectorAll('[data-mact]').forEach(b=>b.onclick=()=>{ const x=todayItems().find(y=>y.k===b.dataset.mact); lsSet('rs.morning',t); close(); if(x&&x.act) x.act(); });
      m.querySelector('#mOk').onclick=()=>{ lsSet('rs.morning',t); close(); render(); };
      m.querySelector('#mLater').onclick=()=>{ lsSet('rs.morningLater',String(Date.now()+3600e3)); close(); toast('I\'ll show it again in an hour'); }; };
    draw(); },{sticky:true});
}
// after "Later", bring it back an hour on, wherever she is (not mid-sale)
setInterval(()=>{ try{ const until=+lsGet('rs.morningLater','')||0; if(until&&until<=Date.now()&&lsGet('rs.morning','')!==nzDay()&&!modalStack.length&&cur()!=='sell'&&SYNC.businessId&&SYNC.businessId()){ lsSet('rs.morningLater',''); morningSheet(); } }catch(e){} },30000);

/* ---------- goals ---------- */
const goalMonth=()=>+(S.settings.goalMonth||0);       // cents, takings a month
const goalHours=()=>+(S.settings.goalHours||0);       // hours a week, a ceiling
function monthProgress(){
  const t=nzDay(), first=t.slice(0,8)+'01', end=kd(first); end.setMonth(end.getMonth()+1); end.setDate(0); const last=dk(end);
  const taken=S.sales.filter(s=>!s.voided&&s.date>=first&&s.date<=t).reduce((n,s)=>n+s.total,0)+(S.orders||[]).filter(o=>o.status==='sent'&&(o.sentAt?nzDay(new Date(o.sentAt)):o.date)>=first&&(o.sentAt?nzDay(new Date(o.sentAt)):o.date)<=t).reduce((n,o)=>n+(o.total!=null?o.total:orderTotal(o)),0);
  const days=end.getDate(), day=+t.slice(8), left=days-day, goal=goalMonth();
  const expect=goal?Math.round(goal*day/days):0, pace=goal?taken/Math.max(1,expect):0;
  return {first,last,taken,goal,days,day,left,expect,status:!goal?'':taken>=goal?'done':pace>=0.95?'ontrack':pace>=0.75?'close':'behind'};
}
function goalBarHtml(){
  const g=monthProgress(); if(!g.goal||!canManage()||tillLock()) return '';
  const pct=Math.min(100,Math.round(g.taken/g.goal*100)), mk=Math.min(100,Math.round(g.expect/g.goal*100));
  const word={done:'🎉 Goal reached',ontrack:'On track',close:'A little behind',behind:'Behind'}[g.status];
  return `<div class="goal ${g.status}"><div class="grow"><b>${esc(nzDate(kd(g.first),{month:'long'}))}: ${c2(g.taken)} of ${c2(g.goal)}</b><small>${word} · ${g.left} day${g.left===1?'':'s'} left${g.status!=='done'?' · '+c2(Math.max(0,g.goal-g.taken))+' to go':''}</small></div>
    <div class="gbar"><i style="width:${pct}%"></i><em style="left:${mk}%" title="where you'd be on an even pace"></em></div></div>`;
}
// 8 weeks of takings, Monday to Sunday, as bars
function weeksChart(n){
  const t=kd(nzDay()), dow=(t.getDay()+6)%7, mon=addDays(t,-dow), weeks=[];
  for(let i=n-1;i>=0;i--){ const s=addDays(mon,-7*i), e=addDays(s,6), a=dk(s), b=dk(e); weeks.push({a,b,v:S.sales.filter(x=>!x.voided&&x.date>=a&&x.date<=b).reduce((m,x)=>m+x.total,0)}); }
  const max=Math.max(1,...weeks.map(w=>w.v)), W=300, H=90, bw=W/weeks.length;
  return `<svg class="wchart" viewBox="0 0 ${W} ${H+18}" role="img" aria-label="Takings by week">${weeks.map((w,i)=>{ const h=Math.round(w.v/max*H), last=i===weeks.length-1; return `<rect x="${(i*bw+4).toFixed(1)}" y="${H-h}" width="${(bw-8).toFixed(1)}" height="${h}" rx="4" class="${last?'cur':''}"/><text x="${(i*bw+bw/2).toFixed(1)}" y="${H+14}" text-anchor="middle">${esc(nzDate(kd(w.a),{day:'numeric',month:'numeric'}))}</text>${w.v?`<text x="${(i*bw+bw/2).toFixed(1)}" y="${Math.max(10,H-h-4)}" text-anchor="middle" class="v">${Math.round(w.v/100)}</text>`:''}`; }).join('')}</svg>`;
}
function weeksCardHtml(){
  if(!canManage()||tillLock()||!S.sales.length) return '';
  return `<div class="card"><h3>📈 The last 8 weeks</h3>${weeksChart(8)}<p class="note">Takings a week, in dollars. This week is the dark bar.</p></div>`;
}
// Real profit: 12 months against the goal, and hours against the ceiling
function monthsChart(){
  const t=kd(nzDay()), months=[];
  for(let i=11;i>=0;i--){ const s=new Date(t.getFullYear(),t.getMonth()-i,1), e=new Date(s.getFullYear(),s.getMonth()+1,0), a=dk(s), b=dk(e);
    const H=ownerHours(a,b); months.push({a,b,m:s.getMonth(),v:S.sales.filter(x=>!x.voided&&x.date>=a&&x.date<=b).reduce((n,x)=>n+x.total,0),hrs:Math.round(H.total/60)}); }
  const goal=goalMonth(), max=Math.max(1,goal,...months.map(w=>w.v)), W=360, Hh=120, bw=W/12, gy=goal?Hh-Math.round(goal/max*Hh):-1;
  return `<svg class="wchart tall" viewBox="0 0 ${W} ${Hh+18}" role="img" aria-label="Takings by month against the goal">${gy>=0?`<line x1="0" x2="${W}" y1="${gy}" y2="${gy}" class="goalline"/><text x="${W-2}" y="${Math.max(10,gy-3)}" text-anchor="end" class="v">goal ${c2(goal)}</text>`:''}${months.map((w,i)=>{ const h=Math.round(w.v/max*Hh), last=i===11; return `<rect x="${(i*bw+3).toFixed(1)}" y="${Hh-h}" width="${(bw-6).toFixed(1)}" height="${h}" rx="3" class="${last?'cur':''} ${goal&&w.v>=goal?'hit':''}"/><text x="${(i*bw+bw/2).toFixed(1)}" y="${Hh+14}" text-anchor="middle">${MONTHS[w.m]}</text>`; }).join('')}</svg>`;
}
function goalsCardHtml(){
  const g=monthProgress(), hrs=goalHours(), wk=(()=>{ const t=kd(nzDay()), dow=(t.getDay()+6)%7, a=dk(addDays(t,-dow)); return Math.round(ownerHours(a,nzDay()).total/60*10)/10; })();
  return `<div class="card"><h3>🎯 Where you're heading</h3>${g.goal?goalBarHtml():'<p class="note">Set a monthly takings goal in Setup → Goals, and it shows here and on the home screen.</p>'}
    ${monthsChart()}<p class="note">Takings a month, the last 12 months${g.goal?'; the line is the goal':''}.</p>
    ${hrs?`<div class="goal ${wk>hrs?'behind':'ontrack'}"><div class="grow"><b>This week: ${wk} h of your ${hrs} h ceiling</b><small>${wk>hrs?'Over: that\'s the sign to say no to something':'Within your ceiling'}</small></div><div class="gbar"><i style="width:${Math.min(100,Math.round(wk/hrs*100))}%"></i></div></div>`:''}</div>`;
}
function goalsSetupHtml(){
  if(role()!=='owner') return '';
  return `<div class="card"><h3>🎯 Goals</h3><p class="note">Where you're trying to get to. The home screen shows how the month is going against it; Real profit shows the year.</p>
    <div class="formrow"><div><label class="note" for="gMonth">Takings a month ($, incl GST)</label><input class="txt" id="gMonth" inputmode="decimal" value="${goalMonth()?(goalMonth()/100).toFixed(0):''}" placeholder="e.g. 6000"></div>
      <div><label class="note" for="gHours">Hours a week, at most</label><input class="txt" id="gHours" inputmode="numeric" value="${goalHours()||''}" placeholder="e.g. 30"></div></div></div>`;
}
function wireGoalsSetup(){
  const gm=$('#gMonth'); if(gm) gm.onchange=()=>{ const v=gm.value.trim(), c=v?toCents(v):0; if(v&&!(c>0)){ toast('Type the amount, e.g. 6000'); gm.value=goalMonth()?(goalMonth()/100).toFixed(0):''; return; } S.settings.goalMonth=c; save(); toast('Saved'); };
  const gh=$('#gHours'); if(gh) gh.onchange=()=>{ const v=+gh.value||0; if(gh.value&&!(v>0&&v<=100)){ toast('Type the hours, e.g. 30'); gh.value=goalHours()||''; return; } S.settings.goalHours=v; save(); toast('Saved'); };
}
