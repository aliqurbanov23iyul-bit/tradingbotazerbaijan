import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';

const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (password.length < 14 || password.length > 256) throw new Error('Use 14–256 characters.');
const salt = randomBytes(16).toString('hex');
console.log(salt + ':' + scryptSync(password, salt, 64).toString('hex'));
