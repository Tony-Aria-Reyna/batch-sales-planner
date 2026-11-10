/* ================= Places: markets, the Farm Shop, online and the shops she supplies =================
   Two channels, each with groups, and "Add new" at both levels:
     Retail    → Markets, Farm Shop, Online (+ any she adds)
     Wholesale → Shops (+ any she adds)
   A place belongs to one group. Its address and return distance feed mileage; its usual stall fee (and how
   many days the fee covers) is a cost, so it's kept in "costs", which helpers can't see.
   All of this is typed into the app by the owner: none of it is in the code or on GitHub. */
const CHANNELS={retail:'Retail',wholesale:'Wholesale'};
const BASE_GROUPS=[{id:'markets',channel:'retail',name:'Markets'},{id:'farmshop',channel:'retail',name:'Farm Shop'},{id:'online',channel:'retail',name:'Online'},{id:'shops',channel:'wholesale',name:'Shops'}];
const placeGroups=()=>BASE_GROUPS.concat((S.settings.groups||[]).filter(g=>g&&g.id&&g.name&&CHANNELS[g.channel]));
const groupOf=p=>placeGroups().find(g=>g.id===p.group)||{id:'',channel:p.channel||'retail',name:'Other'};
const feeOf=pid=>S.costs.find(c=>c.id==='fee-'+pid);

SCREENS.places={
  title:()=>({h:'Markets and places',s:'Retail and wholesale'}),
  html(){
    const live=S.places.filter(p=>!p.gone);
    return rulesNotice()+`<div class="card"><h3>🏠 Home base</h3><p class="note">Used to work out the drive to each market. Only owners and managers see it.</p>
        <label class="note" for="homeAddr">Home address</label><textarea class="txt grow" rows="1" id="homeAddr" autocomplete="street-address" placeholder="Street, suburb, town">${esc(S.settings.homeAddress||'')}</textarea>
        <p class="note">With this and each place's address in, the assistant works out the km and drive time by road (usually within 5 minutes).</p>
        <div class="formrow"><div><label class="note" for="setMin">Usual setting up (min)</label><input class="txt" id="setMin" inputmode="numeric" value="${+S.settings.setupMins||45}"></div>
          <div><label class="note" for="packMin">Usual packing down (min)</label><input class="txt" id="packMin" inputmode="numeric" value="${+S.settings.packMins||45}"></div></div>
        <p class="note">Used to prefill each market day. Each market then remembers its own.</p></div>`
      +Object.entries(CHANNELS).map(([ch,chName])=>`<div class="card"><h3>${ch==='retail'?'🛍️':'🚚'} ${chName}</h3>
        ${placeGroups().filter(g=>g.channel===ch).map(g=>{ const list=live.filter(p=>p.group===g.id).sort((a,b)=>a.name.localeCompare(b.name));
          return `<div class="pgroup"><div class="row"><div class="grow"><b>${esc(g.name)}</b><small>${list.length} place${list.length===1?'':'s'}</small></div><button class="btn alt small" data-addp="${g.id}">＋ Add</button></div>
            ${list.map(p=>{ const f=feeOf(p.id); return `<button class="row prow" data-place="${p.id}"><div class="grow">${esc(p.name)}<small>${[p.address,p.km?p.km+' km return':'',f&&f.cents?c2(f.cents)+' fee'+(f.days>1?' for '+f.days+' days':''):''].filter(Boolean).map(esc).join(' · ')||'Tap to add details'}</small></div><span class="chev">›</span></button>`; }).join('')}</div>`; }).join('')}
        <div class="mact" style="justify-content:flex-start"><button class="btn alt" data-addg="${ch}">＋ New ${chName.toLowerCase()} group</button></div></div>`).join('');
  },
  wire(){
    const h=$('#homeAddr'); h.onchange=()=>{ S.settings.homeAddress=h.value.trim().slice(0,200); save(); toast('Saved'); };
    [['#setMin','setupMins'],['#packMin','packMins']].forEach(([id,k])=>{ const x=$(id); x.onchange=()=>{ const v=Math.round(+x.value); if(!(v>=0&&v<600)){ toast('Type the minutes, e.g. 45'); return; } S.settings[k]=v; save(); toast('Saved'); }; });
    document.querySelectorAll('[data-addp]').forEach(b=>b.onclick=()=>{ const g=placeGroups().find(x=>x.id===b.dataset.addp); editPlace({group:g.id,channel:g.channel},()=>render()); });
    document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{ const p=S.places.find(x=>x.id===b.dataset.place); if(p) editPlace(p,()=>render()); });
    document.querySelectorAll('[data-addg]').forEach(b=>b.onclick=()=>addGroup(b.dataset.addg,()=>render()));
  }
};
function addGroup(channel,done){
  modal((m,close)=>{ m.innerHTML=`<h2>New ${esc(CHANNELS[channel].toLowerCase())} group</h2><p class="note">For example: Events, Gift shops, Cafés.</p>
      <input class="txt" id="gN" autocapitalize="words" placeholder="Group name"><div class="mact"><button class="btn alt" id="gC">Cancel</button><button class="btn" id="gOk">Add</button></div>`;
    const ok=()=>{ const n=m.querySelector('#gN').value.trim(); if(!n){ toast('Type a name'); return; }
      if(placeGroups().some(g=>g.channel===channel&&g.name.toLowerCase()===n.toLowerCase())){ toast('That group is already there'); return; }
      S.settings.groups=[...(S.settings.groups||[]),{id:'g'+Date.now().toString(36),channel,name:n.slice(0,40)}]; save(); close(); done&&done(); };
    m.querySelector('#gC').onclick=close; m.querySelector('#gOk').onclick=ok; m.querySelector('#gN').onkeydown=e=>{ if(e.key==='Enter') ok(); };
    setTimeout(()=>{ if(!m.contains(document.activeElement)) m.querySelector('#gN').focus(); },50); });
}
function editPlace(src,done){
  if(!canManage()) return;
  const isNew=!src.id, p=Object.assign({name:'',group:'markets',channel:'retail',address:'',km:'',float:'',note:''},JSON.parse(JSON.stringify(src)));
  const f=isNew?null:feeOf(p.id);
  modal((m,close)=>{
    m.innerHTML=`<h2>${isNew?'Add a place':esc(p.name)}</h2>
      <label class="note" for="pN">Name</label><input class="txt" id="pN" value="${esc(p.name)}" autocapitalize="words" placeholder="e.g. Village Market">
      <label class="note" for="pG">Group</label><select class="txt" id="pG">${Object.entries(CHANNELS).map(([ch,cn])=>`<optgroup label="${cn}">${placeGroups().filter(g=>g.channel===ch).map(g=>`<option value="${g.id}" ${p.group===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</optgroup>`).join('')}</select>
      <label class="note" for="pA">Address (optional)</label><textarea class="txt grow" rows="1" id="pA" autocomplete="off" placeholder="Street, suburb, town">${esc(p.address)}</textarea>
      ${(()=>{ const r=p.route||{}; if(!p.address) return ''; if(!S.settings.homeAddress) return '<p class="note">Add the home address (Markets and places → Home base) and the assistant works out the drive.</p>';
        if(r.err) return '<p class="note warn">⚠️ The assistant couldn\'t find this address on the map. Check the spelling, or add the town.</p>';
        if(r.km) return `<p class="note">🚗 By road from home: <b>${r.km} km each way, about ${hmTxt(r.mins)}</b>. Worked out by the assistant.</p>`;
        return '<p class="note">🚗 The assistant will work out the km and drive time shortly.</p>'; })()}
      <div class="formrow"><div><label class="note" for="pK">Drive there and back (km)</label><input class="txt" id="pK" inputmode="decimal" value="${p.km||''}" placeholder="e.g. 64"></div>
        <div><label class="note" for="pF">Usual float ($)</label><input class="txt" id="pF" inputmode="decimal" value="${p.float?(p.float/100).toFixed(2):''}" placeholder="${S.settings.defaultFloat?(S.settings.defaultFloat/100).toFixed(0):'200'}"></div></div>
      <div class="formrow"><div><label class="note" for="pFee">Usual stall fee ($)</label><input class="txt" id="pFee" inputmode="decimal" value="${f&&f.cents?(f.cents/100).toFixed(2):''}" placeholder="optional"></div>
        <div><label class="note" for="pFd">The fee covers</label><select class="txt" id="pFd">${[1,2,3,4,5,6,7].map(n=>`<option value="${n}" ${(f&&f.days||1)===n?'selected':''}>${n} day${n>1?'s':''}</option>`).join('')}</select></div></div>
      <p class="note">A fee covering several days is shared across the days you sell there. Fees are only seen by owners and managers.</p>
      <div id="pShop" style="${p.channel==='wholesale'?'':'display:none'}"><h3>For a shop</h3>
        <div class="bigseg"><button data-pm="buy" class="${p.mode!=='consign'?'on':''}">🚚 They buy (wholesale)</button><button data-pm="consign" class="${p.mode==='consign'?'on':''}">🤝 Consignment (sale or return)</button></div>
        <div class="formrow"><div><label class="note" for="pTerm">Pays within (days)</label><input class="txt" id="pTerm" inputmode="numeric" value="${p.terms||''}" placeholder="e.g. 14"></div>
          <div id="pComW" style="${p.mode==='consign'?'':'display:none'}"><label class="note" for="pCom">Their commission (%)</label><input class="txt" id="pCom" inputmode="decimal" value="${p.commission||''}" placeholder="e.g. 30"></div></div>
        <div id="pShelfW" style="${p.mode==='consign'?'':'display:none'}"><label class="note" for="pShelf">They sell it at</label><select class="txt" id="pShelf"><option value="retail" ${p.shelf!=='wholesale'?'selected':''}>Your retail price</option><option value="wholesale" ${p.shelf==='wholesale'?'selected':''}>Your wholesale price</option></select></div>
        <label class="note" for="pE">Their email (optional, for orders)</label><input class="txt" id="pE" type="email" autocapitalize="none" value="${esc(p.email||'')}"></div>
      <label class="note" for="pNo">Notes (optional)</label><textarea class="txt" id="pNo" rows="2" placeholder="e.g. pay the market manager in cash on the day">${esc(p.note||'')}</textarea>
      <div class="mact">${isNew?'':'<button class="btn danger" id="pDel">Remove…</button>'}<button class="btn alt" id="pC">Cancel</button><button class="btn" id="pOk">Save</button></div>`;
    m.querySelector('#pC').onclick=close;
    let mode=p.mode==='consign'?'consign':'buy';
    m.querySelector('#pG').onchange=()=>{ const g=placeGroups().find(x=>x.id===m.querySelector('#pG').value); m.querySelector('#pShop').style.display=g&&g.channel==='wholesale'?'':'none'; };
    m.querySelectorAll('[data-pm]').forEach(b=>b.onclick=()=>{ mode=b.dataset.pm; m.querySelectorAll('[data-pm]').forEach(x=>x.classList.toggle('on',x===b)); m.querySelector('#pComW').style.display=m.querySelector('#pShelfW').style.display=mode==='consign'?'':'none'; });
    const del=m.querySelector('#pDel'); if(del) del.onclick=()=>confirmBox('Remove '+p.name+'?','It disappears from the lists. Past sales and calendar entries keep its name.','Remove',()=>{ const x=S.places.find(y=>y.id===p.id); if(x){ x.gone=true; save(); } close(); done&&done(); },true);
    m.querySelector('#pOk').onclick=()=>{
      const name=m.querySelector('#pN').value.trim(); if(!name){ toast('Type the name'); return; }
      const kmT=m.querySelector('#pK').value.trim(), km=kmT?+kmT.replace(/[^0-9.]/g,''):0; if(kmT&&!(km>=0&&km<5000)){ toast('Type the distance in km, e.g. 64'); return; }
      const flT=m.querySelector('#pF').value.trim(), fl=flT?toCents(flT):0; if(flT&&!(fl>=0)){ toast('Type the float, e.g. 200'); return; }
      const feeT=m.querySelector('#pFee').value.trim(), fee=feeT?toCents(feeT):0; if(feeT&&!(fee>=0)){ toast('Type the fee, e.g. 45'); return; }
      const g=placeGroups().find(x=>x.id===m.querySelector('#pG').value)||BASE_GROUPS[0];
      const addr=m.querySelector('#pA').value.trim().slice(0,200);
      if(km!==(+src.km||0)) p.kmAuto=false; if(addr!==(src.address||'')){ delete p.route; delete p.lat; delete p.lng; if(p.kmAuto!==false) p.kmAuto=true; }
      const tT=m.querySelector('#pTerm').value.trim(), terms=tT?Math.round(+tT):0; if(tT&&!(terms>=0&&terms<366)){ toast('Type the days to pay, e.g. 14'); return; }
      const cT=m.querySelector('#pCom').value.trim(), com=cT?+cT.replace('%',''):0; if(cT&&!(com>=0&&com<=90)){ toast('Type the commission as a percentage, e.g. 30'); return; }
      if(g.channel==='wholesale') Object.assign(p,{mode,terms,commission:mode==='consign'?com:0,shelf:m.querySelector('#pShelf').value,email:m.querySelector('#pE').value.trim().slice(0,120)});
      Object.assign(p,{name:name.slice(0,80),group:g.id,channel:g.channel,address:addr,km:km||0,float:fl||0,note:m.querySelector('#pNo').value.trim().slice(0,500)});
      if(isNew){ p.id=SYNC.newId('places'); S.places.push(p); } else { const x=S.places.find(y=>y.id===p.id); if(x){ ['route','lat','lng'].forEach(k=>{ if(!(k in p)) delete x[k]; }); Object.assign(x,p); } }
      const fid='fee-'+p.id, fx=S.costs.find(c=>c.id===fid), days=+m.querySelector('#pFd').value||1;
      if(fee){ if(fx) Object.assign(fx,{cents:fee,days}); else S.costs.push({id:fid,kind:'stallfee',place:p.id,cents:fee,days}); }
      else if(fx) S.costs.splice(S.costs.indexOf(fx),1);
      save(); close(); toast('Saved'); done&&done(p);
    };
    if(isNew) setTimeout(()=>{ if(!m.contains(document.activeElement)) m.querySelector('#pN').focus(); },50);
  });
}
