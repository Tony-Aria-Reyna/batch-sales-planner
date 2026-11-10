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

/* ---------- to do ---------- */
function todoHtml(){
  if(missingCols.has('todos')) return '';
  const me=SYNC.me(), people=canManage()?[...new Set([me,...SYNC.getMembers()])]:[me];
  let list=S.todos.slice(); if(canManage()&&todoWho!=='all') list=list.filter(t=>(t.who||'')===todoWho);
  const open=list.filter(t=>!t.done), done=list.filter(t=>t.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).slice(0,30);
  const groups=[['overdue','Overdue'],['today','Today'],['later','Coming up'],['nodate','Any time']];
  const row=t=>`<div class="lrow ${t.done?'isdone':''}"><button class="tick ${t.done?'on':''}" data-tick="${t.id}" aria-label="${t.done?'Not done':'Done'}">${t.done?'✓':''}</button>
      <button class="grow ltxt" data-todo="${t.id}"><b>${esc(t.text)}</b><small>${[t.due?(t.due===nzDay()?'Today':nzDate(kd(t.due),{weekday:'short',day:'numeric',month:'short'}))+(t.time?' '+t12(t.time):''):'',canManage()&&t.who?personName(t.who):''].filter(Boolean).map(esc).join(' · ')}</small></button></div>`;
  return `<div class="card">${addBar('tdNew',canManage()?'Add a to-do…':'Add a to-do for yourself…')}
      ${canManage()?`<div class="pastnames" style="margin-top:10px"><button class="chip ${todoWho==='all'?'on':''}" data-tw="all">Everyone</button>${people.map(p=>`<button class="chip ${todoWho===p?'on':''}" data-tw="${esc(p)}">${p===me?'Mine':esc(personName(p))}</button>`).join('')}</div>`:''}</div>
    ${open.length?groups.map(([g,h])=>{ const l=open.filter(t=>todoDue(t)===g).sort((a,b)=>(a.due||'').localeCompare(b.due||'')||(a.time||'').localeCompare(b.time||'')); return l.length?`<div class="card"><h3>${h}</h3>${l.map(row).join('')}</div>`:''; }).join('')
      :`<div class="card"><p class="note">Nothing to do${canManage()&&todoWho!=='all'?' for '+esc(todoWho===me?'you':personName(todoWho)):''}. 🎉</p></div>`}
    ${done.length?`<div class="card"><h3>Done</h3>${done.map(row).join('')}</div>`:''}`;
}
function wireTodo(){
  if(!$('#tdNew')) return;
  wireAdd('tdNew',text=>{ const who=canManage()?(todoWho==='all'?SYNC.me():todoWho):SYNC.me();
    S.todos.push({id:SYNC.newId('todos'),text,who,done:false,due:'',by:SYNC.me(),at:Date.now()}); save(); render(); });
  document.querySelectorAll('[data-tw]').forEach(b=>b.onclick=()=>{ todoWho=b.dataset.tw; lsSet('rs.todowho',todoWho); render(); });
  document.querySelectorAll('[data-tick]').forEach(b=>b.onclick=()=>{ const t=S.todos.find(x=>x.id===b.dataset.tick); if(!t) return; t.done=!t.done; t.doneAt=t.done?Date.now():null; t.doneBy=t.done?SYNC.me():null; save(); render(); });
  document.querySelectorAll('.ltxt[data-todo]').forEach(b=>b.onclick=()=>{ const t=S.todos.find(x=>x.id===b.dataset.todo); if(!t) return; if(t.setup&&!t.done&&typeof finishSetup==='function') finishSetup(t.setup); else if(t.order&&!t.done) reopenOrder(t.order); else openTodo(t); });
}
// change a to-do (also opened from the Calendar). Helpers can change only their own and can't hand it on.
function openTodo(src){
  const mine=(src.who||'')===SYNC.me(); if(!canManage()&&!mine) return;
  const t=JSON.parse(JSON.stringify(src)), people=[...new Set([SYNC.me(),...SYNC.getMembers()])];
  modal((m,close)=>{ m.innerHTML=`<h2>To-do</h2>
      <label class="note" for="tT">What</label><textarea class="txt" id="tT" rows="2">${esc(t.text)}</textarea>
      <div class="formrow"><div><label class="note" for="tD">Date (shows on the calendar)</label><input class="txt" id="tD" type="date" value="${t.due||''}"></div>
        <div><label class="note" for="tH">Time (optional)</label><input class="txt" id="tH" type="time" value="${t.time||''}"></div></div>
      ${canManage()?`<label class="note" for="tW">Whose</label><select class="txt" id="tW">${people.map(p=>`<option value="${esc(p)}" ${t.who===p?'selected':''}>${esc(p===SYNC.me()?'Mine':personName(p))}</option>`).join('')}</select>`:''}
      <div class="mact">${canManage()?'<button class="btn danger" id="tDel">Delete</button>':''}<button class="btn alt" id="tC">Cancel</button><button class="btn" id="tOk">Save</button></div>`;
    m.querySelector('#tC').onclick=close;
    const d=m.querySelector('#tDel'); if(d) d.onclick=()=>{ const i=S.todos.findIndex(x=>x.id===t.id); if(i>=0) S.todos.splice(i,1); save(); close(); rerenderAfterList(); toast('Deleted'); };
    m.querySelector('#tOk').onclick=()=>{ const text=m.querySelector('#tT').value.trim(); if(!text){ toast('Type the to-do'); return; }
      const x=S.todos.find(y=>y.id===t.id); if(!x){ close(); return; }
      x.text=text.slice(0,200); x.due=m.querySelector('#tD').value; x.time=x.due?m.querySelector('#tH').value:'';
      const w=m.querySelector('#tW'); if(w) x.who=w.value;
      save(); close(); rerenderAfterList(); toast('Saved'); }; });
}
const rerenderAfterList=()=>{ if(cur()==='calendar') drawCal(); else render(); };

/* ---------- shopping ---------- */
function shopHtml(){
  if(missingCols.has('shopping')) return '';
  const want=S.shopping.filter(x=>!x.done).sort((a,b)=>(a.at||0)-(b.at||0)), got=S.shopping.filter(x=>x.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  const qs=(q,sz)=>q&&q!=1?(sz?q+' × '+sz:q+' needed'):(sz||'');
  const row=x=>`<div class="lrow ${x.done?'isdone':''}"><button class="tick ${x.done?'on':''}" data-buy="${x.id}" aria-label="${x.done?'Not bought':'Bought'}">${x.done?'✓':''}</button>
      <div class="grow ltxt"><b>${esc(x.item)}</b><small>${esc([x.done?qs(x.gotQty,x.gotSize):qs(x.qty,x.size),x.done?'bought '+nzDate(new Date(x.doneAt),{day:'numeric',month:'short'}):(x.by&&x.by!==SYNC.me()?'added by '+personName(x.by):'')].filter(Boolean).join(' · '))}</small></div>
      ${!x.done&&(canManage()||x.by===SYNC.me())?`<button class="qb rm" data-unshop="${x.id}" aria-label="Remove">✕</button>`:''}</div>`;
  return `<div class="card">${addBar('shNew','Add to the shopping list… e.g. Beeswax 1 kg')}</div>
    ${canManage()&&want.length?shopGroupsHtml(want,row):`<div class="card"><h3>To buy</h3>${want.length?want.map(row).join(''):'<p class="note">Nothing on the list.</p>'}</div>`}
    ${got.length?`<div class="card"><h3>Bought</h3>${got.slice(0,30).map(row).join('')}${canManage()?'<div class="mact" style="justify-content:flex-start"><button class="btn alt small" id="shClear">Clear the bought list</button></div>':''}</div>`:''}`;
}
// "Beeswax 1 kg" → item Beeswax, size 1 kg; "2 x jars" → qty 2
function parseShop(v){
  let qty=1, size='', item=v.trim(); let m=item.match(/^(\d+)\s*(x|×)\s+(.+)$/i); if(m){ qty=+m[1]; item=m[3]; }
  m=item.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|L|litres?|pcs?|pack))$/i); if(m){ item=m[1]; size=m[2]; }
  return {item:item.slice(0,120),qty,size};
}
function wireShop(){
  if(!$('#shNew')) return;
  wireAdd('shNew',v=>{ S.shopping.push(Object.assign({id:SYNC.newId('shopping'),done:false,by:SYNC.me(),at:Date.now()},parseShop(v))); save(); render(); });
  document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{ const x=S.shopping.find(y=>y.id===b.dataset.buy); if(!x) return;
    if(x.done){ x.done=false; x.doneAt=null; save(); render(); return; } confirmBought(x); });
  document.querySelectorAll('[data-unshop]').forEach(b=>b.onclick=()=>{ const i=S.shopping.findIndex(y=>y.id===b.dataset.unshop); if(i>=0){ S.shopping.splice(i,1); save(); render(); } });
  wireShopGroups();
  const c=$('#shClear'); if(c) c.onclick=()=>confirmBox('Clear the bought list?','The prices paid are kept for costs.','Clear',()=>{ for(let i=S.shopping.length-1;i>=0;i--) if(S.shopping[i].done) S.shopping.splice(i,1); save(); render(); });
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

/* ---------- ideas (owners and managers) ---------- */
const IDEA_KINDS={idea:'💡 Idea',call:'📞 Call',product:'🧴 Product idea'};
function ideasHtml(){
  if(missingCols.has('ideas')) return '';
  const open=S.ideas.filter(i=>!i.done).sort((a,b)=>(b.at||0)-(a.at||0)), done=S.ideas.filter(i=>i.done).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).slice(0,20);
  const row=i=>`<div class="lrow ${i.done?'isdone':''}"><button class="tick ${i.done?'on':''}" data-idone="${i.id}" aria-label="Done">${i.done?'✓':''}</button>
      <div class="grow ltxt"><b>${esc(i.text)}</b><small>${esc(IDEA_KINDS[i.kind]||IDEA_KINDS.idea)} · ${esc(nzDate(new Date(i.at),{day:'numeric',month:'short'}))}</small></div><button class="qb rm" data-idel="${i.id}" aria-label="Delete">✕</button></div>`;
  return `<div class="card"><div class="pastnames" style="margin-bottom:10px">${Object.entries(IDEA_KINDS).map(([k,v])=>`<button class="chip ${lsGet('rs.ideakind','idea')===k?'on':''}" data-ik="${k}">${v}</button>`).join('')}</div>${addBar('idNew','Jot it down…')}</div>
    <div class="card">${open.length?open.map(row).join(''):'<p class="note">No ideas yet. Voice notes will be able to drop them here too.</p>'}</div>
    ${done.length?`<div class="card"><h3>Done</h3>${done.map(row).join('')}</div>`:''}`;
}
function wireIdeas(){
  if(!$('#idNew')) return;
  document.querySelectorAll('[data-ik]').forEach(b=>b.onclick=()=>{ lsSet('rs.ideakind',b.dataset.ik); render(); });
  wireAdd('idNew',text=>{ S.ideas.push({id:SYNC.newId('ideas'),text,kind:lsGet('rs.ideakind','idea'),by:SYNC.me(),at:Date.now(),done:false}); save(); render(); });
  document.querySelectorAll('[data-idone]').forEach(b=>b.onclick=()=>{ const i=S.ideas.find(x=>x.id===b.dataset.idone); if(i){ i.done=!i.done; i.doneAt=i.done?Date.now():null; save(); render(); } });
  document.querySelectorAll('[data-idel]').forEach(b=>b.onclick=()=>{ const i=S.ideas.findIndex(x=>x.id===b.dataset.idel); if(i>=0){ S.ideas.splice(i,1); save(); render(); } });
}
