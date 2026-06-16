// Static achievement definitions — pure data, zero dependencies, so client
// components can import it without pulling in the ML model / evaluator. The
// server-side evaluator (achievements.ts) imports these too.
//
// Wording is deliberately consistent for second-language readers:
//   "Get the exact score ..."  = nail the scoreline (3 pts)
//   "Get the result right ..." = correct winner/draw (2+ pts)
//   "Make a pick / Pick ..."   = just lock a prediction (no correctness implied)
//   "... points"               = career points total

export type Tier = 'common' | 'rare' | 'epic' | 'legendary' | 'platinum';

export type Category =
  | 'Exact Scores'
  | 'Streaks'
  | 'Smart Picks'
  | 'Bold Picks'
  | 'Points'
  | 'Participation'
  | 'Tournament Stages'
  | 'Duels'
  | 'Final Standings'
  | 'Platinum';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  tier: Tier;
  category: Category;
  emoji: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // --- Sharpshooting -------------------------------------------------------
  { id: 'nostradamus', name: 'Nostradamus', emoji: '🔮', tier: 'rare', category: 'Exact Scores', description: 'Get the exact score on 3 matches (total).' },
  { id: 'nostradamus_prime', name: 'Nostradamus Prime', emoji: '🌌', tier: 'epic', category: 'Exact Scores', description: 'Get the exact score on 8 matches (total).' },
  { id: 'daily_double', name: 'Daily Double', emoji: '✌️', tier: 'epic', category: 'Exact Scores', description: 'Get the exact score on 2 matches in the same day.' },
  { id: 'mic_drop', name: 'Mic Drop', emoji: '🎤', tier: 'epic', category: 'Exact Scores', description: 'Get an exact score where none of the other three got the result.' },
  { id: 'smash_and_grab', name: 'Smash and Grab', emoji: '🦊', tier: 'common', category: 'Exact Scores', description: 'Get the exact score on a 1–0 result.' },
  { id: 'park_the_bus', name: 'Park the Bus', emoji: '🚌', tier: 'rare', category: 'Exact Scores', description: 'Get the exact score on a 0–0 result.' },
  { id: 'goal_fest', name: 'Goal Fest', emoji: '🎆', tier: 'epic', category: 'Exact Scores', description: 'Get the exact score on a match with 5+ total goals.' },
  { id: 'goleada', name: 'Goleada', emoji: '💥', tier: 'epic', category: 'Exact Scores', description: 'Get the exact score on a win by 4+ goals.' },
  { id: 'clutch', name: 'Clutch', emoji: '🧊', tier: 'epic', category: 'Exact Scores', description: 'Get the exact score on a knockout match.' },
  { id: 'hat_trick_hero', name: 'Hat-Trick Hero', emoji: '🎩', tier: 'legendary', category: 'Exact Scores', description: 'Get the exact score on 3 matches in the same day.' },
  { id: 'paul_the_octopus', name: 'Paul the Octopus', emoji: '🐙', tier: 'legendary', category: 'Exact Scores', description: 'Get the exact score on 3 matches in a row.' },
  { id: 'mirror_match', name: 'Mirror Match', emoji: '🪞', tier: 'rare', category: 'Exact Scores', description: 'Get the exact score on a draw (any X–X).' },
  { id: 'sniper_elite', name: 'Sniper Elite', emoji: '🔭', tier: 'legendary', category: 'Exact Scores', description: 'Get the exact score on 15 matches (total).' },

  // --- Form & streaks ------------------------------------------------------
  { id: 'hot_streak', name: 'Hot Streak', emoji: '🔥', tier: 'rare', category: 'Streaks', description: 'Get the result right on 5 matches in a row.' },
  { id: 'on_fire', name: 'On Fire', emoji: '🌋', tier: 'epic', category: 'Streaks', description: 'Get the result right on 10 matches in a row.' },
  { id: 'unstoppable', name: 'Unstoppable', emoji: '🌪️', tier: 'legendary', category: 'Streaks', description: 'Get the result right on 15 matches in a row.' },
  { id: 'flawless_day', name: 'Flawless Day', emoji: '✨', tier: 'rare', category: 'Streaks', description: 'Get the result right on every pick on a day with 3+ matches.' },
  { id: 'spotless_slate', name: 'Spotless Slate', emoji: '🧽', tier: 'epic', category: 'Streaks', description: 'Get the result right on every pick on a day with 6+ matches.' },
  { id: 'frostbite', name: 'Frostbite', emoji: '🥶', tier: 'common', category: 'Streaks', description: 'Get the result wrong on 5 matches in a row. It happens.' },
  { id: 'participation_trophy', name: 'Participation Trophy', emoji: '🎗️', tier: 'common', category: 'Streaks', description: 'Score only the 1-point minimum on every pick on a day with 3+ matches.' },
  { id: 'redemption', name: 'Redemption', emoji: '🔁', tier: 'epic', category: 'Streaks', description: 'Get the result right on 5 in a row right after a Frostbite.' },

  // --- Brains vs the model -------------------------------------------------
  { id: 'giant_slayer', name: 'Giant Slayer', emoji: '🗡️', tier: 'rare', category: 'Smart Picks', description: 'Back the underdog to win (per the model) and be right.' },
  { id: 'kingslayer', name: 'Kingslayer', emoji: '🪓', tier: 'epic', category: 'Smart Picks', description: 'Back a winning underdog on 5 matches (total).' },
  { id: 'galaxy_brain', name: 'Galaxy Brain', emoji: '🧠', tier: 'epic', category: 'Smart Picks', description: "Get the result right where the model's top score got it wrong." },
  { id: 'the_analyst', name: 'The Analyst', emoji: '📊', tier: 'rare', category: 'Smart Picks', description: "Match the model's top score exactly and be right." },
  { id: 'banana_skin', name: 'Banana Skin', emoji: '🍌', tier: 'rare', category: 'Smart Picks', description: 'Correctly call a draw the model thought was lopsided.' },
  { id: 'miracle_on_grass', name: 'Miracle on Grass', emoji: '🎇', tier: 'epic', category: 'Smart Picks', description: 'Back a winner the model gave under 20%.' },
  { id: 'against_all_odds', name: 'Against All Odds', emoji: '🃏', tier: 'epic', category: 'Smart Picks', description: 'Get the exact score on a match the underdog wins.' },
  { id: 'party_pooper', name: 'Party Pooper', emoji: '🌧️', tier: 'epic', category: 'Smart Picks', description: "Get the exact score where the model's big favorite (>70%) fails to win." },
  { id: 'marksman', name: 'Marksman', emoji: '🎯', tier: 'rare', category: 'Smart Picks', description: 'Get the result right on 20 matches (total).' },
  { id: 'deadeye', name: 'Deadeye', emoji: '🦅', tier: 'epic', category: 'Smart Picks', description: 'Get the result right on 40 matches (total).' },
  { id: 'stalemate', name: 'Stalemate', emoji: '🤝', tier: 'rare', category: 'Smart Picks', description: 'Correctly call 3 draws (total).' },

  // --- Bold calls ----------------------------------------------------------
  { id: 'ambitious', name: 'Ambitious', emoji: '🎲', tier: 'common', category: 'Bold Picks', description: 'Make a pick where you back a team to score 6 or more.' },
  { id: 'high_roller', name: 'High Roller', emoji: '🎢', tier: 'epic', category: 'Bold Picks', description: 'Back a team to score 6+ and get the result right.' },
  { id: 'down_to_the_wire', name: 'Down to the Wire', emoji: '🕙', tier: 'common', category: 'Bold Picks', description: 'Make a pick in the final 2 minutes before it locks.' },

  // --- Points milestones ---------------------------------------------------
  { id: 'quarter_century', name: 'Quarter Century', emoji: '🪙', tier: 'common', category: 'Points', description: 'Reach 25 total points.' },
  { id: 'half_century', name: 'Half Century', emoji: '🥈', tier: 'rare', category: 'Points', description: 'Reach 50 total points.' },
  { id: 'three_quarter_century', name: 'Three-Quarter Century', emoji: '💎', tier: 'epic', category: 'Points', description: 'Reach 75 total points.' },
  { id: 'centurion', name: 'Centurion', emoji: '💯', tier: 'legendary', category: 'Points', description: 'Reach 100 total points.' },

  // --- Appearances ---------------------------------------------------------
  { id: 'squad_player', name: 'Squad Player', emoji: '🧢', tier: 'common', category: 'Participation', description: 'Make a pick on 25 matches.' },
  { id: 'veteran', name: 'Veteran', emoji: '🎖️', tier: 'rare', category: 'Participation', description: 'Make a pick on 50 matches.' },
  { id: 'club_legend', name: 'Club Legend', emoji: '🏟️', tier: 'epic', category: 'Participation', description: 'Make a pick on 75 matches.' },
  { id: 'icon', name: 'Icon', emoji: '🗿', tier: 'legendary', category: 'Participation', description: 'Make a pick on 100 matches.' },
  { id: 'ever_present', name: 'Ever-Present', emoji: '📆', tier: 'epic', category: 'Participation', description: 'Pick every match across 7 days in a row.' },
  { id: 'glued_to_the_screen', name: 'Glued to the Screen', emoji: '📺', tier: 'legendary', category: 'Participation', description: 'Pick every match across 14 days in a row.' },
  { id: 'marathon_day', name: 'Marathon Day', emoji: '🗓️', tier: 'rare', category: 'Participation', description: 'Pick every match on a day with 6+ matches.' },
  { id: 'globetrotter', name: 'Globetrotter', emoji: '🌎', tier: 'epic', category: 'Participation', description: 'Make a pick on a match in every host city.' },

  // --- Stages & knockouts --------------------------------------------------
  { id: 'knockout_king', name: 'Knockout King', emoji: '🥊', tier: 'epic', category: 'Tournament Stages', description: 'Get the result right on every knockout match you pick in one round.' },
  { id: 'bracket_buster', name: 'Bracket Buster', emoji: '🧨', tier: 'rare', category: 'Tournament Stages', description: 'Back a winning underdog in a knockout match.' },
  { id: 'el_hincha', name: 'El Hincha', emoji: '📣', tier: 'legendary', category: 'Tournament Stages', description: 'Make a pick on every match of the knockout stage.' },
  { id: 'the_perfect_group', name: 'The Perfect Group', emoji: '🟩', tier: 'epic', category: 'Tournament Stages', description: 'Get the result right on all 6 matches of one group.' },
  { id: 'called_the_final', name: 'Called the Final', emoji: '🏆', tier: 'legendary', category: 'Tournament Stages', description: 'Get the exact score of the Final.' },
  { id: 'crowned_it', name: 'Crowned It', emoji: '👑', tier: 'epic', category: 'Tournament Stages', description: 'Get the result of the Final right.' },
  { id: 'bronze_medal_match', name: 'Bronze Medal Match', emoji: '🥉', tier: 'epic', category: 'Tournament Stages', description: 'Get the exact score of the third-place match.' },
  { id: 'big_stage', name: 'Big Stage', emoji: '🎪', tier: 'rare', category: 'Tournament Stages', description: 'Get the result of a semi-final right.' },
  { id: 'dream_start', name: 'Dream Start', emoji: '💫', tier: 'rare', category: 'Tournament Stages', description: 'Get the result right on your first 3 knockout picks.' },

  // --- Rivalry (duels) -----------------------------------------------------
  { id: 'first_blood', name: 'First Blood', emoji: '⚔️', tier: 'common', category: 'Duels', description: 'Win a penalty shootout duel.' },
  { id: 'shootout_king', name: 'Shootout King', emoji: '🥅', tier: 'rare', category: 'Duels', description: 'Win 5 duels (total).' },
  { id: 'nemesis', name: 'Nemesis', emoji: '😈', tier: 'rare', category: 'Duels', description: 'Beat the same player in 3 duels.' },
  { id: 'clean_sheet', name: 'Clean Sheet', emoji: '🧤', tier: 'rare', category: 'Duels', description: 'Win a duel without letting in a goal.' },
  { id: 'sudden_death', name: 'Sudden Death', emoji: '☠️', tier: 'rare', category: 'Duels', description: 'Win a duel in sudden death (past 5 kicks each).' },
  { id: 'comeback_king', name: 'Comeback King', emoji: '🔄', tier: 'epic', category: 'Duels', description: 'Win a duel after being down by 2+.' },
  { id: 'unbeaten_run', name: 'Unbeaten Run', emoji: '🛡️', tier: 'legendary', category: 'Duels', description: 'Win 5 duels in a row.' },
  { id: 'on_a_roll', name: 'On a Roll', emoji: '🎳', tier: 'rare', category: 'Duels', description: 'Win 3 duels in a row.' },
  { id: 'five_for_five', name: 'Five for Five', emoji: '🖐️', tier: 'epic', category: 'Duels', description: 'Win a duel scoring all five of your kicks.' },
  { id: 'rivalry_sweep', name: 'Rivalry Sweep', emoji: '🧹', tier: 'legendary', category: 'Duels', description: 'Beat all three other players at least once.' },
  { id: 'apex_predator', name: 'Apex Predator', emoji: '🐅', tier: 'legendary', category: 'Duels', description: 'Beat each of the other three players at least twice.' },
  { id: 'duelist', name: 'Duelist', emoji: '🤺', tier: 'rare', category: 'Duels', description: 'Play 10 duels (win or lose).' },
  { id: 'marathon_man', name: 'Marathon Man', emoji: '🏃', tier: 'epic', category: 'Duels', description: 'Win a duel that goes 14+ kicks.' },
  { id: 'the_wall', name: 'The Wall', emoji: '🧱', tier: 'rare', category: 'Duels', description: 'Win a duel on a save — the deciding kick is stopped.' },
  { id: 'double_trouble', name: 'Double Trouble', emoji: '⚡', tier: 'rare', category: 'Duels', description: 'Win 2 duels in the same day.' },
  { id: 'sudden_death_specialist', name: 'Sudden Death Specialist', emoji: '🪦', tier: 'rare', category: 'Duels', description: 'Win 2 duels in sudden death.' },

  // --- Placement (one-time, at tournament end) -----------------------------
  { id: 'champion', name: 'Champion', emoji: '🥇', tier: 'legendary', category: 'Final Standings', description: 'Finish the tournament in 1st place.' },
  { id: 'runner_up', name: 'Runner-up', emoji: '🥈', tier: 'epic', category: 'Final Standings', description: 'Finish the tournament in 2nd place.' },
  { id: 'podium_finish', name: 'Podium Finish', emoji: '🥉', tier: 'rare', category: 'Final Standings', description: 'Finish the tournament in 3rd place.' },
  { id: 'better_luck_next_time', name: 'Better Luck Next Time! (In 4 Years)', emoji: '🥄', tier: 'common', category: 'Final Standings', description: 'Finish the tournament in 4th — dead last.' },

  // --- Platinum (the lot) --------------------------------------------------
  { id: 'platinum', name: 'Ultimate Baller', emoji: '💎', tier: 'platinum', category: 'Platinum', description: 'Earn every other badge in the game. Final Standings (your finishing place) do not count.' },
];

export const ACHIEVEMENTS_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a])
);

export const TIER_ORDER: Record<Tier, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  platinum: 4,
};

export const TIER_LABEL: Record<Tier, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  platinum: 'Platinum',
};

export const PLATINUM_ID = 'platinum';

/** Every badge you must hold to earn Platinum — all of them except the
 *  mutually-exclusive Final Standings and Platinum itself (72 badges). */
export const PLATINUM_REQUIRED_IDS: string[] = ACHIEVEMENTS.filter(
  (a) => a.category !== 'Platinum' && a.category !== 'Final Standings'
).map((a) => a.id);

export const CATEGORY_ORDER: Category[] = [
  'Exact Scores',
  'Streaks',
  'Smart Picks',
  'Bold Picks',
  'Points',
  'Participation',
  'Tournament Stages',
  'Duels',
  'Final Standings',
  'Platinum',
];
