# Achievements plan — Bracket Mundial

Hidden achievements layer for the 4-player game (Carlos, Sebas, Mauri, Joaquin). Tone: jokey but fair, football-flavored. Scope: **prediction & scoring** + **rivalry**.

---

## What shipped (final)

The round-by-round sections below are the design history (and still use the old tier/section names from when they were written). This is what actually got built:

- **76 badges**, defined in `src/lib/achievementsList.ts`, evaluated by the pure engine in `src/lib/achievements.ts`.
- **Four rarities:** Common (gray) → Rare (blue) → Epic (purple) → Legendary (orange/gold).
- **Nine sections:** Exact Scores, Streaks, Smart Picks, Bold Picks, Points, Participation, Tournament Stages, Duels, Final Standings.
- **Hidden-until-first-unlock reveal:** the first run silently baselines what players already earned; the first *new* badge after that fires a group-wide banner naming the player and achievement, and lights up the page, nav link, and standings badges.
- **Calculated when matches end:** every badge is computed from finished, locked picks only, so pre-filling future games or picking-then-retracting can't award anything. Participation badges count only finished matches; a reconcile pass prunes anything mistakenly awarded by an earlier rule.
- **Wording for second-language readers:** "Get the exact score" (3 pts) vs "Get the result right" (2+ pts) vs "Make a pick" (no correctness implied).
- **Interactive board** (`/achievements`): switch between players, group by rarity or type, filter all/unlocked/locked, per-player segmented progress bar, and click any badge to see which game + date each player earned it on.
- **Duels** made visible to the whole group (picks stay secret). SQL migration in `supabase/achievements.sql`.

We were **13 matches into a 104-match tournament** when this was designed, which drove the reveal mechanic below.

---

## 1. The mid-tournament problem (and the fix)

Because the game is already running, any "your first X" achievement is dead on arrival: it either already happened or would retro-fire on everyone the instant the feature ships, which kills the surprise. So:

- **Dropped:** On the Board, Bullseye, Oracle (and other "first ___" framings).
- **Streaks redefined** around getting the **outcome right** (2+ points), per your note.
- **The reveal stays a real moment.** At launch we silently run the evaluator once to record what each player has *already* earned from the 13 played matches, with **no banner and no toasts**. The big group reveal fires on the **first brand-new unlock after launch**:

  > **"New feature unlocked! Mauri just earned Hot Streak 🔥 — achievements are now live for everyone. Go check yours."**

  The announcement doubles as the feature's debut: it tells everyone achievements exist *and* who set them off. From that instant the `/achievements` page, standings badges, and future toasts all appear. Anything pre-earned at launch simply shows as already-unlocked on the page, so there's history to look at but no retroactive spam.

Cumulative counters (e.g. exact-score totals, career points) count the full tournament so milestones are real. Streaks and one-off events count forward from launch so they're fresh to chase.

---

## 2. The list (livelier, less meta)

Badges run **bronze → silver → gold → legendary** so there's always a next rung. Legendary is the new top tier: once-a-tournament feats that almost never happen. Emoji are placeholders for real badge art later.

**Scoring key (so the logic is unambiguous).** Every pick earns at least 1 point, so "scored points" can't be a real bar. The exact mapping used below:

- **3 pts — *exact*:** correct scoreline.
- **2 pts — *outcome*:** right winner or a called draw, wrong scoreline.
- **1 pt — *miss*:** you locked a pick but got the outcome wrong.
- **0 pts — *no-show*:** no pick locked at all.

So **"correct outcome" = 2 or 3 pts**, and **"got it wrong" = a miss (1 pt) or a no-show (0)**. To your Mic Drop question: yes — a rival who "got it wrong" scored 1 (or 0 if they didn't pick); anyone on 2+ does *not* count as wrong.

### Sharpshooting — exact scores

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🔮 | **Nostradamus** | Predict **3** exact scorelines across the tournament. | Silver |
| 🌌 | **Nostradamus Prime** | Get to **8** exact scorelines. | Gold |
| ✌️ | **Daily Double** | **2** exact scores in one matchday. (Tough but real.) | Gold |
| 🎤 | **Mic Drop** | Exact-score a match (3 pts) where **none of the other three got the outcome** — each scored 1 or 0. | Gold |
| 🦊 | **Smash and Grab** | Exact-score a **1–0**. | Bronze |
| 🚌 | **Park the Bus** | Exact-score a **0–0**. | Silver |
| 🎆 | **Goal Fest** | Exact-score a match with **5+ goals** in it. | Gold |
| 💥 | **Goleada** | Exact-score a game won by a **4+ goal margin** (a thrashing). | Gold |
| 🧊 | **Clutch** | Exact-score a **knockout** match. | Gold |
| 🎩 | **Hat-Trick Hero** | **3 exact scores in a single matchday.** Almost never happens. | Legendary |
| 🐙 | **Paul the Octopus** | Exact-score **3 matches in a row.** Named for the oracle octopus. | Legendary |

### Form & streaks

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🔥 | **Hot Streak** | Correct outcome on **5** matches in a row. | Silver |
| 🌋 | **On Fire** | Correct outcome on **10** matches in a row. | Gold |
| ✨ | **Flawless Day** | Get the **correct outcome (2+)** on **every** pick you made on a matchday with 3+ games. | Silver |
| 🥶 | **Frostbite** | The anti-streak: **a miss (1 pt) on 5 matches in a row.** Jokey but fair. | Bronze |
| 🎗️ | **Participation Trophy** | Score **only the 1-pt minimum** on every pick across a 3+ game matchday — you showed up and whiffed them all. | Bronze |

### Brains vs the model

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🗡️ | **Giant Slayer** | Correctly call an **upset** — pick the underdog to win (per the ML favorite) and they do. | Silver |
| 🪓 | **Kingslayer** | Call **5** upsets across the tournament. | Gold |
| 🧠 | **Galaxy Brain** | Get the **correct outcome (2+)** on a match where the model's most-likely score would've missed the outcome. | Gold |
| 📊 | **The Analyst** | Agree with the model's most-likely score **and** nail it exactly. | Silver |
| 🍌 | **Banana Skin** | Correctly call a **draw** in a game the model made lopsided (one side a clear favorite). | Silver |

### Bold calls

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🎲 | **Ambitious** | Back a team to score **6 or more** in a prediction (e.g. 6–0, 7–2). Pure "wow, you bet that high." | Bronze |

### Points milestones

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🪙 | **Half Century** | Reach **50** career points. | Bronze |
| 💯 | **Centurion** | Reach **100** career points. | Silver |
| 🌠 | **Galáctico** | Reach **200** career points. | Gold |

### Appearances — matches you've predicted (the long grind)

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🧢 | **Squad Player** | Lock a pick on **25** matches. | Bronze |
| 🎖️ | **Veteran** | **50** matches predicted. | Silver |
| 🏟️ | **Club Legend** | **75** matches predicted. | Gold |
| 🗿 | **Icon** | **100** matches predicted. | Legendary |

### Stages & knockouts

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🥊 | **Knockout King** | Get the **correct outcome (2+)** on **every** knockout match you pick within a single round. | Gold |
| 🧨 | **Bracket Buster** | Correctly call the outcome of a **knockout-stage upset**. | Silver |
| 📣 | **El Hincha** *(Real Fútbol Fan)* | Lock a pick for **every match of the knockout stage**. | Legendary |
| 🟩 | **The Perfect Group** | Correct outcome on **every match of one group** (all 6 games). | Gold |
| 🏆 | **Called the Final** | Predict the **exact score of the Final**. | Legendary |

### Rivalry — head-to-head duels *(records reset to 0 — see note)*

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| ⚔️ | **First Blood** | Win a penalty shootout duel. | Bronze |
| 🥅 | **Shootout King** | Win **5** duels. | Silver |
| 😈 | **Nemesis** | Beat the **same player** in 3 duels. | Silver |
| 🧤 | **Clean Sheet** | Win a duel **without conceding** a goal. | Silver |
| ☠️ | **Sudden Death** | Win a duel in **sudden death** (past 5 kicks each). | Silver |
| 🔄 | **Comeback King** | Win a duel after **trailing by 2+**. | Gold |
| 🛡️ | **Unbeaten Run** | Win **5 duels in a row**. | Legendary |
| 🖐️ | **Five for Five** | Win a duel converting **all five** of your kicks. | Gold |
| 🧹 | **Rivalry Sweep** | Record at least one duel win against **all three** other players. | Legendary |

**No secret achievements** — every badge is visible up front. The one surprise is the feature itself: nobody knows achievements exist until the first one is earned and the group banner fires. After that, it's all out in the open to chase.

**43 in the master list**, spanning quick bronze wins to once-a-tournament legendaries, all earnable from where we are now. New batches are added in their own sections below so the list stays readable.

---

## 2b. New additions — round 4

Fresh ones, kept separate so they're easy to spot. These fold into the categories above once you sign off.

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🎯 | **Marksman** | Get the **correct outcome (2+)** on **20** matches total. | Silver |
| 🦅 | **Deadeye** | Correct outcome on **40** matches total. | Gold |
| 🤝 | **Stalemate** | Correctly call **3 draws** (right outcome on a drawn match, three times). | Silver |
| 👑 | **Crowned It** | Get the **outcome of the Final** right (2+). Pairs with Called the Final. | Gold |
| 🥉 | **Bronze Medal Match** | Exact-score the **third-place playoff**. | Gold |
| 🎪 | **Big Stage** | Correct outcome in a **semi-final**. | Silver |
| 🎢 | **High Roller** | Place an **Ambitious** bet (a team to score 6+) **and** get the outcome right. The version with teeth. | Gold |
| 📆 | **Ever-Present** | Predict **every match across 7 straight matchdays** — no misses. | Gold |
| 🏃 | **Marathon Man** | Win a duel that runs **14+ kicks** (deep into sudden death). | Gold |
| 🧱 | **The Wall** | Win a duel on a **save** — the deciding kick was stopped. | Silver |
| ⚡ | **Double Trouble** | Win **2 duels in a single day**. | Silver |

**11 new → 54 total.**

---

## 2c. New additions — round 5

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 📺 | **Glued to the Screen** | Ever-Present, but for **14 straight matchdays** — no misses. | Legendary |
| 🌪️ | **Unstoppable** | Correct outcome on **15** matches in a row (above On Fire). | Legendary |
| 🐐 | **The GOAT** | Reach **250** career points. | Legendary |
| 🪞 | **Mirror Match** | Exact-score a **draw** (any X–X). | Silver |
| 🎇 | **Miracle on Grass** | Correctly call an upset where the model gave the winner **under 20%**. | Gold |
| 🃏 | **Against All Odds** | **Exact-score** a match the **underdog wins** — exact and upset in one. | Gold |
| 🌎 | **Globetrotter** | Lock a pick on a match at **every host venue** (all 16 host cities). | Gold |
| 🎳 | **On a Roll** | Win **3 duels in a row** (the rung below Unbeaten Run). | Silver |
| 🕙 | **Down to the Wire** | Lock a prediction in the **final 2 minutes** before it closes. | Bronze |
| 🪦 | **Sudden Death Specialist** | Win **2 duels** that went to sudden death. | Silver |

**10 new → 64 total.**

---

## 2d. New additions — round 6 (final batch)

| Badge | Name | Unlock | Tier |
|---|---|---|---|
| 🔭 | **Sniper Elite** | **15** exact scores total — caps the Nostradamus ladder. | Legendary |
| 🧽 | **Spotless Slate** | Correct outcome on **every** pick of a **6+ game** matchday. | Gold |
| 🔁 | **Redemption** | Go on a **5-match** correct-outcome run **right after** a Frostbite (5 misses in a row). | Gold |
| 🤺 | **Duelist** | Complete **10 duels** (win or lose). | Silver |
| 🐅 | **Apex Predator** | Beat **each** of the other three players in duels **at least twice**. | Legendary |
| 🗓️ | **Marathon Day** | Lock a pick on **every match** of a 6+ game matchday. | Silver |
| 💫 | **Dream Start** | Correct outcome on your **first 3 knockout-stage picks**. | Silver |
| 🌧️ | **Party Pooper** | **Exact-score** a game where the model's **heavy favorite (>70%)** fails to win. | Gold |
| 🥇 | **Champion** | Finish the tournament in **1st place**. One-time capstone. | Legendary |
| 🥈 | **Runner-up** | Finish the tournament in **2nd place**. | Gold |
| 🥉 | **Podium Finish** | Finish the tournament in **3rd place**. | Silver |
| 🥄 | **Better Luck Next Time! (In 4 Years)** | Finish the tournament in **4th** — dead last. | Bronze |

**12 new → 76 total.**

---

## 3. What changed from v1

- Cut every leaderboard-position achievement (King of the Hill, Reign, Leapfrog, Escape Artist, Day Winner) — too meta.
- Cut the "first ___" achievements that the mid-tournament start breaks.
- **Nostradamus** is now the headline exact-score chase, tiered.
- **Hot Streak / On Fire** are now correct-**outcome** streaks (5 / 10 in a row).
- Added lively, concrete football moments: Giant Slayer, Galaxy Brain, Goal Fest, Ambitious, Park the Bus, Mic Drop, The Perfect Group.

---

## 4. How it shows up (unchanged from your picks)

1. **Group banner** on the first post-launch unlock, then **toasts** for each later unlock (once per player).
2. **Badges** next to names on the standings.
3. **`/achievements` page**: grid of all of them, earned ones lit with who/when, the rest greyed with their unlock rule (no hidden "???" — every badge is visible), and a "X / 76 unlocked" header.

---

## 5. Technical sketch

- `src/lib/achievements.ts`: the static definitions + a **pure evaluator** (given a player's predictions, matches, duels, and the ML model's per-match favorite, return the set of earned ids). Same pure/testable pattern as `scoring.ts`.
- One new table **`user_achievements`** (`user_id`, `achievement_id`, `earned_at`, optional `match_id`). Written server-side only, idempotent — an id is inserted once and never re-awarded, mirroring the `scored` flag discipline already in the sync job.
- Evaluation runs inside the existing scoring path right after points are written, plus a pass when a duel finishes.
- Reveal flag = "does the launch baseline have any post-launch rows yet?" A small realtime watcher (same pattern as `ChallengeWatcher`) flips the UI on and fires the banner.
- ML-based achievements (Giant Slayer, Galaxy Brain) use the existing `predict()` output (`probHome/probDraw/probAway`, `mostLikelyScore`) to define the favorite — no new model work.

### Duel changes you flagged

- **Reset to 0:** you'll wipe the existing penalty-shootout records, so every duel achievement (First Blood, Shootout King, Nemesis, etc.) starts fresh from launch. The achievement engine doesn't care about old rows, so no extra work.
- **Make duels visible to everyone:** right now the `duels_select` policy only lets the two participants see a duel — a Carlos-vs-Sebas duel is invisible to Mauri and Joaquin. You're right, that needs to change so outcomes show up for the whole group (and so Rivalry Sweep / a duel record board make sense). It's a small RLS swap: broaden `duels_select` to all authenticated users. **The picks stay secret** — those live in `duel_secrets`, which has no grants and isn't touched, so the anti-cheat design holds. I can ship this one-line change whenever you want.

---

## 6. Decisions I need from you

1. **Thresholds** — Nostradamus 3 / 8, streaks 5 / 10, points 50 / 100 / 200, appearances 25/50/75/100, correct-outcome 20/40 all good?
2. **List size** — 76 now (final batch added). Lock it here?
3. **The bad ones** — happy with Frostbite + Participation Trophy as the two self-roasts, or want more teeth (or less)?
4. **Badge art** — emoji to start, or a proper crest/medal style pass up front?

Say the word on these and I'll lock it and build the engine.
