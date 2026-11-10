import { spawn } from 'node:child_process';

const worker = spawn('python', ['-m', 'bot.main'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ADMIN_PASSWORD_HASH: '',
    SESSION_SECRET: '',
    ADMIN_USERNAME: ''
  }
});
worker.on('error', error => {
  console.error('Unable to start Python:', error.code);
  process.exitCode = 1;
});
worker.on('exit', code => { process.exitCode = code ?? 1; });
