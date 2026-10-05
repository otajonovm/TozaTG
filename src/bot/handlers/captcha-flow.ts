import type { ChatPermissions, User } from "grammy/types";
import type { ChatSettings } from "@prisma/client";
import type { Api } from "grammy";
import { captchaKeyboard } from "../keyboards";
import { userLabel } from "../html";
import { clearCaptcha, createChallenge, rememberCaptcha, type CaptchaKind } from "../../services/captcha.service";
import { getChatByTelegramId } from "../../services/chat.service";

const silentPermissions: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

export async function loadSettings(telegramChatId: number): Promise<ChatSettings | null> {
  const chat = await getChatByTelegramId(telegramChatId);
  return chat?.settings ?? null;
}

export async function sendCaptcha(input: {
  api: Api;
  kind: CaptchaKind;
  chatId: number;
  user: User;
  target: "private" | "group";
}): Promise<void> {
  const challenge = createChallenge();
  const keyboard = captchaKeyboard(input.kind, input.chatId, input.user.id, challenge);
  const text =
    input.kind === "join_request"
      ? `Kanalga kirish uchun 3 daqiqa ichida misolni yeching:\n\n${challenge.question}`
      : `${userLabel(input.user)}, guruhga yozish uchun 3 daqiqa ichida misolni yeching:\n\n${challenge.question}`;

  const destination = input.target === "private" ? input.user.id : input.chatId;

  await rememberCaptcha({
    chatId: input.chatId,
    userId: input.user.id,
    kind: input.kind,
    correctIndex: challenge.correctIndex,
    onExpire: async () => {
      if (input.kind === "join_request") {
        await input.api.declineChatJoinRequest(input.chatId, input.user.id);
        await input.api.sendMessage(input.user.id, "Vaqt tugadi. Kirish so'rovi rad etildi.").catch(() => undefined);
        return;
      }
      await kickFromGroup(input.api, input.chatId, input.user.id);
    },
  });

  try {
    await input.api.sendMessage(destination, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (error) {
    await clearCaptcha(input.chatId, input.user.id);
    throw error;
  }
}

export async function restrictNewcomer(api: Api, chatId: number, userId: number): Promise<void> {
  await api.restrictChatMember(chatId, userId, silentPermissions).catch(() => undefined);
}

export async function restoreNewcomer(api: Api, chatId: number, userId: number): Promise<void> {
  try {
    const chat = await api.getChat(chatId);
    if (chat.type === "group" || chat.type === "supergroup") {
      const permissions = chat.permissions;
      if (permissions) {
        await api.restrictChatMember(chatId, userId, permissions);
        return;
      }
    }
  } catch {
    // Guruh standart huquqlarini o'qib bo'lmasa, yozishni ochamiz.
  }

  await api
    .restrictChatMember(chatId, userId, {
      ...silentPermissions,
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    })
    .catch(() => undefined);
}

export async function kickFromGroup(api: Api, chatId: number, userId: number): Promise<void> {
  await api.banChatMember(chatId, userId).catch(() => undefined);
  await api.unbanChatMember(chatId, userId, { only_if_banned: true }).catch(() => undefined);
}
