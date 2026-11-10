import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseHealth, databaseOptions, schemaVersion } from '../api/database.mjs';

test('remote connections verify TLS and cannot override host or certificate validation', () => {
  const options = databaseOptions('postgresql://example.invalid/app?sslmode=require',true);
  assert.equal(options.ssl.rejectUnauthorized,true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
  assert.throws(()=>databaseOptions('postgres://example.invalid/app?sslmode=disable'));
  assert.throws(()=>databaseOptions('postgres://localhost/app?host=example.invalid'));
  assert.throws(()=>databaseOptions('postgres://example.invalid/app?ssl=0'));
  assert.throws(()=>databaseOptions('postgres://localhost/app?sslmode=disable',true));
  assert.equal(databaseOptions('postgres://localhost/app?sslmode=disable').ssl,false);
});

test('readiness reports missing configuration, missing schema and connection failure separately', async () => {
  assert.deepEqual(await databaseHealth(null),{status:'not_configured'});
  assert.deepEqual(await databaseHealth({query:async()=>({rows:[{migrations:null}]})}),{status:'migration_required'});
  assert.deepEqual(await databaseHealth({query:async()=>{throw Error('fixture secret');}}),{status:'unavailable'});
  const fixture = {query:async(sql,params)=>{
    if (!params) return {rows:[{migrations:'control_schema_migrations'}]};
    assert.deepEqual(params,[schemaVersion]);
    return {rowCount:1};
  }};
  assert.deepEqual(await databaseHealth(fixture),{status:'healthy'});
});
