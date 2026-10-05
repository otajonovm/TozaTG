import { MemberStatus, type Task } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isQueueReady } from "../lib/readiness";
import { getCleanDeletedQueue, runCleanDeleted, type CleanDeletedJobData } from "../workers/clean-deleted.worker";

export interface RemovableCounts {
  deleted: number;
  bots: number;
  total: number;
}

export interface CleanDeletedEnqueue {
  task: Task;
  alreadyRunning: boolean;
}

const active = { notIn: [MemberStatus.KICKED, MemberStatus.LEFT] };

export async function countRemovableMembers(chatId: string): Promise<RemovableCounts> {
  const base = { chatId, status: active };
  const [deleted, bots, total] = await Promise.all([
    prisma.chatMember.count({ where: { ...base, isDeleted: true } }),
    prisma.chatMember.count({ where: { ...base, isBot: true, isDeleted: false } }),
    prisma.chatMember.count({
      where: { ...base, OR: [{ isDeleted: true }, { isBot: true }] },
    }),
  ]);
  return { deleted, bots, total };
}

export async function scannedMemberCount(chatId: string): Promise<number> {
  return prisma.chatMember.count({ where: { chatId } });
}

/** O'rtacha 1.35 soniya: 1.2 va 1.5 oralig'idagi tanaffus. */
export function estimateMinutes(memberCount: number): number {
  return Math.max(1, Math.round((memberCount * 1.35) / 60));
}

export function cleanDeletedPrompt(counts: RemovableCounts): string {
  const minutes = estimateMinutes(counts.total);
  const lines: string[] = [];
  if (counts.deleted > 0) {
    lines.push(`Kanalingizda ${counts.deleted} ta o'chirilgan akkaunt topildi.`);
  }
  if (counts.bots > 0) {
    lines.push(`${counts.bots} ta bot ham chiqariladi.`);
  }
  if (lines.length === 0) {
    lines.push(`Kanalingizda ${counts.total} ta keraksiz a'zo topildi.`);
  }
  lines.push(`Tozalash taxminan ${minutes} daqiqa vaqt oladi.`, "Boshlaymizmi?");
  return lines.join("\n");
}

export async function enqueueCleanDeleted(input: {
  chatId: string;
  total: number;
  progressChatId: number;
  progressMessageId: number;
}): Promise<CleanDeletedEnqueue> {
  const existing = await prisma.task.findFirst({
    where: { chatId: input.chatId, type: "CLEAN_DELETED", status: { in: ["PENDING", "RUNNING"] } },
  });
  if (existing) return { task: existing, alreadyRunning: true };

  const task = await prisma.task.create({
    data: {
      chatId: input.chatId,
      type: "CLEAN_DELETED",
      status: "PENDING",
      total: input.total,
    },
  });

  const data: CleanDeletedJobData = {
    taskId: task.id,
    progressChatId: input.progressChatId,
    progressMessageId: input.progressMessageId,
  };

  if (!isQueueReady()) {
    console.log("[clean-deleted] Redis yo'q, tozalash shu jarayonda ishlaydi");
    void runCleanDeleted(data).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[clean-deleted] ${message}`);
      return prisma.task.update({
        where: { id: task.id },
        data: { status: "FAILED", error: message.slice(0, 2000) },
      });
    });
    return { task, alreadyRunning: false };
  }

  try {
    const job = await getCleanDeletedQueue().add("clean-deleted", data, {
      jobId: task.id,
      removeOnComplete: 200,
      removeOnFail: 100,
    });
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { bullJobId: job.id ?? null },
    });
    return { task: updated, alreadyRunning: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[clean-deleted] navbatga qo'yilmadi, shu jarayonda davom etadi: ${message}`);
    void runCleanDeleted(data);
    return { task, alreadyRunning: false };
  }
}
