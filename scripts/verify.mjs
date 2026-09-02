/** Post-deploy sanity check: schema shape, seeded data, and the vector RPC. */
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

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const q = async (label, sql) => {
  const { rows } = await client.query(sql);
  console.log(label, JSON.stringify(rows[0] ?? rows));
};

try {
  await q('tables        ', `select string_agg(table_name, ', ' order by table_name) as t
                             from information_schema.tables
                             where table_schema = 'public'`);
  await q('pgvector      ', `select extversion as v from pg_extension where extname = 'vector'`);
  await q('customers     ', 'select count(*)::int as rows from customers');
  await q('conversion    ', `select round(avg((status='purchased')::int)::numeric, 4) as rate from customers`);
  await q('worst treat.  ', `select treatment,
                                    round(avg((status='purchased')::int)::numeric,3) as conv,
                                    count(*)::int as n
                             from customers group by treatment order by conv limit 1`);
  await q('worst provider', `select provider,
                                    round(avg((status='purchased')::int)::numeric,3) as conv
                             from customers group by provider order by conv limit 1`);
  await q('embed dims    ', `select a.atttypmod as dims from pg_attribute a
                             join pg_class c on c.oid = a.attrelid
                             where c.relname='documents' and a.attname='embedding'`);
  await q('match_documents', `select count(*)::int as exists from pg_proc where proname='match_documents'`);
  await q('constraints   ', `select string_agg(conname, ', ') as c from pg_constraint
                             where conrelid = 'customers'::regclass and contype = 'c'`);
} finally {
  await client.end();
}
