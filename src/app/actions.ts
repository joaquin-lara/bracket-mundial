'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface PredictionResult {
  ok: boolean;
  error?: string;
}

export async function submitPrediction(
  matchId: number,
  predHome: number,
  predAway: number
): Promise<PredictionResult> {
  if (
    !Number.isInteger(matchId) ||
    !Number.isInteger(predHome) ||
    !Number.isInteger(predAway) ||
    predHome < 0 ||
    predHome > 20 ||
    predAway < 0 ||
    predAway > 20
  ) {
    return { ok: false, error: 'Scores must be whole numbers between 0 and 20.' };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // No predictions on placeholder fixtures (knockout slots without teams).
  const { data: matchRow } = await supabase
    .from('matches')
    .select('home_team, away_team')
    .eq('id', matchId)
    .maybeSingle();
  if (!matchRow) return { ok: false, error: 'Unknown match.' };
  if (matchRow.home_team === 'TBD' || matchRow.away_team === 'TBD') {
    return { ok: false, error: 'Teams for this match are not decided yet.' };
  }

  // Column-level grants prevent clients from upserting whole rows, so do a
  // select-then-insert-or-update. The 10-minute lock is enforced by the
  // database RLS policies either way; this code just reports the outcome.
  const { data: existing, error: selectError } = await supabase
    .from('predictions')
    .select('id')
    .eq('user_id', user.id)
    .eq('match_id', matchId)
    .maybeSingle();
  if (selectError) return { ok: false, error: selectError.message };

  let error;
  if (existing) {
    ({ error } = await supabase
      .from('predictions')
      .update({ pred_home: predHome, pred_away: predAway })
      .eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('predictions').insert({
      user_id: user.id,
      match_id: matchId,
      pred_home: predHome,
      pred_away: predAway,
    }));
  }

  if (error) {
    const locked =
      error.message.includes('row-level security') || error.code === '42501';
    return {
      ok: false,
      error: locked
        ? 'Predictions are locked for this match (under 10 minutes to kickoff).'
        : error.message,
    };
  }

  revalidatePath('/today');
  revalidatePath('/matches');
  return { ok: true };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
