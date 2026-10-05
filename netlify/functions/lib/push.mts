import webpush from "web-push";
import { get0DteStore } from "./0dte-store.mts";

const VAPID_KEY="push/vapid.json";
const SUBJECT="https://wtc-0dte.netlify.app";

export async function ensureVapid(){
  const store=get0DteStore();
  let keys:any=await store.get(VAPID_KEY,{type:"json"}).catch(()=>null);
  if(!keys?.publicKey||!keys?.privateKey){
    const generated=webpush.generateVAPIDKeys();
    keys={...generated,subject:SUBJECT,createdAt:new Date().toISOString()};
    await store.setJSON(VAPID_KEY,keys);
  }
  return keys;
}

async function configure(){
  const keys=await ensureVapid();
  webpush.setVapidDetails(keys.subject||SUBJECT,keys.publicKey,keys.privateKey);
  return keys;
}

export async function getVapidPublicKey(){
  const keys=await ensureVapid();
  return keys.publicKey as string;
}

export async function sendOne(subscription:any,payload:any){
  await configure();
  return webpush.sendNotification(subscription,JSON.stringify(payload),{TTL:120,urgency:"high"});
}

export async function sendAll(payload:any){
  await configure();
  const store=get0DteStore();
  const listed=await store.list({prefix:"push/sub-"});
  let sent=0,removed=0,failed=0;
  for(const item of listed.blobs){
    const sub=await store.get(item.key,{type:"json"});
    if(!sub)continue;
    try{
      await webpush.sendNotification(sub,JSON.stringify(payload),{TTL:120,urgency:"high"});
      sent++;
    }catch(error:any){
      const code=error?.statusCode;
      if(code===404||code===410){await store.delete(item.key);removed++;}
      else{failed++;console.error("0DTE push failed",item.key,code,error?.message);}
    }
  }
  return {sent,removed,failed,subscribers:listed.blobs.length};
}

export async function pushSubscriberCount(){
  const store=get0DteStore();
  const listed=await store.list({prefix:"push/sub-"});
  return listed.blobs.length;
}
