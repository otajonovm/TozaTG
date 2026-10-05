import Redis from "ioredis";
import { env } from "../config/env";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  connectTimeout: 5_000,
} as const;

const extraConnections: Redis[] = [];

function attachErrorLog(client: Redis, label: string): void {
  client.on("error", (error: Error) => {
    console.error(`[redis:${label}] ${error.message}`);
  });
}

/** Ilova bo'ylab umumiy Redis mijoz. Ulanish birinchi pinggacha kechiktiriladi. */
export const redis: Redis = new Redis(env.REDIS_URL, {
  ...redisOptions,
  lazyConnect: true,
});
attachErrorLog(redis, "app");

/**
 * BullMQ Queue va Worker uchun yangi ulanish.
 * BullMQ `maxRetriesPerRequest: null` talab qiladi va har bir
 * worker o'z ulanishiga ega bo'lishi kerak.
 */
export function createRedisConnection(): Redis {
  const connection = new Redis(env.REDIS_URL, redisOptions);
  attachErrorLog(connection, "bullmq");
  extraConnections.push(connection);
  return connection;
}

export async function checkRedis(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    const reply = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis javob bermadi")), 4_000);
      }),
    ]);
    if (reply !== "PONG") {
      throw new Error(`Redis ping kutilmagan javob qaytardi: ${reply}`);
    }
  } catch (error) {
    redis.disconnect();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function quit(client: Redis): Promise<void> {
  if (client.status === "end" || client.status === "close") {
    return;
  }
  try {
    await client.quit();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[redis] yopishda xato: ${message}`);
    client.disconnect();
  }
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all(extraConnections.splice(0).map((client) => quit(client)));
  await quit(redis);
}
