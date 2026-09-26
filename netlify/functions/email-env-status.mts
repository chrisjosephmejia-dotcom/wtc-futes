import type { Config } from "@netlify/functions";

declare const Netlify:any;

export default async () => {
  const apiKey=Netlify.env.get("RESEND_API_KEY");
  const to=Netlify.env.get("ALERT_EMAIL_TO");
  const from=Netlify.env.get("ALERT_EMAIL_FROM");
  const context=Netlify.env.get("CONTEXT");
  return Response.json({
    ok:true,
    hasResendApiKey:!!apiKey,
    hasAlertEmailTo:!!to,
    hasAlertEmailFrom:!!from,
    context:context||null
  });
};

export const config:Config={path:"/api/email-env-status"};
