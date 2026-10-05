import { InlineKeyboard, InputFile } from "grammy";
import { isAdmin } from "../../config/env";
import { AuditError, buildAudit, type AuditReport } from "../../services/audit.service";
import { renderAuditCard } from "../../services/audit-card";
import { getChatByTelegramId, listChatsForUser, telegramChatIdOf, type ChatWithSettings } from "../../services/chat.service";
import { escapeHtml } from "../html";
import type { BotContext } from "../context";
import { chatPickKeyboard } from "../keyboards";
import { canManage } from "./settings";

const running = new Set<string>();

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function auditCaption(report: AuditReport): string {
  const name = report.username ? `${escapeHtml(report.title)} (@${escapeHtml(report.username)})` : escapeHtml(report.title);
  return [
    `<b>Kanal Tozalik Pasporti</b>`,
    name,
    "",
    `A'zolar: ${report.total}`,
    `O'chirilgan: ${report.deleted} (${formatPercent(report.deadPercent)}%)`,
    `Premium: ${report.premium} (${formatPercent(report.premiumPercent)}%)`,
    `Botlar: ${report.bots} (${formatPercent(report.botPercent)}%)`,
    `Tozalik: ${report.score}/100 (${escapeHtml(report.grade)})`,
    "",
    "Ushbu hisobot TozaTG boti tomonidan tekshirildi.",
  ].join("\n");
}

export function auditKeyboard(chatId: string): InlineKeyboard {
  return new InlineKeyboard().text("O'lik akkauntlarni tozalash", `audit:clean:${chatId}`);
}

async function channelUsername(ctx: BotContext, chat: ChatWithSettings): Promise<string | null> {
  try {
    const info = await ctx.api.getChat(telegramChatIdOf(chat));
    return "username" in info && info.username ? info.username : null;
  } catch {
    return null;
  }
}

export async function runAudit(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!(await canManage(ctx, chat))) {
    await ctx.reply("Auditni faqat chat admini olishi mumkin.");
    return;
  }
  if (running.has(chat.id)) {
    await ctx.reply(`${chat.title}: audit allaqachon ketmoqda.`);
    return;
  }

  running.add(chat.id);
  const pending = await ctx.reply(`${chat.title}: tozalik pasporti tayyorlanmoqda.`);
  try {
    const username = await channelUsername(ctx, chat);
    const report = await buildAudit({
      chatId: chat.id,
      telegramChatId: chat.telegramChatId,
      title: chat.title,
      username,
    });
    const image = renderAuditCard(report);
    await ctx.replyWithPhoto(new InputFile(image, "tozatg-audit.png"), {
      caption: auditCaption(report),
      parse_mode: "HTML",
      reply_markup: auditKeyboard(chat.id),
    });
    await ctx.api.deleteMessage(pending.chat.id, pending.message_id).catch(() => undefined);
  } catch (error) {
    const message = error instanceof AuditError ? error.message : "Pasportni yig'ib bo'lmadi. Birozdan so'ng qayta urinib ko'ring.";
    if (!(error instanceof AuditError)) {
      console.error(`[audit] ${error instanceof Error ? error.message : String(error)}`);
    }
    await ctx.reply(`${chat.title}: ${message}`).catch(() => undefined);
  } finally {
    running.delete(chat.id);
  }
}

export async function auditCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  if (ctx.chat && ctx.chat.type !== "private") {
    const chat = await getChatByTelegramId(ctx.chat.id);
    if (!chat) {
      await ctx.reply("Bu chat ro'yxatda yo'q. Botni admin qilib qayta qo'shing.");
      return;
    }
    await runAudit(ctx, chat);
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  if (chats.length === 0) {
    await ctx.reply("Chat topilmadi. Botni avval kanal yoki guruhga admin qiling.");
    return;
  }
  if (chats.length === 1) {
    const only = chats[0];
    if (only) await runAudit(ctx, only);
    return;
  }

  await ctx.reply("Qaysi kanalning tozalik pasportini chiqaramiz?", {
    reply_markup: chatPickKeyboard("audit", chats),
  });
}
