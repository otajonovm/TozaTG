import type { User } from "grammy/types";
import type { BotContext } from "../context";
import { classifyText, isServiceMessage } from "../../services/moderation.service";
import { loadSettings } from "./captcha-flow";
import { welcomeMember } from "./join-request";

async function senderIsAdmin(ctx: BotContext): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  if (ctx.message?.sender_chat) return true;
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

export async function messageHandler(ctx: BotContext): Promise<void> {
  const message = ctx.message;
  if (!message || !ctx.chat || ctx.chat.type === "private") return;
  if (ctx.from?.id === ctx.me.id) return;

  const newcomers = message.new_chat_members ?? [];
  for (const member of newcomers) {
    if (member.is_bot) continue;
    await welcomeMember(ctx, member as User);
  }

  const settings = await loadSettings(ctx.chat.id).catch(() => null);
  const deleteService = settings?.deleteServiceMessages ?? true;
  if (deleteService && isServiceMessage(message)) {
    await ctx.deleteMessage().catch(() => undefined);
    return;
  }

  if (!message.text || (await senderIsAdmin(ctx))) return;

  const reason = classifyText(message.text, settings);
  if (!reason) return;

  const deleted = await ctx.deleteMessage().then(
    () => true,
    () => false,
  );
  if (deleted) {
    console.log(`[moderation] ${reason} chat=${ctx.chat.id}`);
  }
}
