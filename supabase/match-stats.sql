-- Match statistics from API-Football, cached on the matches row once the
-- match is FINISHED. Reuses af_fixture_id from lineups.sql -- that id can
-- only be discovered while a match is live (free tier), so stats are
-- fetched exactly once after full-time using the id captured earlier (see
-- src/lib/statsSync.ts).
-- match_stats             : { home: {shotsOnGoal, shotsOffGoal, totalShots,
--                             blockedShots, shotsInsideBox, shotsOutsideBox,
--                             fouls, cornerKicks, offsides, possession,
--                             yellowCards, redCards, goalkeeperSaves},
--                             away: {...} } once fetched; never refetched.
-- match_stats_checked_at  : last time we attempted the fetch (throttle).
-- match_stats_attempts    : capped so a fixture that never returns stats
--                           can't drain the daily quota.
alter table matches add column if not exists match_stats jsonb;
alter table matches add column if not exists match_stats_checked_at timestamptz;
alter table matches add column if not exists match_stats_attempts int not null default 0;
