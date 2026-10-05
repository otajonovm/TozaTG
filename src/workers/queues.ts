import { Queue } from "bullmq";
import { createRedisConnection } from "../lib/redis";

export interface TaskJobData {
  taskId: string;
}

export const CLEAN_QUEUE_NAME = "tozatg-clean";
export const SCAN_QUEUE_NAME = "tozatg-scan";

let cleanQueue: Queue<TaskJobData> | null = null;
let scanQueue: Queue<TaskJobData> | null = null;

export function getCleanQueue(): Queue<TaskJobData> {
  cleanQueue ??= new Queue<TaskJobData>(CLEAN_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return cleanQueue;
}

export function getScanQueue(): Queue<TaskJobData> {
  scanQueue ??= new Queue<TaskJobData>(SCAN_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return scanQueue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([cleanQueue?.close(), scanQueue?.close()]);
  cleanQueue = null;
  scanQueue = null;
}
