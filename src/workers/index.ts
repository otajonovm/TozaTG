import { Worker } from "bullmq";
import { closeQueues } from "./queues";
import { createCleanWorker } from "./clean.worker";
import { closeCleanDeletedQueue, createCleanDeletedWorker } from "./clean-deleted.worker";
import { createScanWorker } from "./scan.worker";

export function startWorkers(): { close: () => Promise<void> } {
  const cleanWorker: Worker = createCleanWorker();
  const cleanDeletedWorker: Worker = createCleanDeletedWorker();
  const scanWorker: Worker = createScanWorker();

  return {
    async close() {
      await cleanWorker.close();
      await cleanDeletedWorker.close();
      await scanWorker.close();
      await closeCleanDeletedQueue();
      await closeQueues();
    },
  };
}
