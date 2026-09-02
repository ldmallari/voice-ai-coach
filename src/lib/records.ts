import { isSupabaseConfigured, serverClient } from './supabase';
import { generateCustomers } from './synthetic';
import type { CustomerRecord } from './types';

/**
 * Loads clinic records.
 *
 * Falls back to the seeded synthetic dataset when Supabase isn't configured, so the
 * app and its tests stay runnable without infrastructure. The fallback is logged
 * rather than silent, because quietly serving demo data would be worse than failing.
 */
export async function loadRecords(): Promise<CustomerRecord[]> {
  if (!isSupabaseConfigured()) {
    console.warn('[records] Supabase not configured; using synthetic dataset.');
    return generateCustomers();
  }

  const { data, error } = await serverClient()
    .from('customers')
    .select('id, customer_name, treatment, provider, status, amount_spent, last_visit, rebooked, satisfaction');

  if (error) throw new Error(`Failed to load customers: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    customerName: row.customer_name as string,
    treatment: row.treatment as string,
    provider: row.provider as string,
    status: row.status as CustomerRecord['status'],
    amountSpent: Number(row.amount_spent),
    lastVisit: row.last_visit as string,
    rebooked: row.rebooked as boolean,
    satisfaction: row.satisfaction === null ? null : Number(row.satisfaction),
  }));
}
