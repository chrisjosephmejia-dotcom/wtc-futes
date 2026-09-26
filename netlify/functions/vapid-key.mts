import type { Context, Config } from "@netlify/functions";
declare const Netlify:any;

const FALLBACK_PUBLIC_KEY = "BKVJBC8b0uZ-seyxOjEHous9fhuIKqreoAyhGQ1jrv7Qs9SoXWsJRC8TMy_YkQKrq9h_Pe0sluJvuSWViB6kFZU";

export default async (_req:Request,_context:Context) => {
  const publicKey=Netlify.env.get("VAPID_PUBLIC_KEY") || FALLBACK_PUBLIC_KEY;
  return Response.json({publicKey},{headers:{"Cache-Control":"no-store"}});
};
export const config:Config={path:"/api/vapid-key"};
