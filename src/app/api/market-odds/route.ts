import { NextResponse } from 'next/server';
import { getMarketOdds } from '@/lib/polymarket';

export const dynamic = 'force-dynamic';

// Polled by every open predictor-page tab every 20s. Cheap regardless of how
// many tabs are open: getMarketOdds() only re-hits Polymarket once per
// 20s window server-wide (see src/lib/polymarket.ts).
export async function GET() {
  try {
    const odds = await getMarketOdds();
    return NextResponse.json({ odds: Object.fromEntries(odds) });
  } catch (err) {
    return NextResponse.json(
      { odds: {}, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
