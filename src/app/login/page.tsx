'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { flagUrl } from '@/lib/flags';
import {
  GUEST_EMAIL,
  GUEST_NAME,
  GUEST_PASSWORD,
  PLAYER_META,
  PLAYERS,
  pinPassword,
  playerEmail,
  type Player,
} from '@/lib/players';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!player || !/^\d{4}$/.test(pin)) {
      setError('Enter your 4-digit PIN.');
      return;
    }
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const email = playerEmail(player);
    const password = pinPassword(player, pin);

    // Try logging in; if this player has never set a PIN, create the
    // account with this PIN (first PIN entered claims the slot).
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: player } },
      });
      if (signUpError || !data.session) {
        setError('Wrong PIN. Try again.');
        setPin('');
        setBusy(false);
        return;
      }
    }

    // Fade the card out fully before the home page (and its globe
    // entrance) takes over.
    setLeaving(true);
    setTimeout(() => {
      router.push('/');
      router.refresh();
    }, 550);
  }

  async function continueAsGuest() {
    setBusy(true);
    setError(null);

    const supabase = createClient();
    // Sign into the shared guest account, creating it the first time.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: GUEST_EMAIL,
      password: GUEST_PASSWORD,
    });
    if (signInError) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: GUEST_EMAIL,
        password: GUEST_PASSWORD,
        options: { data: { display_name: GUEST_NAME } },
      });
      if (signUpError || !data.session) {
        setError('Could not start a guest session. Try again.');
        setBusy(false);
        return;
      }
    }

    setLeaving(true);
    setTimeout(() => {
      router.push('/');
      router.refresh();
    }, 550);
  }

  return (
    <main>
      <div className={`auth-card${leaving ? ' leaving' : ''}`}>
        <h1>
          Stonks World
          <br />
          Cup Bracket.
        </h1>
        {!player ? (
          <>
            <p className="subtitle">Which player are you?</p>
            <div className="player-grid">
              {PLAYERS.map((p) => (
                <button key={p} className="player-btn" onClick={() => setPlayer(p)}>
                  <span className="player-avatar" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={flagUrl(PLAYER_META[p].flagCode)!} alt={p} className="contender-flag" />
                  </span>
                  {p}
                </button>
              ))}
            </div>

            <div className="guest-divider">
              <span>or</span>
            </div>
            <button className="guest-btn" onClick={continueAsGuest} disabled={busy}>
              {busy ? 'Entering…' : 'Browse as guest'}
            </button>
            <p className="hint">Just looking? Guests can view everything but can&apos;t fill out a bracket.</p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="subtitle">
              Hi {player}.{' '}
              <button type="button" className="link-btn" onClick={() => { setPlayer(null); setPin(''); setError(null); }}>
                Not you?
              </button>
            </p>
            <label htmlFor="pin">Your 4-digit PIN</label>
            <input
              id="pin"
              className="pin-input"
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
            <p className="hint">First time? Whatever PIN you enter now becomes yours.</p>
            {error && <p className="msg-err">{error}</p>}
            <button type="submit" disabled={busy || pin.length !== 4}>
              {busy ? 'Entering…' : 'Enter'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
