-- Where a rank sits in the distribution of everyone who logs the same thing.
--
-- The app's strength ranks compare an estimated 1RM against published tables.
-- Those tables are a consensus assembled from other people's data; this is the
-- only number in the app that actually measures the population using it. It is
-- also the number people want from a rank system and the one a printed standard
-- cannot give: not "you are Diamond II" but "of the people who log this, 62%
-- are below you".
--
-- What is deliberately NOT here:
--
--   * No leaderboard, no ordering, no identity. The RPC returns a count, four
--     percentiles and one share-below. There is no call that returns a row, a
--     user id, or a name, and the raw table is unreachable from the app role.
--   * No weights and no repetitions. A score is already normalised for
--     bodyweight, sex and age, which means it carries far less about a person
--     than "142.5 kg" does.
--   * No sex column. Splitting again would halve every sample for nothing:
--     the score being compared is sex-normalised before it ever leaves the
--     device. Storing an attribute the query does not use is storing it for
--     no reason.
--   * Nothing at all until ten other people have contributed the same metric.
--     Below that a percentile is a description of individuals.
--
-- Contributing is what buys the answer, as in patch 013: there is no read-only
-- path, so nobody is measured by a population they declined to join.

create table if not exists public.rank_observations (
  user_id uuid not null references auth.users on delete cascade,
  -- 'overall', 'lift:Barbell Bench Press', or 'region:chest'. One table for all
  -- three because they are the same question asked at three zoom levels, and
  -- three tables would mean three of every policy below.
  metric_key text not null check(
    metric_key = 'overall'
    or metric_key ~ '^(lift|region):[^\n\r]{1,70}$'
  ),
  score numeric not null check(score >= 0 and score <= 100),
  updated_at timestamptz not null default now(),
  primary key(user_id, metric_key)
);

create index if not exists rank_observations_metric_idx
  on public.rank_observations(metric_key, updated_at);

alter table public.rank_observations enable row level security;
revoke all on table public.rank_observations from anon,authenticated;

/**
 * Upsert this device's scores and return the distribution around them.
 *
 * `p_scores` is [{"key":"overall","score":41.2}, ...]. One call rather than one
 * per metric: a body map has fifteen regions and patch 013's loop would make
 * fifteen round trips out of one screen render.
 */
create or replace function public.share_rank_scores(p_scores jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb := '{}'::jsonb;
  item jsonb;
  keys text[] := '{}';
  k text;
  s numeric;
  own numeric;
  stats record;
begin
  if auth.uid() is null or not public.has_active_access() then raise exception 'ACCESS_REVOKED'; end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) > 40 then
    raise exception 'RANK_SCORES_INVALID';
  end if;

  for item in select * from jsonb_array_elements(p_scores) loop
    k := trim(item->>'key');
    s := (item->>'score')::numeric;
    if k is null or s is null or s < 0 or s > 100 then raise exception 'RANK_SCORES_INVALID'; end if;
    if k <> 'overall' and k !~ '^(lift|region):[^\n\r]{1,70}$' then raise exception 'RANK_SCORES_INVALID'; end if;

    insert into public.rank_observations(user_id, metric_key, score)
    values(auth.uid(), k, s)
    on conflict(user_id, metric_key) do update set score = excluded.score, updated_at = now();
    -- A payload that repeats a key would otherwise run the aggregate twice for
    -- the same answer.
    if not (k = any(keys)) then keys := keys || k; end if;
  end loop;

  -- Everyone *else*, and only while their number is recent enough to describe
  -- them. A percentile against your own row included is a percentile that moves
  -- when you are the only one who trained.
  foreach k in array keys loop
    -- Read once rather than per row: a correlated subquery inside the aggregate
    -- would re-run it for every observation being counted.
    select score into own from public.rank_observations
     where user_id = auth.uid() and metric_key = k;

    select
      count(*) as n,
      avg(case when o.score < own then 1.0 else 0.0 end) as below,
      percentile_cont(0.20) within group(order by o.score) as q20,
      percentile_cont(0.40) within group(order by o.score) as q40,
      percentile_cont(0.60) within group(order by o.score) as q60,
      percentile_cont(0.80) within group(order by o.score) as q80
      into stats
      from public.rank_observations o
     where o.metric_key = k
       and o.user_id <> auth.uid()
       and o.updated_at > now() - interval '12 months';

    if stats.n >= 10 then
      result := result || jsonb_build_object(k, jsonb_build_object(
        'count', stats.n,
        -- Whole percent. A distribution of a few dozen people does not support
        -- a decimal, and printing one would imply a precision that is not there.
        'below', round(stats.below * 100),
        'q20', stats.q20, 'q40', stats.q40, 'q60', stats.q60, 'q80', stats.q80
      ));
    end if;
  end loop;

  return result;
end; $$;

/** Withdraw every contribution. The comparison stops in the same breath. */
create or replace function public.forget_rank_scores()
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'AUTH'; end if;
  delete from public.rank_observations where user_id = auth.uid();
end; $$;

revoke all on function public.share_rank_scores(jsonb) from public;
revoke all on function public.forget_rank_scores() from public;

-- And from anon by name. Supabase's default privileges grant EXECUTE on every
-- newly created function directly to anon, and a revoke from PUBLIC does not
-- touch a grant made to a role: without these two lines both functions are
-- reachable from an unauthenticated request. They refuse it on their first
-- line, so this changes no behaviour, but a guard inside is not a reason to
-- leave the door reachable. Verified against the live database, where patch
-- 013's two functions still show the same gap.
revoke execute on function public.share_rank_scores(jsonb) from anon;
revoke execute on function public.forget_rank_scores() from anon;

grant execute on function public.share_rank_scores(jsonb) to authenticated;
grant execute on function public.forget_rank_scores() to authenticated;
