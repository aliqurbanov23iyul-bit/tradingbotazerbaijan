import { marketData } from './market.mjs';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createPool, databaseHealth } from './database.mjs';

const hashPassword = promisify(scrypt);

const env = process.env;
const production = Boolean(env.VERCEL || env.NODE_ENV === 'production');
const views = new Set(['dashboard','telegram','users','affiliate','signals','ai-analysis','market-data','analytics','logs','settings']);
const sessions = new Map();
const attempts = new Map();
const ttl = 3600000;
let pool;

async function database() {
  if (!env.DATABASE_URL) return null;
  pool ??= createPool(env.DATABASE_URL,production);
  return pool;
}

function same(a, b) {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}

function sign(id) {
  return createHmac('sha256', env.SESSION_SECRET).update(id + ':' + env.ADMIN_PASSWORD_HASH).digest('base64url');
}

function configured() {
  return env.SESSION_SECRET?.length >= 32 && env.ADMIN_USERNAME &&
    /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH || '') &&
    (!production || env.DATABASE_URL);
}

function cookie(value, age) {
  return 'qta_control=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (production ? '; Secure' : '');
}

async function session(req, db) {
  const token = String(req.headers.cookie || '').match(/(?:^|;\s*)qta_control=([^;]+)/)?.[1] || '';
  if (!configured() || !/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [id, sig] = token.split('.');
  if (!same(sig, sign(id))) return null;
  if (!db) return sessions.get(id) > Date.now() ? id : null;
  const found = await db.query('SELECT 1 FROM control_sessions WHERE id=$1 AND expires_at>now()', [id]);
  return found.rowCount ? id : null;
}

function reject(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function jsonBody(req) {
  if (String(req.headers['content-type']).split(';')[0].trim().toLowerCase() !== 'application/json') reject(415, 'JSON required.');
  if (Number(req.headers['content-length']) > 8192) reject(413, 'Request too large.');
  let value = req.body;
  if (value === undefined) {
    const chunks = [];
    let size = 0;
    for await (const part of req) {
      const chunk = Buffer.from(part);
      size += chunk.length;
      if (size > 8192) reject(413, 'Request too large.');
      chunks.push(chunk);
    }
    value = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    if (Buffer.byteLength(value)>8192) reject(413,'Request too large.');
    try { value = JSON.parse(value); } catch { reject(400, 'Invalid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(400, 'Invalid request.');
  return value;
}

async function rateLimit(req, db) {
  const bucket = String((env.VERCEL ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress) || 'unknown').split(',')[0];
  if (db) {
    const r = await db.query(`INSERT INTO control_attempts VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN control_attempts.until_at<now() THEN 1 ELSE least(control_attempts.attempts+1,1000) END,
      until_at=CASE WHEN control_attempts.until_at<now() THEN excluded.until_at ELSE control_attempts.until_at END RETURNING attempts`, [bucket]);
    return r.rows[0].attempts > 10;
  }
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const row = attempts.get(bucket) || { count: 0, until: now + 900000 };
  row.count++;
  attempts.set(bucket, row);
  return row.count > 10;
}

const listSize = 25;
const safe = (value, max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const empty = { rows: [], more: false };
const metrics = { users: 0, active: 0, signals: 0, cents: 0, pending: 0, verified: 0 };

function filters(url) {
  return {
    q: safe(url.searchParams.get('q'), 80),
    status: safe(url.searchParams.get('status'), 20),
    asset: safe(url.searchParams.get('asset'), 30),
    period: safe(url.searchParams.get('period'), 10),
    direction: safe(url.searchParams.get('direction'), 10),
    result: safe(url.searchParams.get('result'), 10),
    offset: Math.max(0, Math.min(10000, parseInt(url.searchParams.get('page'), 10) || 0)) * listSize
  };
}

function range(url) {
  const type = url.searchParams.get('range');
  const now = new Date();
  if (type === 'custom') {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const start = new Date(from + 'T00:00:00+04:00');
    const end = new Date(to + 'T00:00:00+04:00');
    if (![from,to].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value)) ||
        !Number.isFinite(+start) || !Number.isFinite(+end) || end < start || end - start > 366 * 86400000) reject(400, 'Select a valid range of up to 367 days.');
    return [start, new Date(+end + 86400000)];
  }
  if (type === 'today') {
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Baku' }).format(now);
    return [new Date(day + 'T00:00:00+04:00'), now];
  }
  return [new Date(+now - (type === '7' ? 7 : 30) * 86400000), now];
}

async function list(db, route, f) {
  if (!db) return empty;
  const queries = {
    users: [`SELECT * FROM registrations WHERE ($1='' OR telegram_id ILIKE '%'||$1||'%' OR username ILIKE '%'||$1||'%')
      AND ($2='' OR status=$2) ORDER BY created_at DESC,telegram_id LIMIT 26 OFFSET $3`, [f.q,f.status,f.offset]],
    signals: [`SELECT *,at+period*interval '1 minute' AS expiry FROM signals
      WHERE ($1='' OR asset ILIKE $1) AND ($2='' OR period::text=$2) AND ($3='' OR direction=$3) AND ($4='' OR outcome=$4)
      ORDER BY at DESC,id DESC LIMIT 26 OFFSET $5`, [f.asset,f.period,f.direction,f.result,f.offset]],
    logs: [`SELECT * FROM control_logs WHERE ($1='' OR concat_ws(' ',service,event,message,actor) ILIKE '%'||$1||'%')
      AND ($2='' OR severity=$2) ORDER BY at DESC,id DESC LIMIT 26 OFFSET $3`, [f.q,f.status,f.offset]]
  };
  const { rows } = await db.query(...queries[route]);
  return { rows: rows.slice(0,listSize), more: rows.length > listSize };
}

async function readData(db, route, url) {
  if (route === 'market-data') return marketData(db,url);
  const f = filters(url);
  if (['users','signals','logs'].includes(route)) return list(db,route,f);
  if (route === 'settings' || route === 'affiliate') {
    const stored = db ? (await db.query('SELECT key,value FROM control_settings')).rows : [];
    const config = Object.fromEntries(stored.map(row => [row.key,row.value]));
    if (route === 'settings') return { config, database: !!db, actor: env.ADMIN_USERNAME };
    const referrals = db ? (await db.query("SELECT count(*) AS users, (SELECT count(*) FROM affiliate_verifications WHERE status='Pending') AS pending,count(*) FILTER (WHERE status='Verified') AS verified FROM registrations")).rows[0] : metrics;
    const commissions = db ? (await db.query('SELECT telegram_id,cents,reference,at FROM commissions ORDER BY at DESC,id DESC LIMIT 25')).rows : [];
    const activity = await list(db,'users',filters(new URL('http://localhost')));
    const requests = db ? (await db.query(`SELECT v.*,r.username FROM affiliate_verifications v
      JOIN registrations r USING(telegram_id) ORDER BY (v.status='Pending') DESC,v.requested_at DESC,v.id DESC LIMIT 100`)).rows : [];
    return { config: config.affiliate || {}, referrals, commissions, requests, activity: activity.rows, database: !!db };
  }
  if (route === 'dashboard') {
    if (!db) return { metrics, performance: [], signals: [], users: [], logs: [], database: false };
    const [summary, performance, signals, users, logs, bot] = await Promise.all([
      db.query(`SELECT (SELECT count(*) FROM registrations) users,
        (SELECT count(*) FROM registrations WHERE status='Verified' AND enabled AND last_seen>now()-interval '30 days') active,
        (SELECT count(*) FROM signals) signals,(SELECT coalesce(sum(cents),0) FROM commissions) cents`),
      db.query(`SELECT to_char(at AT TIME ZONE 'Asia/Baku','YYYY-MM-DD') day,
        count(*) FILTER (WHERE outcome='Win') wins,count(*) FILTER (WHERE outcome='Loss') losses FROM signals
        WHERE at>=now()-interval '30 days' AND outcome IN ('Win','Loss') AND ($1='' OR asset ILIKE $1) AND ($2='' OR period::text=$2)
        GROUP BY 1 ORDER BY 1`, [f.asset,f.period]),
      list(db,'signals',{...f,asset:'',period:''}),list(db,'users',f),list(db,'logs',f),
      db.query("SELECT last_heartbeat>now()-interval '60 seconds' AS online FROM bot_runtime WHERE id=1")
    ]);
    return { metrics: summary.rows[0], performance: performance.rows, signals: signals.rows.slice(0,5), users: users.rows.slice(0,5), logs: logs.rows.slice(0,5), botOnline: !!bot.rows[0]?.online, database: true };
  }
  if (route === 'telegram') {
    const durations = [3,5,10,15,30,60,180,300,900];
    if (!db) return { database:false, durations, errors:[] };
    const [saved,runtime,users,errors] = await Promise.all([
      db.query("SELECT value FROM control_settings WHERE key='telegram'"),
      db.query("SELECT *,last_heartbeat>now()-interval '60 seconds' AS online FROM bot_runtime WHERE id=1"),
      db.query("SELECT count(*) users,max(last_seen) activity FROM registrations"),
      db.query("SELECT at,message FROM control_logs WHERE service='Telegram' AND severity='Error' ORDER BY at DESC,id DESC LIMIT 10")
    ]);
    const config = saved.rows[0]?.value || {};
    const bot = runtime.rows[0];
    return { database:true, username:bot?.username || config.username, connected:!!bot, online:!!bot?.online,
      maintenance:config.maintenance === true, durations:config.durations ?? durations,
      users:users.rows[0].users, activity:users.rows[0].activity, errors:errors.rows };
  }
  if (route === 'analytics') {
    const dates = range(url);
    if (!db) return { users:[], performance:[], conversion:[], models:[], revenue:[] };
    const queries = [
      "SELECT to_char(created_at AT TIME ZONE 'Asia/Baku','YYYY-MM-DD') day,count(*) total FROM registrations WHERE created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1",
      "SELECT to_char(at AT TIME ZONE 'Asia/Baku','YYYY-MM-DD') day,count(*) FILTER (WHERE outcome='Win') wins,count(*) FILTER (WHERE outcome='Loss') losses FROM signals WHERE at BETWEEN $1 AND $2 AND outcome IN ('Win','Loss') GROUP BY 1 ORDER BY 1",
      "SELECT to_char(created_at AT TIME ZONE 'Asia/Baku','YYYY-MM-DD') day,count(*) total,count(*) FILTER (WHERE status='Verified') verified FROM registrations WHERE created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1",
      "SELECT model AS day,round(100.0*count(*) FILTER (WHERE outcome='Win')/count(*),1) accuracy FROM signals WHERE at BETWEEN $1 AND $2 AND outcome IN ('Win','Loss') GROUP BY 1 ORDER BY 1",
      "SELECT to_char(at AT TIME ZONE 'Asia/Baku','YYYY-MM-DD') day,sum(cents)/100.0 revenue FROM commissions WHERE at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1"
    ];
    const results = await Promise.all(queries.map(sql => db.query(sql,dates)));
    return Object.fromEntries(['users','performance','conversion','models','revenue'].map((key,i) => [key,results[i].rows]));
  }
  return { database: !!db };
}

async function writeData(db, route, data) {
  if (!db) reject(503,'Connect PostgreSQL to save changes.');
  if (route === 'users') {
    if (typeof data.id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(data.id) ||
        !['Pending','Verified','Rejected'].includes(data.status) || typeof data.enabled !== 'boolean' ||
        (data.enabled && data.status !== 'Verified')) reject(400,'Only verified users can be activated.');
    const updated = await db.query(`WITH changed AS (
      UPDATE registrations SET status=$2,enabled=$3 WHERE telegram_id=$1 RETURNING telegram_id
    ), reviewed AS (
      UPDATE affiliate_verifications v SET status=$2,reviewed_at=now(),reviewed_by=$4
      FROM changed WHERE v.telegram_id=changed.telegram_id AND v.status='Pending' AND $2 IN ('Verified','Rejected')
    ) INSERT INTO control_logs(service,event,severity,message,actor)
      SELECT 'Affiliate','user.access','Info',telegram_id||' → '||$2||' / '||$3::text,$4 FROM changed`,
      [data.id,data.status,data.enabled,env.ADMIN_USERNAME]);
    if (!updated.rowCount) reject(404,'User not found.');
    return;
  }
  if (!['settings','affiliate'].includes(route)) reject(405,'Method not allowed.');
  const key = route === 'affiliate' ? 'affiliate' : data.section;
  if (key === 'bot-controls') {
    const allowed = [3,5,10,15,30,60,180,300,900];
    if (typeof data.maintenance !== 'boolean' || !Array.isArray(data.durations) ||
        data.durations.length > allowed.length || !data.durations.every(duration => allowed.includes(duration))) {
      reject(400,'Invalid maintenance or duration settings.');
    }
    const value = { maintenance:data.maintenance, durations:allowed.filter(duration => data.durations.includes(duration)) };
    await saveConfig(db,'telegram',value);
    return;
  }
  let value;
  if (key === 'affiliate') {
    const link = safe(data.link, 1000);
    const disclosure = safe(data.disclosure, 600);
    const model = data.model;
    if (link) {
      let url;
      try { url = new URL(link); } catch { reject(400,'Enter a valid HTTPS link.'); }
      if (url.protocol !== 'https:' || url.username || url.password ||
          !['loss-linked','not-loss-linked'].includes(model) || !disclosure) reject(400,'Link, commission model and disclosure are required.');
    }
    value = { link, disclosure, model: link ? model : '' };
  } else if (key === 'telegram') {
    const username = safe(data.username,32);
    if (username && !/^[A-Za-z0-9_]{5,32}$/.test(username)) reject(400,'Invalid Telegram username.');
    value = { username };
  } else if (key === 'general') {
    value = { name: safe(data.name,80) || 'Quick Trade AI' };
  } else {
    reject(400,'Unknown configuration section.');
  }
  await saveConfig(db,key,value);
}

async function saveConfig(db,key,value) {
  await db.query(`WITH saved AS (INSERT INTO control_settings VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=control_settings.value || excluded.value RETURNING key)
    INSERT INTO control_logs(service,event,severity,message,actor)
    SELECT 'Settings','config.updated','Info',key,$3 FROM saved`, [key,JSON.stringify(value),env.ADMIN_USERNAME]);
}

export default async function control(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json = (status,data) => {
    res.statusCode = status;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  };
  const redirect = path => { res.statusCode = 303; res.setHeader('Location',path); res.end(); };
  const url = new URL(req.url,'http://localhost');
  const path = url.pathname;
  const page = String(req.query?.view ?? url.searchParams.get('view') ?? path.slice(1));
  const action = url.searchParams.get('action');
  try {
    if (action === 'health' && req.method === 'GET') {
      let status = 'unavailable';
      try { ({status} = await databaseHealth(await database())); } catch {}
      return json(status === 'healthy' ? 200 : 503,{ database:status });
    }
    if (req.method === 'GET' && !action) {
      if (path === '/' && !page) return redirect('/dashboard');
      if (page !== 'login' && !views.has(page)) return json(404,{error:'Page not found.'});
      if (page !== 'login' && !await session(req,await database())) return redirect('/login');
      const html = await readFile(new URL('../pages/' + (page === 'login' ? 'login' : 'shell') + '.html',import.meta.url));
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.end(html);
    }
    if (!['GET','POST'].includes(req.method)) reject(405,'Method not allowed.');
    if (!configured()) reject(503,'Admin setup required. See README.');
    if (req.method === 'POST' && req.headers.origin !== (production ? 'https://' : 'http://') + req.headers.host) reject(403,'Origin rejected.');
    const db = await database();
    if (action === 'login' && req.method === 'POST') {
      if (db && (await databaseHealth(db)).status !== 'healthy') reject(503,'Database unavailable or migration required.');
      if (await rateLimit(req,db)) reject(429,'Too many attempts. Retry in 15 minutes.');
      const { username, password } = await jsonBody(req);
      const [salt, digest] = env.ADMIN_PASSWORD_HASH.split(':');
      const valid = typeof password === 'string' && password.length <= 256 &&
        same((await hashPassword(password,salt,64)).toString('hex'),digest);
      if (!valid || username !== env.ADMIN_USERNAME) reject(401,'Invalid username or password.');
      const id = randomBytes(32).toString('hex');
      if (db) {
        await db.query('DELETE FROM control_sessions WHERE expires_at<=now()');
        await db.query(`WITH created AS (
          INSERT INTO control_sessions VALUES($1,now()+interval '1 hour') RETURNING id
        ) INSERT INTO control_logs(service,event,severity,message,actor)
        SELECT 'Security','session.login','Info','Administrator signed in',$2 FROM created`,[id,env.ADMIN_USERNAME]);
      } else {
        for (const [key, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(key);
        sessions.set(id,Date.now()+ttl);
      }
      res.setHeader('Set-Cookie',cookie(id+'.'+sign(id),3600));
      return json(200,{ ok:true });
    }
    const id = await session(req,db);
    if (!id) reject(401,'Sign in required.');
    if (action === 'logout' && req.method === 'POST') {
      if (db) await db.query('DELETE FROM control_sessions WHERE id=$1',[id]);
      else sessions.delete(id);
      res.setHeader('Set-Cookie',cookie('',0));
      return json(200,{ ok:true });
    }
    if (!views.has(action)) reject(404,'Unknown operation.');
    if (req.method === 'GET') return json(200,{...await readData(db,action,url),database:!!db});
    await writeData(db,action,await jsonBody(req));
    return json(200,{ ok:true });
  } catch (error) {
    if (!error.status) console.error('Control Center:', error.code || error.name);
    const databaseError = /^(08|28|53|57P|42P01|42703|ECONN|ENOTFOUND|ETIMEDOUT)/.test(error.code || '');
    return json(error.status || (databaseError ? 503 : 500),{ error:error.status ? error.message : 'Service unavailable. Check server configuration.' });
  }
}
