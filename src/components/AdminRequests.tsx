'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { flagUrl } from '@/lib/flags';
import { decideSignup } from '@/app/actions';

export interface PendingRequest {
  id: string;
  display_name: string;
  flag_code: string | null;
  color: string | null;
  created_at: string;
}

export default function AdminRequests({ requests }: { requests: PendingRequest[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusyId(id);
    setError(null);
    const res = await decideSignup(id, decision);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error ?? 'Something went wrong.');
      return;
    }
    router.refresh();
  }

  if (requests.length === 0) {
    return <p className="empty">No pending requests. You&apos;re all caught up.</p>;
  }

  return (
    <div className="admin-list">
      {error && <p className="msg-err">{error}</p>}
      {requests.map((r) => (
        <div className="admin-row" key={r.id}>
          <span className="player-avatar" style={{ background: r.color ?? 'rgba(0,0,0,0.5)' }}>
            {r.flag_code && flagUrl(r.flag_code) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={flagUrl(r.flag_code)!} alt="" className="contender-flag" />
            ) : (
              <span>{r.display_name.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
          <span className="admin-name">{r.display_name}</span>
          <span className="admin-actions">
            <button
              className="btn-approve"
              disabled={busyId === r.id}
              onClick={() => decide(r.id, 'approved')}
            >
              {busyId === r.id ? '…' : 'Approve'}
            </button>
            <button
              className="btn-reject"
              disabled={busyId === r.id}
              onClick={() => decide(r.id, 'rejected')}
            >
              Reject
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
