import type { Context, Config } from "@netlify/functions";
import crypto from "node:crypto";
import { store } from "./lib/storage.mjs";

function key(endpoint:string){return "sub-"+crypto.createHash("sha256").update(endpoint).digest("hex").slice(0,32);}
export default async (req:Request,_context:Context) => {
  if (!["POST","DELETE"].includes(req.method)) return new Response("Method not allowed",{status:405});
  const body:any=await req.json().catch(()=>null); const endpoint=body?.endpoint;
  if (!endpoint) return Response.json({error:"Missing subscription endpoint"},{status:400});
  const s=store("mnq-push-subscriptions"); const k=key(endpoint);
  if (req.method==="DELETE") {await s.delete(k); return Response.json({ok:true,subscribed:false});}
  if (!body?.keys?.p256dh || !body?.keys?.auth) return Response.json({error:"Invalid push subscription"},{status:400});
  await s.setJSON(k,body);
  const listed=await s.list({prefix:"sub-"});
  return Response.json({ok:true,subscribed:true,subscriberCount:listed.blobs.length});
};
export const config:Config={path:"/api/subscription"};
