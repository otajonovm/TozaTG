import { Api as GrammyApi, GrammyError } from "grammy";
import { Api as TgApi } from "telegram";
import { env } from "../config/env";
import { sleep } from "../lib/sleep";
import { toTelegramNumber } from "../lib/telegram-id";
import { getMtprotoClient, hasMtprotoSession, resolveChat, waitForFlood } from "./telegram-mtproto.service";

export interface ClearResult {
  deleted: number;
  note?: string;
}

type DeleteOutcome = "deleted" | "missing" | "forbidden";

function pauseMs(): number {
  return 1000 + Math.floor(Math.random() * 501);
}

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 429) {
        const retryAfter = error.parameters?.retry_after ?? 2;
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      throw error;
    }
  }
}

function outcomeFromError(error: GrammyError): DeleteOutcome {
  const description = error.description.toLowerCase();
  if (
    description.includes("can't be deleted") ||
    description.includes("not enough rights") ||
    description.includes("have no rights") ||
    description.includes("chat_admin_required")
  ) {
    return "forbidden";
  }
  return "missing";
}

async function deleteOne(api: GrammyApi, chatId: number, messageId: number): Promise<DeleteOutcome> {
  try {
    await withRetry(() => api.deleteMessage(chatId, messageId));
    return "deleted";
  } catch (error) {
    if (error instanceof GrammyError && error.error_code === 400) return outcomeFromError(error);
    throw error;
  }
}

async function deleteIds(
  api: GrammyApi,
  chatId: number,
  ids: number[],
  onProgress: ((deleted: number) => Promise<void>) | undefined,
  deletedSoFar: number,
): Promise<{ deleted: number; forbidden: number[] }> {
  let deleted = deletedSoFar;
  const forbidden: number[] = [];
  for (let index = 0; index < ids.length; index += 8) {
    const slice = ids.slice(index, index + 8);
    const results = await Promise.all(slice.map((id) => deleteOne(api, chatId, id)));
    results.forEach((result, resultIndex) => {
      if (result === "deleted") deleted += 1;
      if (result === "forbidden") {
        const id = slice[resultIndex];
        if (id !== undefined) forbidden.push(id);
      }
    });
    if (onProgress && deleted > deletedSoFar && deleted % 400 < 8) await onProgress(deleted);
    await sleep(350);
  }
  return { deleted, forbidden };
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

async function openForReading(
  client: Awaited<ReturnType<typeof getMtprotoClient>>,
  api: GrammyApi,
  chatId: number,
): Promise<{ entity: TgApi.Channel | TgApi.Chat; leave: boolean }> {
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
      const text = error instanceof Error ? error.message : String(error);
      if (!text.includes("USER_ALREADY_PARTICIPANT")) throw error;
    }
    return { entity: resolved, leave };
  }

  const link = await api.createChatInviteLink(chatId, { name: "TozaTG", member_limit: 1 });
  try {
    const hash = inviteHash(link.invite_link);
    try {
      const updates = await client.invoke(new TgApi.messages.ImportChatInvite({ hash }));
      const entity = channelFromUpdates(updates);
      if (!entity) throw new Error("Yopiq kanalga kirib bo'lmadi");
      return { entity, leave: true };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!text.includes("USER_ALREADY_PARTICIPANT") && !text.includes("Yopiq kanalga kirib")) throw error;
      if (text.includes("Yopiq kanalga kirib")) throw error;
      const entity = await resolveChat(client, BigInt(chatId));
      return { entity, leave: false };
    }
  } finally {
    await api.revokeChatInviteLink(chatId, link.invite_link).catch(() => undefined);
  }
}

type MtprotoClient = Awaited<ReturnType<typeof getMtprotoClient>>;
type ReadableEntity = TgApi.Channel | TgApi.Chat;

type SeenMessage = { id: number; service: boolean };

async function listSeen(client: MtprotoClient, entity: ReadableEntity): Promise<SeenMessage[]> {
  const seen: SeenMessage[] = [];
  let offsetId = 0;

  while (true) {
    try {
      const page = offsetId > 0 ? { offsetId } : {};
      for await (const message of client.iterMessages(entity, page)) {
        if (typeof message.id !== "number") continue;
        offsetId = message.id;
        const kind = message.className as string;
        seen.push({ id: message.id, service: kind === "MessageService" });
      }
      return seen;
    } catch (error) {
      const waited = await waitForFlood(error);
      if (waited) continue;
      throw error;
    }
  }
}

/** Ko'ringan oxirgi raqamdan keyin yana xabar bormi — bo'shliqni 40 tagacha o'tkazib yuboradi. */
async function raiseMaxId(api: GrammyApi, chatId: number, start: number): Promise<number> {
  let max = start;
  let misses = 0;
  for (let id = start + 1; id <= start + 2000 && misses < 40; id += 1) {
    const outcome = await deleteOne(api, chatId, id);
    if (outcome === "missing") misses += 1;
    else {
      max = id;
      misses = 0;
    }
    if (id % 10 === 0) await sleep(300);
  }
  return max;
}

async function invokeWithRetry<T>(work: () => Promise<T>): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempt += 1;
      if (attempt < 4 && message.includes("CHAT_ADMIN_REQUIRED")) {
        await sleep(2000);
        continue;
      }
      const waited = await waitForFlood(error);
      if (waited) continue;
      throw error;
    }
  }
}

async function clearEntireHistory(client: MtprotoClient, entity: ReadableEntity, maxId: number): Promise<void> {
  await invokeWithRetry(async () => {
    if (entity.className === "Channel") {
      await client.invoke(
        new TgApi.channels.DeleteHistory({
          channel: entity,
          maxId,
          forEveryone: true,
        }),
      );
      return;
    }
    await client.invoke(
      new TgApi.messages.DeleteHistory({
        peer: entity,
        maxId,
        revoke: true,
      }),
    );
  });
}

async function deleteIdRange(
  client: MtprotoClient,
  entity: ReadableEntity,
  maxId: number,
  onProgress?: (deleted: number) => Promise<void>,
): Promise<number> {
  let removed = 0;
  for (let start = 1; start <= maxId; start += 100) {
    const end = Math.min(maxId, start + 99);
    const ids: number[] = [];
    for (let id = start; id <= end; id += 1) ids.push(id);
    const affected = await invokeWithRetry(() => deleteBatchCount(client, entity, ids));
    removed += affected;
    if (onProgress && end % 500 < 100) await onProgress(end);
    await sleep(pauseMs());
  }
  return removed;
}

async function deleteBatchCount(client: MtprotoClient, entity: ReadableEntity, ids: number[]): Promise<number> {
  if (entity.className === "Channel") {
    const result = await client.invoke(new TgApi.channels.DeleteMessages({ channel: entity, id: ids }));
    return result.ptsCount ?? 0;
  }
  const result = await client.invoke(new TgApi.messages.DeleteMessages({ id: ids, revoke: true }));
  return result.ptsCount ?? 0;
}

async function demoteUser(api: GrammyApi, chatId: number, userId: number): Promise<void> {
  await api
    .promoteChatMember(chatId, userId, {
      is_anonymous: false,
      can_manage_chat: false,
      can_delete_messages: false,
      can_post_messages: false,
      can_edit_messages: false,
      can_invite_users: false,
      can_restrict_members: false,
      can_pin_messages: false,
      can_promote_members: false,
      can_change_info: false,
      can_manage_video_chats: false,
    })
    .catch(() => undefined);
}

/** Ulangan akkauntni vaqtincha admin qiladi. Qaytgan id ni keyin adminlikdan olish kerak. */
async function promoteForDelete(
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

  const alreadyDeletes =
    member?.status === "creator" ||
    (member?.status === "administrator" && member.can_delete_messages === true);
  if (alreadyDeletes) return null;
  if (!canPromote) {
    throw new Error("Botda «Admin qo'shish» yoqilmagan. Shu huquqni yoqing.");
  }

  try {
    await api.promoteChatMember(chatId, userId, {
      can_manage_chat: true,
      can_delete_messages: true,
    });
  } catch (error) {
    const text = error instanceof GrammyError ? error.description : error instanceof Error ? error.message : String(error);
    throw new Error(`Ulangan akkaunt admin qilinmadi: ${text}`);
  }
  return userId;
}

async function waitUntilCanDelete(api: GrammyApi, chatId: number, userId: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1000);
    try {
      const updated = await api.getChatMember(chatId, userId);
      if (updated.status === "administrator" && updated.can_delete_messages === true) return;
    } catch {
      // A'zo ro'yxati yangilanmagan bo'lishi mumkin.
    }
  }
  throw new Error("Ulangan akkaunt admin bo'ldi, lekin «Xabarlarni o'chirish» huquqi yoqilmadi.");
}

async function clearByReadingHistory(
  telegramChatId: bigint,
  onProgress?: (deleted: number) => Promise<void>,
): Promise<ClearResult> {
  if (!hasMtprotoSession()) {
    throw new Error("Postlarni o'qish uchun admin akkaunt sessiyasi kerak.");
  }

  const api = new GrammyApi(env.BOT_TOKEN);
  const chatId = toTelegramNumber(telegramChatId);
  const me = await api.getMe();
  const member = await api.getChatMember(chatId, me.id);
  const canDelete =
    member.status === "creator" ||
    (member.status === "administrator" && member.can_delete_messages !== false);
  const canPromote =
    member.status === "creator" ||
    (member.status === "administrator" && member.can_promote_members === true);
  if (!canDelete && !canPromote) {
    throw new Error("Botga «Xabarlarni o'chirish» yoki «Admin qo'shish» huquqini bering.");
  }

  const client = await getMtprotoClient();
  const opened = await openForReading(client, api, chatId);
  let promotedId: number | null = null;

  try {
    const seen = await listSeen(client, opened.entity);
    if (seen.length === 0) {
      return { deleted: 0, note: "O'chiriladigan post topilmadi." };
    }

    const visibleMax = seen.reduce((max, item) => Math.max(max, item.id), 0);
    const maxId = await raiseMaxId(api, chatId, visibleMax);
    console.warn(`[fresh] chat ${chatId} ko'ringan=${seen.length} maxId=${maxId}`);

    promotedId = await promoteForDelete(api, client, chatId, canPromote);
    if (promotedId !== null) await waitUntilCanDelete(api, chatId, promotedId);

    let historyOk = false;
    try {
      await clearEntireHistory(client, opened.entity, maxId);
      historyOk = true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.warn(`[fresh] butun tarixni o'chirish rad etildi: ${text}`);
    }

    const stillNormal = (await listSeen(client, opened.entity)).some((item) => !item.service);
    let rangeRemoved = 0;
    if (!historyOk || stillNormal) {
      rangeRemoved = await deleteIdRange(client, opened.entity, maxId, onProgress);
    }

    const leftNormal = (await listSeen(client, opened.entity)).filter((item) => !item.service);
    if (leftNormal.length > 0 && !historyOk && rangeRemoved === 0) {
      throw new Error(
        "Xabarlar topildi, lekin o'chmadi. Botda «Xabarlarni o'chirish» va «Admin qo'shish» yoqilgan bo'lishi kerak.",
      );
    }

    if (!historyOk && rangeRemoved === 0 && leftNormal.length === 0) {
      return { deleted: 0, note: "Faqat o'chmaydigan xizmat xabarlari qoldi." };
    }

    if (onProgress) await onProgress(historyOk ? maxId : rangeRemoved);
    return {
      deleted: historyOk ? maxId : rangeRemoved,
      note: "Guruh ochilgani haqidagi xizmat xabari qolishi mumkin.",
    };
  } finally {
    if (promotedId !== null) await demoteUser(api, chatId, promotedId);
    if (opened.leave && opened.entity.className === "Channel") {
      await client.invoke(new TgApi.channels.LeaveChannel({ channel: opened.entity })).catch(() => undefined);
    }
  }
}

/**
 * Kanaldagi postlar va guruhdagi xabarlarni o'chiradi.
 * 48 soatdan eski xabarlarni bot tokeni o'chira olmaydi, shuning uchun
 * ulangan akkaunt vaqtincha admin bo'lib oxirgi xabargacha tarixni tozalaydi.
 */
export async function clearChatHistory(
  telegramChatId: bigint,
  _sinkChatId: number,
  onProgress?: (deleted: number) => Promise<void>,
): Promise<ClearResult> {
  return clearByReadingHistory(telegramChatId, onProgress);
}
