import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { FloodWaitError } from "telegram/errors";
import { env } from "../config/env";
import { sleep } from "../lib/sleep";

let client: TelegramClient | null = null;

export function hasMtprotoSession(): boolean {
  return env.MTPROTO_SESSION.trim().length > 0;
}

export async function getMtprotoClient(): Promise<TelegramClient> {
  if (!hasMtprotoSession()) {
    throw new Error("MTPROTO_SESSION bo'sh. Kanal a'zolarini o'qish uchun foydalanuvchi sessiyasi kerak.");
  }

  if (client?.connected) {
    return client;
  }

  client = new TelegramClient(new StringSession(env.MTPROTO_SESSION), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 5,
    floodSleepThreshold: 60,
  });

  await client.connect();
  return client;
}

export function floodWaitSeconds(error: unknown): number | null {
  if (error instanceof FloodWaitError) {
    return error.seconds;
  }
  if (typeof error === "object" && error !== null && "seconds" in error) {
    const seconds = (error as { seconds?: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return seconds;
    }
  }
  return null;
}

export async function waitForFlood(error: unknown): Promise<boolean> {
  const seconds = floodWaitSeconds(error);
  if (seconds === null || seconds < 0) return false;
  const waitMs = (seconds + 1) * 1000;
  console.warn(`[mtproto] FloodWait ${seconds}s — jarayon kutmoqda`);
  await sleep(waitMs);
  return true;
}

function peerId(telegramChatId: bigint): string {
  const raw = telegramChatId.toString();
  if (raw.startsWith("-100")) return raw.slice(4);
  if (raw.startsWith("-")) return raw.slice(1);
  return raw;
}

/** Bot API chat id ni GramJS ko'radigan kanal yoki guruhga aylantiradi. */
export async function resolveChat(client: TelegramClient, telegramChatId: bigint): Promise<Api.Channel | Api.Chat> {
  const target = peerId(telegramChatId);
  for await (const dialog of client.iterDialogs({})) {
    const entity = dialog.entity;
    if (!entity || (entity.className !== "Channel" && entity.className !== "Chat")) continue;
    if (entity.id.toString() === target) return entity;
  }

  throw new Error("Ulangan akkaunt bu chatni ko'rmayapti. U ham shu kanal yoki guruhda admin bo'lishi kerak.");
}

export async function disconnectMtproto(): Promise<void> {
  if (!client) return;
  try {
    await client.disconnect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[mtproto] uzishda xato: ${message}`);
  } finally {
    client = null;
  }
}
