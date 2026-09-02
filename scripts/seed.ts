/**
 * Seeds the synthetic clinic dataset into Supabase.
 * Run once after applying supabase/schema.sql:  npm run seed
 */
import { generateCustomers } from '../src/lib/synthetic';
import { serverClient } from '../src/lib/supabase';

async function main() {
  const records = generateCustomers();
  const rows = records.map((record) => ({
    id: record.id,
    customer_name: record.customerName,
    treatment: record.treatment,
    provider: record.provider,
    status: record.status,
    amount_spent: record.amountSpent,
    last_visit: record.lastVisit,
    rebooked: record.rebooked,
    satisfaction: record.satisfaction,
  }));

  const { error } = await serverClient().from('customers').upsert(rows);
  if (error) throw new Error(error.message);

  console.log(`Seeded ${rows.length} customer records.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
