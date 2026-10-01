// pm2 process file: `pm2 start deploy/ecosystem.config.js`
module.exports = {
  apps: [{
    name: 'devora',
    script: 'server.js',
    node_args: '--disable-warning=ExperimentalWarning --env-file-if-exists=.env',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '700M',
  }],
};
