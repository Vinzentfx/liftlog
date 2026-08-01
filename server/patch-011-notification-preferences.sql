-- Notification master switch and daily creatine reminders.
-- Apply after patch-010-social-plans-invites.sql.

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  all_enabled boolean not null default true,
  creatine_enabled boolean not null default false,
  creatine_time time not null default '19:00',
  timezone_name text not null default 'Europe/Berlin' check(char_length(timezone_name)<=64),
  snoozed_until timestamptz,
  last_taken_day date,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

create or replace function public.save_notification_preferences(
  p_notifications_enabled boolean,p_creatine_enabled boolean,p_reminder_time time,p_timezone_name text
) returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if p_timezone_name is null or char_length(p_timezone_name)>64
    or not exists(select 1 from pg_timezone_names where name=p_timezone_name)
    then raise exception 'TIMEZONE_INVALID'; end if;
  insert into public.notification_preferences(user_id,all_enabled,creatine_enabled,creatine_time,timezone_name)
  values(auth.uid(),p_notifications_enabled,p_creatine_enabled,p_reminder_time,p_timezone_name)
  on conflict(user_id) do update set all_enabled=excluded.all_enabled,
    creatine_enabled=excluded.creatine_enabled,creatine_time=excluded.creatine_time,
    timezone_name=excluded.timezone_name,updated_at=now(),
    snoozed_until=case when excluded.creatine_enabled then notification_preferences.snoozed_until else null end;
end; $$;

create or replace function public.answer_creatine_reminder(reminder_action text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if reminder_action='taken' then
    update public.notification_preferences set
      last_taken_day=(now() at time zone timezone_name)::date,snoozed_until=null,updated_at=now()
    where user_id=auth.uid();
  elsif reminder_action='snooze' then
    update public.notification_preferences set snoozed_until=now()+interval '1 hour',updated_at=now()
    where user_id=auth.uid() and all_enabled and creatine_enabled;
  else raise exception 'REMINDER_ACTION_INVALID';
  end if;
  if not found then raise exception 'REMINDER_NOT_ENABLED'; end if;
end; $$;

revoke all on table public.notification_preferences from anon,authenticated;
revoke all on function public.save_notification_preferences(boolean,boolean,time,text),
  public.answer_creatine_reminder(text) from public,anon;
grant execute on function public.save_notification_preferences(boolean,boolean,time,text),
  public.answer_creatine_reminder(text) to authenticated;
notify pgrst,'reload schema';
