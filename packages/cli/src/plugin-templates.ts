/**
 * SDK v3 plugin templates for `openpets plugin new --template <name>` (§18.4).
 * Each template ships a typed entry, a valid manifestVersion-3 manifest, a
 * passing test built on `@open-pets/plugin-sdk/testing`, and a README.
 */

export type PluginTemplateName = "blank" | "reminder" | "ambient" | "ai-chat" | "tamagotchi" | "calendar";

export const pluginTemplateNames: readonly PluginTemplateName[] = ["blank", "reminder", "ambient", "ai-chat", "tamagotchi", "calendar"];

export type PluginTemplateContext = { readonly id: string; readonly name: string };

export type PluginTemplate = {
  readonly description: string;
  readonly permissions: readonly string[];
  readonly configSchema: Record<string, unknown>;
  readonly entry: (ctx: PluginTemplateContext) => string;
  readonly test: (ctx: PluginTemplateContext) => string;
};

const sharedTestHeader = `import assert from "node:assert/strict";
import { createTestHarness } from "@open-pets/plugin-sdk/testing";
import { register } from "./index.js";
`;

export const pluginTemplates: Record<PluginTemplateName, PluginTemplate> = {
  blank: {
    description: "A minimal starting point with one command.",
    permissions: ["pet:speak", "pet:reaction", "commands", "status"],
    configSchema: {},
    entry: ({ name }) => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await ctx.status.set({ text: ${JSON.stringify(`${name} is ready`)}, tone: "info" });

      await ctx.commands.register(
        { id: "say-hello", title: "Say hello", description: "Get a friendly greeting." },
        async () => {
          await ctx.pet.speak(${JSON.stringify(`Hello from ${name}!`)});
          await ctx.pet.react("waving");
        },
      );
    },

    async stop() {},
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, { permissions: ["pet:speak", "pet:reaction", "commands", "status"] });
await h.start();
await h.runCommand("say-hello");
h.expectSpoke(/hello/i);
h.expectReacted("waving");
console.log("blank template tests passed.");
`,
  },

  reminder: {
    description: "One-shot reminders with a form, notifications, and cron routines.",
    permissions: ["pet:speak", "pet:reaction", "commands", "status", "schedule", "storage", "notify"],
    configSchema: {
      morningSummary: { type: "boolean", label: "Morning summary", default: false },
    },
    entry: ({ name }) => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await ctx.status.set({ text: "Reminders ready", tone: "info" });

      await ctx.commands.register(
        {
          id: "remind-me",
          title: "Remind me…",
          description: "Set a one-shot reminder.",
          form: {
            fields: [
              { id: "message", type: "text", label: "Reminder", maxLength: 120, required: true },
              { id: "minutes", type: "number", label: "In minutes", default: 10, min: 1, max: 720 },
            ],
            submitLabel: "Set reminder",
          },
        },
        async (values) => {
          const minutes = Number(values?.minutes ?? 10);
          const message = String(values?.message ?? "Reminder");
          const id = "reminder-" + Math.random().toString(36).slice(2, 8);
          await ctx.schedule.once(id, minutes * 60_000, async () => {
            await ctx.notify.notify({ title: ${JSON.stringify(name)}, body: message });
            const bubble = await ctx.pet.speak({ text: message, sticky: true, icon: "bell", actions: [{ id: "ok", label: "Done", style: "primary" }] });
            bubble.onAction(() => bubble.dismiss());
            await ctx.pet.react("waving");
          });
          await ctx.pet.speak("Reminder set.");
        },
      );

      const config = await ctx.config.get();
      if (config.morningSummary) {
        await ctx.schedule.cron("morning-summary", "0 9 * * 1-5", async () => {
          await ctx.pet.speak("Good morning. Ready when you are.");
        });
      }
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, {
  permissions: ["pet:speak", "pet:reaction", "commands", "status", "schedule", "storage", "notify", "pet:interact"],
  config: { morningSummary: true },
});
await h.start();
h.expectScheduled("morning-summary");
await h.runCommand("remind-me", { message: "Stretch!", minutes: 5 });
h.expectSpoke(/reminder set/i);
await h.clock.advance("5m");
h.expectNotified(/stretch/i);
h.expectSpoke(/stretch/i);
h.expectNoErrors();
console.log("reminder template tests passed.");
`,
  },

  ambient: {
    description: "Gentle ambient presence driven by the senses bus.",
    permissions: ["pet:speak", "pet:reaction", "schedule", "events", "status"],
    configSchema: {
      checkInMinutes: { type: "number", label: "Check-in minutes", default: 45, min: 10, max: 480 },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const config = await ctx.config.get();
      const intervalMinutes = Math.max(10, Number(config.checkInMinutes ?? 45));

      await ctx.schedule.every("ambient-check-in", intervalMinutes * 60_000, async () => {
        await ctx.pet.speak("Still here with you.");
      });

      ctx.events.on("idle:exit", () => {
        void ctx.pet.react("waving");
      });

      ctx.events.on("pet:clicked", () => {
        void ctx.pet.react("celebrating");
      });

      ctx.events.on("day:partChanged", (event) => {
        if (event.part === "evening") void ctx.pet.speak("Evening already. Pace yourself.");
      });
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, {
  permissions: ["pet:speak", "pet:reaction", "schedule", "events", "status"],
  config: { checkInMinutes: 45 },
});
await h.start();
h.expectScheduled("ambient-check-in");
await h.clock.advance("45m");
h.expectSpoke(/still here/i);
await h.emit("pet:clicked", { petId: "default" });
h.expectReacted("celebrating");
await h.emit("day:partChanged", { part: "evening" });
h.expectSpoke(/evening/i);
h.expectNoErrors();
console.log("ambient template tests passed.");
`,
  },

  "ai-chat": {
    description: "A chat pet on the host AI gateway with model-generated speech.",
    permissions: ["pet:speak", "pet:speak:dynamic", "pet:interact", "pet:reaction", "commands", "status", "ai"],
    configSchema: {
      personality: { type: "textarea", label: "Personality", default: "You are a tiny upbeat desktop pet. Reply in one short sentence.", maxLength: 500 },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      await ctx.commands.register(
        {
          id: "ask-pet",
          title: "Ask the pet…",
          form: { fields: [{ id: "question", type: "text", label: "Question", maxLength: 300, required: true }], submitLabel: "Ask" },
        },
        async (values) => {
          if (!(await ctx.ai.available())) {
            await ctx.pet.speak("No AI provider is set up yet.");
            return;
          }
          const config = await ctx.config.get();
          await ctx.pet.react("thinking");
          const bubble = await ctx.pet.speak({ text: "…", dynamic: true, sticky: true });
          let answer = "";
          await ctx.ai.stream(
            { system: String(config.personality ?? ""), messages: [{ role: "user", content: String(values?.question ?? "") }], maxTokens: 200 },
            (token) => {
              answer += token;
              void bubble.update({ markdown: answer, dynamic: true });
            },
          );
          await bubble.update({ markdown: answer, dynamic: true, sticky: false, durationMs: 12_000 });
          await ctx.pet.react("success");
        },
      );
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const h = createTestHarness(register, {
  permissions: ["pet:speak", "pet:speak:dynamic", "pet:interact", "pet:reaction", "commands", "status", "ai"],
});
h.ai.mock(() => "I feel sleepy but happy.");
await h.start();
await h.runCommand("ask-pet", { question: "How do you feel?" });
assert.equal(h.calls.aiCalls.length, 1);
h.expectReacted("success");
const live = h.calls.bubbles.find((bubble) => bubble.spec.dynamic);
assert.ok(live, "asked question produced a dynamic bubble");
assert.ok(live.updates.length > 0, "streaming updated the bubble in place");
console.log("ai-chat template tests passed.");
`,
  },

  tamagotchi: {
    description: "A virtual pet with needs, moods, feeding, and a live stats pin.",
    permissions: ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "events", "audio", "notify"],
    configSchema: {
      decayMinutes: { type: "number", label: "Need decay minutes", default: 30, min: 10, max: 240 },
    },
    entry: ({ name }) => `/// <reference types="@open-pets/plugin-sdk" />

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const config = await ctx.config.get();
      const decayMinutes = Math.max(10, Number(config.decayMinutes ?? 30));

      const loadStats = async () => {
        const stats = (await ctx.storage.get("stats")) ?? { hunger: 80, energy: 80, affection: 60, lastSeen: Date.now() };
        // Catch up decay across restarts/sleep from wall-clock time.
        const elapsedTicks = Math.floor((Date.now() - (stats.lastSeen ?? Date.now())) / (decayMinutes * 60_000));
        if (elapsedTicks > 0) {
          stats.hunger = clamp(stats.hunger - elapsedTicks * 6);
          stats.energy = clamp(stats.energy - elapsedTicks * 4);
          stats.affection = clamp(stats.affection - elapsedTicks * 3);
        }
        stats.lastSeen = Date.now();
        await ctx.storage.set("stats", stats);
        return stats;
      };

      const moodOf = (stats) => {
        if (stats.hunger < 25) return "hungry";
        if (stats.energy < 25) return "sleepy";
        if (stats.affection < 25) return "lonely";
        return "happy";
      };

      let pinned = null;
      const refreshPin = async (stats) => {
        const mood = moodOf(stats);
        const text = mood === "happy"
          ? \`Mood: happy · 🍖 \${stats.hunger} ⚡ \${stats.energy} ♥ \${stats.affection}\`
          : \`I'm \${mood}! · 🍖 \${stats.hunger} ⚡ \${stats.energy} ♥ \${stats.affection}\`;
        if (pinned) { await pinned.update({ text }); return; }
        pinned = await ctx.pet.speak({ text, pin: true, icon: "heart", priority: mood === "happy" ? "low" : "high" });
        pinned.onDismiss(() => { pinned = null; });
      };

      const applyMood = async (stats) => {
        const mood = moodOf(stats);
        if (mood === "hungry") await ctx.pet.react("waiting");
        else if (mood === "sleepy") await ctx.pet.react("idle");
        else if (mood === "lonely") await ctx.pet.react("error");
        else await ctx.pet.react("success");
        await refreshPin(stats);
      };

      const stats = await loadStats();
      await applyMood(stats);

      await ctx.schedule.every("decay", decayMinutes * 60_000, async () => {
        const current = await loadStats();
        current.hunger = clamp(current.hunger - 6);
        current.energy = clamp(current.energy - 4);
        current.affection = clamp(current.affection - 3);
        await ctx.storage.set("stats", current);
        await applyMood(current);
        if (moodOf(current) !== "happy") {
          await ctx.notify.notify({ title: ${JSON.stringify(name)}, body: "Your pet needs attention." });
        }
      });

      ctx.events.on("pet:clicked", async () => {
        const current = await loadStats();
        current.affection = clamp(current.affection + 8);
        await ctx.storage.set("stats", current);
        await ctx.pet.speak({ text: "♥", icon: "heart", durationMs: 1500, priority: "low" });
        await applyMood(current);
      });

      await ctx.commands.register({ id: "feed", title: "Feed", placement: "top", priority: 10 }, async () => {
        const current = await loadStats();
        current.hunger = clamp(current.hunger + 30);
        await ctx.storage.set("stats", current);
        await ctx.audio.play("nom").catch(() => undefined);
        await ctx.pet.speak({ text: "Nom nom!", icon: "food", durationMs: 2500 });
        await applyMood(current);
      });

      await ctx.commands.register({ id: "play", title: "Play", placement: "top", priority: 9 }, async () => {
        const current = await loadStats();
        current.affection = clamp(current.affection + 15);
        current.energy = clamp(current.energy - 10);
        await ctx.storage.set("stats", current);
        await ctx.pet.react("celebrating");
        await applyMood(current);
      });

      await ctx.commands.register({ id: "nap", title: "Nap time" }, async () => {
        const current = await loadStats();
        current.energy = clamp(current.energy + 40);
        await ctx.storage.set("stats", current);
        await ctx.pet.speak("Zzz…");
        await applyMood(current);
      });
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const PERMISSIONS = ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "events", "audio", "notify"];
const h = createTestHarness(register, { permissions: PERMISSIONS, config: { decayMinutes: 30 } });
await h.start();
h.expectScheduled("decay");
h.expectStored("stats", (stats) => stats.hunger <= 100 && stats.hunger >= 0);
h.expectBubble({ pin: true });

await h.runCommand("feed");
h.expectSpoke(/nom/i);
h.expectStored("stats", (stats) => stats.hunger >= 80);

await h.emit("pet:clicked", { petId: "default" });
h.expectStored("stats", (stats) => stats.affection > 60);

// Needs decay over time and the pet complains when neglected.
await h.clock.advance("4h");
h.expectStored("stats", (stats) => stats.hunger < 100);
h.expectNoErrors();
console.log("tamagotchi template tests passed.");
`,
  },

  calendar: {
    description: "Calendar companion: .ics import, countdown pin, event reminders.",
    permissions: ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "files", "notify"],
    configSchema: {
      reminderMinutes: { type: "number", label: "Remind before (minutes)", default: 10, min: 1, max: 120 },
    },
    entry: () => `/// <reference types="@open-pets/plugin-sdk" />

const parseIcs = (text) => {
  const events = [];
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const summary = /SUMMARY:(.*)/.exec(block)?.[1]?.trim();
    const start = /DTSTART(?:;[^:]*)?:(\\d{8}T\\d{6}Z?)/.exec(block)?.[1];
    if (!summary || !start) continue;
    const iso = start.replace(/^(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})(Z?)$/, "$1-$2-$3T$4:$5:$6$7");
    const startsAt = Date.parse(iso);
    if (Number.isFinite(startsAt)) events.push({ summary: summary.slice(0, 120), startsAt });
  }
  return events.sort((a, b) => a.startsAt - b.startsAt);
};

export function register(OpenPetsPlugin) {
  OpenPetsPlugin.register({
    async start(ctx) {
      const config = await ctx.config.get();
      const reminderMinutes = Math.max(1, Number(config.reminderMinutes ?? 10));
      let pinned = null;

      const armReminders = async () => {
        const events = (await ctx.storage.get("events")) ?? [];
        const upcoming = events.filter((event) => event.startsAt > Date.now());
        await ctx.storage.set("events", upcoming);
        const next = upcoming[0];
        if (!next) { if (pinned) { await pinned.dismiss(); pinned = null; } return; }
        const label = \`Next: \${next.summary}\`;
        if (pinned) await pinned.update({ text: label });
        else {
          pinned = await ctx.pet.speak({ text: label, pin: true, icon: "timer" });
          pinned.onDismiss(() => { pinned = null; });
        }
        const remindAt = new Date(next.startsAt - reminderMinutes * 60_000).toISOString();
        await ctx.schedule.at("next-event-reminder", remindAt, async () => {
          // Drop the reminded event first so re-arming never repeats it.
          const remaining = ((await ctx.storage.get("events")) ?? []).filter((event) => !(event.summary === next.summary && event.startsAt === next.startsAt));
          await ctx.storage.set("events", remaining);
          await ctx.notify.notify({ title: "Upcoming event", body: next.summary });
          await ctx.pet.speak({ text: \`\${next.summary} in \${reminderMinutes} min\`, icon: "bell", sticky: true, actions: [{ id: "ok", label: "OK", style: "primary" }] });
          await ctx.pet.react("waiting");
          await armReminders();
        });
      };

      await ctx.commands.register({ id: "import-ics", title: "Import calendar (.ics)" }, async () => {
        const files = await ctx.files.pick({ accept: [".ics"] });
        if (files.length === 0) return;
        const text = await files[0].readText();
        const events = parseIcs(text).filter((event) => event.startsAt > Date.now()).slice(0, 50);
        await ctx.storage.set("events", events);
        await ctx.pet.speak(\`Imported \${events.length} upcoming events.\`);
        await armReminders();
      });

      await ctx.commands.register({ id: "whats-next", title: "What's next?" }, async () => {
        const events = (await ctx.storage.get("events")) ?? [];
        const next = events.find((event) => event.startsAt > Date.now());
        await ctx.pet.speak(next ? \`Next up: \${next.summary}\` : "Nothing on the calendar.");
      });

      await armReminders();
    },
  });
}
`,
    test: () => `${sharedTestHeader}
const PERMISSIONS = ["pet:speak", "pet:interact", "pet:pin", "pet:reaction", "commands", "status", "schedule", "storage", "files", "notify"];
const h = createTestHarness(register, { permissions: PERMISSIONS, config: { reminderMinutes: 10 } });
const startsAt = new Date(h.clock.now() + 60 * 60_000);
const stamp = startsAt.toISOString().replace(/[-:]/g, "").replace(/\\.\\d{3}/, "");
h.files.provide([{ name: "work.ics", text: "BEGIN:VEVENT\\nSUMMARY:Standup\\nDTSTART:" + stamp + "\\nEND:VEVENT" }]);
await h.start();
await h.runCommand("import-ics");
h.expectSpoke(/imported 1 upcoming/i);
h.expectBubble({ pin: true });
h.expectScheduled("next-event-reminder");
await h.clock.advance("51m");
h.expectNotified(/standup/i);
h.expectNoErrors();
console.log("calendar template tests passed.");
`,
  },
};
