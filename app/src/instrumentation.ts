export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn("DATABASE_URL not set — skipping database migrations");
      return;
    }

    const { runMigrations } = await import("@/lib/db/migrate");
    const result = await runMigrations();
    for (const line of result.logs) {
      if (result.migrationError || result.fixupError) {
        console.warn(line);
      } else {
        console.info(line);
      }
    }

    // Initialize ETL sync scheduler using saved settings
    const { getSetting } = await import("@/lib/db/settings");
    const { startScheduler } = await import("@/lib/etl/scheduler");

    let syncEnabled = true; // default: enabled for backward compat
    try {
      const savedEnabled = await getSetting("sync_enabled");
      if (savedEnabled !== null) {
        syncEnabled = savedEnabled === "true";
      }
    } catch {
      // use default
    }

    let intervalMinutes = 1440; // default 24h
    try {
      const savedMinutes = await getSetting("sync_interval_minutes");
      if (savedMinutes) {
        intervalMinutes = Number(savedMinutes);
      } else {
        // Backward compatibility: migrate from sync_interval_hours
        const savedHours = await getSetting("sync_interval_hours");
        if (savedHours) intervalMinutes = Number(savedHours) * 60;
      }
    } catch {
      // use default
    }

    if (syncEnabled) {
      startScheduler(intervalMinutes);
    } else {
      const label = intervalMinutes < 60
        ? `${intervalMinutes}m`
        : intervalMinutes % 60 === 0
          ? `${intervalMinutes / 60}h`
          : `${Math.floor(intervalMinutes / 60)}h ${intervalMinutes % 60}m`;
      console.info(`Sync scheduler is disabled (interval: ${label}). Enable it from the Data Sync settings page.`);
    }
  }
}
