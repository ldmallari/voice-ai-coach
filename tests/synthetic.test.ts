import { describe, expect, it } from 'vitest';
import { DATASET_SIZE, generateCustomers } from '@/lib/synthetic';
import { conversionRate, treatmentPerformance } from '@/lib/metrics';

describe('generateCustomers', () => {
  it('meets the 50+ record requirement', () => {
    expect(generateCustomers().length).toBeGreaterThanOrEqual(50);
    expect(generateCustomers()).toHaveLength(DATASET_SIZE);
  });

  it('is deterministic, so tests and CI see identical numbers', () => {
    expect(generateCustomers()).toEqual(generateCustomers());
    expect(conversionRate(generateCustomers())).toBe(
      conversionRate(generateCustomers()),
    );
  });

  it('produces distinct ids', () => {
    const records = generateCustomers();
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
  });

  it('never records spend against a non-purchase', () => {
    for (const record of generateCustomers()) {
      if (record.status !== 'purchased') expect(record.amountSpent).toBe(0);
    }
  });

  it('never rebooks a customer who did not purchase', () => {
    for (const record of generateCustomers()) {
      if (record.status !== 'purchased') expect(record.rebooked).toBe(false);
    }
  });

  it('contains a genuinely underperforming treatment for the coach to find', () => {
    const worst = treatmentPerformance(generateCustomers())[0];
    expect(worst.conversionRate).toBeLessThan(0.5);
  });
});
