/* ================= Lists: To do, Shopping and Ideas =================
   To do:    owners and managers see everyone's; a helper sees only their own and can add one for themselves.
             A to-do with a date also shows on the Calendar.
   Shopping: everyone can add and tick. Ticking asks what was actually bought (size and how many, and,
             for owners and managers, the price paid), because the shop doesn't always have the size wanted.
             A price paid is kept with its date, so later price changes never rewrite past costs.
   Ideas:    owners and managers only: product ideas, people to call, things to think about. */
let listTab=lsGet('rs.listtab','todo'), todoWho=lsGet('rs.todowho','all');
const LIST_TABS=()=>[['todo','✅ To do'],['shop','🛒 Shopping']].concat(canManage()?[['ideas','💡 Ideas']]:[]).concat([['voice','🎙 Voice notes'+(pendingNotes().length?' ('+pendingNotes().length+')':'')]]);
const todoDue=t=>t.due?(t.due<nzDay()&&!t.done?'overdue':t.due===nzDay()?'today':'later'):'nodate';

SCREENS.lists={
  title:()=>({h:'Lists',s:canManage()?'To do, shopping and ideas':'To do and shopping'}),
  html(){
    const tabs=LIST_TABS(); if(!tabs.some(t=>t[0]===listTab)) listTab='todo';
    const body=listTab==='shop'?shopHtml():listTab==='ideas'?ideasHtml():listTab==='voice'?voiceListHtml():todoHtml();
    return rulesNotice()+`<div class="ctabs">${tabs.map(([k,v])=>`<button class="chip big ${listTab===k?'on':''}" data-lt="${k}">${v}</button>`).join('')}</div>`+body;
  },
  wire(){
    document.querySelectorAll('[data-lt]').forEach(b=>b.onclick=()=>{ listTab=b.dataset.lt; lsSet('rs.listtab',listTab); render(); });
    if(listTab==='shop') wireShop(); else if(listTab==='ideas') wireIdeas(); else if(listTab==='voice') wireVoiceList(); else wireTodo();
  }
};
const addBar=(id,ph)=>`<div class="addbar"><textarea class="txt grow" rows="1" id="${id}" placeholder="${ph}" autocapitalize="sentences" enterkeyhint="done"></textarea><button class="btn" id="${id}Go" aria-label="Add">＋ Add</button></div>`;
function wireAdd(id,fn){ const i=$('#'+id), go=()=>{ const v=i.value.trim(); if(!v) return; fn(v.slice(0,200)); i.value=''; }; $('#'+id+'Go').onclick=go; i.onkeydown=e=>{ if(e.key==='Enter') go(); }; }

/* ---------- to do (laid out like Family Screen) ----------
   One add row. Tap the square to tick; tap the words to open it (what, whose job, put on the calendar).
   Jobs whose day has passed ask "Did these get done?". "Clear done" tidies the list; cleared jobs are
   kept (hidden) so the weekly summary can list what got done. */
const PERSON_COLS=['#c8ece6','#f6c6cf','#f2cbe6','#d9cbf5','#fde3a7','#cfe3f7','#d6ecc4','#f9d3b4'];
const personCol=e=>{ const l=[...new Set([...SYNC.getOwners(),...SYNC.getMembers()])].sort(); const i=l.indexOf(e); return PERSON_COLS[(i<0?0:i)%PERSON_COLS.length]; };
const dot=e=>`<span class="pdot" style="background:${personCol(e)}"></span>`;
const whenTxt=t=>(t.due===nzDay()?'Today':t.due===dk(addDays(kd(nzDay()),1))?'Tomorrow':nzDate(kd(t.due),{weekday:'short',day:'numeric',month:'short'}))+(t.time?' · '+t12(t.time):'');
const nowHM=()=>{ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
const todoPast=t=>!t.done&&t.due&&(t.due<nzDay()||(t.due===nzDay()&&t.time&&t.time<nowHM()));
function todoHtml(){
  if(missingCols.has('todos')) return '';
  const me=SYNC.me(), people=canManage()?[...new Set([me,...SYNC.getMembers()])]:[me];
  let list=S.todos.filter(t=>!t.cleared); if(canManage()&&todoWho!=='all') list=list.filter(t=>(t.who||'')===todoWho);
  const check=list.filter(todoPast), open=list.filter(t=>!t.done&&!t.due), booked=list.filter(t=>!t.done&&t.due&&!todoPast(t)).sort((a,b)=>(a.due+(a.time||'')).localeCompare(b.due+(b.time||''))),
    done=list.filter(t=>t.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).slice(0,30);
  const whoTag=t=>canManage()&&t.who?`<span class="whotag">${dot(t.who)}${esc(t.who===me?'Me':personName(t.who))}</span>`:'';
  const row=(t,extra)=>`<div class="lrow item ${t.done?'isdone':''}"><button class="tick ${t.done?'on':''}" data-tick="${t.id}" aria-label="${t.done?'Not done':'Done'}">${t.done?'✓':''}</button>
      <button class="grow ltxt" data-todo="${t.id}"><b>${esc(t.text)}</b><small>${extra||''}${whoTag(t)}</small></button>
      ${t.done?'':`<button class="calbtn" data-tcal="${t.id}" aria-label="Put on the calendar">📅</button>`}</div>`;
  return `<div class="card"><div class="lhead"><h3>✅ To do <span class="n">${check.length+open.length+booked.length}</span></h3>${done.length?'<button class="btn alt small" id="tdClear">Clear done</button>':''}</div>
      ${addBar('tdNew',canManage()?'Add a job…':'Add a job for yourself…')}
      ${canManage()&&people.length>1?`<div class="pastnames" style="margin-top:10px"><button class="chip ${todoWho==='all'?'on':''}" data-tw="all">Everyone</button>${people.map(p=>`<button class="chip ${todoWho===p?'on':''}" data-tw="${esc(p)}">${dot(p)}${p===me?'Mine':esc(personName(p))}</button>`).join('')}</div>`:''}
      ${check.length?`<p class="sect warn">⏰ Did these get done?</p>${check.map(t=>`<div class="chkcard"><small>Booked for ${esc(whenTxt(t))}</small><b>${esc(t.text)}</b>
        <div class="acts"><button class="btn small ok" data-tdone="${t.id}">✓ Done</button><button class="btn alt small" data-tmove="${t.id}">📅 Move it</button><button class="btn alt small" data-tunbook="${t.id}">↩ Back on the list</button></div></div>`).join('')}`:''}
      ${open.length?`${check.length||booked.length?'<p class="sect">To do</p>':''}${open.map(t=>row(t)).join('')}`:''}
      ${booked.length?`<p class="sect">📅 Booked in</p>${booked.map(t=>row(t,`<span class="when">📅 ${esc(whenTxt(t))}</span>`)).join('')}`:''}
      ${!check.length&&!open.length&&!booked.length?`<p class="note" style="padding:8px 0">Nothing to do${canManage()&&todoWho!=='all'?' for '+esc(todoWho===me?'you':personName(todoWho)):''}. 🎉</p>`:''}
      ${done.length?`<p class="sect">Done</p>${done.map(t=>row(t)).join('')}`:''}</div>`;
}
function wireTodo(){
  if(!$('#tdNew')) return;
  wireAdd('tdNew',text=>{ const who=canManage()?(todoWho==='all'?SYNC.me():todoWho):SYNC.me();
    S.todos.push({id:SYNC.newId('todos'),text:text.charAt(0).toUpperCase()+text.slice(1),who,done:false,due:'',by:SYNC.me(),at:Date.now()}); save(); render(); });
  const find=id=>S.todos.find(x=>x.id===id), done=(t,v)=>{ t.done=v; t.doneAt=v?Date.now():null; t.doneBy=v?SYNC.me():null; save(); render(); };
  document.querySelectorAll('[data-tw]').forEach(b=>b.onclick=()=>{ todoWho=b.dataset.tw; lsSet('rs.todowho',todoWho); render(); });
  document.querySelectorAll('[data-tick]').forEach(b=>b.onclick=()=>{ const t=find(b.dataset.tick); if(t) done(t,!t.done); });
  document.querySelectorAll('[data-tdone]').forEach(b=>b.onclick=()=>{ const t=find(b.dataset.tdone); if(t){ done(t,true); toast('Nice one ✓'); } });
  document.querySelectorAll('[data-tmove]').forEach(b=>b.onclick=()=>{ const t=find(b.dataset.tmove); if(t) bookTodo(t,'Move it to a new day'); });
  document.querySelectorAll('[data-tunbook]').forEach(b=>b.onclick=()=>{ const t=find(b.dataset.tunbook); if(t){ t.due=''; t.time=''; save(); render(); } });
  document.querySelectorAll('[data-tcal]').forEach(b=>b.onclick=()=>{ const t=find(b.dataset.tcal); if(t) bookTodo(t); });
  document.querySelectorAll('.ltxt[data-todo]').forEach(b=>b.onclick=()=>{ const t=find(b.dataset.todo); if(!t) return; if(t.setup&&!t.done&&typeof finishSetup==='function') finishSetup(t.setup); else if(t.order&&!t.done) reopenOrder(t.order); else openTodo(t); });
  const cl=$('#tdClear'); if(cl) cl.onclick=()=>{ let n=0; S.todos.forEach(t=>{ if(t.done&&!t.cleared&&(canManage()||t.who===SYNC.me())){ t.cleared=Date.now(); n++; } }); save(); render(); toast(n+' cleared · listed in the weekly summary'); };
}
// put a to-do on the calendar: a day (today, tomorrow, the next few) and an optional time
function bookTodo(t,title){
  modal((m,close)=>{ let day=t.due||nzDay(), time=t.time||'';
    const days=[...Array(8)].map((_,i)=>dk(addDays(kd(nzDay()),i)));
    const draw=()=>{ m.innerHTML=`<h2>📅 ${esc(title||'Put it on the calendar')}</h2><p class="chkline" style="font-size:20px">${esc(t.text)}</p>
      <p class="note" style="margin-bottom:0"><b>Which day?</b></p><div class="pastnames">${days.map((d,i)=>`<button class="chip big ${day===d?'on':''}" data-bd="${d}">${i===0?'Today':i===1?'Tomorrow':esc(nzDate(kd(d),{weekday:'short',day:'numeric',month:'short'}))}</button>`).join('')}</div>
      <label class="note" for="bkD">Or pick a date</label><input class="txt" id="bkD" type="date" value="${day}">
      <label class="note" for="bkT">Time (optional)</label><input class="txt" id="bkT" type="time" value="${time}">
      <div class="mact">${t.due?'<button class="btn alt" id="bkOff">↩ Take it off the calendar</button>':''}<button class="btn alt" id="bkC">Cancel</button><button class="btn" id="bkOk">Put it on</button></div>`;
      m.querySelectorAll('[data-bd]').forEach(b=>b.onclick=()=>{ day=b.dataset.bd; time=m.querySelector('#bkT').value; draw(); });
      m.querySelector('#bkC').onclick=close;
      const off=m.querySelector('#bkOff'); if(off) off.onclick=()=>{ t.due=''; t.time=''; save(); close(); rerenderAfterList(); };
      m.querySelector('#bkOk').onclick=()=>{ const d=m.querySelector('#bkD').value||day; t.due=d; t.time=m.querySelector('#bkT').value||''; save(); close(); rerenderAfterList(); toast('On the calendar · '+whenTxt(t)); }; };
    draw(); });
}
// change a to-do (also opened from the Calendar). Helpers can change only their own and can't hand it on.
function openTodo(src){
  const mine=(src.who||'')===SYNC.me(); if(!canManage()&&!mine) return;
  const t=S.todos.find(x=>x.id===src.id)||src, st={text:t.text,who:t.who||''}, people=[...new Set([SYNC.me(),...SYNC.getMembers()])];
  modal((m,close)=>{ const draw=()=>{ m.innerHTML=`<h2>Job</h2><label class="note" for="tT">What needs doing?</label><textarea class="txt grow" rows="1" id="tT">${esc(st.text)}</textarea>
      ${canManage()?`<p class="note" style="margin-bottom:0"><b>Whose job is it?</b></p><div class="pastnames">${people.map(p=>`<button class="chip big ${st.who===p?'on':''}" data-tw2="${esc(p)}">${dot(p)}${esc(p===SYNC.me()?'Me':personName(p))}</button>`).join('')}</div>`:''}
      ${t.due?`<p class="note">📅 Booked for ${esc(whenTxt(t))}</p>`:''}
      <div class="mact">${canManage()||mine?'<button class="btn danger" id="tDel">Delete</button>':''}<button class="btn alt" id="tCal">📅 ${t.due?'Move it':'Put on calendar'}</button><button class="btn" id="tOk">Save</button></div>`;
      const ti=m.querySelector('#tT'); ti.oninput=()=>st.text=ti.value;
      m.querySelectorAll('[data-tw2]').forEach(b=>b.onclick=()=>{ st.who=b.dataset.tw2; draw(); });
      const keep=()=>{ const v=st.text.trim(); if(!v){ toast('Type the job'); return false; } t.text=v.slice(0,200); if(canManage()) t.who=st.who||t.who; return true; };
      const d=m.querySelector('#tDel'); if(d) d.onclick=()=>{ const i=S.todos.findIndex(x=>x.id===t.id); if(i>=0) S.todos.splice(i,1); save(); close(); rerenderAfterList(); toast('Deleted'); };
      m.querySelector('#tOk').onclick=()=>{ if(!keep()) return; save(); close(); rerenderAfterList(); toast('Saved'); };
      m.querySelector('#tCal').onclick=()=>{ if(!keep()) return; save(); close(); bookTodo(t); }; };
    draw(); });
}
const rerenderAfterList=()=>{ if(cur()==='calendar') drawCal(); else render(); };

/* ---------- shopping (laid out like Family Screen) ----------
   Add an item and it asks "Where from?" once (remembered for that item next time). Tabs along the top for
   each supplier. Tap to tick (it asks what was really bought). Hold an item to move it to another supplier.
   "Clear ticked" tidies the list; cleared items are kept (hidden) for the weekly summary. */
let shopTab=lsGet('rs.shoptab','all'), shopPending=null;
function shopList(){ const m=new Map(); S.inputs.forEach(i=>{ const n=(i.supplier||'').trim(); if(n) m.set(n.toLowerCase(),n); });
  Object.entries(S.settings.shopNames||{}).forEach(([k,n])=>{ if(!m.has(k)) m.set(k,n); }); return [...m.entries()].map(([key,name])=>({key,name})).sort((a,b)=>a.name.localeCompare(b.name)); }
const shopOf=x=>{ const s=suppliedBy(x); return s?s.key:''; };
function shopHtml(){
  if(missingCols.has('shopping')) return '';
  const shops=canManage()?shopList():[], tabOk=shopTab==='all'||shops.some(x=>x.key===shopTab); if(!tabOk) shopTab='all';
  const live=S.shopping.filter(x=>!x.cleared), want=live.filter(x=>!x.done&&(shopTab==='all'||shopOf(x)===shopTab)).sort((a,b)=>(a.at||0)-(b.at||0)), got=live.filter(x=>x.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  const qs=(q,sz)=>q&&q!=1?(sz?q+' × '+sz:q+' needed'):(sz||'');
  const row=x=>`<div class="lrow item ${x.done?'isdone':''}" data-hold="${x.id}"><button class="tick ${x.done?'on':''}" data-buy="${x.id}" aria-label="${x.done?'Not bought':'Bought'}">${x.done?'✓':''}</button>
      <div class="grow ltxt"><b>${esc(x.item)}</b><small>${esc([x.done?qs(x.gotQty,x.gotSize):qs(x.qty,x.size),x.done?'bought '+nzDate(new Date(x.doneAt),{day:'numeric',month:'short'}):(x.by&&x.by!==SYNC.me()?'added by '+personName(x.by):'')].filter(Boolean).join(' · '))}</small></div>
      ${!x.done&&(canManage()||x.by===SYNC.me())?`<button class="qb rm" data-unshop="${x.id}" aria-label="Remove">✕</button>`:''}</div>`;
  const left=live.filter(x=>!x.done).length;
  return `<div class="card"><div class="lhead"><h3>🛒 Shopping <span class="n">${left}</span></h3>${got.length?'<button class="btn alt small" id="shClear">Clear ticked</button>':''}</div>
      ${addBar('shNew','Add an item… e.g. Beeswax 1 kg')}
      ${shopPending?`<div class="chooser"><b>Where does “${esc(shopPending.item)}” come from?</b><div class="pastnames">${shops.map(x=>`<button class="chip big" data-pick="${esc(x.key)}">🏪 ${esc(x.name)}</button>`).join('')}<button class="chip big" data-pick="">Not sure</button><button class="chip big" id="shNewShop">＋ A new supplier</button></div>
        <p class="note">Next time it goes straight there. <button class="linkb" id="shPC">Cancel</button></p></div>`:''}
      ${shops.length?`<div class="shoptabs"><button class="chip ${shopTab==='all'?'on':''}" data-stab="all">All</button>${shops.map(x=>{ const n=live.filter(y=>!y.done&&shopOf(y)===x.key).length; return n||shopTab===x.key?`<button class="chip ${shopTab===x.key?'on':''}" data-stab="${esc(x.key)}">${esc(x.name)} <b>${n}</b></button>`:''; }).join('')}</div>
        <p class="note" style="margin:4px 0 0">Hold an item to move it to another supplier.</p>`:''}</div>
    ${canManage()&&want.length?shopGroupsHtml(want,row):`<div class="card">${want.length?want.map(row).join(''):'<p class="note">Nothing on the list.</p>'}</div>`}
    ${got.length?`<div class="card"><p class="sect">Bought</p>${got.slice(0,30).map(row).join('')}</div>`:''}`;
}
function addShopItem(v,key){ const x=Object.assign({id:SYNC.newId('shopping'),done:false,by:SYNC.me(),at:Date.now()},parseShop(v)); x.item=x.item.charAt(0).toUpperCase()+x.item.slice(1);
  const ex=S.shopping.find(y=>!y.done&&!y.cleared&&y.item.toLowerCase()===x.item.toLowerCase()); if(ex){ toast(ex.item+' is already on the list'); return; }
  if(key) x.shop=key; S.shopping.push(x);
  if(key&&canManage()){ S.settings.itemShop=Object.assign({},S.settings.itemShop||{},{[x.item.toLowerCase()]:key}); } save(); }
function moveShop(x){
  const shops=shopList(); if(!shops.length) return;
  modal((m,close)=>{ m.innerHTML=`<h2>Move “${esc(x.item)}”</h2><p class="note">Which supplier is it from?</p><div class="pastnames">${shops.map(s=>`<button class="chip big ${shopOf(x)===s.key?'on':''}" data-mv="${esc(s.key)}">🏪 ${esc(s.name)}</button>`).join('')}</div><div class="mact"><button class="btn alt" id="mvC">Cancel</button></div>`;
    m.querySelector('#mvC').onclick=close;
    m.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{ x.shop=b.dataset.mv; delete x.input; S.settings.itemShop=Object.assign({},S.settings.itemShop||{},{[x.item.toLowerCase()]:x.shop}); save(); close(); render(); toast('Moved to '+(shops.find(s=>s.key===x.shop)||{}).name); }); });
}
// "Beeswax 1 kg" → item Beeswax, size 1 kg; "2 x jars" → qty 2
function parseShop(v){
  let qty=1, size='', item=v.trim(); let m=item.match(/^(\d+)\s*(x|×)\s+(.+)$/i); if(m){ qty=+m[1]; item=m[3]; }
  m=item.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|L|litres?|pcs?|pack))$/i); if(m){ item=m[1]; size=m[2]; }
  return {item:item.slice(0,120),qty,size};
}
function wireShop(){
  if(!$('#shNew')) return;
  wireAdd('shNew',v=>{ const p=parseShop(v), k=p.item.toLowerCase(), shops=canManage()?shopList():[], mem=(S.settings.itemShop||{})[k];
    const inp=S.inputs.find(i=>(i.name||'').toLowerCase()===k&&i.supplier);
    if(!shops.length||inp||(mem&&shops.some(s=>s.key===mem))||shopTab!=='all'){ addShopItem(v,inp?'':(mem||(shopTab!=='all'?shopTab:''))); render(); return; }
    shopPending={v,item:p.item}; render(); });
  document.querySelectorAll('[data-stab]').forEach(b=>b.onclick=()=>{ shopTab=b.dataset.stab; lsSet('rs.shoptab',shopTab); render(); });
  document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{ if(!shopPending) return; addShopItem(shopPending.v,b.dataset.pick); shopPending=null; render(); });
  const pc=$('#shPC'); if(pc) pc.onclick=()=>{ shopPending=null; render(); };
  const ns=$('#shNewShop'); if(ns) ns.onclick=()=>modal((m,close)=>{ m.innerHTML=`<h2>A new supplier</h2><label class="note" for="nsN">Name</label><textarea class="txt grow" rows="1" id="nsN" placeholder="e.g. Hive Supplies"></textarea>
      <p class="note">Add their email or website later on any ingredient you buy from them.</p><div class="mact"><button class="btn alt" id="nsC">Cancel</button><button class="btn" id="nsOk">Add</button></div>`;
    m.querySelector('#nsC').onclick=close; m.querySelector('#nsOk').onclick=()=>{ const n=m.querySelector('#nsN').value.trim().slice(0,60); if(!n){ toast('Type the name'); return; } const k=n.toLowerCase();
      S.settings.shopNames=Object.assign({},S.settings.shopNames||{},{[k]:n}); if(shopPending){ addShopItem(shopPending.v,k); shopPending=null; } save(); close(); render(); }; });
  document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{ const x=S.shopping.find(y=>y.id===b.dataset.buy); if(!x) return;
    if(x.done){ x.done=false; x.doneAt=null; save(); render(); return; } confirmBought(x); });
  document.querySelectorAll('[data-unshop]').forEach(b=>b.onclick=()=>{ const i=S.shopping.findIndex(y=>y.id===b.dataset.unshop); if(i>=0){ S.shopping.splice(i,1); save(); render(); } });
  // hold an item to move it to another supplier
  if(canManage()) document.querySelectorAll('[data-hold]').forEach(el=>{ let t=null; const x=S.shopping.find(y=>y.id===el.dataset.hold); if(!x||x.done) return;
    el.addEventListener('pointerdown',e=>{ if(e.target.closest('button')) return; t=setTimeout(()=>{ t=null; if(navigator.vibrate) navigator.vibrate(20); moveShop(x); },550); });
    ['pointerup','pointerleave','pointercancel','pointermove'].forEach(ev=>el.addEventListener(ev,e=>{ if(ev==='pointermove'&&Math.abs(e.movementX)+Math.abs(e.movementY)<4) return; if(t){ clearTimeout(t); t=null; } }));
    el.addEventListener('contextmenu',e=>{ e.preventDefault(); moveShop(x); }); });
  wireShopGroups();
  const c=$('#shClear'); if(c) c.onclick=()=>{ let n=0; S.shopping.forEach(x=>{ if(x.done&&!x.cleared){ x.cleared=Date.now(); n++; } }); save(); render(); toast(n+' cleared · the prices paid are kept'); };
}
// what was actually bought: one tap if it's as listed, or tweak the size, how many and the price
function confirmBought(x){
  modal((m,close)=>{ m.innerHTML=`<h2>🛒 ${esc(x.item)}</h2><p class="note">On the list: ${esc([x.qty&&x.qty!=1?x.qty+' ×':'',x.size||''].filter(Boolean).join(' ')||'no size given')}</p>
      <div class="formrow"><div><label class="note" for="bQ">How many</label><input class="txt" id="bQ" inputmode="decimal" value="${x.qty||1}"></div>
        <div><label class="note" for="bS">Size bought</label><input class="txt" id="bS" value="${esc(x.size||'')}" placeholder="e.g. 500 g"></div></div>
      ${canManage()?`<label class="note" for="bP">Price paid, total (optional)</label><input class="txt" id="bP" inputmode="decimal" placeholder="e.g. 24.90">`:''}
      <div class="mact"><button class="btn alt" id="bC">Cancel</button><button class="btn" id="bOk">✓ Bought</button></div>`;
    m.querySelector('#bC').onclick=close;
    m.querySelector('#bOk').onclick=()=>{ const q=+m.querySelector('#bQ').value.replace(/[^0-9.]/g,'')||1, sz=m.querySelector('#bS').value.trim().slice(0,40);
      const pe=m.querySelector('#bP'), pt=pe?pe.value.trim():'', cents=pt?toCents(pt):0; if(pt&&!(cents>=0)){ toast('Type the price, e.g. 24.90'); return; }
      Object.assign(x,{done:true,doneAt:Date.now(),doneBy:SYNC.me(),gotQty:q,gotSize:sz});
      const inp=x.input&&S.inputs.find(i=>i.id===x.input);   // an ingredient from a brew plan: what was bought goes into its stock
      if(inp&&typeof inputStock==='function'&&inputStock(inp.id)!=null) moveStock({kind:'bought',input:inp.id,qty:q*(inp.pack||0)});
      if(cents){ S.prices.push({id:SYNC.newId('prices'),input:x.input||'',item:x.item,size:sz,qty:q,cents,at:Date.now(),date:nzDay(),by:SYNC.me(),from:'shopping'}); }
      save(); close(); render(); toast('Ticked off'); }; });
}

/* ---------- ideas (owners and managers), the same rows as the to-dos ----------
   Tap an idea to make it a to-do, put it on the calendar, or give it to someone. */
const IDEA_KINDS={idea:'💡 Idea',call:'📞 Call',product:'🧴 Product idea'};
function ideasHtml(){
  if(missingCols.has('ideas')) return '';
  const live=S.ideas.filter(i=>!i.cleared), open=live.filter(i=>!i.done).sort((a,b)=>(b.at||0)-(a.at||0)), done=live.filter(i=>i.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).slice(0,20), kind=lsGet('rs.ideakind','idea');
  const row=i=>`<div class="lrow item ${i.done?'isdone':''}"><button class="tick ${i.done?'on':''}" data-idone="${i.id}" aria-label="Done">${i.done?'✓':''}</button>
      <button class="grow ltxt" data-iopen="${i.id}"><b>${esc(i.text)}</b><small><span class="ktag">${esc(IDEA_KINDS[i.kind]||IDEA_KINDS.idea)}</span> ${esc(nzDate(new Date(i.at),{day:'numeric',month:'short'}))}</small></button>
      ${i.done?'':`<button class="calbtn" data-ical="${i.id}" aria-label="Put on the calendar">📅</button>`}</div>`;
  return `<div class="card"><div class="lhead"><h3>💡 Ideas <span class="n">${open.length}</span></h3>${done.length?'<button class="btn alt small" id="idClear">Clear done</button>':''}</div>
      ${addBar('idNew','Jot it down…')}
      <div class="kinds">${Object.entries(IDEA_KINDS).map(([k,v])=>`<button class="ktag ${kind===k?'on':''}" data-ik="${k}">${v}</button>`).join('')}</div>
      ${open.length?open.map(row).join(''):'<p class="note" style="padding:8px 0">No ideas yet. Say them to the assistant, or jot them here.</p>'}
      ${done.length?`<p class="sect">Done</p>${done.map(row).join('')}`:''}</div>`;
}
// an idea becomes a job (for someone, optionally on the calendar)
function ideaToTodo(i,who,book){ const t={id:SYNC.newId('todos'),text:i.text,who:who||SYNC.me(),done:false,due:'',by:SYNC.me(),at:Date.now(),fromIdea:i.id};
  S.todos.push(t); i.done=true; i.doneAt=Date.now(); i.todo=t.id; save(); if(book) bookTodo(t); else { render(); toast('Now a to-do'+(who&&who!==SYNC.me()?' for '+personName(who):'')); } }
function openIdea(i){
  const people=[...new Set([SYNC.me(),...SYNC.getMembers()])], st={text:i.text,kind:i.kind||'idea'};
  modal((m,close)=>{ const draw=()=>{ m.innerHTML=`<h2>${esc(IDEA_KINDS[st.kind]||'Idea')}</h2><textarea class="txt grow" rows="1" id="iT">${esc(st.text)}</textarea>
      <div class="kinds">${Object.entries(IDEA_KINDS).map(([k,v])=>`<button class="ktag ${st.kind===k?'on':''}" data-ik2="${k}">${v}</button>`).join('')}</div>
      <p class="note" style="margin-bottom:0"><b>Turn it into a job for…</b></p><div class="pastnames">${people.map(p=>`<button class="chip big" data-ito="${esc(p)}">${dot(p)}${esc(p===SYNC.me()?'Me':personName(p))}</button>`).join('')}</div>
      <div class="mact"><button class="btn danger" id="iDel">Delete</button><button class="btn alt" id="iCal">📅 Put on calendar</button><button class="btn" id="iOk">Save</button></div>`;
      const ti=m.querySelector('#iT'); ti.oninput=()=>st.text=ti.value;
      const keep=()=>{ const v=st.text.trim(); if(!v){ toast('Type the idea'); return false; } i.text=v.slice(0,300); i.kind=st.kind; return true; };
      m.querySelectorAll('[data-ik2]').forEach(b=>b.onclick=()=>{ st.kind=b.dataset.ik2; draw(); });
      m.querySelectorAll('[data-ito]').forEach(b=>b.onclick=()=>{ if(!keep()) return; close(); ideaToTodo(i,b.dataset.ito); });
      m.querySelector('#iCal').onclick=()=>{ if(!keep()) return; close(); ideaToTodo(i,SYNC.me(),true); };
      m.querySelector('#iDel').onclick=()=>{ const x=S.ideas.findIndex(y=>y.id===i.id); if(x>=0) S.ideas.splice(x,1); save(); close(); render(); toast('Deleted'); };
      m.querySelector('#iOk').onclick=()=>{ if(!keep()) return; save(); close(); render(); toast('Saved'); }; };
    draw(); });
}
function wireIdeas(){
  if(!$('#idNew')) return;
  document.querySelectorAll('[data-ik]').forEach(b=>b.onclick=()=>{ lsSet('rs.ideakind',b.dataset.ik); document.querySelectorAll('[data-ik]').forEach(x=>x.classList.toggle('on',x===b)); });
  wireAdd('idNew',text=>{ S.ideas.push({id:SYNC.newId('ideas'),text:text.charAt(0).toUpperCase()+text.slice(1),kind:lsGet('rs.ideakind','idea'),by:SYNC.me(),at:Date.now(),done:false}); save(); render(); });
  const find=id=>S.ideas.find(x=>x.id===id);
  document.querySelectorAll('[data-idone]').forEach(b=>b.onclick=()=>{ const i=find(b.dataset.idone); if(i){ i.done=!i.done; i.doneAt=i.done?Date.now():null; save(); render(); } });
  document.querySelectorAll('[data-iopen]').forEach(b=>b.onclick=()=>{ const i=find(b.dataset.iopen); if(i) openIdea(i); });
  document.querySelectorAll('[data-ical]').forEach(b=>b.onclick=()=>{ const i=find(b.dataset.ical); if(i) ideaToTodo(i,SYNC.me(),true); });
  const cl=$('#idClear'); if(cl) cl.onclick=()=>{ let n=0; S.ideas.forEach(i=>{ if(i.done&&!i.cleared){ i.cleared=Date.now(); n++; } }); save(); render(); toast(n+' cleared'); };
}
