import type { BotContext } from "../context";
import { deactivateChat, registerChat } from "../../services/chat.service";
import { escapeHtml } from "../html";
import {
  channelDashboardKeyboard,
  channelDashboardText,
  groupDashboardKeyboard,
  groupDashboardText,
} from "../keyboards/dashboard.keyboard";

function isAdminStatus(status: string): boolean {
  return status === "administrator" || status === "creator";
}

export async function membershipHandler(ctx: BotContext): Promise<void> {
  const update = ctx.myChatMember;
  if (!update || update.chat.type === "private") return;

  const status = update.new_chat_member.status;
  const active = status === "member" || status === "administrator" || status === "restricted" || status === "creator";

  if (!active) {
    await deactivateChat(update.chat.id).catch((error: unknown) => {
      console.error("[membership] o'chirishda xato", error);
    });
    return;
  }

  const title = "title" in update.chat ? update.chat.title : "Chat";
  const chat = await registerChat({
    telegramChatId: update.chat.id,
    title,
    type: update.chat.type,
    owner: update.from,
    isActive: true,
  });

  const becameAdmin = isAdminStatus(status) && !isAdminStatus(update.old_chat_member.status);
  if (!becameAdmin) return;

  const safeTitle = escapeHtml(title);
  const isChannel = update.chat.type === "channel";
  const text = isChannel ? channelDashboardText(safeTitle) : groupDashboardText(safeTitle);
  const replyMarkup = isChannel ? channelDashboardKeyboard(chat.id) : groupDashboardKeyboard(chat);

  const sent = await ctx.api
    .sendMessage(update.from.id, text, { parse_mode: "HTML", reply_markup: replyMarkup })
    .then(() => true)
    .catch(() => false);

  if (!sent) {
    console.warn(`[membership] ${title}: admin lichkasiga panel yuborilmadi. Avval botga /start yuborishi kerak.`);
  }
}
