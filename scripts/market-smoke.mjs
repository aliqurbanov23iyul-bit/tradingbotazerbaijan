import assert from 'node:assert/strict';
import { marketData } from '../api/market.mjs';

const url = query => new URL('http://localhost/?' + query);
await assert.rejects(marketData(null,url('asset=OTC')), {status:400});
await assert.rejects(marketData(null,url('interval=2')), {status:400});
assert.deepEqual((await marketData(null,url(''))).quotes,[]);
const requests = [];
const fixture = {
  async query(sql,args) {
    requests.push({sql,args});
    return {rows:sql.includes('FROM market_candles') ? [{open_at:'second'},{open_at:'first'}] : []};
  }
};
const result = await marketData(fixture,url('asset=EUR%2FUSD&interval=900'));
assert.equal(result.provider,'oanda');
assert.deepEqual(requests.find(call=>call.sql.includes('FROM market_candles')).args,['oanda','EUR/USD',900]);
assert.deepEqual(result.candles.map(c=>c.open_at),['first','second']);
console.log('Passed: market filters, offline state, provider selection and chronological chart payload.');
