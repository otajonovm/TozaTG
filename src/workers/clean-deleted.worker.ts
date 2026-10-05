import { Api, GrammyError } from "grammy";
import { Queue, Worker } from "bullmq";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { createRedisConnection } from "../lib/redis";
import { sleep } from "../lib/sleep";
import { toTelegramNumber } from "../lib/telegram-id";

export const CLEAN_DELETED_QUEUE_NAME = "tozatg-clean-deleted";

export interface CleanDeletedJobData {
  taskId: string;
  progressChatId: number;
  progressMessageId: number;
}

export interface FloodWaitError extends Error {
  seconds: number;
}

let queue: Queue<CleanDeletedJobData> | null = null;

export function getCleanDeletedQueue(): Queue<CleanDeletedJobData> {
  queue ??= new Queue<CleanDeletedJobData>(CLEAN_DELETED_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return queue;
}

export async function closeCleanDeletedQueue(): Promise<void> {
  await queue?.close();
  queue = null;
}

function pauseMs(): number {
  return 1200 + Math.floor(Math.random() * 301);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function floodWaitSeconds(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "seconds" in error) {
    const seconds = (error as { seconds?: unknown }).seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      return seconds;
    }
  }
  if (error instanceof GrammyError && error.error_code === 429) {
    const retryAfter = error.parameters.retry_after ?? 5;
    return retryAfter >= 0 ? retryAfter : null;
  }
  return null;
}

function isAlreadyGone(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("user_not_participant") || text.includes("participant_id_invalid");
}

function isProtectedMember(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("administrator") || text.includes("chat owner") || text.includes("can't remove");
}

function progressText(title: string, processed: number, total: number): string {
  const percent = total === 0 ? 0 : Math.floor((processed / total) * 100);
  const slots = 10;
  const filled = total === 0 ? 0 : Math.round((processed / total) * slots);
  const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, slots - filled))}`;
  return [`${title}: tozalanmoqda`, `${bar} ${percent}%`, `${processed} / ${total}`].join("\n");
}

async function editProgress(api: Api, data: CleanDeletedJobData, text: string): Promise<void> {
  if (!data.progressChatId || !data.progressMessageId) return;
  await api.editMessageText(data.progressChatId, data.progressMessageId, text).catch(() => undefined);
}

async function kickMember(api: Api, chatId: number, userId: number): Promise<void> {
  for (;;) {
    try {
      await api.banChatMember(chatId, userId);
      await api.unbanChatMember(chatId, userId);
      return;
    } catch (error) {
      const seconds = floodWaitSeconds(error);
      if (seconds === null) throw error;
      console.warn(`[clean-deleted] FloodWait ${seconds}s — jarayon kutmoqda`);
      await sleep((seconds + 1) * 1000);
    }
  }
}

export async function runCleanDeleted(data: CleanDeletedJobData): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: data.taskId },
    include: { chat: true },
  });
  if (!task) return;

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "RUNNING", error: null, processed: 0 },
  });

  const api = new Api(env.BOT_TOKEN);
  const me = await api.getMe();
  const members = await prisma.chatMember.findMany({
    where: {
      chatId: task.chatId,
      userId: { not: BigInt(me.id) },
      status: { notIn: ["KICKED", "LEFT"] },
      OR: [{ isDeleted: true }, { isBot: true }],
    },
    orderBy: { scannedAt: "asc" },
  });

  await prisma.task.update({
    where: { id: task.id },
    data: { total: members.length },
  });

  const telegramChatId = toTelegramNumber(task.chat.telegramChatId);
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
      if (isAlreadyGone(error)) {
        await prisma.chatMember.update({
          where: { id: member.id },
          data: { status: "KICKED" },
        });
        removed += 1;
      } else if (!isProtectedMember(error)) {
        lastError = errorText(error);
        console.error(`[clean-deleted] ${member.userId.toString()}: ${lastError}`);
      }
    }

    processed += 1;
    if (processed % 50 === 0 || processed === members.length) {
      await prisma.task.update({
        where: { id: task.id },
        data: { processed },
      });
    }
    if (processed % 50 === 0 && processed < members.length) {
      await editProgress(api, data, progressText(task.chat.title, processed, members.length));
    }
    if (processed < members.length) {
      await sleep(pauseMs());
    }
  }

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "COMPLETED", processed, total: members.length, error: lastError },
  });

  const done =
    removed > 0
      ? `✅ ${removed} ta keraksiz a'zo tozalandi! Kanalingiz ER faollik ko'rsatkichi oshdi.`
      : `${task.chat.title}: chiqariladigan o'chirilgan akkaunt yoki bot qolmadi.`;
  const note = lastError && removed < processed ? `\n${processed - removed} tasi chiqarilmadi.` : "";
  await editProgress(api, data, `${done}${note}`);
}

export function createCleanDeletedWorker(): Worker<CleanDeletedJobData> {
  const worker = new Worker<CleanDeletedJobData>(
    CLEAN_DELETED_QUEUE_NAME,
    async (job) => {
      await runCleanDeleted(job.data);
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(`[clean-deleted] vazifa yiqildi: ${error.message}`);
    if (!job) return;
    void prisma.task
      .update({
        where: { id: job.data.taskId },
        data: { status: "FAILED", error: error.message.slice(0, 2000) },
      })
      .catch((updateError: unknown) => {
        console.error("[clean-deleted] status yangilanmadi", updateError);
      });
  });

  return worker;
}
