import pg from 'pg';

export const schemaVersion = '004a';

export function databaseOptions(value, production = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid DATABASE_URL.'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with a database name.');
  }
  const sslmode = url.searchParams.get('sslmode');
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  for (const key of url.searchParams.keys()) {
    if (!['sslmode','application_name'].includes(key)) throw new Error('Unsupported PostgreSQL URL parameter.');
  }
  if (sslmode && !['require','verify-ca','verify-full','disable'].includes(sslmode)) throw new Error('Unsupported PostgreSQL TLS mode.');
  if (sslmode === 'disable' && (production || !loopback)) throw new Error('PostgreSQL TLS is required.');
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.href,
    ssl: production || !loopback || (sslmode && sslmode !== 'disable') ? {rejectUnauthorized:true} : false,
    max:4, connectionTimeoutMillis:5000, query_timeout:6000, statement_timeout:5500
  };
}

export function createPool(value, production) {
  const pool = new pg.Pool(databaseOptions(value,production));
  pool.on('error', error => console.error('PostgreSQL idle connection:', error.code || error.name));
  return pool;
}

export async function databaseHealth(db) {
  if (!db) return {status:'not_configured'};
  try {
    const table = await db.query("SELECT to_regclass('control_schema_migrations') AS migrations");
    if (!table.rows[0].migrations) return {status:'migration_required'};
    const version = await db.query('SELECT 1 FROM control_schema_migrations WHERE version=$1',[schemaVersion]);
    return {status:version.rowCount ? 'healthy' : 'migration_required'};
  } catch {
    return {status:'unavailable'};
  }
}
