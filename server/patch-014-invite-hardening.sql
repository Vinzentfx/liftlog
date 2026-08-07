-- Patch 014: make the invite gate's rate limits real, and its codes unguessable.
-- Apply after patch-013 in the Supabase SQL editor.
--
-- Two separate problems, found by reading what the transaction does rather than
-- what the function says.
--
-- 1. THE LIMITS NEVER COUNTED. `consume_security_attempt` records an attempt
--    and returns whether it was within budget. Every caller then reports a bad
--    code with `raise exception`, which aborts the transaction the RPC runs in,
--    which rolls back the row it had just written. So a wrong guess left the
--    counter exactly where it found it, and "ten attempts an hour" was ten
--    attempts a second, forever. The fix is to stop raising: these functions now
--    return a status string and commit, so the attempt that was counted stays
--    counted. `claim_ownership` had the identical bug and is fixed the same way.
--
-- 2. THE LIMIT WAS THE WRONG SHAPE ANYWAY. It is keyed by `auth.uid()`, and
--    signing up is open to anyone, so ten guesses per free account is unlimited
--    guessing. That only ever mattered because codes were short and
--    human-chosen, in the shape of `MARCEL-2026`: a first name and a year.
--
--    So: a cap on failed claims across the whole instance, which the
--    free-accounts trick cannot walk around, and `public.new_invite()`, which
--    mints 80 bits. The second is what actually closes it; the first is there
--    for the codes already handed out.
--
-- The global cap is deliberately generous, because it is shared: a determined
-- stranger can spend it and stop new sign-ups for an hour. Locking your own
-- friends out for an hour is a much smaller problem than letting a stranger in,
-- and clearing it early is one statement, at the bottom of this file.
--
-- The client tolerates both versions of these functions, so the app keeps
-- working between deploying this and shipping the matching JavaScript.

-- ------------------------------------------------------------- global guard --

create table if not exists public.invite_guard (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default now(),
  failures int not null default 0
);
alter table public.invite_guard enable row level security;
-- No policies: server-only state, like security_attempts.
revoke all on table public.invite_guard from anon, authenticated;

insert into public.invite_guard (id) values (true) on conflict (id) do nothing;

-- How many wrong codes the whole instance may produce in one hour. Somebody
-- mistyping a code they actually hold will not come close.
create or replace function public.invite_failure_budget()
returns int language sql immutable as $$ select 30 $$;

create or replace function public.note_invite_failure()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.invite_guard set
    window_started_at = case
      when window_started_at < now() - interval '1 hour' then now()
      else window_started_at end,
    failures = case
      when window_started_at < now() - interval '1 hour' then 1
      else failures + 1 end
  where id;
end; $$;

create or replace function public.invites_locked()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select failures >= public.invite_failure_budget()
      and window_started_at >= now() - interval '1 hour'
    from public.invite_guard where id
  ), false);
$$;

-- ------------------------------------------------------------ claim_invite --

-- Returns a status instead of raising, so that a counted attempt survives the
-- call. 'OK' on success, otherwise the reason. Body is otherwise patch-004's,
-- kept whole so this file alone says what the function does now.
--
-- The old void-returning version has to go explicitly: changing the return type
-- is not something `create or replace` will do for you.
drop function if exists public.claim_invite(text);

create or replace function public.claim_invite(invite_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_code text;
begin
  if auth.uid() is null then
    return 'NOT_SIGNED_IN';
  end if;

  -- Read the grant directly. This RPC must not depend on callers having execute
  -- permission on the private has_active_access() helper.
  if exists (
    select 1 from public.access_grants ag
    where ag.user_id = auth.uid() and ag.active = true
  ) then
    return 'OK';
  end if;

  -- Checked before the per-account counter: somebody spending one attempt per
  -- throwaway account never reaches their own limit, so their own limit is not
  -- the one that can stop them.
  if public.invites_locked() then
    return 'RATE_LIMITED';
  end if;

  if not public.consume_security_attempt('claim_invite', 10) then
    return 'RATE_LIMITED';
  end if;

  update public.invites i
  set used_by = auth.uid(), used_at = now()
  where i.code = invite_code and i.used_by is null
  returning i.code into claimed_code;

  if claimed_code is null then
    perform public.note_invite_failure();
    return 'INVITE_INVALID';
  end if;

  insert into public.profiles (id)
  values (auth.uid())
  on conflict (id) do nothing;

  insert into public.access_grants (
    user_id, active, granted_at, revoked_at, invite_code
  ) values (
    auth.uid(), true, now(), null, claimed_code
  )
  on conflict (user_id) do update set
    active = true,
    granted_at = now(),
    revoked_at = null,
    invite_code = excluded.invite_code;

  delete from public.security_attempts
  where user_id = auth.uid() and action = 'claim_invite';
  return 'OK';
end;
$$;

-- --------------------------------------------------------- claim_ownership --

-- Same rollback bug, same fix. The recovery key is 128 bits, so the limiter was
-- never the thing standing between an attacker and an account: it is fixed
-- because a limiter that silently does nothing is worse than no limiter, since
-- it is the one you stop thinking about.
drop function if exists public.claim_ownership(text, uuid, text);

create or replace function public.claim_ownership(verifier text, device uuid, owner_token text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare stored text;
begin
  if auth.uid() is null then return 'NOT_SIGNED_IN'; end if;
  if not public.consume_security_attempt('claim_ownership', 5) then
    return 'RATE_LIMITED';
  end if;
  select rp.verifier into stored from public.recovery_proofs rp where rp.user_id = auth.uid();
  if stored is null then return 'NO_RECOVERY_SET'; end if;
  if stored <> verifier then return 'RECOVERY_WRONG'; end if;
  if length(owner_token) < 40 then return 'OWNER_TOKEN_INVALID'; end if;
  if not exists (select 1 from public.devices d where d.id = device and d.user_id = auth.uid()) then
    return 'NO_SUCH_DEVICE';
  end if;
  update public.devices set status = 'revoked', wrapped_key = null,
    wrap_iv = null, wrapped_by = null
  where user_id = auth.uid() and id <> device;
  update public.devices set status = 'approved', approved_at = now() where id = device;
  update public.profiles set owner_device = device,
    owner_token_hash = digest(owner_token, 'sha256') where id = auth.uid();
  delete from public.security_attempts where user_id = auth.uid() and action = 'claim_ownership';
  return 'OK';
end; $$;

-- ------------------------------------------------------------ minting codes --

-- 16 characters from a 30-symbol alphabet: a shade over 78 bits. The alphabet
-- leaves out 0/O/1/I/L/U so a code can be read down the phone without a
-- spelling argument, and the groups of four are there for the same reason.
--
-- Admin only. Not granted to `authenticated`, so it runs from the SQL editor
-- and nowhere else.
create or replace function public.new_invite(invite_note text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  generated text := '';
  raw bytea;
begin
  raw := gen_random_bytes(16);
  for i in 0..15 loop
    generated := generated || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
    if i in (3, 7, 11) then generated := generated || '-'; end if;
  end loop;
  insert into public.invites (code, note) values (generated, invite_note);
  return generated;
end; $$;

revoke all on function public.new_invite(text) from public, anon, authenticated;
revoke all on function public.note_invite_failure() from public, anon, authenticated;
revoke all on function public.invites_locked() from public, anon, authenticated;
revoke all on function public.invite_failure_budget() from public, anon, authenticated;
revoke all on function public.claim_invite(text) from public, anon;
grant execute on function public.claim_invite(text) to authenticated;
revoke all on function public.claim_ownership(text, uuid, text) from public, anon;
grant execute on function public.claim_ownership(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------ how to --
--
-- Issue a code, and read it back once:
--   select public.new_invite('Marcel');
--
-- Which existing codes are worth guessing? Anything short or word-shaped.
-- Delete the unused ones and hand out fresh ones instead:
--   select code, note, used_by from public.invites
--    where used_by is null and length(replace(code, '-', '')) < 12;
--   delete from public.invites
--    where used_by is null and length(replace(code, '-', '')) < 12;
--
-- Clear the global lock early, if a stranger has parked on it:
--   update public.invite_guard set failures = 0 where id;
--
-- Accounts that signed up and never redeemed a code leave an auth.users row and
-- nothing else. Harmless in themselves, but they are what makes guessing cheap,
-- so they are worth sweeping up. Deleting them needs the service role, i.e. the
-- dashboard rather than this editor:
--   select u.id, u.email, u.created_at from auth.users u
--     left join public.access_grants ag on ag.user_id = u.id
--    where ag.user_id is null and u.created_at < now() - interval '7 days';
