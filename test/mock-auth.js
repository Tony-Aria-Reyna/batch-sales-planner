// in-browser stand-in for Firebase Auth (screen tests only)
let listeners=[]; const cur=()=>{ try{ return JSON.parse(sessionStorage.getItem('mockuser')); }catch(e){ return null; } };
const emit=()=>{ const u=cur(); listeners.forEach(cb=>setTimeout(()=>cb(u),0)); };
export const getAuth=()=>({ get currentUser(){ return cur(); } }); export const browserLocalPersistence={}; export const setPersistence=()=>Promise.resolve();
export const connectAuthEmulator=()=>{}; export const getRedirectResult=()=>Promise.resolve(null);
export function onAuthStateChanged(a,cb){ listeners.push(cb); setTimeout(()=>cb(cur()),0); return ()=>{ listeners=listeners.filter(x=>x!==cb); }; }
export class GoogleAuthProvider{ setCustomParameters(){} static credential(j){ return JSON.parse(j); } }
export async function signInWithCredential(a,c){ sessionStorage.setItem('mockuser',JSON.stringify({email:c.email,uid:c.sub,metadata:{lastSignInTime:new Date().toUTCString()}})); emit(); }
export async function signInWithPopup(){ const e=new Error('popup'); e.code='auth/popup-closed-by-user'; throw e; }
export async function signInWithRedirect(){}
export async function signOut(){ sessionStorage.removeItem('mockuser'); emit(); }
export async function reauthenticateWithPopup(){ return {}; } export async function reauthenticateWithRedirect(){}
