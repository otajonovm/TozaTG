import type { Chat, ChatType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { toBigIntId, toTelegramNumber } from "../lib/telegram-id";
import { upsertUser } from "./user.service";
import type { User as TelegramUser } from "grammy/types";

const chatInclude = { settings: true, owner: true } satisfies Prisma.ChatInclude;

export type ChatWithSettings = Prisma.ChatGetPayload<{ include: typeof chatInclude }>;

function mapChatType(type: string): ChatType {
  if (type === "channel") return "CHANNEL";
  if (type === "group") return "GROUP";
  return "SUPERGROUP";
}

export function chatTypeLabel(type: ChatType): string {
  if (type === "CHANNEL") return "kanal";
  if (type === "GROUP") return "guruh";
  return "superguruh";
}

export async function registerChat(input: {
  telegramChatId: number;
  title: string;
  type: string;
  owner: TelegramUser;
  isActive?: boolean;
}): Promise<ChatWithSettings> {
  const owner = await upsertUser(input.owner);
  const telegramChatId = toBigIntId(input.telegramChatId);

  const chat = await prisma.chat.upsert({
    where: { telegramChatId },
    create: {
      telegramChatId,
      title: input.title,
      type: mapChatType(input.type),
      ownerId: owner.id,
      isActive: input.isActive ?? true,
      settings: { create: {} },
    },
    update: {
      title: input.title,
      type: mapChatType(input.type),
      isActive: input.isActive ?? true,
    },
    include: chatInclude,
  });

  if (!chat.settings) {
    const settings = await prisma.chatSettings.create({ data: { chatId: chat.id } });
    return { ...chat, settings };
  }

  return chat;
}

export async function deactivateChat(telegramChatId: number): Promise<void> {
  await prisma.chat.updateMany({
    where: { telegramChatId: toBigIntId(telegramChatId) },
    data: { isActive: false },
  });
}

export async function getChatByTelegramId(telegramChatId: number): Promise<ChatWithSettings | null> {
  return prisma.chat.findUnique({
    where: { telegramChatId: toBigIntId(telegramChatId) },
    include: chatInclude,
  });
}

export async function getChatById(id: string): Promise<ChatWithSettings | null> {
  return prisma.chat.findUnique({
    where: { id },
    include: chatInclude,
  });
}

export async function listChatsForUser(telegramUserId: number, platformAdmin: boolean): Promise<ChatWithSettings[]> {
  if (platformAdmin) {
    return prisma.chat.findMany({
      where: { isActive: true },
      include: chatInclude,
      orderBy: { title: "asc" },
    });
  }

  const user = await prisma.user.findUnique({
    where: { telegramId: toBigIntId(telegramUserId) },
  });
  if (!user) return [];

  return prisma.chat.findMany({
    where: { ownerId: user.id, isActive: true },
    include: chatInclude,
    orderBy: { title: "asc" },
  });
}

const settingFields = {
  cap: "captchaEnabled",
  svc: "deleteServiceMessages",
  lat: "filterNonLatin",
  prem: "filterNoPremium",
} as const;

export type SettingCode = keyof typeof settingFields;

export function isSettingCode(value: string): value is SettingCode {
  return value in settingFields;
}

export async function toggleSetting(chatId: string, code: SettingCode): Promise<ChatWithSettings> {
  const field = settingFields[code];
  const current = await prisma.chatSettings.findUnique({ where: { chatId } });
  if (!current) {
    throw new Error("Chat sozlamalari topilmadi");
  }

  await prisma.chatSettings.update({
    where: { chatId },
    data: { [field]: !current[field] },
  });

  const chat = await getChatById(chatId);
  if (!chat) {
    throw new Error("Chat topilmadi");
  }
  return chat;
}

export function telegramChatIdOf(chat: Chat): number {
  return toTelegramNumber(chat.telegramChatId);
}
