import { isAdmin } from "../../config/env";
import { getChatStats } from "../../services/analytics.service";
import { chatTypeLabel, listChatsForUser } from "../../services/chat.service";
import type { BotContext } from "../context";

export async function myChatsCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Chatlar ro'yxati shaxsiy chatda. Menga /mychats deb yozing.");
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  if (chats.length === 0) {
    await ctx.reply("Hali chat yo'q. Botni kanal yoki guruhga admin qilib qo'shing, so'ng /mychats ni qayta yuboring.");
    return;
  }

  const lines: string[] = ["Ulangan chatlar:", ""];
  for (const chat of chats) {
    const stats = await getChatStats(chat.id);
    lines.push(
      `• ${chat.title} (${chatTypeLabel(chat.type)})`,
      `  skaner: ${stats.total}, o'chirilgan: ${stats.deleted}, bot: ${stats.bots}, premium: ${stats.premium}`,
    );
  }
  lines.push("", "Sozlash: /settings", "Skaner: /scan", "Tozalash: /clean");

  await ctx.reply(lines.join("\n"));
}
