import { InlineKeyboard } from "grammy";
import type { ChatWithSettings } from "../../services/chat.service";

export type DashboardFlag = "captcha" | "spam" | "service";

function mark(enabled: boolean): string {
  return enabled ? "🟢 YOQILGAN" : "⚪️ O‘CHIRILGAN";
}

export function channelDashboardText(title: string): string {
  return `🎉 <b>«${title}» kanali muvaffaqiyatli ulandi!</b>\n\nKerakli xizmatni tanlang:`;
}

export function groupDashboardText(title: string): string {
  return `🎉 <b>«${title}» guruhi muvaffaqiyatli ulandi!</b>\n\nKerakli himoya turlarini tanlang:`;
}

export function channelDashboardKeyboard(chatId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧹 Auditoriyani tozalash", `menu_clean_${chatId}`)
    .row()
    .text("🛡 Kirish so‘rovi (Captcha)", `menu_captcha_${chatId}`)
    .row()
    .text("📊 Kanal Auditi (Pasport)", `menu_audit_${chatId}`)
    .row()
    .text("⚙️ Sozlamalar", `menu_settings_${chatId}`);
}

export function groupDashboardKeyboard(chat: ChatWithSettings): InlineKeyboard {
  const settings = chat.settings;
  const captcha = settings?.captchaEnabled ?? true;
  const spam = settings?.filterSpam ?? true;
  const service = settings?.deleteServiceMessages ?? true;

  return new InlineKeyboard()
    .text(`🧩 Kirish Captchasi: ${mark(captcha)}`, `toggle_group_captcha_${chat.id}`)
    .row()
    .text(`🚫 Reklama va spam filtri: ${mark(spam)}`, `toggle_antispam_${chat.id}`)
    .row()
    .text(`🧹 Kirdi-chiqdi xabarlar: ${mark(service)}`, `toggle_service_msg_${chat.id}`)
    .row()
    .text("⚙️ Guruh sozlamalari", `menu_group_settings_${chat.id}`);
}

export function captchaInfoKeyboard(chat: ChatWithSettings): InlineKeyboard {
  const captcha = chat.settings?.captchaEnabled ?? true;
  return new InlineKeyboard().text(`🛡 Kirish so‘rovi: ${mark(captcha)}`, `toggle_group_captcha_${chat.id}`);
}
