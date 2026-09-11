-- Freiwilliger sozialer Bereich mit Datenschutz zuerst. Die Trainingssicherungen bleiben
-- verschlüsselt und unberührt, hier liegen nur die kleinen Werte, die jemand ausdrücklich freigibt.

create table if not exists public.social_profiles (
  user_id uuid primary key references auth.users on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  discoverable boolean not null default false,
  leaderboard_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users on delete cascade,
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester <> addressee),
  unique (requester, addressee)
);

create table if not exists public.social_weekly_stats (
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  workouts smallint not null check (workouts between 0 and 50),
  working_sets smallint not null check (working_sets between 0 and 1000),
  strength_score numeric(5,2) check (strength_score between 0 and 100),
  training_today boolean not null default false,
  status_text text check (char_length(status_text) <= 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.social_profiles enable row level security;
alter table public.social_friendships enable row level security;
alter table public.social_weekly_stats enable row level security;
-- Absichtlich keine direkten Policies auf den Tabellen. Alles Lesen und Schreiben geht über
-- die schmalen Funktionen unten, damit die REST-API kein Verzeichnis aller Nutzer ausspuckt.

create or replace function public.save_social_profile(
  new_handle text, new_display_name text, is_discoverable boolean, joins_leaderboard boolean
) returns void language plpgsql security definer set search_path = public as $$
declare clean_handle text := lower(trim(new_handle));
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if clean_handle !~ '^[a-z0-9_]{3,24}$' then raise exception 'HANDLE_INVALID'; end if;
  if char_length(trim(new_display_name)) not between 1 and 40 then raise exception 'NAME_INVALID'; end if;
  insert into public.social_profiles(user_id, handle, display_name, discoverable, leaderboard_opt_in)
  values (auth.uid(), clean_handle, trim(new_display_name), is_discoverable, joins_leaderboard)
  on conflict (user_id) do update set handle=excluded.handle, display_name=excluded.display_name,
    discoverable=excluded.discoverable, leaderboard_opt_in=excluded.leaderboard_opt_in, updated_at=now();
exception when unique_violation then raise exception 'HANDLE_TAKEN';
end; $$;

create or replace function public.publish_social_week(
  workout_count integer, working_set_count integer, strength_value numeric,
  trains_today boolean, status_text text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not exists(select 1 from public.social_profiles where user_id=auth.uid()) then raise exception 'SOCIAL_PROFILE_REQUIRED'; end if;
  insert into public.social_weekly_stats(user_id, week_start, workouts, working_sets, strength_score, training_today, status_text)
  values(auth.uid(), date_trunc('week', current_date)::date,
    greatest(0,least(workout_count,50)), greatest(0,least(working_set_count,1000)),
    case when strength_value between 0 and 100 then strength_value else null end,
    trains_today, nullif(left(trim(status_text),100),''))
  on conflict(user_id,week_start) do update set workouts=excluded.workouts,
    working_sets=excluded.working_sets, strength_score=excluded.strength_score,
    training_today=excluded.training_today, status_text=excluded.status_text, updated_at=now();
end; $$;

create or replace function public.request_friend(friend_handle text)
returns void language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  select user_id into target from public.social_profiles
    where handle=lower(trim(friend_handle)) and discoverable=true;
  if target is null then raise exception 'USER_NOT_FOUND'; end if;
  if target=auth.uid() then raise exception 'CANNOT_ADD_SELF'; end if;
  if exists(select 1 from public.social_friendships where status='blocked' and
    ((requester=auth.uid() and addressee=target) or (requester=target and addressee=auth.uid())))
    then raise exception 'USER_NOT_FOUND'; end if;
  if exists(select 1 from public.social_friendships where
    ((requester=auth.uid() and addressee=target) or (requester=target and addressee=auth.uid())))
    then raise exception 'REQUEST_EXISTS'; end if;
  insert into public.social_friendships(requester,addressee) values(auth.uid(),target);
end; $$;

create or replace function public.answer_friend_request(request_id uuid, accept_request boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if accept_request then
    update public.social_friendships set status='accepted', updated_at=now()
      where id=request_id and addressee=auth.uid() and status='pending';
  else
    delete from public.social_friendships where id=request_id and addressee=auth.uid() and status='pending';
  end if;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
end; $$;

create or replace function public.block_social_user(blocked_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_active_access() or blocked_user=auth.uid() then raise exception 'NOT_ALLOWED'; end if;
  delete from public.social_friendships where
    (requester=auth.uid() and addressee=blocked_user) or (requester=blocked_user and addressee=auth.uid());
  insert into public.social_friendships(requester,addressee,status)
    values(auth.uid(),blocked_user,'blocked') on conflict(requester,addressee)
    do update set status='blocked',updated_at=now();
end; $$;

create or replace function public.social_hub()
returns jsonb language sql stable security definer set search_path = public as $$
with me as (
  select p.user_id,p.handle,p.display_name,p.discoverable,p.leaderboard_opt_in,
    coalesce(s.training_today and s.updated_at::date=current_date,false) training_today,
    case when s.updated_at::date=current_date then s.status_text else null end status_text
  from public.social_profiles p left join public.social_weekly_stats s
    on s.user_id=p.user_id and s.week_start=date_trunc('week',current_date)::date
  where p.user_id=auth.uid()
), accepted as (
  select f.id, case when f.requester=auth.uid() then f.addressee else f.requester end friend_id
  from public.social_friendships f where public.has_active_access() and f.status='accepted'
    and (f.requester=auth.uid() or f.addressee=auth.uid())
), friends as (
  select p.user_id,p.handle,p.display_name,
    coalesce(s.training_today and s.updated_at::date=current_date,false) training_today,
    case when s.updated_at::date=current_date then s.status_text else null end status_text,
    s.workouts,s.working_sets
  from accepted a join public.social_profiles p on p.user_id=a.friend_id
  left join public.social_weekly_stats s on s.user_id=p.user_id and s.week_start=date_trunc('week',current_date)::date
), requests as (
  select f.id,p.user_id,p.handle,p.display_name from public.social_friendships f
  join public.social_profiles p on p.user_id=f.requester
  where public.has_active_access() and f.addressee=auth.uid() and f.status='pending'
), leaders as (
  select p.user_id,p.handle,p.display_name,s.workouts,s.working_sets,s.strength_score
  from public.social_profiles p join public.social_weekly_stats s on s.user_id=p.user_id
  where public.has_active_access() and p.leaderboard_opt_in=true
    and s.week_start=date_trunc('week',current_date)::date
  order by s.workouts desc,s.working_sets desc limit 50
)
select jsonb_build_object(
  'me',coalesce((select to_jsonb(me) from me),'null'::jsonb),
  'friends',coalesce((select jsonb_agg(to_jsonb(friends) order by display_name) from friends),'[]'::jsonb),
  'requests',coalesce((select jsonb_agg(to_jsonb(requests) order by display_name) from requests),'[]'::jsonb),
  'leaderboard',coalesce((select jsonb_agg(to_jsonb(leaders)) from leaders),'[]'::jsonb)
);
$$;

revoke all on table public.social_profiles,public.social_friendships,public.social_weekly_stats from anon,authenticated;
revoke all on function public.save_social_profile(text,text,boolean,boolean),
  public.publish_social_week(integer,integer,numeric,boolean,text),public.request_friend(text),
  public.answer_friend_request(uuid,boolean),public.block_social_user(uuid),public.social_hub() from public,anon;
grant execute on function public.save_social_profile(text,text,boolean,boolean),
  public.publish_social_week(integer,integer,numeric,boolean,text),public.request_friend(text),
  public.answer_friend_request(uuid,boolean),public.block_social_user(uuid),public.social_hub() to authenticated;
notify pgrst, 'reload schema';
