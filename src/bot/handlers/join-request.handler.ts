import { captchaKeyboard } from "../keyboards";
import type { BotContext } from "../context";
import { clearCaptcha, createChallenge, rememberCaptcha, setCaptchaMessage } from "../../services/captcha.service";
import { loadSettings } from "./captcha-flow";

export const JOIN_CAPTCHA_FAIL = "❌ Noto'g'ri javob yoki vaqt tugadi. Kirish so'rovi bekor qilindi.";

export function joinCaptchaText(channelTitle: string, question: string): string {
  return [
    `Assalomu alaykum! ${channelTitle} kanaliga kirish uchun siz robot emassligingizni tasdiqlang.`,
    "",
    question,
  ].join("\n");
}

export async function joinRequestHandler(ctx: BotContext): Promise<void> {
  const request = ctx.chatJoinRequest;
  if (!request) return;

  const chatId = request.chat.id;
  const user = request.from;
  const settings = await loadSettings(chatId).catch(() => null);

  if (settings && !settings.captchaEnabled) {
    await ctx.api.approveChatJoinRequest(chatId, user.id);
    return;
  }

  if (settings?.filterNoPremium && !user.is_premium) {
    await ctx.api.declineChatJoinRequest(chatId, user.id);
    await ctx.api
      .sendMessage(user.id, "Bu kanal hozircha faqat Telegram Premium foydalanuvchilarni qabul qiladi.")
      .catch(() => undefined);
    return;
  }

  const challenge = createChallenge();
  const title = request.chat.title || "kanal";
  const text = joinCaptchaText(title, challenge.question);
  let captchaMessageId = 0;

  try {
    await rememberCaptcha({
      chatId,
      userId: user.id,
      kind: "join_request",
      correctIndex: challenge.correctIndex,
      onExpire: async () => {
        await ctx.api.declineChatJoinRequest(chatId, user.id).catch(() => undefined);
        if (captchaMessageId) {
          await ctx.api.editMessageText(user.id, captchaMessageId, JOIN_CAPTCHA_FAIL).catch(() => undefined);
          return;
        }
        await ctx.api.sendMessage(user.id, JOIN_CAPTCHA_FAIL).catch(() => undefined);
      },
    });

    const sent = await ctx.api.sendMessage(user.id, text, {
      reply_markup: captchaKeyboard("join_request", chatId, user.id, challenge),
    });
    captchaMessageId = sent.message_id;
    await setCaptchaMessage(chatId, user.id, sent.message_id);
  } catch (error) {
    await clearCaptcha(chatId, user.id);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[join] captcha yuborilmadi: ${message}`);
    await ctx.api.declineChatJoinRequest(chatId, user.id).catch(() => undefined);
  }
}
