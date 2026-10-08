import { execSync } from 'node:child_process';
import { Client } from 'pg';

/** Create the test database (if missing) and apply all migrations once per run. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/mohalla_test?schema=public');
  const dbName = url.pathname.slice(1);
  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  admin.search = '';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
}
