/**
 * PM2 process manager — enterprise single-instance-per-node backend with graceful lifecycle.
 *
 * Why: ad-hoc `bun run src/index.ts` instances accumulated and raced the maintenance/dispatch
 * queue, producing duplicate DB pools + a transient false integrity FAIL. PM2 owns the process:
 * one managed instance per node, autorestart, graceful SIGTERM (the app's gracefulShutdown hook
 * releases the Prisma pool + Redis), and a duplicate-start is refused (same pm2 name).
 *
 * Horizontal scale is still supported — run PM2 on N nodes; cron/dispatch is leader-locked in
 * Redis (`runWithLeaderLock`, `assignment:processor`), so only ONE node runs schedulers.
 *
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload homigo-backend            # zero-downtime
 *   pm2 logs homigo-backend
 */
module.exports = {
  apps: [
    {
      name: "homigo-backend",
      script: "src/index.ts",
      interpreter: "bun",
      cwd: __dirname,
      instances: 1,            // one managed instance per node (NOT cluster — Elysia binds the port)
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",       // crash-loop guard
      restart_delay: 3000,
      kill_timeout: 10000,     // give gracefulShutdown time to drain the pool
      wait_ready: false,
      max_memory_restart: "1G",
      env: { NODE_ENV: "development", PORT: "3000" },
      env_production: { NODE_ENV: "production", PORT: "3000" },
      // health: PM2 restarts on crash; external probe should hit GET /health (db+redis status).
      out_file: "./logs/backend-out.log",
      error_file: "./logs/backend-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
