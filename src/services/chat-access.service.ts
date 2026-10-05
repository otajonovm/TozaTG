import { Api as GrammyApi, GrammyError } from "grammy";
import { Api as TgApi } from "telegram";
import { env } from "../config/env";
import { sleep } from "../lib/sleep";
import { toTelegramNumber } from "../lib/telegram-id";
import { getMtprotoClient, resolveChat } from "./telegram-mtproto.service";

type MtprotoClient = Awaited<ReturnType<typeof getMtprotoClient>>;
type ReadableEntity = TgApi.Channel | TgApi.Chat;

function errorText(error: unknown): string {
  if (error instanceof GrammyError) return error.description;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isHiddenFromUser(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("ko'rmayapti") || text.includes("CHANNEL_INVALID") || text.includes("input entity");
}

function inviteHash(link: string): string {
  const clean = link.split("?")[0] ?? link;
  const plus = clean.split("/+");
  if (plus.length > 1 && plus[plus.length - 1]) return plus[plus.length - 1] ?? "";
  const join = clean.split("/joinchat/");
  if (join.length > 1 && join[join.length - 1]) return join[join.length - 1] ?? "";
  throw new Error("Taklif havolasi o'qilmadi");
}

function channelFromUpdates(updates: TgApi.TypeUpdates): TgApi.Channel | null {
  if (!("chats" in updates)) return null;
  for (const chat of updates.chats) {
    if (chat.className === "Channel") return chat;
  }
  return null;
}

async function assertBotAdmin(api: GrammyApi, chatId: number): Promise<{ canPromote: boolean }> {
  const me = await api.getMe();
  let member: Awaited<ReturnType<GrammyApi["getChatMember"]>>;
  try {
    member = await api.getChatMember(chatId, me.id);
  } catch (error) {
    throw new Error(`Bot bu chatni ko'rmayapti. Botni admin qiling. ${errorText(error)}`);
  }
  if (member.status === "creator") return { canPromote: true };
  if (member.status !== "administrator") {
    throw new Error("Bot bu chatda admin emas. Avval botni admin qiling.");
  }
  return { canPromote: member.can_promote_members === true };
}

async function joinChat(
  client: MtprotoClient,
  api: GrammyApi,
  chatId: number,
): Promise<{ entity: ReadableEntity; leave: boolean }> {
  const chat = await api.getChat(chatId);
  const username = "username" in chat ? chat.username : undefined;

  if (username) {
    const resolved = await client.getEntity(username);
    if (resolved.className !== "Channel" && resolved.className !== "Chat") {
      throw new Error("Kanal topilmadi");
    }
    if (resolved.className === "Chat") return { entity: resolved, leave: false };
    let leave = false;
    try {
      await client.invoke(new TgApi.channels.JoinChannel({ channel: resolved }));
      leave = true;
    } catch (error) {
      if (!errorText(error).includes("USER_ALREADY_PARTICIPANT")) throw error;
    }
    return { entity: resolved, leave };
  }

  const link = await api.createChatInviteLink(chatId, { name: "TozaTG", member_limit: 1 });
  try {
    const updates = await client.invoke(new TgApi.messages.ImportChatInvite({ hash: inviteHash(link.invite_link) }));
    const entity = channelFromUpdates(updates);
    if (!entity) throw new Error("Yopiq kanalga kirib bo'lmadi");
    return { entity, leave: true };
  } catch (error) {
    if (!errorText(error).includes("USER_ALREADY_PARTICIPANT")) throw error;
    return { entity: await resolveChat(client, BigInt(chatId)), leave: false };
  } finally {
    await api.revokeChatInviteLink(chatId, link.invite_link).catch(() => undefined);
  }
}

async function promoteForReading(
  api: GrammyApi,
  client: MtprotoClient,
  chatId: number,
  canPromote: boolean,
): Promise<number | null> {
  const sessionUser = await client.getMe();
  const userId = toTelegramNumber(BigInt(sessionUser.id.toString()));
  let member: Awaited<ReturnType<GrammyApi["getChatMember"]>> | null = null;
  try {
    member = await api.getChatMember(chatId, userId);
  } catch {
    member = null;
  }
  if (member?.status === "creator" || member?.status === "administrator") return null;
  if (!canPromote) {
    throw new Error("Bot admin, lekin a'zolarni o'qish uchun unga «Admin qo'shish» huquqini yoqing.");
  }

  try {
    await api.promoteChatMember(chatId, userId, {
      can_manage_chat: true,
      can_invite_users: true,
      can_restrict_members: true,
    });
  } catch (error) {
    throw new Error(`Ulangan akkaunt vaqtincha admin qilinmadi: ${errorText(error)}`);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1000);
    try {
      const updated = await api.getChatMember(chatId, userId);
      if (updated.status === "administrator") return userId;
    } catch {
      // A'zolik yangilanmagan bo'lishi mumkin.
    }
  }
  throw new Error("Ulangan akkaunt admin bo'ldi, lekin Telegram huquqni hali ko'rsatmadi.");
}

async function demoteUser(api: GrammyApi, chatId: number, userId: number): Promise<void> {
  await api
    .promoteChatMember(chatId, userId, {
      is_anonymous: false,
      can_manage_chat: false,
      can_delete_messages: false,
      can_invite_users: false,
      can_restrict_members: false,
      can_promote_members: false,
      can_change_info: false,
      can_pin_messages: false,
      can_manage_video_chats: false,
    })
    .catch(() => undefined);
}

/**
 * Bot admin bo'lgan chatni ulangan akkauntga ochadi.
 * Akkaunt chatda bo'lmasa, bot uni kiritadi va a'zolarni o'qish uchun vaqtincha admin qiladi.
 */
export async function withManagedChat<T>(
  telegramChatId: bigint,
  work: (entity: ReadableEntity) => Promise<T>,
): Promise<T> {
  const api = new GrammyApi(env.BOT_TOKEN);
  const chatId = toTelegramNumber(telegramChatId);
  const client = await getMtprotoClient();
  const { canPromote } = await assertBotAdmin(api, chatId);

  let entity: ReadableEntity | null = null;
  let leave = false;
  try {
    entity = await resolveChat(client, telegramChatId);
  } catch (error) {
    if (!isHiddenFromUser(error)) throw error;
    const opened = await joinChat(client, api, chatId);
    entity = opened.entity;
    leave = opened.leave;
  }

  let promotedId: number | null = null;
  try {
    if (!entity) throw new Error("Chat ochilmadi.");
    if (canPromote) {
      promotedId = await promoteForReading(api, client, chatId, canPromote);
    }
    try {
      return await work(entity);
    } catch (error) {
      const text = errorText(error);
      const needsAdmin = text.includes("CHAT_ADMIN_REQUIRED") || text.includes("admin privileges");
      if (!needsAdmin || promotedId !== null) throw error;
      throw new Error("Bot admin, lekin a'zolarni o'qish uchun unga «Admin qo'shish» huquqini yoqing.");
    }
  } finally {
    if (promotedId !== null) await demoteUser(api, chatId, promotedId);
    if (leave && entity?.className === "Channel") {
      await client.invoke(new TgApi.channels.LeaveChannel({ channel: entity })).catch(() => undefined);
    }
  }
}
