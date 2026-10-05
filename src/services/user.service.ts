import type { User as TelegramUser } from "grammy/types";
import type { User, UserRole } from "@prisma/client";
import { isAdmin } from "../config/env";
import { prisma } from "../lib/prisma";
import { toBigIntId } from "../lib/telegram-id";

export async function upsertUser(from: TelegramUser): Promise<User> {
  const telegramId = toBigIntId(from.id);
  const role: UserRole = isAdmin(telegramId) ? "ADMIN" : "USER";

  return prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      firstName: from.first_name,
      username: from.username ?? null,
      role,
    },
    update: {
      firstName: from.first_name,
      username: from.username ?? null,
      ...(role === "ADMIN" ? { role } : {}),
    },
  });
}

export async function findUserByTelegramId(telegramId: number): Promise<User | null> {
  return prisma.user.findUnique({
    where: { telegramId: toBigIntId(telegramId) },
  });
}
