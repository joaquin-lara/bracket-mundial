import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminRequests, { type PendingRequest } from '@/components/AdminRequests';
import { isAdminEmail } from '@/lib/players';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Admins only.
  if (!user || !isAdminEmail(user.email)) redirect('/');

  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, flag_code, color, created_at, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const requests: PendingRequest[] = (data ?? []).map((p) => ({
    id: p.id as string,
    display_name: p.display_name as string,
    flag_code: (p.flag_code as string | null) ?? null,
    color: (p.color as string | null) ?? null,
    created_at: p.created_at as string,
  }));

  return (
    <main>
      <h1>Sign-up approvals</h1>
      <p className="subtitle">
        New players who want to join. Approving anyone lets them fill out a bracket.{' '}
        <Link href="/" className="link-btn">Back home</Link>
      </p>
      <AdminRequests requests={requests} />
    </main>
  );
}
