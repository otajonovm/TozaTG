import { isAdmin } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getChatByTelegramId, listChatsForUser, type ChatWithSettings } from "../../services/chat.service";
import { hasMtprotoSession } from "../../services/telegram-mtproto.service";
import { isSweepRunning, sweepChats } from "../../services/sweep.service";
import { enqueueClean, enqueueScan } from "../../services/task.service";
import type { BotContext } from "../context";
import { chatPickKeyboard } from "../keyboards";
import { canManage, formatChatLine } from "./settings";

async function pickOrRun(
  ctx: BotContext,
  action: "clean" | "scan",
  run: (chat: ChatWithSettings) => Promise<void>,
): Promise<void> {
  if (!ctx.from) return;

  if (ctx.chat && ctx.chat.type !== "private") {
    const chat = await getChatByTelegramId(ctx.chat.id);
    if (!chat) {
      await ctx.reply("Bu chat ro'yxatda yo'q. Botni admin qilib qayta qo'shing.");
      return;
    }
    await run(chat);
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  if (chats.length === 0) {
    await ctx.reply("Chat topilmadi. Botni avval kanal yoki guruhga qo'shing.");
    return;
  }
  if (chats.length === 1) {
    const only = chats[0];
    if (only) await run(only);
    return;
  }

  await ctx.reply(action === "clean" ? "Qaysi chatni tozalaymiz?" : "Qaysi chatni skanerlaymiz?", {
    reply_markup: chatPickKeyboard(action, chats),
  });
}

export async function runClean(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!(await canManage(ctx, chat))) {
    await ctx.reply("Tozalashni faqat chat admini boshlay oladi.");
    return;
  }

  const [deletedCount, removedCount, scannedCount] = await Promise.all([
    prisma.chatMember.count({
      where: { chatId: chat.id, isDeleted: true, status: { notIn: ["KICKED", "LEFT"] } },
    }),
    prisma.chatMember.count({
      where: { chatId: chat.id, isDeleted: true, status: "KICKED" },
    }),
    prisma.chatMember.count({ where: { chatId: chat.id } }),
  ]);

  if (deletedCount === 0) {
    const title = formatChatLine(chat);
    if (scannedCount === 0) {
      await ctx.reply(`${title} hali skanerlanmagan. Avval /scan yuboring.`);
      return;
    }
    if (removedCount > 0) {
      await ctx.reply(`${title}: chiqariladigan o'chirilgan akkaunt qolmadi. ${removedCount} tasi avval kanaldan chiqarilgan.`);
      return;
    }
    await ctx.reply(`${title}: ${scannedCount} ta a'zo tekshirildi, o'chirilgan akkaunt yo'q.`);
    return;
  }

  const { alreadyRunning } = await enqueueClean(chat.id, deletedCount);
  if (alreadyRunning) {
    await ctx.reply(`${formatChatLine(chat)} uchun tozalash allaqachon navbatda.`);
    return;
  }

  await ctx.reply(
    `${formatChatLine(chat)}: ${deletedCount} ta o'chirilgan akkaunt navbatga qo'yildi. Har bir chiqarish orasida 1–1.5 soniya pauza bo'ladi.`,
  );
}

export async function runScan(ctx: BotContext, chat: ChatWithSettings): Promise<void> {
  if (!(await canManage(ctx, chat))) {
    await ctx.reply("Skanerni faqat chat admini boshlay oladi.");
    return;
  }

  if (!hasMtprotoSession()) {
    await ctx.reply(
      "Skaner uchun kanal admini bo'lgan oddiy akkaunt kerak. Loyiha papkasida npm run mtproto:login ni ishga tushiring, telefon va kodni kiriting, so'ng botni qayta yoqing.",
    );
    return;
  }

  const { alreadyRunning } = await enqueueScan(chat.id);
  if (alreadyRunning) {
    await ctx.reply(`${formatChatLine(chat)} uchun skaner allaqachon navbatda.`);
    return;
  }

  await ctx.reply(`${formatChatLine(chat)} skaneri navbatga qo'yildi. FloodWait bo'lsa, jarayon o'zi kutadi.`);
}

export async function cleanAllCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Barcha chatlarni tozalash uchun menga shaxsiy yozing: /cleanall");
    return;
  }

  const chats = await listChatsForUser(ctx.from.id, isAdmin(ctx.from.id));
  const manageable: ChatWithSettings[] = [];
  for (const chat of chats) {
    if (await canManage(ctx, chat)) manageable.push(chat);
  }

  if (manageable.length === 0) {
    await ctx.reply("Tozalanadigan chat yo'q. Botni kanal va guruhga admin qilib qo'shing.");
    return;
  }

  if (!hasMtprotoSession()) {
    await ctx.reply("Avval admin akkaunt sessiyasini ulang: npm run mtproto:login");
    return;
  }

  if (isSweepRunning()) {
    await ctx.reply("Umumiy tozalash allaqachon ketmoqda. Tugagach xabar beraman.");
    return;
  }

  const names = manageable.map((chat) => `• ${formatChatLine(chat)}`).join("\n");
  await ctx.reply(
    [
      `${manageable.length} ta chat tozalanadi:`,
      names,
      "",
      "Har birida avval a'zolar skanerlanadi, so'ng o'chirilgan akkauntlar chiqariladi.",
      "Guruh yangi a'zolar uchun captcha va servis xabarlarni o'chirish bilan toza turadi.",
    ].join("\n"),
  );

  void sweepChats(ctx.from.id, manageable);
}

export async function cleanCommand(ctx: BotContext): Promise<void> {
  await pickOrRun(ctx, "clean", (chat) => runClean(ctx, chat));
}

export async function scanCommand(ctx: BotContext): Promise<void> {
  await pickOrRun(ctx, "scan", (chat) => runScan(ctx, chat));
}
