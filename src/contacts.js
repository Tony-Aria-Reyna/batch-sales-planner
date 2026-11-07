/* ================= Customer contacts (owners and managers, from Setup) =================
   Every email address given for a receipt is kept, in one of two lists:
   • Loyalty programme: the customer said yes to the Loyalty programme question. These people have agreed
     to news and offers by email; the date, the exact wording and who asked are kept as proof of consent.
   • Receipt only: everyone else. These addresses were given for a receipt and must not be sent marketing
     emails (NZ Unsolicited Electronic Messages Act 2007).
   Consent records are never edited. Leaving the programme adds a "left" entry; a later receipt where the
   customer says "No thanks" doesn't take them off the programme. Deleting a contact removes every entry. */
let contactTab='loyalty', contactFind='';
function contactList(){
  const by={};
  S.contacts.slice().sort((a,b)=>a.at-b.at).forEach(c=>{
    const k=String(c.email||'').toLowerCase(); if(!k) return;
    const r=by[k]||(by[k]={email:k,name:'',first:c.at,last:c.at,receipts:0,loyalty:false,joinedAt:null,joinedWhere:'',joinedBy:'',consentText:'',leftAt:null,ids:[]});
    r.ids.push(c.id); r.last=c.at; if(c.name) r.name=c.name; if(c.saleId) r.receipts++;
    if(c.kind==='joined'||(c.loyalty===true&&c.kind!=='left')){ r.loyalty=true; r.joinedAt=c.at; r.joinedWhere=c.source||''; r.joinedBy=c.servedBy||personName(c.by); r.consentText=c.consentText||''; r.leftAt=null; }
    if(c.kind==='left'){ r.loyalty=false; r.leftAt=c.at; }
  });
  return Object.values(by).sort((a,b)=>a.email.localeCompare(b.email));
}
const shortDate=t=>t?nzDate(new Date(t),{day:'numeric',month:'short',year:'numeric'}):'';
SCREENS.contacts={
  title:()=>({h:'Customer contacts',s:'Loyalty programme and receipt-only emails'}),
  html(){
    const all=contactList(), loyal=all.filter(c=>c.loyalty), other=all.filter(c=>!c.loyalty);
    const list=(contactTab==='loyalty'?loyal:other).filter(c=>!contactFind||(c.email+' '+c.name).toLowerCase().includes(contactFind.toLowerCase()));
    return `<div class="card"><div class="ctabs"><button class="fchip ${contactTab==='loyalty'?'on':''}" data-ct="loyalty" style="--c:var(--green)">💚 Loyalty programme <small>${loyal.length}</small></button>
        <button class="fchip ${contactTab==='other'?'on':''}" data-ct="other" style="--c:var(--muted)">📧 Receipt only <small>${other.length}</small></button></div>
      <p class="note">${contactTab==='loyalty'?'These customers said <b>yes</b> to the Loyalty programme, so they can be sent news and offers. Every email to them must offer an easy way to leave.':'These addresses were given <b>for a receipt only</b>. Don\'t send them news or offers unless they join the Loyalty programme.'}</p>
      <input class="txt" id="cFind" placeholder="Search by email or name" value="${esc(contactFind)}">
      <div class="mact" style="justify-content:flex-start"><button class="btn alt" id="cCsv">⬇️ Download this list (CSV)</button></div></div>
    <div class="card">${list.length?list.map(c=>`<div class="row"><div class="grow"><b>${esc(c.email)}</b>${c.name?' · '+esc(c.name):''}
        <small>${c.loyalty?'Joined '+shortDate(c.joinedAt)+(c.joinedWhere?' at '+esc(c.joinedWhere):'')+(c.joinedBy?' · asked by '+esc(c.joinedBy):''):'First receipt '+shortDate(c.first)+(c.leftAt?' · left the Loyalty programme '+shortDate(c.leftAt):'')} · ${c.receipts} receipt${c.receipts===1?'':'s'}</small></div>
        ${c.loyalty?`<button class="btn alt small" data-leave="${esc(c.email)}">Remove from loyalty</button>`:''}${role()==='owner'?`<button class="btn danger small" data-forget="${esc(c.email)}">Delete</button>`:''}</div>`).join('')
      :`<p class="note">${contactFind?'Nobody matches that search.':'Nobody yet. Addresses appear here when customers are emailed a receipt.'}</p>`}</div>`;
  },
  wire(){
    document.querySelectorAll('[data-ct]').forEach(b=>b.onclick=()=>{ contactTab=b.dataset.ct; render(); });
    const f=$('#cFind'); f.oninput=()=>{ contactFind=f.value; const pos=f.selectionStart; render(); const g=$('#cFind'); g.focus(); g.setSelectionRange(pos,pos); };
    $('#cCsv').onclick=()=>{ const all=contactList(), list=contactTab==='loyalty'?all.filter(c=>c.loyalty):all.filter(c=>!c.loyalty);
      const q=x=>'"'+String(x==null?'':x).replace(/"/g,'""')+'"';
      const rows=contactTab==='loyalty'?[['Email','Name','Joined','Where','Asked by','Receipts','Wording agreed to']].concat(list.map(c=>[c.email,c.name,shortDate(c.joinedAt),c.joinedWhere,c.joinedBy,c.receipts,c.consentText]))
        :[['Email','Name','First receipt','Receipts','Left loyalty']].concat(list.map(c=>[c.email,c.name,shortDate(c.first),c.receipts,shortDate(c.leftAt)]));
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv'}));
      a.download=(contactTab==='loyalty'?'loyalty-programme-':'receipt-only-contacts-')+nzDay()+'.csv'; document.body.appendChild(a); a.click(); a.remove(); toast('Downloaded '+list.length+' contacts'); };
    document.querySelectorAll('[data-leave]').forEach(b=>b.onclick=()=>{ const e=b.dataset.leave;
      confirmBox('Remove '+e+' from the Loyalty programme?','Do this when a customer asks to leave. Their email stays on the receipt-only list.','Remove',()=>{
        S.contacts.push({id:SYNC.newId('contacts'),email:e,name:'',loyalty:false,kind:'left',consentText:'',source:'',by:SYNC.me(),at:Date.now()});
        logApproval('remove from the Loyalty programme',SYNC.me(),e); save(); render(); toast(e+' has left the Loyalty programme'); }); });
    document.querySelectorAll('[data-forget]').forEach(b=>b.onclick=()=>{ const e=b.dataset.forget;
      confirmBox('Delete '+e+' completely?','Use this when a customer asks for their details to be deleted. Every record of their email, including their Loyalty programme consent, is removed. It can\'t be undone.','Delete',()=>{
        for(let i=S.contacts.length-1;i>=0;i--) if(String(S.contacts[i].email).toLowerCase()===e) S.contacts.splice(i,1);
        logApproval('delete a customer contact',SYNC.me(),'(email removed at the customer\'s request)'); save(); render(); toast('Deleted'); },true); });
  }
};
