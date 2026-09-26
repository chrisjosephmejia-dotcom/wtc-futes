import type { Context, Config } from "@netlify/functions";
declare const Netlify:any;
export default async (_req:Request,_context:Context) => {
  const publicKey=Netlify.env.get("VAPID_PUBLIC_KEY");
  if (!publicKey) return Response.json({error:"Push key unavailable"},{status:500});
  return Response.json({publicKey},{headers:{"Cache-Control":"public, max-age=3600"}});
};
export const config:Config={path:"/api/vapid-key"};
