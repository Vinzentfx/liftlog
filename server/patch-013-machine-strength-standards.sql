-- Privacy-preserving, same-model machine-strength aggregates.
-- The app sends a SHA-256 hash of the normalized manufacturer/model label,
-- never the readable label or gym location. Raw rows are inaccessible to app
-- users; the RPC returns only a count and four robust percentiles.

create table if not exists public.machine_strength_observations (
  user_id uuid not null references auth.users on delete cascade,
  exercise_name text not null check(char_length(exercise_name) between 1 and 80),
  machine_hash text not null check(machine_hash ~ '^[0-9a-f]{64}$'),
  sex text not null check(sex in ('male','female')),
  normalized_ratio numeric not null check(normalized_ratio between 0.02 and 10),
  updated_at timestamptz not null default now(),
  primary key(user_id,exercise_name)
);

alter table public.machine_strength_observations enable row level security;
revoke all on table public.machine_strength_observations from anon,authenticated;

create or replace function public.share_machine_record(
  p_machine_hash text,p_exercise text,p_ratio numeric,p_sex text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if p_machine_hash !~ '^[0-9a-f]{64}$' or char_length(trim(p_exercise)) not between 1 and 80
    or p_ratio not between 0.02 and 10 or p_sex not in ('male','female') then
    raise exception 'MACHINE_RECORD_INVALID';
  end if;

  insert into public.machine_strength_observations(user_id,exercise_name,machine_hash,sex,normalized_ratio)
  values(auth.uid(),trim(p_exercise),p_machine_hash,p_sex,p_ratio)
  on conflict(user_id,exercise_name) do update set machine_hash=excluded.machine_hash,sex=excluded.sex,
    normalized_ratio=excluded.normalized_ratio,updated_at=now();

  select jsonb_build_object(
    'count',count(*),
    'q20',case when count(*)>=10 then percentile_cont(0.20) within group(order by normalized_ratio) end,
    'q40',case when count(*)>=10 then percentile_cont(0.40) within group(order by normalized_ratio) end,
    'q60',case when count(*)>=10 then percentile_cont(0.60) within group(order by normalized_ratio) end,
    'q80',case when count(*)>=10 then percentile_cont(0.80) within group(order by normalized_ratio) end
  ) into result from public.machine_strength_observations
  where machine_hash=p_machine_hash and exercise_name=trim(p_exercise) and sex=p_sex
    and updated_at>now()-interval '18 months';
  return result;
end; $$;

create or replace function public.remove_machine_record(p_exercise text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'AUTH'; end if;
  delete from public.machine_strength_observations where user_id=auth.uid() and exercise_name=trim(p_exercise);
end; $$;

revoke all on function public.share_machine_record(text,text,numeric,text) from public;
revoke all on function public.remove_machine_record(text) from public;
grant execute on function public.share_machine_record(text,text,numeric,text) to authenticated;
grant execute on function public.remove_machine_record(text) to authenticated;
