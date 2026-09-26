import type { Config } from "@netlify/functions";

declare const Netlify:any;

export default async () => {
  return Response.json({
    resendApiKey: !!Netlify.env.get("RESEND_API_KEY"),
    alertEmailTo: !!Netlify.env.get("ALERT_EMAIL_TO"),
    alertEmailFrom: !!Netlify.env.get("ALERT_EMAIL_FROM")
  }, { headers: { "Cache-Control": "no-store" } });
};

export const config: Config = { path: "/api/email-health" };
