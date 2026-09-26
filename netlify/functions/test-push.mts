import type { Context, Config } from "@netlify/functions";
import { sendOne } from "./lib/push.mjs";
export default async (req:Request,_context:Context) => {
  if (req.method!=="POST") return new Response("Method not allowed",{status:405});
  const sub:any=await req.json().catch(()=>null);
  if (!sub?.endpoint) return Response.json({error:"No push subscription"},{status:400});
  try {
    await sendOne(sub,{title:"WTC MNQ server test",body:"Real Web Push is working. This came from Netlify, not the open browser tab.",tag:"mnq-server-test",url:"/",kind:"test",ts:Date.now()});
    return Response.json({ok:true});
  } catch(error:any) {
    return Response.json({ok:false,error:error?.message||String(error)},{status:500});
  }
};
export const config:Config={path:"/api/test-push"};
