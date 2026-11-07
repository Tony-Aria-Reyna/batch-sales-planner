// in-browser stand-in for Firestore (screen tests only): shared across tabs via localStorage
const K='mockdb'; const load=()=>JSON.parse(localStorage.getItem(K)||'{}'); const store=d=>localStorage.setItem(K,JSON.stringify(d));
let subs=[]; const me=()=>{ try{ return JSON.parse(sessionStorage.getItem('mockuser')).email; }catch(e){ return null; } };
window.addEventListener('storage',e=>{ if(e.key===K) fire(); });
function fire(){ subs.forEach(s=>setTimeout(()=>s.run(),0)); }
const memberOf=(d,path)=>{ if(path.startsWith('invites')) return true; const hid=path.split('/')[1]; const h=d['businesses/'+hid]; return h&&h.members&&h.members.includes(me()); };
const deny=cb=>{ const e=new Error('denied'); e.code='permission-denied'; cb&&cb(e); };
export const initializeFirestore=()=>({}); export const persistentLocalCache=()=>({}); export const persistentMultipleTabManager=()=>({}); export const connectFirestoreEmulator=()=>{};
export const doc=(db,...p)=>{ if(!p.length&&db&&db.t==='col'){ const id=Math.random().toString(36).slice(2,12); return {t:'doc',path:db.path+'/'+id,id}; } return {t:'doc',path:p.join('/'),id:p[p.length-1]}; }; export const collection=(db,...p)=>({t:'col',path:p.join('/')});
export const where=(f,op,v)=>({f,op,v}); export const query=(c,w)=>({t:'q',path:c.path,w});
export const serverTimestamp=()=>Date.now();
export const deleteField=()=>({__del:1}); export const arrayUnion=v=>({__u:v}); export const arrayRemove=v=>({__r:v});
function snapCol(d,path){ const pre=path+'/'; const docs=Object.keys(d).filter(k=>k.startsWith(pre)&&!k.slice(pre.length).includes('/')).map(k=>({id:k.slice(pre.length),data:()=>JSON.parse(JSON.stringify(d[k]))})); return {docs,empty:!docs.length}; }
export function onSnapshot(ref,a,b,c){ let cb=a,err=b; if(typeof a!=='function'){ cb=b; err=c; }
  const s={run(){ const d=load(); if(!memberOf(d,ref.path)) return deny(err);
    if(ref.t==='doc'){ const v=d[ref.path]; cb({exists:()=>!!v,data:()=>JSON.parse(JSON.stringify(v)),id:ref.id,metadata:{hasPendingWrites:false}}); } else { const sc=snapCol(d,ref.path); sc.metadata={hasPendingWrites:false}; cb(sc); } }};
  subs.push(s); setTimeout(()=>s.run(),0); return ()=>{ subs=subs.filter(x=>x!==s); };
}
export async function getDocs(q){ const d=load(); const s=snapCol(d,q.path); if(q.w) s.docs=s.docs.filter(x=>{ const v=x.data()[q.w.f]; return Array.isArray(v)&&v.includes(q.w.v); }); s.empty=!s.docs.length; return s; }
export async function addDoc(c,data){ const d=load(); const id=Math.random().toString(36).slice(2,10); d[c.path+'/'+id]=data; store(d); fire(); return {id}; }
function applyUpdate(old,data){ const n=Object.assign({},old); for(const [k,v] of Object.entries(data)){ if(k.includes('.')){ const [a,b]=k.split('.'); n[a]=Object.assign({},n[a]); if(v&&v.__del) delete n[a][b]; else n[a][b]=v; continue; } if(v&&v.__u!==undefined){ n[k]=[...new Set([...(n[k]||[]),v.__u])]; } else if(v&&v.__r!==undefined){ n[k]=(n[k]||[]).filter(x=>x!==v.__r); } else n[k]=v; } return n; }
export async function updateDoc(ref,data){ const d=load(); if(!memberOf(d,ref.path)) { const e=new Error('denied'); e.code='permission-denied'; throw e; } d[ref.path]=applyUpdate(d[ref.path],data); store(d); fire(); }
export function writeBatch(){ const ops=[]; return { set(r,v){ops.push(['s',r,v]);}, update(r,v){ops.push(['u',r,v]);}, delete(r){ops.push(['d',r]);},
  async commit(){ const d=load(); for(const [k,r,v] of ops){ if(!memberOf(d,r.path)){ const e=new Error('denied'); e.code='permission-denied'; throw e; } if(k==='s') d[r.path]=JSON.parse(JSON.stringify(v)); else if(k==='u') d[r.path]=applyUpdate(d[r.path],v); else delete d[r.path]; } store(d); fire(); } }; }

export async function getDoc(ref){ const d=load(); const v=d[ref.path]; return {exists:()=>!!v,data:()=>v,id:ref.id}; }
export async function setDoc(ref,data){ const d=load(); d[ref.path]=JSON.parse(JSON.stringify(data)); store(d); fire(); }
export async function deleteDoc(ref){ const d=load(); delete d[ref.path]; store(d); fire(); }
