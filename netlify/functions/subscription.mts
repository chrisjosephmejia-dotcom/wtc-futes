import type { Context, Config } from "@netlify/functions";
import crypto from "node:crypto";
import { get0DteStore } from "./lib/0dte-store.mts";

function key(endpoint:string){return "push/sub-"+crypto.createHash("sha256").update(endpoint).digest("hex").slice(0,32);}
export default async(req:Request,_context:Context)=>{
  if(!["POST","DELETE"].includes(req.method))return new Response("Method not allowed",{status:405});
  const body:any=await req.json().catch(()=>null),endpoint=body?.endpoint;
  if(!endpoint)return Response.json({error:"Missing subscription endpoint"},{status:400});
  const store=get0DteStore(),k=key(endpoint);
  if(req.method==="DELETE"){await store.delete(k);return Response.json({ok:true,subscribed:false});}
  if(!body?.keys?.p256dh||!body?.keys?.auth)return Response.json({error:"Invalid push subscription"},{status:400});
  await store.setJSON(k,body);
  const listed=await store.list({prefix:"push/sub-"});
  return Response.json({ok:true,subscribed:true,subscriberCount:listed.blobs.length});
};
export const config:Config={path:"/api/subscription"};