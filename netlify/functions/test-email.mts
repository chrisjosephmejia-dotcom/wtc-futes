import type { Config } from "@netlify/functions";
import { sendTestEmail } from "./lib/email.mjs";

// Redeployed after production email secret configuration.
export default async (req:Request) => {
  if(req.method!=="POST") return new Response("Method not allowed",{status:405});
  try {
    const result=await sendTestEmail();
    return Response.json({ok:true,id:result?.id||null});
  } catch(error:any) {
    return Response.json({ok:false,error:error?.message||String(error)},{status:500});
  }
};

export const config:Config={path:"/api/test-email"};
