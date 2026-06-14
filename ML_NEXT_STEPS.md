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

**Network reality (re-checked 2026-06-14):** the Kaggle creds ARE now set
(`KAGGLE_USERNAME` + `KAGGLE_KEY` both present and valid). The blocker is **not**
auth and **not** the dataset slug — it is this environment's **network egress
allowlist**. Every Kaggle request returns, at the proxy layer:

```
HTTP 403  Host not in allowlist: www.kaggle.com. Add this host to your network
          egress settings to allow access.
```

Probed this session: the allowlist is effectively **GitHub-only**
(`github.com`, `raw.githubusercontent.com`, `media.githubusercontent.com`,
`objects.githubusercontent.com`) **plus `storage.googleapis.com`**. Blocked:
`kaggle.com`, `www.kaggle.com`, `huggingface.co`, `zenodo.org`, `figshare.com`.
Kaggle dataset files live on GCS (which IS reachable), but the download endpoint
must first 302-redirect through `www.kaggle.com` to mint a signed GCS URL — so the
open GCS host alone doesn't help. The eddwebster GitHub mirror still stops at FIFA
22 (23/24/25 → 404), and a GitHub repo/code search turned up no public mirror that
*commits* the full multi-nation FC23/24/25 sofifa CSV (repos that use the dataset
reference Kaggle or host only a small single-league subset).

**Resolution chosen by user (2026-06-14): add `www.kaggle.com` to the egress
allowlist.** The network policy is fixed at container start, so the edit only
takes effect in a **new session** — it did NOT propagate to the session that hit
this. `storage.googleapis.com` is already allowed (the download redirect target),
so adding `www.kaggle.com` (and `kaggle.com`) should be sufficient.

**Next session (once kaggle.com is allowed), run exactly:**

```bash
npm install && npm run build:elo            # deps + data/results.csv
# FIFA 15-22 (eddwebster mirror):
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
base="https://raw.githubusercontent.com/eddwebster/football_analytics/master/data/fifa/raw"
mkdir -p data/fifa
for yy in 15 16 17 18 19 20 21 22; do
  curl -sSL -A "$UA" "$base/male_players_$yy.csv" -o "data/fifa/male_players_$yy.csv"
done
# FIFA 23 / FC 24 / FC 25 from Kaggle (unzip, find the male players CSV, place as
# data/fifa/male_players_23.csv / _24.csv / _25.csv; confirm header has
# `overall` and `nationality_name`):
for slug_out in \
  "stefanoleone992/fifa-23-complete-player-dataset:23" \
  "stefanoleone992/ea-sports-fc-24-complete-player-dataset:24" \
  "stefanoleone992/ea-sports-fc-25-complete-player-dataset:25"; do
  slug=${slug_out%:*}; yy=${slug_out#*:}
  curl -L -u "$KAGGLE_USERNAME:$KAGGLE_KEY" -o /tmp/fc$yy.zip \
    "https://www.kaggle.com/api/v1/datasets/download/$slug"
  # unzip /tmp/fc$yy.zip -d /tmp/fc$yy && locate the male players csv -> data/fifa/male_players_$yy.csv
done
npx tsx scripts/squad-strength.ts   # should now list editions incl. 23/24/25
npm run backtest                     # compare Ensemble (DC+squad) vs Dixon-Coles only
```

1. **Newer squad snapshots (blocked on egress allowlist, NOT auth).** Add FIFA 23 /
   FC 24 / FC 25. `scripts/squad-strength.ts` already auto-loads
   `male_players_23/24/25.csv` from `data/fifa/` (sofifa schema: `overall` +
   `nationality_name`). Creds are set; the only missing piece is `www.kaggle.com`
   in the egress allowlist (user is adding it; needs a fresh session). Then re-run
   `npm run backtest`. Note: squad is only a complementary signal; **DC alone
   already ships and beats the old model**, so the live predictor is unaffected
   until/unless the ensemble proves a meaningful win.
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
- **Add `www.kaggle.com` (and `kaggle.com`) to the environment's network egress
  allowlist**, then start a **new session** (the policy is set at container start
  and won't hot-reload). Kaggle creds are already set, so that's the only blocker
  for FC 23/24/25. `storage.googleapis.com` is already allowed. (If you'd rather
  not touch the allowlist, paste direct GitHub-raw CSV links for the FC23/24/25
  male-players files instead — those hosts are reachable today.)
- Later, a **free lineup-API key** as a Vercel env var for the live-lineup
  feature (production only).
