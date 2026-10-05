import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { createRedisConnection } from "../lib/redis";
import { SCAN_QUEUE_NAME, type TaskJobData } from "./queues";
import { runScanTask } from "./scan.processor";

export function createScanWorker(): Worker<TaskJobData> {
  const worker = new Worker<TaskJobData>(
    SCAN_QUEUE_NAME,
    async (job) => {
      await runScanTask(job.data.taskId);
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(`[scan] vazifa yiqildi: ${error.message}`);
    if (!job) return;
    void prisma.task
      .update({
        where: { id: job.data.taskId },
        data: { status: "FAILED", error: error.message.slice(0, 2000) },
      })
      .catch((updateError: unknown) => {
        console.error("[scan] status yangilanmadi", updateError);
      });
  });

  return worker;
}
