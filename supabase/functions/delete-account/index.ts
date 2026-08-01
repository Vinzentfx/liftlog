const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !serviceKey) return reply(500, { code: 'SERVER' });
  if (!authorization?.startsWith('Bearer ')) return reply(401, { code: 'AUTH' });

  try {
    const userResponse = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: serviceKey },
    });
    if (!userResponse.ok) return reply(401, { code: 'AUTH' });
    const user = await userResponse.json();
    const { owner_token } = await request.json();
    if (typeof owner_token !== 'string' || owner_token.length < 32) {
      return reply(400, { code: 'OWNER_TOKEN_WRONG' });
    }

    // A stolen login token alone is insufficient: the server verifies the
    // main-device capability without deleting anything. Deleting the Auth user
    // afterwards cascades to all public rows in one database transaction.
    const dataResponse = await fetch(`${url}/rest/v1/rpc/authorize_account_deletion`, {
      method: 'POST',
      headers: { Authorization: authorization, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_token }),
    });
    if (!dataResponse.ok) {
      const problem = await dataResponse.json().catch(() => ({}));
      return reply(dataResponse.status, { code: problem.message || 'DENIED' });
    }

    const deleteResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!deleteResponse.ok) return reply(500, { code: 'SERVER' });
    return reply(200, { ok: true });
  } catch {
    return reply(500, { code: 'SERVER' });
  }
});

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
