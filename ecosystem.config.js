// PM2 process file for bare-metal / VM installs (build first: `npm ci && npm run build && npm run db:migrate`).
// For containers use deploy/docker-compose.prod.yml instead.
const path = require('path');

const common = { watch: false, autorestart: true, max_restarts: 20, kill_timeout: 65000 };

module.exports = {
  apps: [
    { ...common, name: 'orb-web', cwd: path.join(__dirname, 'apps/web'), script: 'npm', args: 'run start', env: { NODE_ENV: 'production', PORT: 3000 } },
    { ...common, name: 'orb-proxy', cwd: path.join(__dirname, 'apps/proxy'), script: 'dist/index.js', env: { NODE_ENV: 'production' }, instances: 'max', exec_mode: 'cluster' },
    { ...common, name: 'orb-worker', cwd: path.join(__dirname, 'apps/worker'), script: 'dist/index.js', env: { NODE_ENV: 'production' } },
    { ...common, name: 'orb-runner', cwd: path.join(__dirname, 'apps/runner'), script: 'dist/index.js', env: { NODE_ENV: 'production' } },
  ],
};
