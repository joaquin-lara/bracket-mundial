# Lineup data (research)

`lineups.json` — starting XIs (player name + nickname) for 314 men's senior
international matches across 6 tournaments (World Cup 2018/2022, Euro 2020/2024,
Copa América 2024, AFCON 2023). Produced by `npm run fetch:lineups`.

**Provenance:** derived from [StatsBomb open data](https://github.com/statsbomb/open-data)
(free for research/education under StatsBomb's user agreement; attribution
required, no bulk redistribution). We keep only the starting-XI subset needed for
the lineup-vs-Dixon-Coles backtest (`scripts/lineup-strength.ts` +
`scripts/backtest.ts`). The raw StatsBomb JSON cache lives under gitignored
`data/sb-cache/` and is re-fetchable.

**Why not fbref:** fbref is the richer source but is Cloudflare-blocked from the
web sandbox (the egress gateway's TLS fingerprint trips an unsolvable Turnstile —
see `ML_NEXT_STEPS.md`). StatsBomb is the reachable alternative; it covers major
tournaments only (no qualifiers / Gold Cup / Nations League / 2025-26 tail).
