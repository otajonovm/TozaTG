import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { createRedisConnection } from "../lib/redis";
import { runCleanTask } from "./clean.processor";
import { CLEAN_QUEUE_NAME, type TaskJobData } from "./queues";

export function createCleanWorker(): Worker<TaskJobData> {
  const worker = new Worker<TaskJobData>(
    CLEAN_QUEUE_NAME,
    async (job) => {
      await runCleanTask(job.data.taskId);
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(`[clean] vazifa yiqildi: ${error.message}`);
    if (!job) return;
    void prisma.task
      .update({
        where: { id: job.data.taskId },
        data: { status: "FAILED", error: error.message.slice(0, 2000) },
      })
      .catch((updateError: unknown) => {
        console.error("[clean] status yangilanmadi", updateError);
      });
  });

  return worker;
}
