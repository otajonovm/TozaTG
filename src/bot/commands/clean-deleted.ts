import { InlineKeyboard } from "grammy";
import { isAdmin } from "../../config/env";
import {
  cleanDeletedPrompt,
  countRemovableMembers,
  enqueueCleanDeleted,
  scannedMemberCount,
} from "../../services/clean-deleted.service";
import { getChatByTelegramId, listChatsForUser, type ChatWithSettings } from "../../services/chat.service";
import type { BotContext } from "../context";
import { chatPickKeyboard } from "../keyboards";
import { canManage } from "./settings";

export function cleanDeletedKeyboard(chatId: string): InlineKeyboard {
  return new InlineKeyboard().text("Ha, tozalashni boshlash", `cdel:yes:${chatId}`);
}

export async function promptCleanDeleted(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!(await canManage(ctx, chat))) {
    await ctx.reply("Tozalashni faqat chat admini boshlay oladi.");
    return;
  }

  const scanned = await scannedMemberCount(chat.id);
  if (scanned === 0) {
    await ctx.reply(`${chat.title} hali skanerlanmagan. Avval /scan yuboring.`);
    return;
  }

  const counts = await countRemovableMembers(chat.id);
  if (counts.total === 0) {
    await ctx.reply(`${chat.title}: chiqariladigan o'chirilgan akkaunt yoki bot yo'q.`);
    return;
  }

  await ctx.reply(cleanDeletedPrompt(counts), {
    reply_markup: cleanDeletedKeyboard(chat.id),
  });
}

export async function beginCleanDeleted(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!(await canManage(ctx, chat))) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  const counts = await countRemovableMembers(chat.id);
  if (counts.total === 0) {
    await ctx.answerCallbackQuery({ text: "Chiqariladigan a'zo qolmadi.", show_alert: true });
    return;
  }

  const message = ctx.callbackQuery?.message;
  const progressChatId = message && "chat" in message ? message.chat.id : ctx.chat?.id;
  const progressMessageId = message?.message_id;
  if (!progressChatId || !progressMessageId) {
    await ctx.answerCallbackQuery({ text: "Xabar topilmadi.", show_alert: true });
    return;
  }

  const { alreadyRunning } = await enqueueCleanDeleted({
    chatId: chat.id,
    total: counts.total,
    progressChatId,
    progressMessageId,
  });

  await ctx.answerCallbackQuery({ text: alreadyRunning ? "Allaqachon ketmoqda." : "Boshlandi." });
  const text = alreadyRunning
    ? `${chat.title}: tozalash allaqachon ketmoqda.`
    : `${chat.title}: tozalanmoqda\n░░░░░░░░░░ 0%\n0 / ${counts.total}`;
  await ctx.editMessageText(text).catch(() => undefined);
}

export async function cleanDeletedCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  if (ctx.chat && ctx.chat.type !== "private") {
    const chat = await getChatByTelegramId(ctx.chat.id);
    if (!chat) {
      await ctx.reply("Bu chat ro'yxatda yo'q. Botni admin qilib qayta qo'shing.");
      return;
    }
    await promptCleanDeleted(ctx, chat);
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  if (chats.length === 0) {
    await ctx.reply("Chat topilmadi. Botni avval kanal yoki guruhga admin qiling.");
    return;
  }
  if (chats.length === 1) {
    const only = chats[0];
    if (only) await promptCleanDeleted(ctx, only);
    return;
  }

  await ctx.reply("Qaysi kanalni sotuvga tayyorlaymiz?", {
    reply_markup: chatPickKeyboard("cdel", chats),
  });
}
