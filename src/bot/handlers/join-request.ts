import type { BotContext } from "../context";
import { kickFromGroup, loadSettings, restrictNewcomer, sendCaptcha } from "./captcha-flow";

export async function welcomeMember(ctx: BotContext, user: NonNullable<BotContext["from"]>): Promise<void> {
  if (!ctx.chat || user.is_bot) return;
  const settings = await loadSettings(ctx.chat.id).catch(() => null);
  const captchaEnabled = settings?.captchaEnabled ?? true;

  if (settings?.filterNoPremium && !user.is_premium) {
    await kickFromGroup(ctx.api, ctx.chat.id, user.id);
    return;
  }

  if (!captchaEnabled) {
    await ctx.reply(`Xush kelibsiz, ${user.first_name}.`);
    return;
  }

  await sendCaptcha({
    api: ctx.api,
    kind: "group",
    chatId: ctx.chat.id,
    user,
    target: "group",
  });
  if (ctx.chat.type === "supergroup" || ctx.chat.type === "group") {
    await restrictNewcomer(ctx.api, ctx.chat.id, user.id);
  }
}
