'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { COUNTRY_OPTIONS, flagUrl } from '@/lib/flags';
import {
  GUEST_EMAIL,
  GUEST_NAME,
  GUEST_PASSWORD,
  PLAYER_META,
  PLAYERS,
  colorForName,
  isValidSignupName,
  pinPassword,
  playerEmail,
  type Player,
} from '@/lib/players';
import { createClient } from '@/lib/supabase/client';

type Mode = 'select' | 'pin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('select');
  const [player, setPlayer] = useState<Player | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Sign-up form fields
  const [name, setName] = useState('');
  const [signupPin, setSignupPin] = useState('');
  const [flagCode, setFlagCode] = useState('');

  function goHome() {
    setLeaving(true);
    setTimeout(() => {
      router.push('/');
      router.refresh();
    }, 550);
  }

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

    goHome();
  }

  async function signUpNewUser(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = name.trim();
    if (!isValidSignupName(cleanName)) {
      setError('Pick a name (2–14 letters/numbers) that isn’t already taken.');
      return;
    }
    if (!/^\d{4}$/.test(signupPin)) {
      setError('Choose a 4-digit PIN.');
      return;
    }
    if (!flagCode) {
      setError('Pick a country flag.');
      return;
    }
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const email = playerEmail(cleanName);
    const password = pinPassword(cleanName, signupPin);
    const color = colorForName(cleanName);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: cleanName, flag_code: flagCode, color } },
    });

    if (signUpError || !data.session) {
      const taken = (signUpError?.message ?? '').toLowerCase().includes('already');
      setError(taken ? 'That name is already taken. Try another.' : 'Could not sign up. Try again.');
      setBusy(false);
      return;
    }

    // Account created with status 'pending'. The home layout shows a
    // waiting-for-approval screen until an admin approves it.
    goHome();
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

    goHome();
  }

  function backToSelect() {
    setMode('select');
    setPlayer(null);
    setPin('');
    setName('');
    setSignupPin('');
    setFlagCode('');
    setError(null);
  }

  return (
    <main>
      <div className={`auth-card${leaving ? ' leaving' : ''}`}>
        <h1>
          Stonks World
          <br />
          Cup Bracket.
        </h1>

        {mode === 'select' && (
          <>
            <p className="subtitle">Which player are you?</p>
            <div className="player-grid">
              {PLAYERS.map((p) => (
                <button
                  key={p}
                  className="player-btn"
                  onClick={() => {
                    setPlayer(p);
                    setMode('pin');
                    setError(null);
                  }}
                >
                  <span className="player-avatar" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={flagUrl(PLAYER_META[p].flagCode)!} alt={p} className="contender-flag" />
                  </span>
                  {p}
                </button>
              ))}
            </div>

            <button className="signup-btn" onClick={() => { setMode('signup'); setError(null); }}>
              + New User - Sign Up
            </button>

            <div className="guest-divider">
              <span>or</span>
            </div>
            <button className="guest-btn" onClick={continueAsGuest} disabled={busy}>
              {busy ? 'Entering…' : 'Browse as guest'}
            </button>
            <p className="hint">Just looking? Guests can view everything but can&apos;t fill out a bracket.</p>
          </>
        )}

        {mode === 'pin' && player && (
          <form onSubmit={submit}>
            <p className="subtitle">
              Hi {player}.{' '}
              <button type="button" className="link-btn" onClick={backToSelect}>
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

        {mode === 'signup' && (
          <form onSubmit={signUpNewUser}>
            <p className="subtitle">
              New player.{' '}
              <button type="button" className="link-btn" onClick={backToSelect}>
                Back
              </button>
            </p>

            <label htmlFor="su-name">Display name</label>
            <input
              id="su-name"
              className="text-input"
              type="text"
              autoFocus
              maxLength={14}
              placeholder="e.g. Diego"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label htmlFor="su-flag">Your flag</label>
            <div className="flag-select-row">
              <span className="player-avatar" style={{ background: 'rgba(0,0,0,0.5)' }}>
                {flagCode ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flagUrl(flagCode)!} alt="" className="contender-flag" />
                ) : (
                  <span className="flag-placeholder">🏳️</span>
                )}
              </span>
              <select
                id="su-flag"
                className="flag-select"
                value={flagCode}
                onChange={(e) => setFlagCode(e.target.value)}
              >
                <option value="">Pick a country…</option>
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <label htmlFor="su-pin">Choose a 4-digit PIN</label>
            <input
              id="su-pin"
              className="pin-input"
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={signupPin}
              onChange={(e) => setSignupPin(e.target.value.replace(/\D/g, ''))}
            />

            <p className="hint">An admin (Carlos, Joaquin, Mauri or Sebas) has to approve you before you can fill out a bracket.</p>
            {error && <p className="msg-err">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Request to join'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
