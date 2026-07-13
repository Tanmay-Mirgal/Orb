const path = require('path');

module.exports = {
  apps: [
    {
      name: 'orb-web',
      script: 'npm',
      args: 'run start',
      cwd: './apps/web',
      env_file: path.join(__dirname, '.env'),
      watch: false
    },
    {
      name: 'orb-worker',
      script: 'npm',
      args: 'run dev',
      cwd: './apps/worker',
      env_file: path.join(__dirname, '.env'),
      watch: false
    },
    {
      name: 'orb-proxy',
      script: 'npm',
      args: 'run dev',
      cwd: './apps/proxy',
      env_file: path.join(__dirname, '.env'),
      watch: false
    }
  ]
};
