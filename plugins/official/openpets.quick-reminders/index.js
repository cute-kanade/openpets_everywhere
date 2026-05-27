export const MAX_REMINDERS = 10;
export const MAX_MESSAGE_LENGTH = 140;
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

export function cleanMessage(value, fallback = "Reminder time.") {
  const text = typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ") : "";
  return (text || fallback).slice(0, MAX_MESSAGE_LENGTH).trim() || fallback;
}

export function durationMs(values = {}) {
  const hours = Math.max(0, Math.min(23, Math.round(Number(values.hours ?? 0))));
  const minutes = Math.max(0, Math.min(59, Math.round(Number(values.minutes ?? 0))));
  const ms = (hours * 60 + minutes) * 60_000;
  if (ms < 60_000 || ms > MAX_DELAY_MS) throw new Error("Reminder duration must be 1 minute to 24 hours.");
  return ms;
}

export async function getReminders(ctx) {
  const reminders = await ctx.storage.get("reminders");
  return Array.isArray(reminders) ? reminders.filter((r) => r && typeof r.id === "string" && typeof r.dueAt === "number" && typeof r.message === "string").slice(0, MAX_REMINDERS) : [];
}

async function saveReminders(ctx, reminders) {
  await ctx.storage.set("reminders", reminders.slice(0, MAX_REMINDERS));
  await ctx.status.set(reminders.length ? { text: `${reminders.length} reminder${reminders.length === 1 ? "" : "s"} active`, tone: "info" } : { text: "No active reminders", tone: "info" });
}

export async function fireReminder(ctx, id) {
  const reminders = await getReminders(ctx);
  const item = reminders.find((r) => r.id === id);
  await saveReminders(ctx, reminders.filter((r) => r.id !== id));
  if (!item) return false;
  await ctx.pet.speak(item.message);
  await ctx.pet.react("waving");
  return true;
}

export async function scheduleReminder(ctx, reminder) {
  const delay = Math.max(1_000, reminder.dueAt - Date.now());
  await ctx.schedule.once(reminder.id, delay, () => fireReminder(ctx, reminder.id));
}

export async function addReminder(ctx, message, delayMs) {
  const reminders = (await getReminders(ctx)).filter((r) => r.dueAt > Date.now());
  if (reminders.length >= MAX_REMINDERS) throw new Error("Quick Reminders can keep up to 10 active reminders.");
  const reminder = { id: `reminder-${Date.now().toString(36)}`.slice(0, 64), message: cleanMessage(message), dueAt: Date.now() + delayMs };
  reminders.push(reminder);
  await saveReminders(ctx, reminders);
  await scheduleReminder(ctx, reminder);
  await ctx.pet.speak("Reminder set.");
  await ctx.pet.react("success");
  return reminder;
}

export async function reconcile(ctx) {
  await ctx.schedule.cancelAll();
  const now = Date.now();
  const reminders = await getReminders(ctx);
  const future = reminders.filter((r) => r.dueAt > now);
  const overdue = reminders.filter((r) => r.dueAt <= now);
  await saveReminders(ctx, future);
  for (const item of future) await scheduleReminder(ctx, item);
  if (overdue.length) await ctx.pet.speak(`${overdue.length} reminder${overdue.length === 1 ? "" : "s"} missed while OpenPets was closed.`);
}

export function summary(reminders, now = Date.now()) {
  if (!reminders.length) return "No active reminders.";
  return reminders.slice(0, 5).map((r) => `${Math.max(1, Math.ceil((r.dueAt - now) / 60_000))} min: ${r.message}`).join("; ");
}

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await reconcile(ctx);
      await ctx.commands.register({ id: "set-reminder", title: "Set reminder...", description: "Create a quick local reminder.", form: { submitLabel: "Set Reminder", fields: [
        { id: "message", type: "textarea", label: "Message", required: true, maxLength: MAX_MESSAGE_LENGTH, default: "Reminder time." },
        { id: "hours", type: "number", label: "Hours", default: 0, min: 0, max: 23 },
        { id: "minutes", type: "number", label: "Minutes", default: 15, min: 0, max: 59 }
      ] } }, async (values) => addReminder(ctx, values.message, durationMs(values)));
      await ctx.commands.register({ id: "reminder-15", title: "15 min reminder", description: "Set a default reminder for 15 minutes." }, () => addReminder(ctx, "Reminder time.", 15 * 60_000));
      await ctx.commands.register({ id: "reminder-30", title: "30 min reminder", description: "Set a default reminder for 30 minutes." }, () => addReminder(ctx, "Reminder time.", 30 * 60_000));
      await ctx.commands.register({ id: "reminder-60", title: "1 hour reminder", description: "Set a default reminder for 1 hour." }, () => addReminder(ctx, "Reminder time.", 60 * 60_000));
      await ctx.commands.register({ id: "view-reminders", title: "View reminders", description: "Speak active reminders." }, async () => ctx.pet.speak(summary(await getReminders(ctx))));
      await ctx.commands.register({ id: "clear-reminders", title: "Clear reminders", description: "Cancel all active reminders." }, async () => { await ctx.schedule.cancelAll(); await saveReminders(ctx, []); await ctx.pet.speak("Reminders cleared."); });
    },
    async stop() {}
  });
}
