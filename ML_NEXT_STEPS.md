# ML predictor — handoff notes

Working branch: `claude/ml-model-predictor-review-y1xufc`.

## What exists now

A walk-forward backtest harness (`scripts/backtest.ts`, run `npm run backtest`)
that scores models one step ahead (predict-before-update, so no leakage), with a
clean **constants / validation / test** split and proper scoring (RPS, log-loss,
Brier, calibration).

Measured out-of-sample on competitive matches (test 2015+):

| model | RPS | log-loss |
|---|---|---|
| base rate | 0.2323 | 1.0522 |
| Elo + independent Poisson (the shipped model) | 0.1672 | 0.8557 |
| **Dixon-Coles online (attack/defense)** | **0.1654** | **0.8454** |
| Dixon-Coles + recalibration | 0.1654 | 0.8453 |

Squad-value test (same 2,636 matches both teams have a FIFA pool for):

| model | RPS | log-loss |
|---|---|---|
| Dixon-Coles only | 0.1875 | 0.9536 |
| Squad strength only | 0.1926 | 0.9716 |
| **Ensemble (DC + squad, 50/50)** | **0.1861** | **0.9504** |

Findings: Dixon-Coles beats the shipped Elo model; squad strength is weaker alone
but **complementary** (ensemble beats DC alone); DC is already well-calibrated so
temperature recalibration is ~a no-op (T=0.995).

These are research scripts only — **nothing is wired into the live predictor page yet.**

## Data (gitignored under `/data/`, must be re-fetched per session)

```bash
# results dataset
npm run build:elo            # downloads data/results.csv

# FIFA talent-pool ratings (FIFA 15-22), auto-loaded by scripts/squad-strength.ts
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
base="https://raw.githubusercontent.com/eddwebster/football_analytics/master/data/fifa/raw"
mkdir -p data/fifa
for yy in 15 16 17 18 19 20 21 22; do
  curl -sSL -A "$UA" "$base/male_players_$yy.csv" -o "data/fifa/male_players_$yy.csv"
done
```

## Next session — to do (web access is now open: Transfermarkt + general web)

This session was on the GitHub-only network policy, so I was capped at FIFA 22
(2021) — stale for a 2026 World Cup. The new session has the **Custom** policy
(Transfermarkt + default domains), so:

1. **Get newer squad snapshots (highest value).** Add FIFA 23 / EA FC 24 / FC 25
   (2022-2024). Drop `male_players_23.csv` / `_24.csv` / `_25.csv` into
   `data/fifa/` — `scripts/squad-strength.ts` already lists editions 15-25 and
   auto-loads whatever is present (the FIFA->EA FC rename keeps the sofifa schema:
   needs `overall` + `nationality_name` columns). Sources: sofifa.com is now
   reachable; the Stefano Leone Kaggle "EA Sports FC 24/25 complete player dataset"
   is the same lineage. **If a source needs auth (Kaggle), ask the user for a
   Kaggle API token or a direct CSV link.** Then re-run `npm run backtest`.
2. **Transfermarkt squad values** for the 2026 squads (now reachable) as an
   alternative/added strength signal. Note TM has bot protection — use a browser
   User-Agent and be gentle.
3. **Tune the ensemble weight** (currently fixed 50/50) on the validation window,
   not the test window.
4. **Wire the winner into the live predictor** (`src/lib/ml/`): export per-team
   Dixon-Coles attack/defense + squad strength into a shipped JSON, blend +
   recalibrate in `model.ts`, surface it on `src/app/predictor/page.tsx`.
5. **Live lineups (#2)** for upcoming fixtures: build against a free lineup API
   to run in **production** (Vercel egress is open; this sandbox can't test the
   live call). Needs a free API key as a Vercel env var. Add the UI note: squad
   strength is built in, and confirmed lineups feed in near kickoff to sharpen a
   match's odds.

## User actions that may be needed next session
- A **free Kaggle API token** (or a direct GitHub/CSV link) if FC 24/25 data
  isn't reachable without auth.
- Later, a **free lineup-API key** added as a Vercel env var for the live-lineup
  feature (production only).
