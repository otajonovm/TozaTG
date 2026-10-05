import { InlineKeyboard } from "grammy";
import { isAdmin } from "../../config/env";
import { AuditError, buildAudit } from "../../services/audit.service";
import { averageRecentViews } from "../../services/channel-views.service";
import { getChatByTelegramId, listChatsForUser, telegramChatIdOf, type ChatWithSettings } from "../../services/chat.service";
import {
  formatMoney,
  formatValuation,
  isTopicId,
  valueChannel,
  TOPICS,
  type TopicId,
} from "../../services/valuation.service";
import type { BotContext } from "../context";
import { chatPickKeyboard } from "../keyboards";
import { canManage } from "./settings";

interface EstimateDraft {
  chatDbId: string;
  title: string;
  realMembers: number;
  deletedPercent: number;
  views: number | null;
  viewsSource: "scan" | "manual" | null;
  topic: TopicId | null;
  step: "topic" | "views";
}

const drafts = new Map<number, EstimateDraft>();

function topicKeyboard(chatId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const topic of Object.values(TOPICS)) {
    keyboard.text(topic.label, `est:${topic.id}:${chatId}`).row();
  }
  return keyboard;
}

async function channelUsername(ctx: BotContext, chat: ChatWithSettings): Promise<string | null> {
  try {
    const info = await ctx.api.getChat(telegramChatIdOf(chat));
    return "username" in info && info.username ? info.username : null;
  } catch {
    return null;
  }
}

function sendReport(ctx: BotContext, draft: EstimateDraft): Promise<unknown> {
  if (!draft.topic || draft.views === null) {
    return ctx.reply("Baholash uchun mavzu va ko'rish soni kerak.");
  }
  const report = valueChannel({
    topic: draft.topic,
    views: draft.views,
    realMembers: draft.realMembers,
    deletedPercent: draft.deletedPercent,
  });
  const source =
    draft.viewsSource === "scan"
      ? "Ko'rish soni oxirgi postlar o'rtachasidan olindi."
      : "Ko'rish sonini siz kiritdingiz.";
  return ctx.reply(`${formatValuation(report)}\n\n${source}`);
}

export async function startEstimate(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!ctx.from) return;
  if (!(await canManage(ctx, chat))) {
    await ctx.reply("Bahoni faqat chat admini ko'ra oladi.");
    return;
  }

  const pending = await ctx.reply(`${chat.title}: a'zolar va ko'rishlar tekshirilmoqda.`);
  try {
    const username = await channelUsername(ctx, chat);
    const audit = await buildAudit({
      chatId: chat.id,
      telegramChatId: chat.telegramChatId,
      title: chat.title,
      username,
    });
    const views = await averageRecentViews(chat.telegramChatId, username);
    const draft: EstimateDraft = {
      chatDbId: chat.id,
      title: chat.title,
      realMembers: audit.real,
      deletedPercent: audit.deadPercent,
      views,
      viewsSource: views === null ? null : "scan",
      topic: null,
      step: "topic",
    };
    drafts.set(ctx.from.id, draft);

    const lines = [
      `${chat.title}`,
      `Haqiqiy a'zolar: ${formatMoney(audit.real)}`,
      `O'chirilgan ulushi: ${audit.deadPercent}%`,
    ];
    if (views !== null) {
      lines.push(`Oxirgi postlar o'rtacha ko'rishi: ${formatMoney(views)}`);
    } else {
      lines.push("Ko'rish soni avtomatik topilmadi. Mavzudan keyin o'zingiz yuborasiz.");
    }
    lines.push("", "Mavzuni tanlang.");
    await ctx.reply(lines.join("\n"), { reply_markup: topicKeyboard(chat.id) });
    await ctx.api.deleteMessage(pending.chat.id, pending.message_id).catch(() => undefined);
  } catch (error) {
    const message = error instanceof AuditError ? error.message : "Kanalni o'lchab bo'lmadi.";
    if (!(error instanceof AuditError)) {
      console.error(`[estimate] ${error instanceof Error ? error.message : String(error)}`);
    }
    await ctx.reply(`${chat.title}: ${message}`).catch(() => undefined);
  }
}

export async function chooseEstimateTopic(ctx: BotContext, topicId: string, chatId: string): Promise<void> {
  if (!ctx.from || !isTopicId(topicId)) {
    await ctx.answerCallbackQuery({ text: "Mavzu topilmadi." });
    return;
  }
  const draft = drafts.get(ctx.from.id);
  if (!draft || draft.chatDbId !== chatId) {
    await ctx.answerCallbackQuery({ text: "Avval /estimate yuboring.", show_alert: true });
    return;
  }

  draft.topic = topicId;
  await ctx.answerCallbackQuery({ text: TOPICS[topicId].label });
  if (draft.views === null) {
    draft.step = "views";
    await ctx.editMessageText("24 soatlik o'rtacha ko'rish sonini yuboring. Masalan: 4500").catch(async () => {
      await ctx.reply("24 soatlik o'rtacha ko'rish sonini yuboring. Masalan: 4500");
    });
    return;
  }

  drafts.delete(ctx.from.id);
  await sendReport(ctx, draft);
}

export async function handleEstimateViews(ctx: BotContext): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) return false;
  const draft = drafts.get(ctx.from.id);
  if (!draft || draft.step !== "views" || !draft.topic) return false;

  const views = Number(text.replace(/[\s,_]/g, ""));
  if (!Number.isInteger(views) || views < 1 || views > 50_000_000) {
    await ctx.reply("Ko'rishni bitta son bilan yuboring. Masalan: 4500");
    return true;
  }

  draft.views = views;
  draft.viewsSource = "manual";
  drafts.delete(ctx.from.id);
  await sendReport(ctx, draft);
  return true;
}

export async function estimateCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  if (ctx.chat && ctx.chat.type !== "private") {
    const chat = await getChatByTelegramId(ctx.chat.id);
    if (!chat) {
      await ctx.reply("Bu chat ro'yxatda yo'q. Botni admin qilib qayta qo'shing.");
      return;
    }
    await startEstimate(ctx, chat);
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  if (chats.length === 0) {
    await ctx.reply("Chat topilmadi. Botni avval kanalga admin qiling.");
    return;
  }
  if (chats.length === 1) {
    const only = chats[0];
    if (only) await startEstimate(ctx, only);
    return;
  }

  await ctx.reply("Qaysi kanalning bozor narxini hisoblaymiz?", {
    reply_markup: chatPickKeyboard("est", chats),
  });
}
