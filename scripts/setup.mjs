import { readFile } from 'node:fs/promises';
import { createPool, databaseHealth, schemaVersion } from '../api/database.mjs';

const value = process.env.DATABASE_URL;
if (!value) {
  console.error('DATABASE_URL is required. Set it privately in .env or the server environment.');
  process.exitCode = 1;
} else {
  let pool;
  let client;
  try {
    pool = createPool(value,process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL));
    client = await pool.connect();
    const schema = await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
    const migration = await readFile(new URL('../db/migrations/004a.sql',import.meta.url),'utf8');
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(912802, 4)');
    await client.query(`CREATE TABLE IF NOT EXISTS control_schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query('SELECT 1 FROM control_schema_migrations WHERE version=$1',[schemaVersion]);
    if (!applied.rowCount) {
      await client.query(schema);
      await client.query(migration);
      await client.query('INSERT INTO control_schema_migrations(version) VALUES($1)',[schemaVersion]);
    }
    await client.query('COMMIT');
    const health = await databaseHealth(client);
    if (health.status !== 'healthy') throw new Error('Database health check failed.');
    console.log('PostgreSQL schema ready ('+schemaVersion+').');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Database setup failed ('+(error.code || error.name)+'). Verify the PostgreSQL URL, TLS and migration permissions.');
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool?.end();
  }
}
