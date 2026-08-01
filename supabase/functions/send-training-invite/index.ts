import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const handler = withSupabase({ auth: "user" }, async (request, ctx) => {
  if (request.method !== "POST") return reply(405, { code: "METHOD_NOT_ALLOWED" });
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:vonbehrenv@gmail.com";
  if (!publicKey || !privateKey) return reply(503, { code: "PUSH_NOT_CONFIGURED" });

  try {
    const { inviteId } = await request.json();
    const { data: userData } = await ctx.supabase.auth.getUser();
    if (!userData?.user?.id || typeof inviteId !== "string") return reply(400, { code: "INVALID_REQUEST" });

    // The browser-supplied id is never trusted: the admin lookup must prove the
    // signed-in caller actually sent this invitation before any push is sent.
    const { data: invite, error } = await ctx.supabaseAdmin.from("training_invites")
      .select("id,sender,recipient,training_at,note")
      .eq("id", inviteId).eq("sender", userData.user.id).eq("status", "pending").single();
    if (error || !invite) return reply(404, { code: "INVITE_NOT_FOUND" });

    const { data: subscriptions } = await ctx.supabaseAdmin.from("push_subscriptions")
      .select("endpoint,p256dh,auth").eq("user_id", invite.recipient);
    const { data: notificationPreference } = await ctx.supabaseAdmin.from("notification_preferences")
      .select("all_enabled").eq("user_id", invite.recipient).maybeSingle();
    if (notificationPreference?.all_enabled === false) return reply(200, { ok: true, delivered: 0 });
    const { data: profile } = await ctx.supabaseAdmin.from("social_profiles")
      .select("display_name").eq("user_id", invite.sender).single();
    const name = profile?.display_name || "Ein Freund";
    const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
      .format(new Date(invite.training_at));
    const payload = JSON.stringify({ title: `Trainingseinladung von ${name}`,
      body: `${name} möchte um ${time} trainieren.${invite.note ? ` ${invite.note}` : ""}`,
      tag: `training-invite-${invite.id}`, url: "./#/users" });

    webpush.setVapidDetails(subject, publicKey, privateKey);
    await Promise.all((subscriptions || []).map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
      } catch (pushError) {
        if ([404, 410].includes(pushError?.statusCode)) {
          await ctx.supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        } else console.warn("push failed", pushError?.statusCode);
      }
    }));
    return reply(200, { ok: true, delivered: subscriptions?.length || 0 });
  } catch (error) {
    console.error("training invite push failed", error);
    return reply(500, { code: "SERVER" });
  }
});

export default { fetch(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  return handler(request);
} };

function reply(status: number, body: unknown) { return Response.json(body, { status, headers: cors }); }
