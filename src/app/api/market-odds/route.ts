import { NextResponse, type NextRequest } from 'next/server';
import { getMarketOdds } from '@/lib/polymarket';
import { checkRateLimit, clientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Polled by every open predictor-page tab every 20s. Cheap regardless of how
// many tabs are open: getMarketOdds() only re-hits Polymarket once per
// 20s window server-wide (see src/lib/polymarket.ts).
export async function GET(req: NextRequest) {
  // Rate limit: 60 per minute per IP (one per second ceiling for polling tabs)
  const ip = clientIp(req);
  if (!checkRateLimit(`market-odds:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ odds: {}, error: 'Too many requests' }, { status: 429 });
  }

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
