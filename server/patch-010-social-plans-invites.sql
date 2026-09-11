-- Geplante Trainings sichtbar, mehrere Ansichten der Rangliste und private
-- Trainingseinladungen. Nach patch-008-social-hub.sql einspielen.

alter table public.social_weekly_stats add column if not exists planned_workout text
  check (char_length(planned_workout)<=160);

create table if not exists public.training_invites (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users on delete cascade,
  recipient uuid not null references auth.users on delete cascade,
  training_at timestamptz not null,
  note text check (char_length(note)<=140),
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check(sender<>recipient)
);
create index if not exists training_invites_recipient on public.training_invites(recipient,status,training_at);
alter table public.training_invites enable row level security;

create table if not exists public.push_subscriptions (
  endpoint text primary key check(char_length(endpoint)<=2000),
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null check(char_length(p256dh)<=256),
  auth text not null check(char_length(auth)<=128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;

create or replace function public.publish_social_presence(
  workout_count integer,working_set_count integer,strength_value numeric,
  trains_today boolean,status_text text,planned_workout text
) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not exists(select 1 from public.social_profiles where user_id=auth.uid()) then raise exception 'SOCIAL_PROFILE_REQUIRED'; end if;
  insert into public.social_weekly_stats(user_id,week_start,workouts,working_sets,strength_score,
    training_today,status_text,planned_workout)
  values(auth.uid(),date_trunc('week',current_date)::date,
    greatest(0,least(workout_count,50)),greatest(0,least(working_set_count,1000)),
    case when strength_value between 0 and 100 then strength_value else null end,
    trains_today,nullif(left(trim(status_text),100),''),nullif(left(trim(planned_workout),160),''))
  on conflict(user_id,week_start) do update set workouts=excluded.workouts,
    working_sets=excluded.working_sets,strength_score=excluded.strength_score,
    training_today=excluded.training_today,status_text=excluded.status_text,
    planned_workout=excluded.planned_workout,updated_at=now();
end; $$;

create or replace function public.send_training_invite(friend_id uuid,training_at timestamptz,invite_note text)
returns uuid language plpgsql security definer set search_path=public as $$
declare created_id uuid;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if training_at<now()-interval '5 minutes' or training_at>now()+interval '30 days' then raise exception 'INVITE_TIME_INVALID'; end if;
  if (select count(*) from public.training_invites where sender=auth.uid()
      and created_at>now()-interval '1 hour')>=10 then raise exception 'RATE_LIMITED'; end if;
  if not exists(select 1 from public.social_friendships where status='accepted' and
    ((requester=auth.uid() and addressee=friend_id) or (requester=friend_id and addressee=auth.uid())))
    then raise exception 'NOT_FRIENDS'; end if;
  if exists(select 1 from public.social_friendships where status='blocked' and
    ((requester=auth.uid() and addressee=friend_id) or (requester=friend_id and addressee=auth.uid())))
    then raise exception 'NOT_FRIENDS'; end if;
  insert into public.training_invites(sender,recipient,training_at,note)
    values(auth.uid(),friend_id,training_at,nullif(left(trim(invite_note),140),'')) returning id into created_id;
  return created_id;
end; $$;

create or replace function public.answer_training_invite(invite_id uuid,accept_invite boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  update public.training_invites set status=case when accept_invite then 'accepted' else 'declined' end,
    answered_at=now() where id=invite_id and recipient=auth.uid() and status='pending';
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
end; $$;

create or replace function public.save_push_subscription(push_endpoint text,push_p256dh text,push_auth text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if char_length(push_endpoint)>2000 or char_length(push_p256dh)>256 or char_length(push_auth)>128
    then raise exception 'PUSH_INVALID'; end if;
  insert into public.push_subscriptions(endpoint,user_id,p256dh,auth)
    values(push_endpoint,auth.uid(),push_p256dh,push_auth)
  on conflict(endpoint) do update set user_id=auth.uid(),p256dh=excluded.p256dh,
    auth=excluded.auth,updated_at=now();
end; $$;

create or replace function public.remove_push_subscription(push_endpoint text)
returns void language sql security definer set search_path=public as $$
  delete from public.push_subscriptions ps where ps.endpoint=$1 and ps.user_id=auth.uid();
$$;

create or replace function public.social_hub()
returns jsonb language sql stable security definer set search_path=public as $$
with me as (
  select p.user_id,p.handle,p.display_name,p.discoverable,p.leaderboard_opt_in,
    coalesce(s.training_today and s.updated_at::date=current_date,false) training_today,
    case when s.updated_at::date=current_date then s.status_text end status_text,
    case when s.updated_at::date=current_date then s.planned_workout end planned_workout
  from public.social_profiles p left join public.social_weekly_stats s
    on s.user_id=p.user_id and s.week_start=date_trunc('week',current_date)::date
  where p.user_id=auth.uid()
), accepted as (
  select case when f.requester=auth.uid() then f.addressee else f.requester end friend_id
  from public.social_friendships f where public.has_active_access() and f.status='accepted'
    and (f.requester=auth.uid() or f.addressee=auth.uid())
), friends as (
  select p.user_id,p.handle,p.display_name,
    coalesce(s.training_today and s.updated_at::date=current_date,false) training_today,
    case when s.updated_at::date=current_date then s.status_text end status_text,
    case when s.updated_at::date=current_date then s.planned_workout end planned_workout,
    s.workouts,s.working_sets,s.strength_score
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
    and s.week_start=date_trunc('week',current_date)::date limit 100
), incoming as (
  select i.id,i.training_at,i.note,i.status,i.created_at,p.user_id,p.handle,p.display_name
  from public.training_invites i join public.social_profiles p on p.user_id=i.sender
  where i.recipient=auth.uid() and i.status='pending' and i.training_at>now()-interval '2 hours'
  order by i.training_at
), outgoing as (
  select i.id,i.training_at,i.note,i.status,p.user_id,p.handle,p.display_name
  from public.training_invites i join public.social_profiles p on p.user_id=i.recipient
  where i.sender=auth.uid() and i.training_at>now()-interval '2 hours'
  order by i.training_at
)
select jsonb_build_object(
  'me',coalesce((select to_jsonb(me) from me),'null'::jsonb),
  'friends',coalesce((select jsonb_agg(to_jsonb(friends) order by display_name) from friends),'[]'::jsonb),
  'requests',coalesce((select jsonb_agg(to_jsonb(requests) order by display_name) from requests),'[]'::jsonb),
  'leaderboard',coalesce((select jsonb_agg(to_jsonb(leaders)) from leaders),'[]'::jsonb),
  'invites',coalesce((select jsonb_agg(to_jsonb(incoming)) from incoming),'[]'::jsonb),
  'sent_invites',coalesce((select jsonb_agg(to_jsonb(outgoing)) from outgoing),'[]'::jsonb)
); $$;

revoke all on table public.training_invites,public.push_subscriptions from anon,authenticated;
revoke all on function public.publish_social_presence(integer,integer,numeric,boolean,text,text),
  public.send_training_invite(uuid,timestamptz,text),public.answer_training_invite(uuid,boolean),
  public.save_push_subscription(text,text,text),public.remove_push_subscription(text) from public,anon;
grant execute on function public.publish_social_presence(integer,integer,numeric,boolean,text,text),
  public.send_training_invite(uuid,timestamptz,text),public.answer_training_invite(uuid,boolean),
  public.save_push_subscription(text,text,text),public.remove_push_subscription(text) to authenticated;
notify pgrst,'reload schema';
