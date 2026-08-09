-- Optional replies to training invitations and a one-shot marker for the push
-- sent back to the inviter. Apply after patch-012-social-groups-challenges-pr.sql.

alter table public.training_invites
  add column if not exists response_note text check (char_length(response_note)<=140),
  add column if not exists response_push_sent_at timestamptz;

drop function if exists public.answer_training_invite(uuid,boolean);
create function public.answer_training_invite(invite_id uuid,accept_invite boolean,response_message text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  update public.training_invites set
    status=case when accept_invite then 'accepted' else 'declined' end,
    response_note=nullif(left(trim(response_message),140),''),answered_at=now(),response_push_sent_at=null
  where id=invite_id and recipient=auth.uid() and status='pending';
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
end; $$;

-- Rebuild the hub so the sender can still read the answer if push is disabled.
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
  select i.id,i.training_at,i.note,i.status,i.response_note,i.created_at,p.user_id,p.handle,p.display_name
  from public.training_invites i join public.social_profiles p on p.user_id=i.sender
  where i.recipient=auth.uid() and i.status='pending' and i.training_at>now()-interval '2 hours' order by i.training_at
), outgoing as (
  select i.id,i.training_at,i.note,i.status,i.response_note,i.answered_at,p.user_id,p.handle,p.display_name
  from public.training_invites i join public.social_profiles p on p.user_id=i.recipient where i.sender=auth.uid()
    and i.training_at>now()-interval '2 hours' order by i.training_at
)
select jsonb_build_object('me',coalesce((select to_jsonb(me) from me),'null'::jsonb),
 'friends',coalesce((select jsonb_agg(to_jsonb(friends) order by display_name) from friends),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(requests) order by display_name) from requests),'[]'::jsonb),
 'leaderboard',coalesce((select jsonb_agg(to_jsonb(leaders)) from leaders),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(to_jsonb(incoming)) from incoming),'[]'::jsonb),
 'sent_invites',coalesce((select jsonb_agg(to_jsonb(outgoing)) from outgoing),'[]'::jsonb));
$$;

revoke all on function public.answer_training_invite(uuid,boolean,text) from public,anon;
grant execute on function public.answer_training_invite(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
