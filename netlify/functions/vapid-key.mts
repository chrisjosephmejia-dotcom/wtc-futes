import type { Context, Config } from "@netlify/functions";
import { getVapidPublicKey } from "./lib/push.mts";

export default async(_req:Request,_context:Context)=>{
  const publicKey=await getVapidPublicKey();
  return Response.json({publicKey},{headers:{"Cache-Control":"no-store"}});
};
export const config:Config={path:"/api/vapid-key"};