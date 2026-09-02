import type { ConsultationStatus, CustomerRecord } from './types';

/**
 * Deterministic synthetic clinic dataset.
 *
 * Seeded so every run, test and CI job sees identical numbers. The distribution is
 * deliberately uneven: CoolSculpting under-converts and one provider lags, so the
 * coach has something real to find rather than uniform noise.
 */

/** Small seeded PRNG (mulberry32) so the dataset is reproducible without a dependency. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Aroha', 'Mei', 'Sophie', 'Ana', 'Priya', 'Ella', 'Hana', 'Chloe', 'Ruby', 'Ivy',
  'Talia', 'Nina', 'Grace', 'Leilani', 'Zara', 'Maia', 'Olivia', 'Fern', 'Kiri', 'Amber',
];
const LAST_NAMES = [
  'Whittaker', 'Tanaka', 'Ngata', 'Silva', 'Patel', 'Brown', 'Kimura', 'Lefevre',
  'Harding', 'Okafor', 'Rossi', 'Chen', 'Murphy', 'Fisher', 'Novak',
];
const PROVIDERS = ['Dr. Reyes', 'Nurse Adeline', 'Nurse Kahu', 'Dr. Lindqvist'];

/** Per-treatment behaviour. Conversion and rebooking differ so trends exist to find. */
const TREATMENTS = [
  { name: 'Botox', price: 480, conversion: 0.78, rebooking: 0.72 },
  { name: 'Dermal Fillers', price: 890, conversion: 0.66, rebooking: 0.58 },
  { name: 'Laser Hair Removal', price: 320, conversion: 0.71, rebooking: 0.65 },
  { name: 'CoolSculpting', price: 1650, conversion: 0.34, rebooking: 0.31 },
  { name: 'Skin Peel', price: 240, conversion: 0.74, rebooking: 0.44 },
  { name: 'Microneedling', price: 390, conversion: 0.69, rebooking: 0.52 },
];

/** Providers who convert below the clinic average, so coaching has a target. */
const WEAK_PROVIDERS = new Set(['Nurse Kahu']);

export const DATASET_SIZE = 60;

/** Anchor date so `lastVisit` spreads are stable across runs. */
export const DATASET_ANCHOR = new Date('2026-09-01T00:00:00Z');

export function generateCustomers(
  count: number = DATASET_SIZE,
  seed = 20260902,
): CustomerRecord[] {
  const rand = mulberry32(seed);
  const records: CustomerRecord[] = [];

  for (let i = 0; i < count; i += 1) {
    const treatment = TREATMENTS[Math.floor(rand() * TREATMENTS.length)];
    const provider = PROVIDERS[Math.floor(rand() * PROVIDERS.length)];

    // Weak providers convert materially worse on the same treatments.
    const conversionChance = WEAK_PROVIDERS.has(provider)
      ? treatment.conversion * 0.62
      : treatment.conversion;

    const roll = rand();
    let status: ConsultationStatus;
    if (roll < conversionChance) status = 'purchased';
    else if (roll < conversionChance + 0.18) status = 'declined';
    else status = 'consultation_only';

    // Purchases vary +/-20% around list price to mimic package pricing.
    const amountSpent =
      status === 'purchased'
        ? Math.round(treatment.price * (0.8 + rand() * 0.4))
        : 0;

    const rebooked = status === 'purchased' && rand() < treatment.rebooking;

    // Visits spread across the last 180 days.
    const daysAgo = Math.floor(rand() * 180);
    const visit = new Date(DATASET_ANCHOR.getTime() - daysAgo * 86_400_000);

    // Most customers rate; a fifth leave nothing. Purchasers skew happier.
    const satisfaction =
      rand() < 0.2
        ? null
        : status === 'purchased'
          ? 4 + Math.round(rand())
          : 2 + Math.round(rand() * 2);

    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];

    records.push({
      id: `cust_${String(i + 1).padStart(3, '0')}`,
      customerName: `${first} ${last}`,
      treatment: treatment.name,
      provider,
      status,
      amountSpent,
      lastVisit: visit.toISOString().slice(0, 10),
      rebooked,
      satisfaction,
    });
  }

  return records;
}
