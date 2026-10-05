import "dotenv/config";
import { z } from "zod";

function appendSsl(name: "DATABASE_URL" | "DIRECT_URL"): void {
  const value = process.env[name];
  if (!value || value.includes("sslmode=")) return;
  if (value.includes("localhost") || value.includes("127.0.0.1")) return;
  process.env[name] = `${value}${value.includes("?") ? "&" : "?"}sslmode=require`;
}

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}
appendSsl("DATABASE_URL");
appendSsl("DIRECT_URL");
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN bo'sh bo'lmasligi kerak"),
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1, "TELEGRAM_API_HASH bo'sh bo'lmasligi kerak"),
  MTPROTO_SESSION: z.string().default(""),
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  REDIS_URL: z.string().min(1, "REDIS_URL bo'sh bo'lmasligi kerak"),
});

export type Env = z.infer<typeof envSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Muhit o'zgaruvchilari noto'g'ri. .env faylini .env.example dan tekshiring:\n${formatIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const adminTelegramIds: ReadonlySet<bigint> = new Set(
  env.ADMIN_TELEGRAM_IDS.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      if (!/^\d+$/.test(value)) {
        throw new Error(`ADMIN_TELEGRAM_IDS ichida noto'g'ri id: ${value}`);
      }
      return BigInt(value);
    }),
);

export function isAdmin(telegramId: bigint | number): boolean {
  const id = typeof telegramId === "bigint" ? telegramId : BigInt(telegramId);
  return adminTelegramIds.has(id);
}
