-- Patch 005: RLS-Policies führen has_active_access() als Rolle authenticated aus. Diese
-- Rolle braucht also das Recht EXECUTE auf die boolesche Hilfsfunktion. Die Funktion gibt
-- keine Kontodaten preis und wertet immer auth.uid() aus.

grant execute on function public.has_active_access() to authenticated;
notify pgrst, 'reload schema';
