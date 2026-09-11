// Konto vollständig löschen. Zur privilegierten Löschung in Auth kommt nur, wer
// angemeldet ist UND die Besitzer-Berechtigung des Hauptgeräts hat.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const deleteAccount = withSupabase({ auth: "user" }, async (request, ctx) => {
  if (request.method !== "POST") return reply(405, { code: "METHOD_NOT_ALLOWED" });

  try {
    const body = await request.json();
    const ownerToken = body?.owner_token;
    if (typeof ownerToken !== "string" || ownerToken.length < 32) {
      return reply(400, { code: "OWNER_TOKEN_WRONG" });
    }

    // Aufruf mit RLS: auth.uid() ist die angemeldete Person. Die SQL-Funktion
    // vergleicht einen Hash der Berechtigung, die nur auf dem Gerät liegt, und ändert keine Daten.
    const { data: authorized, error: authorizationError } = await ctx.supabase
      .rpc("authorize_account_deletion", { owner_token: ownerToken });
    if (authorizationError || authorized !== true) {
      console.warn("account deletion authorization denied", authorizationError?.code);
      return reply(403, { code: "OWNER_TOKEN_WRONG" });
    }

    const { data: userResult, error: userError } = await ctx.supabase.auth.getUser();
    const user = userResult?.user;
    if (userError || !user?.id) return reply(401, { code: "AUTH" });

    // supabaseAdmin stellt die gehostete Laufzeit bereit, es kommt nie in den
    // Browser. Das Löschen in auth.users entfernt kaskadierend alle Kontozeilen von LiftLog.
    const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("Auth account deletion failed", deleteError.code, deleteError.message);
      return reply(500, { code: "SERVER" });
    }

    return reply(200, { ok: true });
  } catch (error) {
    console.error("account deletion failed", error);
    return reply(500, { code: "SERVER" });
  }
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    return deleteAccount(request);
  },
};

function reply(status: number, body: unknown) {
  return Response.json(body, { status, headers: cors });
}
