module.exports = {
  apps: [
    {
      name: 'titans-coach-scheduler',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4173,
        SITE_CONFIG_PATH: 'site/config.json',
        SITE_DATA_PATH: 'site/data.js',
        REQUESTS_FILE: 'storage/requests.json',
        COACH_ACCOUNTS_FILE: 'storage/coach-accounts.json',
        STATUS_MONITOR_FILE: 'storage/diamond-status-monitor.json',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: '55aiden55'
      }
    },
    {
      name: 'athletics-coach-scheduler',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4184,
        SITE_CONFIG_PATH: 'site/athletics.config.json',
        SITE_DATA_PATH: 'site/athletics-data.js',
        REQUESTS_FILE: 'storage/athletics-requests.json',
        COACH_ACCOUNTS_FILE: 'storage/athletics-coach-accounts.json',
        STATUS_MONITOR_FILE: 'storage/athletics-diamond-status-monitor.json',
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: '55aiden55'
      }
    }
  ]
};
