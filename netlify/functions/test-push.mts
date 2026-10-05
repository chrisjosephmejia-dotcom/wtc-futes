import type { Context, Config } from "@netlify/functions";
import { sendOne } from "./lib/push.mts";

export default async(req:Request,_context:Context)=>{
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  const sub:any=await req.json().catch(()=>null);
  if(!sub?.endpoint)return Response.json({error:"No push subscription"},{status:400});
  try{
    await sendOne(sub,{
      title:"WTC XSP 0DTE test",
      body:"App notifications are working. Entry and exit alerts will come from the 0DTE engine.",
      tag:"wtc-0dte-test",url:"/",kind:"test",ts:Date.now()
    });
    return Response.json({ok:true});
  }catch(error:any){
    return Response.json({ok:false,error:error?.message||String(error)},{status:500});
  }
};
export const config:Config={path:"/api/test-push"};