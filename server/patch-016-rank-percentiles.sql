-- Wo ein Rang in der Verteilung aller liegt, die dasselbe eintragen.
--
-- Die Stärkeränge der App vergleichen ein geschätztes 1RM mit veröffentlichten Tabellen. Diese
-- Tabellen sind ein Konsens aus den Daten anderer Leute. Das hier ist die einzige Zahl in der
-- App, die wirklich die Leute misst, die sie benutzen. Es ist auch die Zahl, die man von einem
-- Rangsystem will und die ein gedruckter Standard nicht liefern kann: nicht "du bist Diamond
-- II", sondern "von allen, die das eintragen, liegen 62 % unter dir".
--
-- Was hier absichtlich nicht steht:
--
--   * Keine Rangliste, keine Reihenfolge, keine Identität. Die RPC gibt eine Anzahl, vier
--     Perzentile und einen Anteil darunter zurück. Es gibt keinen Aufruf, der eine Zeile, eine
--     Nutzer-ID oder einen Namen liefert, und die rohe Tabelle ist für die Rolle der App unerreichbar.
--   * Keine Gewichte und keine Wiederholungen. Eine Wertung ist schon nach Körpergewicht,
--     Geschlecht und Alter normiert und sagt damit viel weniger über eine Person als "142,5 kg".
--   * Keine Spalte fürs Geschlecht. Noch einmal zu teilen würde jede Stichprobe umsonst
--     halbieren: die verglichene Wertung ist schon nach Geschlecht normiert, bevor sie das
--     Gerät verlässt. Eine Eigenschaft zu speichern, die die Abfrage nicht benutzt, heißt, sie
--     ohne Grund zu speichern.
--   * Gar nichts, bis zehn andere Leute dieselbe Größe beigesteuert haben. Darunter ist ein
--     Perzentil eine Beschreibung einzelner Menschen.
--
-- Wer beisteuert, bekommt die Antwort, wie in Patch 013: es gibt keinen Weg nur zum Lesen,
-- niemand wird also an einer Gruppe gemessen, der er nicht beitreten wollte.

create table if not exists public.rank_observations (
  user_id uuid not null references auth.users on delete cascade,
  -- 'overall', 'lift:Barbell Bench Press' oder 'region:chest'. Eine Tabelle für alle drei, weil
  -- es dieselbe Frage auf drei Zoomstufen ist, und drei Tabellen hießen drei von jeder Policy unten.
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
 * Schreibt die Wertungen dieses Geräts und gibt die Verteilung drumherum zurück.
 *
 * `p_scores` ist [{"key":"overall","score":41.2}, ...]. Ein Aufruf statt einem pro
 * Wert: eine Körperkarte hat fünfzehn Regionen, und die Schleife aus Patch 013 würde
 * aus einem Bildschirmaufbau fünfzehn Anfragen machen.
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
    -- Eine Anfrage, die einen Schlüssel wiederholt, würde sonst die Aggregation zweimal für
    -- dieselbe Antwort laufen lassen.
    if not (k = any(keys)) then keys := keys || k; end if;
  end loop;

  -- Alle anderen, und nur so lange ihre Zahl frisch genug ist, um sie zu beschreiben. Ein
  -- Perzentil mit der eigenen Zeile darin bewegt sich, wenn man als Einziger trainiert hat.
  foreach k in array keys loop
    -- Einmal gelesen statt pro Zeile: eine korrelierte Unterabfrage in der Aggregation würde für
    -- jede gezählte Beobachtung neu laufen.
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
        -- Ganze Prozent. Eine Verteilung aus ein paar Dutzend Leuten gibt keine Nachkommastelle
        -- her, und eine zu drucken würde eine Genauigkeit behaupten, die es nicht gibt.
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

-- Und von anon mit Namen. Die Standardrechte von Supabase geben EXECUTE für jede neu angelegte
-- Funktion direkt an anon, und ein Entzug von PUBLIC berührt kein Recht, das einer Rolle gegeben
-- wurde: ohne diese zwei Zeilen sind beide Funktionen von einer Anfrage ohne Anmeldung
-- erreichbar. Sie lehnen das in ihrer ersten Zeile ab, das hier ändert also kein Verhalten, aber
-- ein Schutz drinnen ist kein Grund, die Tür erreichbar zu lassen. Gegen die echte Datenbank
-- geprüft, dort haben die zwei Funktionen aus Patch 013 noch dieselbe Lücke.
revoke execute on function public.share_rank_scores(jsonb) from anon;
revoke execute on function public.forget_rank_scores() from anon;

grant execute on function public.share_rank_scores(jsonb) to authenticated;
grant execute on function public.forget_rank_scores() to authenticated;
