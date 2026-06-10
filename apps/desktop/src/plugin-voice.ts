import { BrowserWindow, session } from "electron";

import { getDefaultPetWindowForPlugins } from "./default-pet-controller.js";
import { debug } from "./logger.js";
import { speakPetWindowTts, stopPetWindowTts } from "./pet-window.js";
import type { PluginAiGateway } from "./plugin-ai-gateway.js";

/**
 * Plugin voice (§13.5). TTS speaks through the pet window's renderer
 * speechSynthesis (the OS voice). STT is strictly one-shot push-to-talk: a
 * dedicated capture window records a bounded clip in its own session (the only
 * session granted microphone permission), and the clip is transcribed through
 * the user's configured AI provider. Never ambient.
 */

export async function pluginVoiceSpeak(text: string, opts: { voice?: string; rate?: number }): Promise<void> {
  const window = getDefaultPetWindowForPlugins();
  if (!window) throw new Error("No pet window is available for speech.");
  speakPetWindowTts(window, text, opts);
}

export function pluginVoiceStop(): void {
  const window = getDefaultPetWindowForPlugins();
  if (window) stopPetWindowTts(window);
}

let listenInProgress = false;

export async function pluginVoiceListen(gateway: PluginAiGateway, opts: { timeoutMs: number }): Promise<{ text: string }> {
  if (listenInProgress) throw new Error("A voice capture is already in progress.");
  listenInProgress = true;
  try {
    const audio = await captureMicrophoneClip(opts.timeoutMs);
    const text = await gateway.transcribe(audio, "audio/webm");
    return { text };
  } finally {
    listenInProgress = false;
  }
}

async function captureMicrophoneClip(timeoutMs: number): Promise<Uint8Array> {
  const partition = `openpets-voice-capture:${Date.now()}`;
  const captureSession = session.fromPartition(partition, { cache: false });
  // The one and only session where the microphone is allowed, per capture.
  captureSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "media"));
  captureSession.setPermissionCheckHandler((_contents, permission) => permission === "media");

  const window = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition },
  });
  try {
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    debug("plugin", "voice capture starting", { timeoutMs });
    const base64 = await window.webContents.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, ${Math.min(Math.max(timeoutMs, 1_000), 30_000)}));
      recorder.stop();
      await stopped;
      for (const track of stream.getTracks()) track.stop();
      const blob = new Blob(chunks, { type: "audio/webm" });
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
      return btoa(binary);
    })()`, true) as string;
    const bytes = Buffer.from(base64, "base64");
    if (bytes.byteLength < 128) throw new Error("Voice capture produced no audio.");
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Voice capture is too large.");
    return bytes;
  } finally {
    if (!window.isDestroyed()) window.destroy();
    void captureSession.clearStorageData().catch(() => undefined);
  }
}
