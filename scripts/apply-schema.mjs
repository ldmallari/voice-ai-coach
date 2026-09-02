/**
 * Applies supabase/schema.sql to the database in DATABASE_URL.
 * Idempotent: the schema uses `if not exists` and `create or replace` throughout.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

function loadEnv() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
}

loadEnv();
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  console.log('Schema applied.');
} finally {
  await client.end();
}
