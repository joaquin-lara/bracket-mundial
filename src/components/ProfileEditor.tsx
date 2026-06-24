'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRY_OPTIONS, flagUrl } from '@/lib/flags';
import { deleteMyAccount, updateProfile } from '@/app/actions';

export default function ProfileEditor({
  initialName,
  initialFlag,
}: {
  initialName: string;
  initialFlag: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [flagCode, setFlagCode] = useState(initialFlag);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const dirty = name.trim() !== initialName || flagCode !== initialFlag;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    const res = await updateProfile(name, flagCode);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save.');
      return;
    }
    setMsg('Saved.');
    router.refresh();
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    const res = await deleteMyAccount();
    // On success the server redirects to /login, so we only land here on error.
    if (res && !res.ok) {
      setError(res.error ?? 'Could not delete account.');
      setDeleting(false);
    }
  }

  return (
    <div className="profile-editor">
      <form onSubmit={save}>
        <label htmlFor="pf-name">Display name</label>
        <input
          id="pf-name"
          className="text-input"
          type="text"
          maxLength={14}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label htmlFor="pf-flag">Your flag</label>
        <div className="flag-select-row">
          <span className="player-avatar" style={{ background: 'rgba(0,0,0,0.5)' }}>
            {flagCode && flagUrl(flagCode) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={flagUrl(flagCode)!} alt="" className="contender-flag" />
            ) : (
              <span className="flag-placeholder">🏳️</span>
            )}
          </span>
          <select
            id="pf-flag"
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

        {error && <p className="msg-err">{error}</p>}
        {msg && <p className="msg-ok">{msg}</p>}
        <button type="submit" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="danger-zone">
        <h2>Delete account</h2>
        <p className="hint">
          This permanently removes your account, your picks, duels and badges. It can&apos;t be
          undone.
        </p>
        {!confirming ? (
          <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        ) : (
          <>
            <label htmlFor="pf-confirm">Type DELETE to confirm</label>
            <input
              id="pf-confirm"
              className="text-input"
              type="text"
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            <div className="danger-actions">
              <button
                type="button"
                className="btn-danger"
                disabled={deleting || confirmText !== 'DELETE'}
                onClick={remove}
              >
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => { setConfirming(false); setConfirmText(''); }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
