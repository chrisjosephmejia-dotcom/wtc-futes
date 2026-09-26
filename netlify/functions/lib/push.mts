import webpush from "web-push";
import { store } from "./storage.mjs";

declare const Netlify: any;

function configure() {
  const subject = Netlify.env.get("VAPID_SUBJECT");
  const publicKey = Netlify.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Netlify.env.get("VAPID_PRIVATE_KEY");
  if (!subject || !publicKey || !privateKey) throw new Error("VAPID environment variables are missing");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendOne(subscription: any, payload: any) {
  configure();
  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 120,
    urgency: "high"
  });
}

export async function sendAll(payload: any) {
  configure();
  const subs = store("mnq-push-subscriptions");
  const listed = await subs.list({ prefix: "sub-" });
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const item of listed.blobs) {
    const sub = await subs.get(item.key, { type: "json" });
    if (!sub) continue;
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 120, urgency: "high" });
      sent += 1;
    } catch (error: any) {
      const code = error?.statusCode;
      if (code === 404 || code === 410) {
        await subs.delete(item.key);
        removed += 1;
      } else {
        failed += 1;
        console.error("push failed", item.key, code, error?.message);
      }
    }
  }
  return { sent, removed, failed, subscribers: listed.blobs.length };
}
