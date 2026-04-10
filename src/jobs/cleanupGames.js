import Game from "../models/Game.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * ONE_HOUR_MS;

const nowMinus = (ms) => new Date(Date.now() - ms);

const cleanupOnce = async ({ finishedMs = DAY_MS, waitingMs = DAY_MS } = {}) => {
  const finishedCutoff = nowMinus(finishedMs);
  const waitingCutoff = nowMinus(waitingMs);

  const result = await Game.deleteMany({
    $or: [
      { status: "finished", updatedAt: { $lt: finishedCutoff } },
      { status: "waiting", updatedAt: { $lt: waitingCutoff } }
    ]
  });

  return { deletedCount: result.deletedCount ?? 0, finishedCutoff, waitingCutoff };
};

const safeLog = (logger, level, message, meta) => {
  const fn = logger?.[level] || logger?.log || (() => {});
  if (meta) return fn(message, meta);
  return fn(message);
};

export const startGameCleanupJob = async ({
  logger = console,
  // Defaults: keep finished + waiting games for 24h.
  finishedMs = DAY_MS,
  waitingMs = DAY_MS,
  // If node-cron is installed, run daily at midnight. Otherwise fallback to interval.
  cronSpec = "0 0 * * *",
  intervalMs = DAY_MS
} = {}) => {
  const run = async (source) => {
    try {
      const { deletedCount, finishedCutoff, waitingCutoff } = await cleanupOnce({ finishedMs, waitingMs });
      safeLog(logger, "log", `[cleanup] ${source}: deleted ${deletedCount} games`, {
        finishedCutoff,
        waitingCutoff
      });
    } catch (err) {
      safeLog(logger, "error", `[cleanup] ${source}: failed`, { error: err?.message || String(err) });
    }
  };

  // Run once on boot so restarts don't delay cleanup until the next schedule.
  await run("boot");

  // Prefer cron if available, but do not make it a hard dependency.
  try {
    const mod = await import("node-cron");
    const cron = mod?.default || mod;
    if (cron?.schedule) {
      const task = cron.schedule(cronSpec, () => run(`cron(${cronSpec})`), { scheduled: true });
      safeLog(logger, "log", `[cleanup] scheduled cron: ${cronSpec}`);
      return { stop: () => task.stop() };
    }
  } catch {
    // ignore - fallback below
  }

  const timer = setInterval(() => run(`interval(${intervalMs}ms)`), intervalMs);
  timer.unref?.();
  safeLog(logger, "log", `[cleanup] node-cron not installed; using interval: ${intervalMs}ms`);
  return { stop: () => clearInterval(timer) };
};

