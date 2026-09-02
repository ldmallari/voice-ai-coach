import { NextResponse } from 'next/server';
import { loadRecords } from '@/lib/records';
import { conversionRate, rebookingRate, retentionRate, totalRevenue } from '@/lib/metrics';

/**
 * Aggregate clinic KPIs for the dashboard header.
 *
 * Deliberately non-identifying — only clinic-wide rates and totals, no customer
 * rows — so it can be read by the client without the tool-endpoint secret.
 */
export async function GET() {
  try {
    const records = await loadRecords();
    return NextResponse.json({
      consultations: records.length,
      conversion: conversionRate(records),
      rebooking: rebookingRate(records),
      revenue: totalRevenue(records),
      retention90: retentionRate(records, 90),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[overview] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
