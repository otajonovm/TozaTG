import type { BotContext } from "../context";
import { answerCaptcha } from "../../services/captcha.service";
import { JOIN_CAPTCHA_FAIL } from "./join-request.handler";

export const JOIN_CAPTCHA_OK = "✅ Tasdiqlandi! Siz kanalga qabul qilindingiz.";

function parseIndex(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** Kirish so'rovi captchasining javobini tekshiradi. `cj:` bilan boshlanmasa false qaytaradi. */
export async function captchaCallbackHandler(ctx: BotContext): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("cj:")) return false;

  const [, chatIdRaw, userIdRaw, indexRaw] = data.split(":");
  const chatId = Number(chatIdRaw);
  const userId = Number(userIdRaw);
  const index = parseIndex(indexRaw);

  if (!ctx.from || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId) || index === null) {
    await ctx.answerCallbackQuery({ text: "Tugma eskirgan." });
    return true;
  }

  if (ctx.from.id !== userId) {
    await ctx.answerCallbackQuery({ text: "Bu tugma boshqa odam uchun.", show_alert: true });
    return true;
  }

  const result = await answerCaptcha(chatId, userId, index);
  if (result !== "correct") {
    await ctx.api.declineChatJoinRequest(chatId, userId).catch(() => undefined);
    await ctx.answerCallbackQuery({ text: "Kirish bekor qilindi." });
    await ctx.editMessageText(JOIN_CAPTCHA_FAIL).catch(() => undefined);
    return true;
  }

  try {
    await ctx.api.approveChatJoinRequest(chatId, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[captcha] tasdiqlanmadi: ${message}`);
    await ctx.answerCallbackQuery({ text: "Tasdiqlab bo'lmadi.", show_alert: true });
    return true;
  }

  await ctx.answerCallbackQuery({ text: "Tasdiqlandi." });
  await ctx.editMessageText(JOIN_CAPTCHA_OK).catch(() => undefined);
  return true;
}
