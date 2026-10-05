import { isAdmin } from "../../config/env";
import {
  chatTypeLabel,
  getChatByTelegramId,
  listChatsForUser,
  telegramChatIdOf,
  type ChatWithSettings,
} from "../../services/chat.service";
import type { BotContext } from "../context";
import { chatPickKeyboard, settingsKeyboard, settingsText } from "../keyboards";

export async function canManage(ctx: BotContext, chat: ChatWithSettings): Promise<boolean> {
  if (!ctx.from) return false;
  if (isAdmin(ctx.from.id) || BigInt(ctx.from.id) === chat.owner.telegramId) {
    return true;
  }

  try {
    const member = await ctx.api.getChatMember(telegramChatIdOf(chat), ctx.from.id);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

export async function sendSettings(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!(await canManage(ctx, chat))) {
    await ctx.reply("Bu chat sozlamalarini faqat admin o'zgartiradi.");
    return;
  }

  ctx.session.lastChatId = chat.id;
  const extra = { parse_mode: "HTML" as const, reply_markup: settingsKeyboard(chat) };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(settingsText(chat), extra).catch(async () => {
      await ctx.reply(settingsText(chat), extra);
    });
    return;
  }
  await ctx.reply(settingsText(chat), extra);
}

export async function settingsCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  if (ctx.chat && ctx.chat.type !== "private") {
    const chat = await getChatByTelegramId(ctx.chat.id);
    if (!chat) {
      await ctx.reply("Bu chat hali ro'yxatda yo'q. Botni qayta admin qilib qo'shing.");
      return;
    }
    await sendSettings(ctx, chat);
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  if (chats.length === 0) {
    await ctx.reply("Sozlanadigan chat yo'q. Avval botni guruh yoki kanalga qo'shing.");
    return;
  }
  if (chats.length === 1) {
    const only = chats[0];
    if (only) await sendSettings(ctx, only);
    return;
  }

  await ctx.reply("Qaysi chat sozlamasini ochamiz?", {
    reply_markup: chatPickKeyboard("settings", chats),
  });
}

export function formatChatLine(chat: ChatWithSettings): string {
  return `${chat.title} (${chatTypeLabel(chat.type)})`;
}
