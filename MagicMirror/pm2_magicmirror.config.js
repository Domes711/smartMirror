module.exports = {
  apps: [{
    name: "MagicMirror",
    script: "npm",
    args: "start",
    cwd: "/home/admin/MagicMirror",
    env: {
      NODE_ENV: "production",
      DISPLAY: ":0"
    },
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    error_file: "/home/admin/.pm2/logs/magicmirror-error.log",
    out_file: "/home/admin/.pm2/logs/magicmirror-out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z"
  }]
};
