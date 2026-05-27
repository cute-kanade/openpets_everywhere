const INTERVALS = { rare: 20 * 60_000, normal: 15 * 60_000, often: 10 * 60_000 };
const DISTANCES = { small: 60, medium: 110 };
const DURATIONS = { subtle: 900, playful: 650 };

function normalizeTime(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? `${match[1]}:${match[2]}` : fallback;
}

export function isQuietNow(config = {}, now = new Date()) {
  if (config.quietHoursEnabled === false) return false;
  const start = normalizeTime(config.quietStart, "22:00");
  const end = normalizeTime(config.quietEnd, "08:00");
  const current = now.getHours() * 60 + now.getMinutes();
  const s = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
  const e = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
  return s <= e ? current >= s && current < e : current >= s || current < e;
}

export function movementConfig(config = {}) {
  const style = ["off", "subtle", "playful"].includes(config.movementStyle) ? config.movementStyle : "subtle";
  const frequency = Object.prototype.hasOwnProperty.call(INTERVALS, config.frequency) ? config.frequency : "rare";
  const maxDistance = Object.prototype.hasOwnProperty.call(DISTANCES, config.maxDistance) ? config.maxDistance : "small";
  return { style, intervalMs: INTERVALS[frequency], distance: DISTANCES[maxDistance], durationMs: DURATIONS[style] ?? 900 };
}

export async function takeWalk(ctx, config = {}) {
  const movement = movementConfig(config);
  if (movement.style === "off" || isQuietNow(config)) return false;
  await ctx.pet.wander({ distance: movement.distance, durationMs: movement.durationMs });
  await ctx.storage.set("lastWalk", { at: new Date().toISOString(), distance: movement.distance });
  return true;
}

export async function reschedule(ctx, config = {}) {
  await ctx.schedule.cancelAll();
  const movement = movementConfig(config);
  if (movement.style === "off") {
    await ctx.status.set({ text: "Wander Buddy is off", tone: "info" });
    return;
  }
  await ctx.schedule.every("wander", movement.intervalMs, () => takeWalk(ctx, config));
  await ctx.status.set({ text: `Wandering ${movement.style} · every ${Math.round(movement.intervalMs / 60_000)} min`, tone: "info" });
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await reschedule(ctx, await ctx.config.get());
      await ctx.commands.register({ id: "take-little-walk", title: "Take a little walk", description: "Move the pet a short safe distance." }, async () => { const config = await ctx.config.get(); return takeWalk(ctx, { ...config, quietHoursEnabled: false, movementStyle: movementConfig(config).style === "off" ? "subtle" : config.movementStyle }); });
      await ctx.commands.register({ id: "return-home", title: "Return home", description: "Move the pet back to its home corner." }, async () => ctx.pet.moveToHome());
      await ctx.commands.register({ id: "stay-still", title: "Stay still for now", description: "Pause Wander Buddy until the plugin is reloaded or settings change." }, async () => { await ctx.schedule.cancelAll(); await ctx.status.set({ text: "Staying still for now", tone: "success" }); });
      ctx.config.onChange?.((next) => reschedule(ctx, next));
    },
    async stop() {}
  });
}
