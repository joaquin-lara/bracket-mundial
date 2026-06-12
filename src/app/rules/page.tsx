import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Rules' };
export const dynamic = 'force-dynamic';

export default function RulesPage() {
  return (
    <main>
      <h1>Rules</h1>
      <p className="subtitle">Short version: guess scores, don&apos;t be last.</p>

      <div className="rules-card">
        <h2>How to play</h2>
        <p>
          Go to <strong>Edit your bracket</strong> and enter the final score you think each game
          will end on, any match in the tournament, anytime. You can change your mind as often as
          you want until <strong>10 minutes before kickoff</strong>, then that match locks for
          good. Nobody can see your picks until the match starts; after kickoff everyone&apos;s
          picks are revealed. Follow results in <strong>Game schedule</strong> and the{' '}
          <strong>World Cup Bracket</strong>.
        </p>
      </div>

      <div className="rules-card">
        <h2>Points</h2>
        <p>
          <strong>3 points</strong> — exact score.
          <br />
          <strong>2 points</strong> — right outcome (winner or draw), wrong scoreline.
          <br />
          <strong>1 point</strong> — you locked a pick but got the outcome wrong.
          <br />
          <strong>0 points</strong> — you didn&apos;t pick. Don&apos;t be that guy.
        </p>
      </div>

      <div className="rules-card">
        <h2>Fine print</h2>
        <p>
          Knockout matches are judged on the score at the end of play, including extra time. A
          match decided on penalties counts as a draw. Scores and points update automatically
          every few minutes. Whoever has the most points after the Final wins. El que sale último
          es el más pendejo.
        </p>
      </div>
    </main>
  );
}
