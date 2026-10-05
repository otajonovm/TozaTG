import { prisma, disconnectPrisma } from "./lib/prisma";
import { ensureLocalPostgres, pushSchema, stopLocalPostgres } from "./lib/local-postgres";
import { setQueueReady } from "./lib/readiness";
import { checkRedis, disconnectRedis } from "./lib/redis";
import { disconnectMtproto } from "./services/telegram-mtproto.service";
import { createBot } from "./bot/create-bot";
import { startWorkers } from "./workers";

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} javob bermadi`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  await ensureLocalPostgres();
  await pushSchema();

  try {
    await withTimeout(prisma.$connect(), 8_000, "PostgreSQL");
    console.log("[db] PostgreSQL ulandi");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[db] ${message}. Chatlar saqlanmasligi mumkin.`);
  }

  let workers: { close: () => Promise<void> } | null = null;
  try {
    await withTimeout(checkRedis(), 8_000, "Redis");
    setQueueReady(true);
    workers = startWorkers();
    console.log("[redis] ulandi, navbat ishga tushdi");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[redis] ${message}. Tozalash va skaner shu jarayon ichida ishlaydi.`);
  }

  const bot = createBot();
  await bot.api.setMyCommands([
    { command: "start", description: "Botni ishga tushirish" },
    { command: "mychats", description: "Ulangan chatlar" },
    { command: "settings", description: "Captcha va filtrlar" },
    { command: "scan", description: "A'zolarni skanerlash" },
    { command: "clean", description: "Bitta chatni tozalash" },
    { command: "cleanall", description: "Barcha chatlarni tozalash" },
    { command: "fresh", description: "Yangi kanal holatiga keltirish" },
    { command: "audit", description: "Kanal tozalik pasporti" },
    { command: "clean_deleted", description: "O'chirilgan akkauntlarni chiqarish" },
    { command: "estimate", description: "Kanal bozor narxi" },
  ]);

  const me = await bot.api.getMe();
  console.log(`[bot] @${me.username ?? me.id} tayyor`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot] ${signal} — to'xtatilmoqda`);
    await bot.stop();
    await workers?.close();
    await disconnectMtproto();
    await disconnectRedis();
    await disconnectPrisma();
    await stopLocalPostgres();
  };

  process.once("SIGINT", () => {
    void stop("SIGINT").finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM").finally(() => process.exit(0));
  });

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => {
      console.log(`[bot] polling boshlandi: @${info.username}`);
    },
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
