-- Migration production exécutée le 15 novembre 2026 : conserver comme documentation versionnée.
revoke all privileges on table public.projects,public.problematics,public.plans,public.sources,public.blocks,public.system_prompts from anon,authenticated;
drop policy if exists open_all on public.projects;
drop policy if exists open_all on public.problematics;
drop policy if exists open_all on public.plans;
drop policy if exists open_all on public.sources;
drop policy if exists open_all on public.blocks;
drop policy if exists open_all on public.system_prompts;
