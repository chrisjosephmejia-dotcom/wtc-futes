import type { Context, Config } from "@netlify/functions";
declare const Netlify:any;



export default async (_req:Request,_context:Context) => {
  const publicKey=Netlify.env.get("VAPID_PUBLIC_KEY");
  if(!publicKey) return Response.json({error:"MCL push configuration is not ready"},{status:503,headers:{"Cache-Control":"no-store"}});
  return Response.json({publicKey},{headers:{"Cache-Control":"no-store"}});
};
export const config:Config={path:"/api/vapid-key"};
