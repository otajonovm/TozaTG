import type { BotContext } from "../context";
import { answerCaptcha } from "../../services/captcha.service";
import { captchaCallbackHandler } from "./captcha-callback.handler";
import { getChatById, isSettingCode, toggleSetting } from "../../services/chat.service";
import { runAudit } from "../commands/audit.command";
import { beginCleanDeleted, promptCleanDeleted } from "../commands/clean-deleted";
import { chooseEstimateTopic, startEstimate } from "../commands/estimate";
import { cleanAllCommand, runClean, runScan } from "../commands/clean";
import { beginFreshWipe, freshKeyboard, freshPrompt } from "../commands/fresh";
import { canManage, sendSettings } from "../commands/settings";
import { kickFromGroup, restoreNewcomer } from "./captcha-flow";
import { dashboardCallbackHandler } from "./settings-toggle.handler";

function parsePositiveIndex(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export async function callbackHandler(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !ctx.from) return;

  if (await dashboardCallbackHandler(ctx)) return;

  if (data.startsWith("cj:")) {
    await captchaCallbackHandler(ctx);
    return;
  }

  if (data.startsWith("cg:")) {
    await handleCaptchaAnswer(ctx, data);
    return;
  }

  if (data.startsWith("set:")) {
    await handleSettingToggle(ctx, data);
    return;
  }

  if (data.startsWith("fresh:")) {
    await handleFreshChoice(ctx, data);
    return;
  }

  if (data.startsWith("cdel:")) {
    await handleCleanDeletedChoice(ctx, data);
    return;
  }

  if (data.startsWith("audit:")) {
    await handleAuditAction(ctx, data);
    return;
  }

  if (data.startsWith("est:")) {
    await handleEstimateTopic(ctx, data);
    return;
  }

  if (data.startsWith("pick:")) {
    await handleChatPick(ctx, data);
    return;
  }

  await ctx.answerCallbackQuery();
}

async function handleCaptchaAnswer(ctx: BotContext, data: string): Promise<void> {
  const [kind, chatIdRaw, userIdRaw, indexRaw] = data.split(":");
  const chatId = Number(chatIdRaw);
  const userId = Number(userIdRaw);
  const index = parsePositiveIndex(indexRaw);

  if (!ctx.from || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId) || index === null) {
    await ctx.answerCallbackQuery({ text: "Tugma eskirgan." });
    return;
  }

  if (ctx.from.id !== userId) {
    await ctx.answerCallbackQuery({ text: "Bu tugma boshqa odam uchun.", show_alert: true });
    return;
  }

  const result = await answerCaptcha(chatId, userId, index);
  if (result === "missing") {
    await ctx.answerCallbackQuery({ text: "Tekshiruv muddati tugagan." });
    return;
  }

  if (result === "wrong") {
    await ctx.answerCallbackQuery({ text: "Noto'g'ri javob." });
    if (kind === "cj") {
      await ctx.api.declineChatJoinRequest(chatId, userId).catch(() => undefined);
      await ctx.editMessageText("Noto'g'ri javob. Kirish so'rovi rad etildi.").catch(() => undefined);
      return;
    }
    await kickFromGroup(ctx.api, chatId, userId);
    await ctx.editMessageText("Noto'g'ri javob. Guruhdan chiqarildingiz.").catch(() => undefined);
    return;
  }

  await ctx.answerCallbackQuery({ text: "To'g'ri." });
  if (kind === "cj") {
    await ctx.api.approveChatJoinRequest(chatId, userId);
    await ctx.editMessageText("To'g'ri. Kirish so'rovingiz tasdiqlandi.").catch(() => undefined);
    return;
  }

  await restoreNewcomer(ctx.api, chatId, userId);
  await ctx.editMessageText("To'g'ri. Endi guruhga yoza olasiz.").catch(() => undefined);
}

async function handleSettingToggle(ctx: BotContext, data: string): Promise<void> {
  const [, chatId, code] = data.split(":");
  if (!chatId || !code || !isSettingCode(code)) {
    await ctx.answerCallbackQuery({ text: "Noma'lum sozlama." });
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }
  if (!(await canManage(ctx, chat))) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  const updated = await toggleSetting(chat.id, code);
  await ctx.answerCallbackQuery({ text: "Saqlandi." });
  await sendSettings(ctx, updated);
}

async function handleChatPick(ctx: BotContext, data: string): Promise<void> {
  const [, action, chatId] = data.split(":");
  if (!chatId) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (chatId === "all" && (action === "clean" || action === "scan")) {
    await ctx.answerCallbackQuery();
    await cleanAllCommand(ctx);
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  if (action === "settings") {
    await sendSettings(ctx, chat);
    return;
  }
  if (action === "clean") {
    await runClean(ctx, chat);
    return;
  }
  if (action === "scan") {
    await runScan(ctx, chat);
    return;
  }
  if (action === "fresh") {
    await ctx.reply(freshPrompt(chat), { reply_markup: freshKeyboard(chat.id) });
    return;
  }
  if (action === "audit") {
    await runAudit(ctx, chat);
    return;
  }
  if (action === "cdel") {
    await promptCleanDeleted(ctx, chat);
    return;
  }
  if (action === "est") {
    await startEstimate(ctx, chat);
  }
}

async function handleEstimateTopic(ctx: BotContext, data: string): Promise<void> {
  const [, topicId, chatId] = data.split(":");
  if (!topicId || !chatId) {
    await ctx.answerCallbackQuery();
    return;
  }
  await chooseEstimateTopic(ctx, topicId, chatId);
}

async function handleCleanDeletedChoice(ctx: BotContext, data: string): Promise<void> {
  const [, choice, chatId] = data.split(":");
  if (choice !== "yes" || !chatId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }

  await beginCleanDeleted(ctx, chat);
}

async function handleAuditAction(ctx: BotContext, data: string): Promise<void> {
  const [, action, chatId] = data.split(":");
  if (action !== "clean" || !chatId) {
    await ctx.answerCallbackQuery();
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }
  if (!(await canManage(ctx, chat))) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
  await runClean(ctx, chat);
}

async function handleFreshChoice(ctx: BotContext, data: string): Promise<void> {
  const [, choice, chatId] = data.split(":");
  if (!chatId || !ctx.from) {
    await ctx.answerCallbackQuery();
    return;
  }

  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }
  if (!(await canManage(ctx, chat))) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
    return;
  }

  if (choice === "no") {
    await ctx.answerCallbackQuery({ text: "Bekor qilindi." });
    await ctx.editMessageText("Bekor qilindi. Post va xabarlar qoldi.").catch(() => undefined);
    return;
  }

  if (choice !== "yes") {
    await ctx.answerCallbackQuery();
    return;
  }

  const started = beginFreshWipe(chat, ctx.from.id);
  await ctx.answerCallbackQuery({ text: started ? "Boshlandi." : "Allaqachon ketmoqda." });
  await ctx
    .editMessageText(
      started
        ? `${chat.title}: post va xabarlar o'chirilmoqda. Tugagach shu yerga xabar keladi.`
        : `${chat.title}: tozalash allaqachon ketmoqda.`,
    )
    .catch(() => undefined);
}
