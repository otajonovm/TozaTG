import type { BotContext } from "../context";
import { getChatById, type ChatWithSettings } from "../../services/chat.service";
import { prisma } from "../../lib/prisma";
import { settingsKeyboard, settingsText } from "../keyboards";
import {
  captchaInfoKeyboard,
  groupDashboardKeyboard,
  type DashboardFlag,
} from "../keyboards/dashboard.keyboard";
import { canManage } from "../commands/settings";
import { promptCleanDeleted } from "../commands/clean-deleted";
import { runAudit } from "../commands/audit.command";

const TOGGLES: ReadonlyArray<readonly [string, DashboardFlag]> = [
  ["toggle_group_captcha_", "captcha"],
  ["toggle_antispam_", "spam"],
  ["toggle_service_msg_", "service"],
];

const MENUS: ReadonlyArray<readonly [string, string]> = [
  ["menu_group_settings_", "group_settings"],
  ["menu_clean_", "clean"],
  ["menu_captcha_", "captcha"],
  ["menu_audit_", "audit"],
  ["menu_settings_", "settings"],
];

function matchPrefix(data: string, prefixes: ReadonlyArray<readonly [string, string]>): { action: string; chatId: string } | null {
  for (const [prefix, action] of prefixes) {
    if (data.startsWith(prefix)) {
      const chatId = data.slice(prefix.length);
      if (chatId) return { action, chatId };
    }
  }
  return null;
}

async function flip(chat: ChatWithSettings, flag: DashboardFlag): Promise<ChatWithSettings> {
  const settings = chat.settings;
  if (!settings) throw new Error("Chat sozlamalari topilmadi");

  const data =
    flag === "captcha"
      ? { captchaEnabled: !settings.captchaEnabled }
      : flag === "spam"
        ? { filterSpam: !settings.filterSpam }
        : { deleteServiceMessages: !settings.deleteServiceMessages };

  await prisma.chatSettings.update({ where: { chatId: chat.id }, data });
  const updated = await getChatById(chat.id);
  if (!updated) throw new Error("Chat topilmadi");
  return updated;
}

function clickedText(ctx: BotContext): string {
  const message = ctx.callbackQuery?.message;
  if (!message || !("text" in message) || !message.text) return "";
  return message.text;
}

export async function dashboardCallbackHandler(ctx: BotContext): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !ctx.from) return false;

  const toggle = matchPrefix(data, TOGGLES);
  if (toggle) {
    await applyToggle(ctx, toggle.chatId, toggle.action as DashboardFlag);
    return true;
  }

  const menu = matchPrefix(data, MENUS);
  if (!menu) return false;
  await openMenu(ctx, menu.chatId, menu.action);
  return true;
}

async function applyToggle(ctx: BotContext, chatId: string, flag: DashboardFlag): Promise<void> {
  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }
  if (!(await canManage(ctx, chat))) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo‘q.", show_alert: true });
    return;
  }

  const updated = await flip(chat, flag);
  const turnedOn =
    flag === "captcha"
      ? updated.settings?.captchaEnabled
      : flag === "spam"
        ? updated.settings?.filterSpam
        : updated.settings?.deleteServiceMessages;

  await ctx.answerCallbackQuery({ text: turnedOn ? "Yoqildi" : "O‘chirildi" });

  const text = clickedText(ctx);
  const markup = text.includes("guruhi muvaffaqiyatli")
    ? groupDashboardKeyboard(updated)
    : captchaInfoKeyboard(updated);
  await ctx.editMessageReplyMarkup({ reply_markup: markup }).catch(() => undefined);
}

async function openMenu(ctx: BotContext, chatId: string, action: string): Promise<void> {
  const chat = await getChatById(chatId);
  if (!chat) {
    await ctx.answerCallbackQuery({ text: "Chat topilmadi.", show_alert: true });
    return;
  }
  if (!(await canManage(ctx, chat))) {
    await ctx.answerCallbackQuery({ text: "Ruxsat yo‘q.", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  if (action === "clean") {
    await promptCleanDeleted(ctx, chat);
    return;
  }
  if (action === "audit") {
    await runAudit(ctx, chat);
    return;
  }
  if (action === "settings" || action === "group_settings") {
    await ctx.reply(settingsText(chat), { parse_mode: "HTML", reply_markup: settingsKeyboard(chat) });
    return;
  }
  if (action === "captcha") {
    const enabled = chat.settings?.captchaEnabled ?? true;
    const text = enabled
      ? "Kirish so‘rovi captchasi yoqilgan. Yangi odam 3 daqiqa ichida misolni yechmasa kanalga kirmaydi."
      : "Kirish so‘rovi captchasi o‘chirilgan. Yangi so‘rovlar darhol qabul qilinadi.";
    await ctx.reply(text, { reply_markup: captchaInfoKeyboard(chat) });
  }
}
