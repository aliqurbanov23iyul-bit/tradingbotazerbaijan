import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'smoke';
process.env.SESSION_SECRET = 's'.repeat(40);
const salt = '0'.repeat(32);
const password = 'test-only-password';
process.env.ADMIN_PASSWORD_HASH = salt + ':' + scryptSync(password,salt,64).toString('hex');
const { default: handler } = await import('../api/control.mjs');

async function request(url,options={}) {
  const headers = {};
  let result;
  const response = {
    setHeader(key,value) { headers[key]=value; },
    end(data) { result={ status:this.statusCode || 200,headers,data }; }
  };
  const requestHeaders = { host:'localhost:3100', origin:'http://localhost:3100', 'content-type':'application/json', ...options.headers };
  await handler({ url,method:options.body ? 'POST' : 'GET',headers:requestHeaders,body:options.body },response);
  return result;
}

assert.match((await request('/login')).data.toString(), /<form[^>]+method="post"/i);
assert.equal((await request('/api/control?action=health')).status,503);
assert.equal((await request('/')).headers.Location,'/dashboard');
assert.equal((await request('/dashboard')).headers.Location,'/login');
assert.equal((await request('/api/control?action=users')).status,401);
const login = '/api/control?action=login';
assert.equal((await request(login,{body:{ username:'smoke',password },headers:{origin:'https://elsewhere.example'}})).status,403);
assert.equal((await request(login,{body:{username:'smoke',password:'invalid'}})).status,401);
const signedIn = await request(login,{body:{username:'smoke',password}});
assert.equal(signedIn.status,200);
assert.match(signedIn.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
const headers = { cookie:signedIn.headers['Set-Cookie'].split(';')[0] };
assert.equal((await request('/api/control?action=dashboard',{headers:{cookie:headers.cookie+'.extra'}})).status,401);
assert.equal((await request(login,{body:{username:'smoke',password},headers:{'content-type':'application/x-www-form-urlencoded'}})).status,415);
assert.match((await request('/dashboard',{headers})).data.toString(),/Control Center/);
for (const route of ['dashboard','telegram','users','affiliate','signals','ai-analysis','market-data','analytics','logs','settings']) {
  assert.equal((await request('/'+route,{headers})).status,200);
  assert.equal((await request('/api/control?action='+route,{headers})).status,200);
}
assert.equal((await request('/api/control?action=affiliate',{headers,body:{link:'https://example.com'}})).status,503);
assert.equal((await request('/api/control?action=logout',{headers,body:{}})).status,200);
assert.equal((await request('/api/control?action=dashboard',{headers})).status,401);
console.log('Passed: protected pages, API authorization, CSRF, login, all 10 views, offline writes, logout.');
