-- Adds the host-city column used by the schedule and bracket views.
-- Run once against the live database (Supabase SQL editor or psql).
-- Safe to re-run.

alter table public.matches
  add column if not exists venue text;

-- Table-level `grant select ... to authenticated` already covers this column,
-- and the sync job writes via the service role, so no extra grants are needed.
