const assets = new Map([
  ['XAU/USD','oanda'],['EUR/USD','oanda'],['GBP/USD','oanda'],['BTC/USD','coinbase']
]);
const intervals = [60,300,900,3600];

export async function marketData(db,url) {
  const symbol = url.searchParams.get('asset') || 'BTC/USD';
  const interval = Number(url.searchParams.get('interval') || 60);
  if (!assets.has(symbol) || !intervals.includes(interval)) {
    throw Object.assign(new Error('Unsupported market asset or interval.'),{status:400});
  }
  const provider = assets.get(symbol);
  const base = {symbol,interval,provider, database:!!db, quotes:[], providers:[], candles:[], errors:[], quality:null};
  if (!db) return base;
  const [quotes,providers,candles,errors,quality] = await Promise.all([
    db.query('SELECT * FROM market_latest ORDER BY symbol'),
    db.query(`SELECT p.*, h.checked_at, CASE WHEN NOT p.enabled THEN 'Not Configured'
      WHEN h.checked_at>=now()-interval '20 seconds' AND h.status='online' THEN 'Online'
      ELSE 'Offline' END AS status FROM market_providers p LEFT JOIN market_data_health h USING(provider) ORDER BY provider`),
    db.query(`SELECT open_at,open,high,low,close FROM market_candles
      WHERE provider=$1 AND symbol=$2 AND interval_seconds=$3 ORDER BY open_at DESC LIMIT 120`,[provider,symbol,interval]),
    db.query('SELECT provider,scope,code,at FROM market_data_errors ORDER BY at DESC,id DESC LIMIT 20'),
    db.query(`SELECT gaps,duplicates,checked_at FROM market_candle_quality
      WHERE provider=$1 AND symbol=$2 AND interval_seconds=$3`,[provider,symbol,interval])
  ]);
  return {...base,quotes:quotes.rows,providers:providers.rows,candles:candles.rows.reverse(),errors:errors.rows,
    quality:quality.rows[0] ?? null};
}
