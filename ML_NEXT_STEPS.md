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

Squad-value test (now with FIFA 15-25 loaded; 2,677 matches both teams have a
FIFA pool for, test 2015+):

| model | RPS | log-loss |
|---|---|---|
| Dixon-Coles only | 0.1872 | 0.9516 |
| Squad strength only | 0.1937 | 0.9738 |
| Ensemble (DC + squad, fixed 50/50) | 0.1863 | 0.9502 |

Findings: Dixon-Coles beats the shipped Elo model; squad strength is weaker alone.
A **fixed 50/50** ensemble looks like a hair better than DC on the test window
(RPS 0.1863 vs 0.1872), **but that edge does not survive honest weight tuning** --
see "Squad ensemble: settled" below. DC is already well-calibrated so temperature
recalibration is ~a no-op (T=0.995).

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
(T≈0.995, a no-op). Squad/ensemble stays **research-only** — and after the FC
23/24/25 refresh, that is now a *settled* decision, not a data-blocked one (see
"Squad ensemble: settled" below).

## Squad ensemble: settled — DC stays solo (2026-06-14)

The Kaggle egress allowlist was opened, so FIFA 23 / EA FC 24 / FC 25 are now
loaded and the talent-pool feature is **current** (the 2026-06 column finally
moves past FIFA 22 — e.g. South Korea 73.4→74.6, USA 75.0→75.8). With current
data we re-ran the question "does DC+squad beat DC alone?" **honestly**:

- A **fixed 50/50** blend edges DC on the *test* window (RPS 0.1863 vs 0.1872) —
  but a fixed weight chosen with test-set hindsight isn't a fair test.
- Sweeping the ensemble weight on a real **validation** window (2015–2018, n=652
  competitive both-pool matches; squad constant fit through 2018, test 2018+):
  validation RPS is **monotonic in the DC weight and is minimised at wDC = 1.0**
  (pure DC). i.e. the only data we're allowed to tune on says "use no squad."
  At that honestly-chosen weight the ensemble *is* DC-only on test (RPS 0.18769).
  The blend only wins if you peek: the test-window optimum (~wDC 0.7, RPS 0.1859)
  is exactly the kind of in-sample tuning the validation split exists to forbid.

Conclusion: squad talent-pool strength is a genuine but **weak and redundant**
signal next to online Dixon-Coles — DC's attack/defence ratings already encode
roughly what the FIFA pool tells us, and more responsively. So the live predictor
**stays DC-only**; squad strength remains a research/explainer signal, not a model
input. (Sweep harness used: a standalone weight grid over the same DC + squad
models as `scripts/backtest.ts`; not committed, since the conclusion is "don't
ship it.") This closes to-do #1 and #3 below.

## Lineup feature (started 2026-06-14) — preliminary, NULL so far on tournaments

The squad average was redundant with DC. Actual **starting lineups** are the
signal DC genuinely cannot have: who is on the pitch tonight (injuries,
suspensions, rotation, B-teams). We test it on *historical* lineups so it's
backtestable; if it works, the same code later powers a live 30-min-before
lineup feature in production.

**Pipeline built (this is the deliverable; data is still being collected):**
- Lineups are scraped from fbref in the **user's own browser** via a Tampermonkey
  userscript (fbref blocks server-side fetch — both this sandbox and a normal
  scraper get 403; a real browser session passes). The script politely crawls
  (~7-11s/page, resumable, checkpoints to localStorage) and downloads one JSON.
  fbref rate-limits hard (~10 req/min, then a multi-minute-to-hour IP block), so
  the full pull comes in chunks across sittings.
- `lineups/fbref_lineups.json` — committed scraped XIs. **Currently 244 matches**
  (WC2022, Euro2024, Copa2024, AFCON2025, GoldCup2025, NationsLeague2425 + a
  little WCQ). Target ~540-1300 incl. the 2026 WC qualifiers (CONMEBOL/CONCACAF/
  UEFA/CAF/AFC) — those were still crawling when fbref rate-limited.
- `scripts/lineup-strength.ts` — joins each starter's name to FIFA `overall`
  (edition in effect on the match date, with fallback) and computes
  `delta = mean(actual XI overall) - mean(nation best-11 overall)`. Name→FIFA
  join lands **~88%** of starters (misses are uncapped/lower-league players of
  small nations + a couple non-FIFA sides like Guadeloupe; degrades gracefully).
- `scripts/backtest.ts` — new **LINEUP TEST** block: nudges DC's goal supremacy
  by `coef * (homeDelta - awayDelta)` and sweeps coef, scoring DC-vs-DC+lineup on
  the same covered matches. `DixonColesOnline.adjustedPredict()` applies the shift.

**Preliminary result (192 covered competitive matches, coef sweep):**

| coef | RPS | log-loss |
|---|---|---|
| 0.00 (DC alone) | 0.1935 | 0.9941 |
| 0.01 | 0.1935 | 0.9938 |
| 0.02 | 0.1936 | 0.9938 |
| 0.05 | 0.1946 | 0.9961 |
| 0.12 | 0.2009 | 1.0140 |

So: **no RPS gain**, a rounding-error log-loss gain at a tiny coef, and any real
nudge hurts. **But read the sample first:** these 192 are almost all *tournament*
matches (group + knockout), where teams field their strongest XI — so the lineup
delta barely varies and there is little for it to exploit. This is the *worst*
sample for the feature. Where lineups should actually matter — rotation, dead
rubbers, B-teams — is **qualifiers**, which are mostly the games still being
scraped. So this is **inconclusive-leaning-null, not a verdict**.

**To extend when the full JSON lands** (no code changes needed):
```bash
# replace lineups/fbref_lineups.json with the bigger download, then:
npx tsx scripts/lineup-strength.ts   # coverage + sample deltas
npm run backtest                     # re-check the LINEUP TEST block
```
If qualifiers move the needle, tune coef on a validation split (don't trust the
tournament-only coef) before any thought of wiring it live. If they don't, this
joins squad strength as a researched-and-rejected signal. The live predictor is
DC-only and untouched either way.

## Data (gitignored under `/data/`, must be re-fetched per session)

```bash
# results dataset
npm run build:elo            # downloads data/results.csv

# FIFA talent-pool ratings, auto-loaded by scripts/squad-strength.ts.
# It reads data/fifa/male_players_<yy>.csv for any edition present, keying on the
# sofifa columns `overall` + `nationality_name`.

# (a) FIFA 15-22 from the eddwebster GitHub mirror (single-snapshot sofifa CSVs):
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
base="https://raw.githubusercontent.com/eddwebster/football_analytics/master/data/fifa/raw"
mkdir -p data/fifa
for yy in 15 16 17 18 19 20 21 22; do
  curl -sSL -A "$UA" "$base/male_players_$yy.csv" -o "data/fifa/male_players_$yy.csv"
done

# (b) FIFA 23 + EA FC 24 from Kaggle. The stefanoleone992 *FC 24* dataset's
#     male_players.csv is one file covering editions 15-24 (column `fifa_version`,
#     single update 2.0 each) and is schema-identical to the eddwebster files, so
#     filter it for versions 23 and 24 -> male_players_23.csv / _24.csv:
curl -L -u "$KAGGLE_USERNAME:$KAGGLE_KEY" -o /tmp/fc24.zip \
  "https://www.kaggle.com/api/v1/datasets/download/stefanoleone992/ea-sports-fc-24-complete-player-dataset"
unzip -o -q /tmp/fc24.zip male_players.csv -d /tmp/fc24x
python3 - <<'PY'
import csv
with open('/tmp/fc24x/male_players.csv', newline='', encoding='utf-8') as f:
    r = csv.reader(f); header = next(r); iv = header.index('fifa_version')
    keep = {'23': [], '24': []}
    for row in r:
        v = row[iv].split('.')[0]
        if v in keep: keep[v].append(row)
for yy, rows in keep.items():
    with open(f'data/fifa/male_players_{yy}.csv', 'w', newline='', encoding='utf-8') as o:
        w = csv.writer(o); w.writerow(header); w.writerows(rows)
PY

# (c) EA FC 25 — no stefanoleone992 FC25 dataset exists. Use a sofifa-style FC25
#     export and rename its columns to the sofifa schema. nyagami's dataset has
#     the widest coverage (~16k players, `OVR` + `Nation`):
curl -L -u "$KAGGLE_USERNAME:$KAGGLE_KEY" -o /tmp/fc25.zip \
  "https://www.kaggle.com/api/v1/datasets/download/nyagami/ea-sports-fc-25-database-ratings-and-stats"
unzip -o -q /tmp/fc25.zip male_players.csv -d /tmp/fc25x
python3 - <<'PY'
import csv
with open('/tmp/fc25x/male_players.csv', newline='', encoding='utf-8') as f:
    r = csv.reader(f); h = next(r)
    iN, iO, iNat = h.index('Name'), h.index('OVR'), h.index('Nation')
    out = [[row[iN], row[iO], row[iNat]] for row in r
           if len(row) > max(iN, iO, iNat) and row[iO].strip().isdigit() and row[iNat].strip()]
with open('data/fifa/male_players_25.csv', 'w', newline='', encoding='utf-8') as o:
    w = csv.writer(o); w.writerow(['short_name', 'overall', 'nationality_name']); w.writerows(out)
PY
```

## Remaining to-do

**Kaggle egress: RESOLVED (2026-06-14).** `www.kaggle.com` (and the
`storage.googleapis.com` download-redirect target) are now on the network egress
allowlist, and `KAGGLE_USERNAME` / `KAGGLE_KEY` are set, so FIFA 23 / FC 24 / FC 25
are reachable and now loaded (see the Data section for the exact, working fetch).
Slug notes for next time: `stefanoleone992/fifa-23-complete-player-dataset` and
`.../ea-sports-fc-24-complete-player-dataset` exist; **there is no stefanoleone992
FC25 dataset** (the guessed `.../ea-sports-fc-25-complete-player-dataset` 404s).
The FC24 dataset's male_players.csv already spans editions 15-24, so it supplies
both 23 and 24; FC25 comes from `nyagami/ea-sports-fc-25-database-ratings-and-stats`
(non-sofifa header, renamed in the fetch script).

1. ~~**Newer squad snapshots.**~~ **Done (2026-06-14).** FIFA 23/24/25 loaded;
   feature is current. Outcome: the ensemble does **not** robustly beat DC-alone
   (see "Squad ensemble: settled" above), so nothing was wired into the live model.
2. **Transfermarkt squad values (blocked on bot protection).** Alternative
   strength signal; TM 403s anonymous requests. Would need a gentler fetch path /
   credential.
3. ~~**Tune the ensemble weight.**~~ **Done (2026-06-14).** Validation picks
   wDC = 1.0 (pure DC); the blend is not a ship candidate. See "Squad ensemble:
   settled" above.
4. ~~**Wire the winner into the live predictor.**~~ **Done** — Dixon-Coles is
   live (see "Wired into the live predictor" above).
5. **Live lineups** for upcoming fixtures: free lineup API, **production only**
   (Vercel egress is open; this sandbox can't test the live call). Needs a free
   API key as a Vercel env var. UI note: squad strength feeds in near kickoff.

## User actions that may be needed next session
- Nothing for the squad feature — Kaggle egress is sorted and the FC 23/24/25
  question is settled (DC stays solo). The data lives under gitignored `data/`,
  so re-run the Data-section fetch each fresh session if you want to reproduce.
- Later, a **free lineup-API key** as a Vercel env var for the live-lineup
  feature (production only).
