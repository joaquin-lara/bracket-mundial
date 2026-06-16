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

## Lineup feature (started 2026-06-14) — REJECTED: doesn't help, slightly hurts

The squad average was redundant with DC. Actual **starting lineups** are the
signal DC genuinely cannot have: who is on the pitch tonight (injuries,
suspensions, rotation, B-teams). We tested it on *historical* lineups so it's
backtestable. **Verdict (2026-06-15): it does not improve on Dixon-Coles.**

**Pipeline built (kept for reuse / the live idea):**
- Lineups are scraped from fbref in the **user's own browser** via a Tampermonkey
  userscript (fbref 403s server-side fetch — both this sandbox and a normal
  scraper; a real browser session passes). Polite crawl, resumable, checkpoints to
  localStorage, 65-min auto-wait through fbref's rate-limit blocks.
- `lineups/fbref_lineups.json` — committed scraped XIs. **844 matches**: WC2022,
  Euro2024, Copa2024, AFCON2025, GoldCup2025, NationsLeague2425, **and the 2026 WC
  qualifiers (CONMEBOL/CONCACAF/UEFA/CAF/AFC)** — i.e. the rotation/dead-rubber
  games where lineups were supposed to matter.
- `scripts/lineup-strength.ts` — joins each starter to FIFA `overall` (edition by
  match date, with fallback) and computes
  `delta = mean(actual XI overall) - mean(nation best-11 overall)`. Join lands
  ~74% of starters across this set (lower than the tournament-only 88% because
  qualifiers are full of minnow nations EA barely rates); degrades gracefully.
- `scripts/backtest.ts` — **LINEUP TEST** block nudges DC's supremacy by
  `coef * (homeDelta - awayDelta)` and sweeps coef.
  `DixonColesOnline.adjustedPredict()` applies the shift.

**Result (495 covered competitive matches — qualifiers included):**

| coef | RPS | log-loss |
|---|---|---|
| **0.00 (DC alone)** | **0.1887** | **0.9672** |
| 0.01 | 0.1890 | 0.9682 |
| 0.03 | 0.1899 | 0.9723 |
| 0.08 | 0.1943 | 0.9958 |
| 0.12 | 0.1991 | 1.0292 |

Every non-zero coefficient is **strictly worse** on RPS and log-loss; the optimum
is coef=0 (ignore lineups). The earlier 192-match tournament-only run was
inconclusive because teams field full strength there; this 495-match run *with*
the qualifiers is the fair test, and the lineup-strength delta adds nothing —
it injects noise.

**Sharper variant also rejected — "star missing" (not averaging).** Averaging an
XI dilutes a single key absence, so we also tested the direct version: penalise a
team when a recognised star (nation player rated >= 82) is absent from the XI
(`starPenaltyFor` in lineup-strength.ts; `STAR-MISSING TEST` in backtest.ts).
767 matches both nations rated, a star missing in 413 of them. On those 413
"star actually out" matches (the best case for the idea):

| coef | RPS | log-loss |
|---|---|---|
| **0.000 (DC alone)** | **0.1703** | **0.8755** |
| 0.005 | 0.1706 | 0.8757 |
| 0.02 | 0.1782 | 0.8997 |
| 0.08 | 0.2925 | 1.3888 |

Zero is best again, monotonically. So it is not an averaging artifact: detecting
real absences (e.g. France 2022 missing Benzema/Pogba/Kanté, penalty -41) and
adjusting for them still hurts.

**Why both fail — the satisfying reason:** a missing star is almost never news to
a results-based model. Injured stars have usually been out for *weeks*, so the
team's recent results are already without them and DC has already marked the team
down. FIFA still labels them "stars," but that label is **stale** — the absence is
already priced in by results. The only case this can't cover is a *truly
last-minute* absence (a star who'd been playing, ruled out ~30 min pre-kickoff);
that's rare and not backtestable here, so not shippable with confidence.

**Status: lineup-strength joins squad-strength as researched-and-rejected.** The
live predictor is DC-only and untouched. Pipeline left in place in case a *smarter*
use is tried later (position-aware impact, or the live near-kickoff feature for a
specific big injury), but the simple XI-overall delta is a dead end.

**To re-check with more/other data** (no code changes needed):
```bash
# replace lineups/fbref_lineups.json, then:
npx tsx scripts/lineup-strength.ts   # coverage + sample deltas
npm run backtest                     # LINEUP TEST block
```

## Experiments that DID find signal (2026-06-15) — `scripts/model-experiments.ts`

After squad + lineups came up empty, ran three no-new-data experiments looking for
signal DC misses. Walk-forward, competitive only, tuned on [2013,2018), tested on
[2018,+). **All three help (modestly); the DC+Elo blend is the standout and is a
ship candidate.** Baseline DC on this window: RPS 0.1647, log-loss 0.8431.

1. **DC + Elo blend — REAL WIN.** Averaging the shipped Elo+Poisson model with DC
   beats DC alone. Validation picks ~40% Elo / 60% DC; on test:
   `wElo 0.0 (DC) 0.1647 / 0.8431  ->  wElo 0.4  RPS 0.1636  logloss 0.8390`.
   Classic diversification: Elo (margin-of-victory, different update) and DC
   (attack/defence) make different errors, so the average is steadier. ~0.7% RPS,
   validation-confirmed and monotonic. **Recommend wiring into the live predictor.**

2. **Altitude home advantage — REAL but niche.** A venue-altitude boost to home
   advantage (acclimatised host) does nothing to the overall number (only ~200 of
   5,801 test matches are >=1000m) but clearly helps *those* games: on the altitude
   subset, `altCoef 0 -> RPS 0.1749/0.9008` improves to `altCoef 0.20 -> 0.1672/0.8698`,
   validation picks altCoef≈0.15. Worth adding for CONMEBOL/Mexico/altitude hosts;
   small global effect. (Altitude table is in model-experiments.ts.)

3. **DC memory/weight tuning — marginal.** Best validation config (shrink 0.0005 =
   longer memory, friendlyWeight 0.7) → test RPS 0.1644 / logloss 0.8418 vs 0.1647 /
   0.8431. Real but tiny; fold in opportunistically.
4. **Rest days — NULL.** Fatigue/rest-asymmetry supremacy term: validation prefers
   coef=0. No signal.
5. **Travel distance — NULL.** Away-team travel-km term (country-centroid table in
   model-experiments.ts): validation mildly likes a coef but it doesn't improve test
   (0.1647→0.1648), and the long-haul (>3000km, n=714) gain is tiny + non-robust.

6. **Training start cutoff — keep ALL history.** Test window fixed (2018+); vary
   where training begins. More history is monotonically better: train-from-1872
   RPS 0.1647, 2000 → 0.1652, 2008 → 0.1667, 2014 → 0.1697. The online decay
   already discounts ancient games; cutting them just removes good priors. No
   overfitting to old data.
7. **Friendlies — keep them, down-weighted.** friendlyWeight 0 (exclude) → test
   0.1664 (worst); 0.5 (current) / 0.75 → 0.1647 (best); 1.5 → 0.1659. Excluding
   friendlies loses real signal; the shipped 0.5 down-weight is already near-optimal.

These improve the *core* model (not a bolt-on signal), so unlike squad/lineups they
are worth shipping. (Tests 6-7 confirm the data scope is already right: full history
+ down-weighted friendlies — not overfitting.)

### Rolling-window robustness check — `scripts/rolling-validation.ts`

The above all scored on one 2018+ window; with many ideas tried, a small win could
be luck specific to that era. So we replayed history once and scored fixed settings
(blend 0.4, altCoef 0.15, tuned DC) on SIX separate 2-year windows. RPS Δ vs DC
(positive = helped; * = clean out-of-sample, post-2018-tuning):

| window | blend Δ | tuned Δ | altitude Δ (n) |
|---|---|---|---|
| 2014-16 | +0.0008 | +0.0006 | -0.0066 (21) |
| 2016-18 | +0.0008 | +0.0006 | +0.0025 (31) |
| 2018-20* | +0.0025 | +0.0005 | +0.0119 (9) |
| 2020-22* | +0.0015 | +0.0003 | +0.0249 (28) |
| 2022-24* | +0.0004 | +0.0003 | -0.0011 (20) |
| 2024-26* | +0.0004 | +0.0003 | +0.0193 (19) |

- **DC+Elo blend: ROBUST.** Positive in all 6 windows incl. all 4 clean ones —
  direction never flips. Genuine, not an artifact of one era. **Ship candidate.**
- **DC tuning: consistently positive but tiny** (+0.0003..0.0006). Free marginal bump.
- **Altitude: NOISY / downgraded to low-confidence.** Only 9-31 altitude games per
  window; helps big some windows, hurts in 2. Leans positive on aggregate but not
  reliable on this evidence — do NOT ship until there are more altitude games.

Net: the one thing to wire live is the **DC+Elo blend** (optionally fold in the
tuned shrink/friendlyWeight). Altitude stays research-only for now.

## Live update + data audit + goals (2026-06-15)

**DC+Elo blend is now LIVE.** `src/lib/ml/model.ts` blends the Dixon-Coles W/D/L
60/40 with the Elo+independent-Poisson model (`BLEND_ELO_WEIGHT = 0.4`,
`eloPoissonWDL()`). Scoreline distribution / expected goals stay pure DC; only the
headline win/draw/win split is blended. Predictor-page explainer + footer updated
to describe the blend honestly. No `ratings.json` change needed (it already carries
Elo + the Poisson constants). 32 tests still pass.

**Country-name audit (every source reconciled).** `scripts/country-names.ts` is the
single source of truth: audited all 336 results-dataset teams, 192 FIFA
nationalities, 159 fbref teams; only 13 FIFA + 20 fbref spellings differ and all are
mapped to the verified results spelling (Korea Republic→South Korea, IR Iran→Iran,
Côte d'Ivoire→Ivory Coast, Türkiye→Turkey, Czechia→Czech Republic, Dominican Rep.→…,
etc.). `lineup-strength.ts` now uses it. The lineup join rose 73.7%→75.5%; remaining
misses are genuinely unrated players (minnow nations / uncapped youth), not name
bugs. Re-ran the STAR-MISSING test with exact names: **verdict unchanged** — DC-alone
still best, lineups still don't help. So the rejection is real, not a join artifact.

**Goals accuracy (`scripts/goals-accuracy.ts`) — measured for the first time.** Every
other test scores W/D/L; this scores the scoreline. On 5,801 competitive test
matches (2018+): total-goals MAE **1.41** (vs 1.47 naive-average), exact most-likely
scoreline hit **13.3%**, total within ±1 goal **43.1%**, scoreline log-loss 2.82.
Takeaway: goal/scoreline prediction is only modestly better than guessing the
average — football scorelines are inherently noisy, and the model's real edge is in
the *outcome* odds, not exact goals. **No test ever improved goal accuracy** (the
blend doesn't touch goals; squad/lineup were rejected). If better *goals* are the
goal, xG-based lambdas are the most promising lever (next). Next step (deliberate model change, not yet done): wire the
DC+Elo blend into `src/lib/ml/model.ts` (it already has both Elo and DC ratings in
ratings.json), optionally add the altitude term, and update the predictor explainer.

## xG: available for internationals but too sparse to help (2026-06-16)

**Where international xG lives:** StatsBomb Open Data (free, GitHub, sandbox-reachable
— unlike fbref, which has NO xG for international comps; confirmed by inspecting the
Euro 2024 fixtures table). `scripts/pull-statsbomb-xg.py` aggregates shot xG per team
for the six men's tournaments it covers → `xg/statsbomb_xg.json` (**314 matches**:
World Cup 2018/2022, Euro 2020/2024, Copa 2024, AFCON 2023).

**Does training on xG beat training on goals?** No (`scripts/xg-experiment.ts`).
Update target = (1-α)·goals + α·xG for the xG matches; scored on competitive test
(2018+): α=0 (shipped) RPS 0.1647, α=0.25 identical, α≥0.5 slightly worse. Only 290
of ~49k rating updates have xG (<1%), so it can't move the ratings. Broader xG
(qualifiers/friendlies) only exists behind bot-protected APIs (FotMob/SofaScore);
this null result makes that lift low-priority.

**The valuable finding — the luck ceiling.** In the 314 xG matches the side with more
xG won only **53%** (drew 28%, lost 20%): **47% of the time the "deserved" winner did
not win.** Nearly half of single-match football is noise the scoreline records but no
model can foresee. This explains why squad / lineups / rest / travel / xG all failed:
DC is already near the achievable ceiling, and there isn't much predictable signal
left to add.

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
