-- Real confirmed lineups from API-Football, cached on the matches row.
-- af_fixture_id     : API-Football's fixture id (our ids come from football-data).
-- lineups           : { home: {teamName, formation, startXI:[{name,pos,grid,number}]},
--                       away: {...} } once the official sheet is published.
-- lineup_checked_at : last time we polled API-Football for this match (throttle).
alter table matches add column if not exists af_fixture_id bigint;
alter table matches add column if not exists lineups jsonb;
alter table matches add column if not exists lineup_checked_at timestamptz;
-- lineup_attempts: number of times we polled; capped so a never-posted match
-- can't drain the daily quota.
alter table matches add column if not exists lineup_attempts int not null default 0;
