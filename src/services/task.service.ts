import type { Task, TaskType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isQueueReady } from "../lib/readiness";
import { sleep } from "../lib/sleep";
import { notifyUser } from "./notify.service";
import { runCleanTask } from "../workers/clean.processor";
import { runScanTask } from "../workers/scan.processor";
import { getCleanQueue, getScanQueue } from "../workers/queues";

export interface EnqueuedTask {
  task: Task;
  alreadyRunning: boolean;
}

function runLocally(taskId: string, type: TaskType): void {
  const work = type === "CLEAN" ? runCleanTask(taskId) : runScanTask(taskId);
  void work.catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[task] ${type} ${taskId}: ${message}`);
    const failed = await prisma.task.findUnique({
      where: { id: taskId },
      include: { chat: { include: { owner: true } } },
    });
    if (failed) {
      const label = type === "CLEAN" ? "Tozalash" : "Skaner";
      await notifyUser(failed.chat.owner.telegramId, `${label} yiqildi (${failed.chat.title}): ${message.slice(0, 300)}`);
    }
    return prisma.task
      .update({
        where: { id: taskId },
        data: { status: "FAILED", error: message.slice(0, 2000) },
      })
      .catch((updateError: unknown) => {
        console.error("[task] status yangilanmadi", updateError);
      });
  });
}

async function createTask(chatId: string, type: TaskType, total = 0): Promise<EnqueuedTask> {
  const existing = await prisma.task.findFirst({
    where: { chatId, type, status: { in: ["PENDING", "RUNNING"] } },
  });
  if (existing) {
    return { task: existing, alreadyRunning: true };
  }

  const task = await prisma.task.create({
    data: { chatId, type, status: "PENDING", total },
  });

  if (!isQueueReady()) {
    console.log(`[task] Redis yo'q, ${type} shu jarayonda ishlaydi`);
    runLocally(task.id, type);
    return { task, alreadyRunning: false };
  }

  try {
    const payload = { taskId: task.id };
    const options = { jobId: task.id, removeOnComplete: 200, removeOnFail: 100 };
    const job =
      type === "CLEAN"
        ? await getCleanQueue().add("clean", payload, options)
        : await getScanQueue().add("scan", payload, options);

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { bullJobId: job.id ?? null },
    });
    return { task: updated, alreadyRunning: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[task] navbatga qo'yilmadi, shu jarayonda davom etadi: ${message}`);
    runLocally(task.id, type);
    return { task, alreadyRunning: false };
  }
}

export async function enqueueClean(chatId: string, deletedCount: number): Promise<EnqueuedTask> {
  return createTask(chatId, "CLEAN", deletedCount);
}

export async function enqueueScan(chatId: string): Promise<EnqueuedTask> {
  return createTask(chatId, "SCAN");
}

export async function waitForTask(taskId: string, timeoutMs = 30 * 60 * 1000): Promise<Task> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Vazifa topilmadi");
    }
    if (task.status === "COMPLETED" || task.status === "FAILED") {
      return task;
    }
    await sleep(1500);
  }
  throw new Error("Vazifa belgilangan vaqtda tugamadi");
}
