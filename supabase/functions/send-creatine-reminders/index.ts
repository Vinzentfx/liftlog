import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

export default { async fetch(request: Request) {
  if (request.method !== "POST") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const cronSecret = Deno.env.get("CREATINE_CRON_SECRET");
  if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
    return Response.json({ code: "AUTH" }, { status: 401 });
  }
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:vonbehrenv@gmail.com";
  const admin = createClient(url, serviceKey);
  const { data: preferences, error } = await admin.from("notification_preferences")
    .select("user_id,creatine_time,timezone_name,snoozed_until,last_taken_day,last_sent_at")
    .eq("all_enabled", true).eq("creatine_enabled", true).limit(1000);
  if (error) return Response.json({ code: "SERVER" }, { status: 500 });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  let delivered = 0;
  for (const pref of preferences || []) {
    const local = localNow(pref.timezone_name);
    if (pref.last_taken_day === local.day || !isDue(pref, local)) continue;
    const { data: subscriptions } = await admin.from("push_subscriptions")
      .select("endpoint,p256dh,auth").eq("user_id", pref.user_id);
    const payload = JSON.stringify({ title: "Kreatin-Erinnerung",
      body: "Hast du dein Kreatin heute schon genommen?",
      tag: `creatine-${local.day}`, url: "./#/home",
      actions: [{ action: "taken", title: "Schon genommen" },
        { action: "snooze", title: "Noch nicht genommen" }] });
    for (const subscription of subscriptions || []) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
        delivered++;
      } catch (pushError) {
        if ([404, 410].includes(pushError?.statusCode))
          await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      }
    }
    await admin.from("notification_preferences").update({ last_sent_at: new Date().toISOString(), snoozed_until: null })
      .eq("user_id", pref.user_id);
  }
  return Response.json({ ok: true, delivered });
} };

function localNow(timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isDue(pref: any, local: { day: string; minutes: number }) {
  if (pref.snoozed_until) return new Date(pref.snoozed_until).getTime() <= Date.now();
  if (pref.last_sent_at && localNow(pref.timezone_name).day === localNowAt(pref.last_sent_at, pref.timezone_name)) return false;
  const [hour, minute] = String(pref.creatine_time).split(":").map(Number);
  return local.minutes >= hour * 60 + minute;
}

function localNowAt(value: string, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
