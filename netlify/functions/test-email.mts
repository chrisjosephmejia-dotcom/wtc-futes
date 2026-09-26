import type { Config } from "@netlify/functions";
import { sendTestEmail } from "./lib/email.mjs";

export default async (_req:Request) => {
  try {
    const result=await sendTestEmail();
    return Response.json({ok:true,id:result?.id||null});
  } catch(error:any) {
    return Response.json({ok:false,error:error?.message||String(error)},{status:500});
  }
};

export const config:Config={path:"/api/test-email"};
