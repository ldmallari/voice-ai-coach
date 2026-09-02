import { describe, expect, it } from 'vitest';
import {
  averageSatisfaction,
  averageSpend,
  conversionRate,
  groupBy,
  lapsedCustomers,
  providerPerformance,
  rebookingRate,
  retentionRate,
  totalRevenue,
  treatmentPerformance,
} from '@/lib/metrics';
import type { CustomerRecord } from '@/lib/types';

/** Builds a record with sensible defaults so each test states only what it cares about. */
function record(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: 'cust_001',
    customerName: 'Test Customer',
    treatment: 'Botox',
    provider: 'Dr. Reyes',
    status: 'purchased',
    amountSpent: 500,
    lastVisit: '2026-08-01',
    rebooked: true,
    satisfaction: 5,
    ...overrides,
  };
}

describe('conversionRate', () => {
  it('is the share of consultations that purchased', () => {
    const records = [
      record({ status: 'purchased' }),
      record({ status: 'purchased' }),
      record({ status: 'declined', amountSpent: 0 }),
      record({ status: 'consultation_only', amountSpent: 0 }),
    ];
    expect(conversionRate(records)).toBe(0.5);
  });

  it('returns 0 for an empty set rather than NaN', () => {
    expect(conversionRate([])).toBe(0);
  });

  it('counts declines and consultation-only alike as non-conversions', () => {
    expect(conversionRate([record({ status: 'declined', amountSpent: 0 })])).toBe(0);
    expect(
      conversionRate([record({ status: 'consultation_only', amountSpent: 0 })]),
    ).toBe(0);
  });
});

describe('rebookingRate', () => {
  it('uses purchases as the denominator, not all consultations', () => {
    const records = [
      record({ status: 'purchased', rebooked: true }),
      record({ status: 'purchased', rebooked: false }),
      // Declines must not dilute the rate.
      record({ status: 'declined', amountSpent: 0, rebooked: false }),
      record({ status: 'declined', amountSpent: 0, rebooked: false }),
    ];
    expect(rebookingRate(records)).toBe(0.5);
  });

  it('returns 0 when nobody purchased', () => {
    expect(rebookingRate([record({ status: 'declined', amountSpent: 0 })])).toBe(0);
  });
});

describe('averageSpend', () => {
  it('averages over purchasers only', () => {
    const records = [
      record({ amountSpent: 400 }),
      record({ amountSpent: 600 }),
      record({ status: 'declined', amountSpent: 0 }),
    ];
    expect(averageSpend(records)).toBe(500);
  });

  it('returns 0 when there are no purchases', () => {
    expect(averageSpend([])).toBe(0);
  });
});

describe('totalRevenue', () => {
  it('sums every amount including zeroes', () => {
    const records = [
      record({ amountSpent: 480 }),
      record({ amountSpent: 890 }),
      record({ status: 'declined', amountSpent: 0 }),
    ];
    expect(totalRevenue(records)).toBe(1370);
  });
});

describe('averageSatisfaction', () => {
  it('ignores customers who left no rating', () => {
    const records = [
      record({ satisfaction: 5 }),
      record({ satisfaction: 3 }),
      record({ satisfaction: null }),
    ];
    expect(averageSatisfaction(records)).toBe(4);
  });

  it('is null when nobody rated, so callers can say so instead of showing 0', () => {
    expect(averageSatisfaction([record({ satisfaction: null })])).toBeNull();
  });
});

describe('lapsedCustomers and retentionRate', () => {
  const asOf = new Date('2026-09-01T00:00:00Z');

  it('treats a visit older than the window as lapsed', () => {
    const records = [
      record({ id: 'recent', lastVisit: '2026-08-20' }),
      record({ id: 'old', lastVisit: '2026-01-15' }),
    ];
    const lapsed = lapsedCustomers(records, 90, asOf);
    expect(lapsed.map((r) => r.id)).toEqual(['old']);
    expect(retentionRate(records, 90, asOf)).toBe(0.5);
  });

  it('counts a visit exactly on the boundary as still active', () => {
    // 90 days before the anchor date.
    const records = [record({ lastVisit: '2026-06-03' })];
    expect(lapsedCustomers(records, 90, asOf)).toHaveLength(0);
  });
});

describe('groupBy', () => {
  it('buckets records by the given field', () => {
    const records = [
      record({ treatment: 'Botox' }),
      record({ treatment: 'Botox' }),
      record({ treatment: 'Skin Peel' }),
    ];
    const groups = groupBy(records, 'treatment');
    expect(groups.get('Botox')).toHaveLength(2);
    expect(groups.get('Skin Peel')).toHaveLength(1);
  });
});

describe('treatmentPerformance', () => {
  it('sorts worst-converting first so the weakest area surfaces', () => {
    const records = [
      record({ treatment: 'Botox', status: 'purchased' }),
      record({ treatment: 'Botox', status: 'purchased' }),
      record({ treatment: 'CoolSculpting', status: 'declined', amountSpent: 0 }),
      record({ treatment: 'CoolSculpting', status: 'purchased' }),
    ];
    const performance = treatmentPerformance(records);
    expect(performance[0].treatment).toBe('CoolSculpting');
    expect(performance[0].conversionRate).toBe(0.5);
    expect(performance[1].treatment).toBe('Botox');
    expect(performance[1].conversionRate).toBe(1);
  });
});

describe('providerPerformance', () => {
  it('reports per-provider conversion, weakest first', () => {
    const records = [
      record({ provider: 'Dr. Reyes', status: 'purchased' }),
      record({ provider: 'Nurse Kahu', status: 'declined', amountSpent: 0 }),
    ];
    const performance = providerPerformance(records);
    expect(performance[0].treatment).toBe('Nurse Kahu');
    expect(performance[0].conversionRate).toBe(0);
  });
});
