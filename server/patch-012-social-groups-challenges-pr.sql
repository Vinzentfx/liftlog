-- Private Gruppen, Gruppen-Challenges, Reaktionen auf Rekorde und Sichtbarkeit je Wert.
-- Nach patch-010-social-plans-invites.sql einspielen.

alter table public.social_profiles add column if not exists show_workouts boolean not null default true;
alter table public.social_profiles add column if not exists show_sets boolean not null default true;
alter table public.social_profiles add column if not exists show_strength boolean not null default true;
alter table public.social_profiles add column if not exists show_presence boolean not null default true;
alter table public.social_profiles add column if not exists show_plan boolean not null default true;
alter table public.social_profiles add column if not exists show_prs boolean not null default false;
alter table public.social_profiles alter column show_prs set default false;

create table if not exists public.social_groups (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade,
  name text not null check(char_length(name) between 1 and 40), created_at timestamptz not null default now()
);
create table if not exists public.social_group_members (
  group_id uuid not null references public.social_groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(), primary key(group_id,user_id)
);
create table if not exists public.social_challenges (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.social_groups on delete cascade,
  creator_id uuid not null references auth.users on delete cascade,
  title text not null check(char_length(title) between 1 and 60), metric text not null check(metric in ('workouts','sets')),
  target integer not null check(target between 1 and 10000), starts_on date not null default current_date,
  ends_on date not null check(ends_on>=starts_on and ends_on<=starts_on+90), created_at timestamptz not null default now()
);
create table if not exists public.social_challenge_progress (
  challenge_id uuid not null references public.social_challenges on delete cascade,
  user_id uuid not null references auth.users on delete cascade, value integer not null check(value between 0 and 10000),
  updated_at timestamptz not null default now(), primary key(challenge_id,user_id)
);
create table if not exists public.social_prs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  exercise_name text not null check(char_length(exercise_name) between 1 and 80),
  value numeric not null check(value>=0 and value<=100000), label text not null check(char_length(label)<=40),
  happened_at timestamptz not null default now()
);
create table if not exists public.social_pr_reactions (
  pr_id uuid not null references public.social_prs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  reaction text not null check(reaction in ('strong','fire','clap')), created_at timestamptz not null default now(),
  primary key(pr_id,user_id)
);
alter table public.social_groups enable row level security;
alter table public.social_group_members enable row level security;
alter table public.social_challenges enable row level security;
alter table public.social_challenge_progress enable row level security;
alter table public.social_prs enable row level security;
alter table public.social_pr_reactions enable row level security;

create or replace function public.save_social_visibility(
  p_workouts boolean,p_sets boolean,p_strength boolean,p_presence boolean,p_plan boolean,p_prs boolean
) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  update public.social_profiles set show_workouts=p_workouts,show_sets=p_sets,show_strength=p_strength,
    show_presence=p_presence,show_plan=p_plan,show_prs=p_prs,updated_at=now() where user_id=auth.uid();
  if not found then raise exception 'SOCIAL_PROFILE_REQUIRED'; end if;
end; $$;

create or replace function public.create_social_group(group_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare gid uuid;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if char_length(trim(group_name)) not between 1 and 40 then raise exception 'GROUP_NAME_INVALID'; end if;
  insert into public.social_groups(owner_id,name) values(auth.uid(),trim(group_name)) returning id into gid;
  insert into public.social_group_members(group_id,user_id) values(gid,auth.uid()); return gid;
end; $$;

create or replace function public.add_social_group_member(p_group uuid,p_friend uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not exists(select 1 from public.social_groups where id=p_group and owner_id=auth.uid()) then raise exception 'NOT_GROUP_OWNER'; end if;
  if not exists(select 1 from public.social_friendships where status='accepted' and
    ((requester=auth.uid() and addressee=p_friend) or (requester=p_friend and addressee=auth.uid()))) then raise exception 'NOT_FRIENDS'; end if;
  insert into public.social_group_members(group_id,user_id) values(p_group,p_friend) on conflict do nothing;
end; $$;

create or replace function public.leave_social_group(p_group uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if exists(select 1 from public.social_groups where id=p_group and owner_id=auth.uid()) then
    delete from public.social_groups where id=p_group;
  else delete from public.social_group_members where group_id=p_group and user_id=auth.uid(); end if;
end; $$;

create or replace function public.create_social_challenge(
  p_group uuid,p_title text,p_metric text,p_target integer,p_ends_on date
) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not exists(select 1 from public.social_group_members where group_id=p_group and user_id=auth.uid()) then raise exception 'NOT_GROUP_MEMBER'; end if;
  insert into public.social_challenges(group_id,creator_id,title,metric,target,ends_on)
  values(p_group,auth.uid(),trim(p_title),p_metric,p_target,p_ends_on) returning id into cid; return cid;
end; $$;

create or replace function public.update_challenge_progress(p_challenge uuid,p_value integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not exists(select 1 from public.social_challenges c join public.social_group_members m on m.group_id=c.group_id
    where c.id=p_challenge and m.user_id=auth.uid() and current_date between c.starts_on and c.ends_on) then raise exception 'CHALLENGE_NOT_AVAILABLE'; end if;
  insert into public.social_challenge_progress(challenge_id,user_id,value) values(p_challenge,auth.uid(),greatest(0,least(p_value,10000)))
  on conflict(challenge_id,user_id) do update set value=excluded.value,updated_at=now();
end; $$;

create or replace function public.publish_social_pr(p_exercise text,p_value numeric,p_label text)
returns uuid language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if not coalesce((select show_prs from public.social_profiles where user_id=auth.uid()),false) then return null; end if;
  if (select count(*) from public.social_prs where user_id=auth.uid() and happened_at>now()-interval '1 hour')>=10 then raise exception 'RATE_LIMITED'; end if;
  insert into public.social_prs(user_id,exercise_name,value,label) values(auth.uid(),left(trim(p_exercise),80),p_value,left(trim(p_label),40)) returning id into pid;
  return pid;
end; $$;

create or replace function public.react_social_pr(p_pr uuid,p_reaction text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if p_reaction not in ('strong','fire','clap') then raise exception 'REACTION_INVALID'; end if;
  if not exists(select 1 from public.social_prs p where p.id=p_pr and p.user_id<>auth.uid() and exists(
    select 1 from public.social_friendships f where f.status='accepted' and
    ((f.requester=auth.uid() and f.addressee=p.user_id) or (f.addressee=auth.uid() and f.requester=p.user_id))
    union select 1 from public.social_group_members a join public.social_group_members b on b.group_id=a.group_id
    where a.user_id=auth.uid() and b.user_id=p.user_id)) then raise exception 'PR_NOT_VISIBLE'; end if;
  insert into public.social_pr_reactions(pr_id,user_id,reaction) values(p_pr,auth.uid(),p_reaction)
  on conflict(pr_id,user_id) do update set reaction=excluded.reaction,created_at=now();
end; $$;

create or replace function public.social_extras()
returns jsonb language sql stable security definer set search_path=public as $$
with my_groups as (
  select g.id,g.name,g.owner_id,g.created_at,
    (select jsonb_agg(jsonb_build_object('user_id',p.user_id,'handle',p.handle,'display_name',p.display_name) order by p.display_name)
     from public.social_group_members gm join public.social_profiles p on p.user_id=gm.user_id where gm.group_id=g.id) members
  from public.social_groups g join public.social_group_members mine on mine.group_id=g.id and mine.user_id=auth.uid()
  where public.has_active_access()
), challenges as (
  select c.*,coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'display_name',p.display_name,'value',coalesce(cp.value,0))
    order by coalesce(cp.value,0) desc,p.display_name)
    from public.social_group_members gm join public.social_profiles p on p.user_id=gm.user_id
    left join public.social_challenge_progress cp on cp.challenge_id=c.id and cp.user_id=gm.user_id
    where gm.group_id=c.group_id),'[]'::jsonb) progress
  from public.social_challenges c join public.social_group_members m on m.group_id=c.group_id and m.user_id=auth.uid()
  where c.ends_on>=current_date-7
), visible_users as (
  select case when f.requester=auth.uid() then f.addressee else f.requester end uid from public.social_friendships f
    where f.status='accepted' and (f.requester=auth.uid() or f.addressee=auth.uid())
  union select b.user_id from public.social_group_members a join public.social_group_members b on b.group_id=a.group_id
    where a.user_id=auth.uid() and b.user_id<>auth.uid()
), prs as (
  select pr.id,pr.user_id,pr.exercise_name,pr.value,pr.label,pr.happened_at,p.display_name,p.handle,
    coalesce((select jsonb_object_agg(x.reaction,x.n) from (select reaction,count(*) n from public.social_pr_reactions r where r.pr_id=pr.id group by reaction)x),'{}'::jsonb) reactions
  from public.social_prs pr join visible_users v on v.uid=pr.user_id join public.social_profiles p on p.user_id=pr.user_id
  where p.show_prs=true and pr.happened_at>now()-interval '30 days' order by pr.happened_at desc limit 50
)
select jsonb_build_object(
  'visibility',coalesce((select jsonb_build_object('workouts',show_workouts,'sets',show_sets,'strength',show_strength,'presence',show_presence,'plan',show_plan,'prs',show_prs) from public.social_profiles where user_id=auth.uid()),'{}'::jsonb),
  'groups',coalesce((select jsonb_agg(to_jsonb(my_groups)) from my_groups),'[]'::jsonb),
  'challenges',coalesce((select jsonb_agg(to_jsonb(challenges)) from challenges),'[]'::jsonb),
  'prs',coalesce((select jsonb_agg(to_jsonb(prs)) from prs),'[]'::jsonb));
$$;

-- Den vorhandenen Bereich mit Filterung der Felder auf dem Server neu bauen. Nur im Client
-- zu verstecken würde die Werte über die Antwort der RPC trotzdem verraten.
create or replace function public.social_hub()
returns jsonb language sql stable security definer set search_path=public as $$
with me as (
  select p.*,
    coalesce(s.training_today and s.updated_at::date=current_date,false) training_today,
    case when s.updated_at::date=current_date then s.status_text end status_text,
    case when s.updated_at::date=current_date then s.planned_workout end planned_workout
  from public.social_profiles p left join public.social_weekly_stats s on s.user_id=p.user_id
    and s.week_start=date_trunc('week',current_date)::date where p.user_id=auth.uid()
), accepted as (
  select case when requester=auth.uid() then addressee else requester end friend_id from public.social_friendships
  where public.has_active_access() and status='accepted' and (requester=auth.uid() or addressee=auth.uid())
), friends as (
  select p.user_id,p.handle,p.display_name,
    case when p.show_presence then coalesce(s.training_today and s.updated_at::date=current_date,false) else false end training_today,
    case when p.show_presence and s.updated_at::date=current_date then s.status_text end status_text,
    case when p.show_plan and s.updated_at::date=current_date then s.planned_workout end planned_workout,
    case when p.show_workouts then s.workouts end workouts,case when p.show_sets then s.working_sets end working_sets,
    case when p.show_strength then s.strength_score end strength_score
  from accepted a join public.social_profiles p on p.user_id=a.friend_id left join public.social_weekly_stats s
    on s.user_id=p.user_id and s.week_start=date_trunc('week',current_date)::date
), requests as (
  select f.id,p.user_id,p.handle,p.display_name from public.social_friendships f join public.social_profiles p on p.user_id=f.requester
  where public.has_active_access() and f.addressee=auth.uid() and f.status='pending'
), leaders as (
  select p.user_id,p.handle,p.display_name,
    case when p.show_workouts then s.workouts end workouts,case when p.show_sets then s.working_sets end working_sets,
    case when p.show_strength then s.strength_score end strength_score
  from public.social_profiles p join public.social_weekly_stats s on s.user_id=p.user_id
  where public.has_active_access() and p.leaderboard_opt_in=true and s.week_start=date_trunc('week',current_date)::date limit 100
), incoming as (
  select i.id,i.training_at,i.note,i.status,i.created_at,p.user_id,p.handle,p.display_name from public.training_invites i
  join public.social_profiles p on p.user_id=i.sender where i.recipient=auth.uid() and i.status='pending'
    and i.training_at>now()-interval '2 hours' order by i.training_at
), outgoing as (
  select i.id,i.training_at,i.note,i.status,p.user_id,p.handle,p.display_name from public.training_invites i
  join public.social_profiles p on p.user_id=i.recipient where i.sender=auth.uid()
    and i.training_at>now()-interval '2 hours' order by i.training_at
)
select jsonb_build_object('me',coalesce((select to_jsonb(me) from me),'null'::jsonb),
 'friends',coalesce((select jsonb_agg(to_jsonb(friends) order by display_name) from friends),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(requests) order by display_name) from requests),'[]'::jsonb),
 'leaderboard',coalesce((select jsonb_agg(to_jsonb(leaders)) from leaders),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(to_jsonb(incoming)) from incoming),'[]'::jsonb),
 'sent_invites',coalesce((select jsonb_agg(to_jsonb(outgoing)) from outgoing),'[]'::jsonb));
$$;

revoke all on table public.social_groups,public.social_group_members,public.social_challenges,
  public.social_challenge_progress,public.social_prs,public.social_pr_reactions from anon,authenticated;
revoke all on function public.save_social_visibility(boolean,boolean,boolean,boolean,boolean,boolean),
  public.create_social_group(text),public.add_social_group_member(uuid,uuid),public.leave_social_group(uuid),
  public.create_social_challenge(uuid,text,text,integer,date),public.update_challenge_progress(uuid,integer),
  public.publish_social_pr(text,numeric,text),public.react_social_pr(uuid,text),public.social_extras() from public,anon;
grant execute on function public.save_social_visibility(boolean,boolean,boolean,boolean,boolean,boolean),
  public.create_social_group(text),public.add_social_group_member(uuid,uuid),public.leave_social_group(uuid),
  public.create_social_challenge(uuid,text,text,integer,date),public.update_challenge_progress(uuid,integer),
  public.publish_social_pr(text,numeric,text),public.react_social_pr(uuid,text),public.social_extras() to authenticated;
notify pgrst,'reload schema';
