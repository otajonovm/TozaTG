import { Api, GrammyError } from "grammy";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { sleep } from "../lib/sleep";
import { toTelegramNumber } from "../lib/telegram-id";
import { notifyUser } from "../services/notify.service";

function pauseMs(): number {
  return 1000 + Math.floor(Math.random() * 501);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function kickMember(api: Api, chatId: number, userId: number): Promise<void> {
  try {
    await api.banChatMember(chatId, userId);
  } catch (error) {
    if (error instanceof GrammyError && error.error_code === 429) {
      const retryAfter = error.parameters.retry_after ?? 5;
      await sleep((retryAfter + 1) * 1000);
      await api.banChatMember(chatId, userId);
      return;
    }
    throw error;
  }
}

export async function runCleanTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { chat: { include: { owner: true } } },
  });
  if (!task) return;

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "RUNNING", error: null },
  });

  const members = await prisma.chatMember.findMany({
    where: {
      chatId: task.chatId,
      isDeleted: true,
      status: { notIn: ["KICKED", "LEFT"] },
    },
    orderBy: { scannedAt: "asc" },
  });

  await prisma.task.update({
    where: { id: task.id },
    data: { total: members.length, processed: 0 },
  });

  const telegramChatId = toTelegramNumber(task.chat.telegramChatId);
  const api = new Api(env.BOT_TOKEN);
  let processed = 0;
  let removed = 0;
  let lastError: string | null = null;

  for (const member of members) {
    try {
      await kickMember(api, telegramChatId, toTelegramNumber(member.userId));
      await prisma.chatMember.update({
        where: { id: member.id },
        data: { status: "KICKED" },
      });
      removed += 1;
    } catch (error) {
      lastError = errorText(error);
      console.error(`[clean] ${member.userId.toString()}: ${lastError}`);
    }

    processed += 1;
    if (processed % 50 === 0 || processed === members.length) {
      await prisma.task.update({
        where: { id: task.id },
        data: { processed },
      });
    }

    if (processed < members.length) {
      await sleep(pauseMs());
    }
  }

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "COMPLETED", processed, error: lastError },
  });

  const failed = processed - removed;
  const lines = [
    `${task.chat.title}: ${removed} ta o'chirilgan akkaunt chiqarildi.`,
  ];
  if (failed > 0) {
    lines.push(`${failed} tasi chiqarilmadi.${lastError ? ` Sabab: ${lastError}` : ""}`);
  }
  await notifyUser(task.chat.owner.telegramId, lines.join("\n"));
}
