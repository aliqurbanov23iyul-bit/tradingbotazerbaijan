import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import control from './api/control.mjs';

const assets = new Map([['/ui.css', 'text/css'], ['/app.js', 'text/javascript'], ['/i18n.js', 'text/javascript']]);
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const type = assets.get(path);
  if (!type) return control(req, res);
  try {
    const content = await readFile(new URL('./public' + path, import.meta.url));
    res.setHeader('Content-Type', type + '; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.PORT || 3100), '127.0.0.1', () => {
  console.log('Control Center · http://127.0.0.1:' + (process.env.PORT || 3100));
});
