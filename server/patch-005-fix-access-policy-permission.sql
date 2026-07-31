-- Patch 005: RLS policies execute has_active_access() as the authenticated role.
-- That role therefore needs EXECUTE permission on the boolean helper. The
-- helper exposes no account data and always evaluates auth.uid().

grant execute on function public.has_active_access() to authenticated;
notify pgrst, 'reload schema';
