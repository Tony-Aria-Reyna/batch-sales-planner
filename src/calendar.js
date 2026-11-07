/* ================= Calendar =================
   First version: a month view with every selling day marked by type; tap a day to see what happened.
   Planned markets, batches to bottle and order due dates will be added here in later stages.
   Money is only shown to owners and managers after "🔒 Show" (same rule as the home screen). */
let calMonth=null, calDay=null;
const ymd=(y,m,d)=>y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
SCREENS.calendar={
  title:()=>({h:'Calendar',s:'Markets and selling days'}),
  html(){
    if(!calMonth){ const t=nzDay(); calMonth={y:+t.slice(0,4),m:+t.slice(5,7)-1}; calDay=t; }
    const {y,m}=calMonth, first=new Date(Date.UTC(y,m,1)), days=new Date(Date.UTC(y,m+1,0)).getUTCDate(), lead=(first.getUTCDay()+6)%7, today=nzDay();
    const byDay={}; S.sessions.forEach(s=>{ (byDay[s.date]=byDay[s.date]||[]).push(s); });
    const monthName=new Intl.DateTimeFormat('en-NZ',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
    let cells=''; for(let i=0;i<lead;i++) cells+='<div class="cd empty"></div>';
    for(let d=1;d<=days;d++){ const k=ymd(y,m,d), list=byDay[k]||[];
      cells+=`<button class="cd ${k===today?'istoday':''} ${k===calDay?'sel':''}" data-day="${k}"><div class="cdi"><span class="dn">${d}</span>${list.slice(0,3).map(s=>`<span class="ev ${s.type}">${(DAY_TYPES[s.type]||'').split(' ')[0]}<b>${esc(s.name||(DAY_TYPES[s.type]||'').replace(/^\S+ /,''))}</b></span>`).join('')}${list.length>3?`<span class="more">+${list.length-3}</span>`:''}</div></button>`; }
    const sel=(byDay[calDay]||[]).sort((a,b)=>a.openedAt-b.openedAt), money=canManage()&&!tillLock()&&Date.now()<moneyUntil;
    const nice=calDay?new Intl.DateTimeFormat('en-NZ',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(calDay+'T12:00:00Z')):'';
    return `<div class="card"><div class="calhead"><button class="btn alt small" id="calPrev" aria-label="Previous month">‹</button><h3 style="margin:0;flex:1;text-align:center">${monthName}</h3><button class="btn alt small" id="calNext" aria-label="Next month">›</button></div>
      <div class="calgrid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="cw">${d}</div>`).join('')}${cells}</div>
      ${calMonth.y+'-'+calMonth.m!==today.slice(0,4)+'-'+(+today.slice(5,7)-1)?'<p style="text-align:center;margin:10px 0 0"><button class="linkb" id="calToday">Back to this month</button></p>':''}</div>
      <div class="card"><h3>${esc(nice)}</h3>${sel.length?sel.map(s=>{ const t=dayTotals(s); return `<div class="row"><span style="font-size:26px">${(DAY_TYPES[s.type]||'').split(' ')[0]}</span><div class="grow"><b>${esc((DAY_TYPES[s.type]||'').replace(/^\S+ /,''))}${s.name?' · '+esc(s.name):''}</b>
          <small>${s.status==='open'?'Open now':'Closed '+nzTime(s.closedAt||s.openedAt)} · started ${nzTime(s.openedAt)}${money?' · '+t.count+' sale'+(t.count===1?'':'s')+', '+c2(t.total):''}</small></div></div>`; }).join('')
        :'<p class="note">No selling days.</p>'}
        ${canManage()&&!tillLock()&&sel.length&&!money?'<p class="note">Takings are hidden. Use 🔒 Show on the home screen to see them for a minute.</p>':''}</div>
      <div class="card"><h3>Coming to the calendar</h3><p class="note">Planning markets ahead, batches to bottle and when orders are due will show here, in later stages.</p></div>`;
  },
  wire(){
    const shift=n=>{ let {y,m}=calMonth; m+=n; if(m<0){ m=11; y--; } if(m>11){ m=0; y++; } calMonth={y,m}; render(); };
    $('#calPrev').onclick=()=>shift(-1); $('#calNext').onclick=()=>shift(1);
    const ct=$('#calToday'); if(ct) ct.onclick=()=>{ calMonth=null; render(); };
    document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{ calDay=b.dataset.day; render(); });
    // swipe left or right to change month
    const g=$('.calgrid'); let x0=null; g.addEventListener('touchstart',e=>{ x0=e.touches[0].clientX; },{passive:true});
    g.addEventListener('touchend',e=>{ if(x0===null) return; const dx=e.changedTouches[0].clientX-x0; x0=null; if(Math.abs(dx)>60) shift(dx<0?1:-1); },{passive:true});
  }
};
