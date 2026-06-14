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

## Wired into the live predictor (done)

The **Dixon-Coles** model now powers the live head-to-head predictor:

- `scripts/build-elo.ts` runs the same online DC pass over the full history and
  exports per-team `dcAtt` / `dcDef` plus global `model.dc = {base, home, rho}`
  into `src/lib/ml/ratings.json`.
- `src/lib/ml/model.ts` computes goal means as attack-vs-defence and applies the
  DC low-score correction for W/D/L and scorelines. Elo is kept only as the
  on-screen "overall strength" number/ranking.
- `src/app/predictor/page.tsx` explainer + footer rewritten to describe
  attack/defence + the draw correction honestly. Tests in `model.test.ts` cover
  the DC behaviour (draw inflation, home advantage, favourite scores more).

Recalibration was intentionally **not** wired in — DC is already calibrated
(T≈0.995, a no-op). Squad/ensemble stays research-only (see #1 below: its data is
stale and not reachable here).

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

## Remaining to-do

**Network reality (checked this session):** the Custom policy reaches more than
GitHub, but the squad sources are still effectively walled. `dagshub.com` resolves
but the FC24 mirror repo redirects to a sign-in; `sofifa.com` / `kaggle.com` /
`transfermarkt.com` all return **403** (reachable at the network layer, refused at
the app layer — bot protection / auth). The eddwebster GitHub mirror still stops
at FIFA 22. So #1 and #2 below remain blocked without a credential or a direct
CSV link from the user.

1. **Newer squad snapshots (blocked on auth).** Add FIFA 23 / FC 24 / FC 25.
   `scripts/squad-strength.ts` already auto-loads `male_players_23/24/25.csv` from
   `data/fifa/` (sofifa schema: `overall` + `nationality_name`). Needs a **Kaggle
   API token** (`KAGGLE_USERNAME`/`KAGGLE_KEY`) or a **direct CSV link** from the
   user. Then re-run `npm run backtest`. Note: squad is only a complementary
   signal; **DC alone already ships and beats the old model.**
2. **Transfermarkt squad values (blocked on bot protection).** Alternative
   strength signal; TM 403s anonymous requests. Would need a gentler fetch path /
   credential.
3. **Tune the ensemble weight** (currently fixed 50/50) on the validation window —
   only worth doing once #1 lands and the ensemble is a ship candidate.
4. ~~**Wire the winner into the live predictor.**~~ **Done** — Dixon-Coles is
   live (see "Wired into the live predictor" above).
5. **Live lineups** for upcoming fixtures: free lineup API, **production only**
   (Vercel egress is open; this sandbox can't test the live call). Needs a free
   API key as a Vercel env var. UI note: squad strength feeds in near kickoff.

## User actions that may be needed next session
- A **free Kaggle API token** (or a direct GitHub/CSV link) to unblock #1 (FC
  23/24/25). Skip if DC-only is enough.
- Later, a **free lineup-API key** as a Vercel env var for the live-lineup
  feature (production only).
