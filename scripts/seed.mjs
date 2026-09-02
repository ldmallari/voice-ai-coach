/**
 * Seeds the deterministic synthetic clinic dataset.
 * Upserts, so re-running is safe and produces the same 60 rows.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { generateCustomers } from '../src/lib/synthetic.ts';

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
}

loadEnv();
const records = generateCustomers();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const r of records) {
    await client.query(
      `insert into customers
         (id, customer_name, treatment, provider, status, amount_spent,
          last_visit, rebooked, satisfaction)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set
         customer_name = excluded.customer_name,
         treatment     = excluded.treatment,
         provider      = excluded.provider,
         status        = excluded.status,
         amount_spent  = excluded.amount_spent,
         last_visit    = excluded.last_visit,
         rebooked      = excluded.rebooked,
         satisfaction  = excluded.satisfaction`,
      [r.id, r.customerName, r.treatment, r.provider, r.status,
       r.amountSpent, r.lastVisit, r.rebooked, r.satisfaction],
    );
  }
  const { rows } = await client.query('select count(*)::int as n from customers');
  console.log(`Seeded. customers rows = ${rows[0].n}`);
} finally {
  await client.end();
}
