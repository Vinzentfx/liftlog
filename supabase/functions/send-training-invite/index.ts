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
    const { inviteId, response = false } = await request.json();
    const { data: userData } = await ctx.supabase.auth.getUser();
    if (!userData?.user?.id || typeof inviteId !== "string" || typeof response !== "boolean") {
      return reply(400, { code: "INVALID_REQUEST" });
    }

    // The browser-supplied id is never trusted. For a new invitation the caller
    // must be its sender; for an answer the caller must be its recipient.
    const query = ctx.supabaseAdmin.from("training_invites")
      .select("id,sender,recipient,training_at,note,status,response_note,answered_at,response_push_sent_at")
      .eq("id", inviteId);
    const { data: invite, error } = response
      ? await query.eq("recipient", userData.user.id).in("status", ["accepted", "declined"]).single()
      : await query.eq("sender", userData.user.id).eq("status", "pending").single();
    if (error || !invite) return reply(404, { code: "INVITE_NOT_FOUND" });

    if (response) {
      if (invite.response_push_sent_at || !invite.answered_at
        || Date.now() - new Date(invite.answered_at).getTime() > 15 * 60 * 1000) {
        return reply(409, { code: "RESPONSE_ALREADY_SENT" });
      }
      // Claim the one permitted notification before sending it. The conditional
      // update prevents repeated requests from becoming a push-spam endpoint.
      const { data: claimed } = await ctx.supabaseAdmin.from("training_invites")
        .update({ response_push_sent_at: new Date().toISOString() }).eq("id", invite.id)
        .is("response_push_sent_at", null).select("id").maybeSingle();
      if (!claimed) return reply(409, { code: "RESPONSE_ALREADY_SENT" });
    }

    const target = response ? invite.sender : invite.recipient;

    const { data: subscriptions } = await ctx.supabaseAdmin.from("push_subscriptions")
      .select("endpoint,p256dh,auth").eq("user_id", target);
    const { data: notificationPreference } = await ctx.supabaseAdmin.from("notification_preferences")
      .select("all_enabled").eq("user_id", target).maybeSingle();
    if (notificationPreference?.all_enabled === false) return reply(200, { ok: true, delivered: 0 });
    const { data: profile } = await ctx.supabaseAdmin.from("social_profiles")
      .select("display_name").eq("user_id", response ? invite.recipient : invite.sender).single();
    const name = profile?.display_name || "Ein Freund";
    const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
      .format(new Date(invite.training_at));
    const accepted = invite.status === "accepted";
    const payload = JSON.stringify(response
      ? { title: `${name} hat ${accepted ? "zugesagt" : "abgesagt"}`,
        body: `${name} hat das Training um ${time} ${accepted ? "angenommen" : "abgelehnt"}.${invite.response_note ? ` ${invite.response_note}` : ""}`,
        tag: `training-response-${invite.id}`, url: "./#/users" }
      : { title: `Trainingseinladung von ${name}`,
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
