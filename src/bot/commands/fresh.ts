import { InlineKeyboard } from "grammy";
import { isAdmin } from "../../config/env";
import { clearChatHistory } from "../../services/history.service";
import { notifyUser } from "../../services/notify.service";
import { chatTypeLabel, listChatsForUser, type ChatWithSettings } from "../../services/chat.service";
import type { BotContext } from "../context";
import { chatPickKeyboard } from "../keyboards";
import { canManage } from "./settings";

const wiping = new Set<string>();

export function freshKeyboard(chatId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Ha, hammasini o'chir", `fresh:yes:${chatId}`)
    .row()
    .text("Yo'q, qoldir", `fresh:no:${chatId}`);
}

export function freshPrompt(chat: ChatWithSettings): string {
  return [
    `${chat.title} (${chatTypeLabel(chat.type)}) yangi ochilgan holatga keltiriladi.`,
    "Kanaldagi postlar va guruhdagi xabarlar o'chadi.",
    "Buni qaytarib bo'lmaydi.",
    "",
    "Davom etaymi?",
  ].join("\n");
}

export function beginFreshWipe(chat: ChatWithSettings, requesterTelegramId: number): boolean {
  if (wiping.has(chat.id)) return false;
  wiping.add(chat.id);

  void (async () => {
    try {
      await notifyUser(BigInt(requesterTelegramId), `${chat.title}: post va xabarlar o'chirilmoqda.`);
      const result = await clearChatHistory(chat.telegramChatId, requesterTelegramId, async (count) => {
        await notifyUser(BigInt(requesterTelegramId), `${chat.title}: ${count} ta xabar o'chirildi.`);
      });
      const summary =
        result.deleted === 0
          ? `${chat.title}: o'chiriladigan post topilmadi.`
          : `${chat.title}: ${result.deleted} ta post va xabar o'chirildi. Chat yangi ochilgan holatga keldi.`;
      await notifyUser(BigInt(requesterTelegramId), result.note ? `${summary}\n${result.note}` : summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await notifyUser(BigInt(requesterTelegramId), `${chat.title}: tozalab bo'lmadi. ${message.slice(0, 300)}`);
    } finally {
      wiping.delete(chat.id);
    }
  })();

  return true;
}

export async function freshCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Yangi holatga keltirishni shaxsiy chatda boshlang: /fresh");
    return;
  }
  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  const manageable: ChatWithSettings[] = [];
  for (const chat of chats) {
    if (await canManage(ctx, chat)) manageable.push(chat);
  }
  if (manageable.length === 0) {
    await ctx.reply("Chat topilmadi. Botni avval kanal yoki guruhga admin qiling.");
    return;
  }
  if (manageable.length === 1) {
    const only = manageable[0];
    if (!only) return;
    await ctx.reply(freshPrompt(only), { reply_markup: freshKeyboard(only.id) });
    return;
  }

  await ctx.reply("Qaysi chatni yangi ochilgan holatga keltiramiz?", {
    reply_markup: chatPickKeyboard("fresh", manageable),
  });
}
