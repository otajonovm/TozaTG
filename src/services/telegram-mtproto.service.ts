import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { FloodWaitError } from "telegram/errors";
import { env } from "../config/env";
import { sleep } from "../lib/sleep";

const MEMBER_PAGE = 200;

let client: TelegramClient | null = null;

export function hasMtprotoSession(): boolean {
  return env.MTPROTO_SESSION.trim().length > 0;
}

export async function getMtprotoClient(): Promise<TelegramClient> {
  if (!hasMtprotoSession()) {
    throw new Error("MTPROTO_SESSION bo'sh. Kanal a'zolarini o'qish uchun foydalanuvchi sessiyasi kerak.");
  }

  if (client?.connected) {
    shieldPrivateFullChannel(client);
    return client;
  }

  client = new TelegramClient(new StringSession(env.MTPROTO_SESSION), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 5,
    floodSleepThreshold: 60,
  });

  await client.connect();
  shieldPrivateFullChannel(client);
  return client;
}

function isFullChannelRequest(request: object): boolean {
  return "className" in request && request.className === "channels.GetFullChannel";
}

/**
 * GramJS a'zolar soni uchun channels.GetFullChannel chaqiradi.
 * Yopiq kanal buni CHANNEL_PRIVATE bilan rad etadi va skanerni yiqitadi.
 * So'rovni yutib, ro'yxatni o'qish davom etadi.
 */
function shieldPrivateFullChannel(telegram: TelegramClient): void {
  const marked = telegram as TelegramClient & { fullChannelShield?: boolean };
  if (marked.fullChannelShield) return;
  marked.fullChannelShield = true;
  const raw = telegram.invoke.bind(telegram);
  telegram.invoke = (async (request: Api.AnyRequest, dcId?: number) => {
    try {
      return await raw(request, dcId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isFullChannelRequest(request) && message.includes("CHANNEL_PRIVATE")) {
        console.warn("[mtproto] yopiq kanal GetFullChannel ni rad etdi, a'zolar ro'yxati davom etadi");
        return { fullChat: { participantsCount: 1 }, chats: [], users: [] };
      }
      throw error;
    }
  }) as TelegramClient["invoke"];
}

function isUser(user: Api.TypeUser): user is Api.User {
  return user.className === "User";
}

/** A'zolarni channels.GetFullChannel chaqirmasdan o'qiydi. */
export async function* iterateMembers(
  telegram: TelegramClient,
  entity: Api.Channel | Api.Chat,
): AsyncGenerator<Api.User> {
  if (entity.className === "Chat") {
    const full = await telegram.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
    if (!(full.fullChat instanceof Api.ChatFull)) return;
    const participants = full.fullChat.participants;
    if (!(participants instanceof Api.ChatParticipants)) return;
    const byId = new Map(full.users.filter(isUser).map((user) => [user.id.toString(), user]));
    for (const participant of participants.participants) {
      if (!("userId" in participant)) continue;
      const user = byId.get(participant.userId.toString());
      if (user) yield user;
    }
    return;
  }

  let offset = 0;
  while (true) {
    let page: Api.channels.TypeChannelParticipants;
    try {
      page = await telegram.invoke(
        new Api.channels.GetParticipants({
          channel: entity,
          filter: new Api.ChannelParticipantsSearch({ q: "" }),
          offset,
          limit: MEMBER_PAGE,
          hash: bigInt.zero,
        }),
      );
    } catch (error) {
      if (await waitForFlood(error)) continue;
      throw error;
    }
    if (page.className !== "channels.ChannelParticipants" || page.users.length === 0) return;
    for (const user of page.users) {
      if (isUser(user)) yield user;
    }
    const count = page.participants.length;
    offset += count;
    if (count < MEMBER_PAGE) return;
  }
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
