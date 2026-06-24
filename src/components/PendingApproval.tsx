import { signOut } from '@/app/actions';

/**
 * Shown to a signed-in player whose sign-up has not been approved yet (or was
 * rejected). Blocks the rest of the app until an admin acts.
 */
export default function PendingApproval({ rejected = false }: { rejected?: boolean }) {
  return (
    <main>
      <div className="auth-card">
        <h1>
          Stonks World
          <br />
          Cup Bracket.
        </h1>

        {rejected ? (
          <>
            <p className="subtitle">Request declined</p>
            <p className="hint">
              An admin declined your request to join. If you think that&apos;s a mistake, ask
              Carlos, Joaquin, Mauri or Sebas to add you.
            </p>
          </>
        ) : (
          <>
            <p className="subtitle">Waiting for approval ⏳</p>
            <p className="hint">
              Your request is in. One of the admins (Carlos, Joaquin, Mauri or Sebas) needs to
              approve you before you can fill out a bracket. Check back soon.
            </p>
          </>
        )}

        <form action={signOut}>
          <button type="submit" className="guest-btn">Sign out</button>
        </form>
      </div>
    </main>
  );
}
