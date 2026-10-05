import { InlineKeyboard } from "grammy";
import type { ChatSettings } from "@prisma/client";
import type { CaptchaChallenge, CaptchaKind } from "../services/captcha.service";
import { chatTypeLabel, type ChatWithSettings } from "../services/chat.service";

function mark(enabled: boolean): string {
  return enabled ? "yoqilgan" : "o'chiq";
}

export function addBotKeyboard(username: string): InlineKeyboard {
  return new InlineKeyboard()
    .url(
      "Guruhga qo'shish",
      `https://t.me/${username}?startgroup=true&admin=delete_messages+ban_users+restrict_members+invite_users+pin_messages`,
    )
    .row()
    .url(
      "Kanalga qo'shish",
      `https://t.me/${username}?startchannel&admin=invite_users+ban_users+delete_messages`,
    );
}

export function captchaKeyboard(
  kind: CaptchaKind,
  chatId: number,
  userId: number,
  challenge: CaptchaChallenge,
): InlineKeyboard {
  const prefix = kind === "join_request" ? "cj" : "cg";
  const keyboard = new InlineKeyboard();
  challenge.options.forEach((label, index) => {
    keyboard.text(label, `${prefix}:${chatId}:${userId}:${index}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

export function settingsKeyboard(chat: ChatWithSettings): InlineKeyboard {
  const settings: ChatSettings | null = chat.settings;
  const captcha = settings?.captchaEnabled ?? true;
  const service = settings?.deleteServiceMessages ?? true;
  const latin = settings?.filterNonLatin ?? false;
  const premium = settings?.filterNoPremium ?? false;

  return new InlineKeyboard()
    .text(`Captcha: ${mark(captcha)}`, `set:${chat.id}:cap`)
    .row()
    .text(`Servis xabarlar: ${mark(service)}`, `set:${chat.id}:svc`)
    .row()
    .text(`Lotin/kirill filtri: ${mark(latin)}`, `set:${chat.id}:lat`)
    .row()
    .text(`Faqat Premium: ${mark(premium)}`, `set:${chat.id}:prem`);
}

export function settingsText(chat: ChatWithSettings): string {
  return [
    `<b>${escapeTitle(chat.title)}</b> (${chatTypeLabel(chat.type)})`,
    "",
    "Sozlamani o'zgartirish uchun tugmani bosing.",
  ].join("\n");
}

export function chatPickKeyboard(
  action: "settings" | "clean" | "scan" | "fresh" | "audit" | "cdel" | "est",
  chats: ChatWithSettings[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (action === "clean") {
    keyboard.text("Barcha chatlarni tozalash", "pick:clean:all").row();
  }
  if (action === "scan") {
    keyboard.text("Barcha chatlarni skanerlash", "pick:scan:all").row();
  }
  for (const chat of chats) {
    keyboard.text(`${chat.title}`.slice(0, 40), `pick:${action}:${chat.id}`).row();
  }
  return keyboard;
}

function escapeTitle(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
