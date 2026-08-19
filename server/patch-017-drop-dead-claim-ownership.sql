-- Patch 017: retire the pre-014 claim_ownership and pin two search_paths.
--
-- Patch 014 replaced claim_ownership with a three-argument form that rate
-- limits, checks an owner token and clears the wrapped keys off revoked
-- devices. It created the new signature but never dropped the old one, so both
-- lived side by side. The old one reads profiles.recovery_verifier, a column
-- that patch 003 moved into recovery_proofs, so every call to it raises at
-- runtime rather than doing anything. What was left is a dead SECURITY DEFINER
-- endpoint on the REST surface with none of 014's hardening on it.
--
-- Nothing calls it: js/cloud.js has passed owner_token since 014.
drop function if exists public.claim_ownership(text, uuid);

-- Both of these resolved unqualified names against whatever search_path the
-- caller happened to have. Neither actually needs one, because both reference
-- every object with its schema spelled out, so the empty setting is the strict
-- reading rather than a compromise. trim_backup_history runs as a trigger on
-- every backup write, which is the reason it is worth pinning at all.
alter function public.trim_backup_history() set search_path = '';
alter function public.invite_failure_budget() set search_path = '';
