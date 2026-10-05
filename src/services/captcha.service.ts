import { isQueueReady } from "../lib/readiness";
import { redis } from "../lib/redis";

export const CAPTCHA_TTL_SECONDS = 180;

export type CaptchaKind = "join_request" | "group";

export interface CaptchaChallenge {
  question: string;
  options: string[];
  correctIndex: number;
}

export interface CaptchaSession {
  chatId: number;
  userId: number;
  kind: CaptchaKind;
  correctIndex: number;
  messageId: number | null;
}

export type CaptchaResult = "correct" | "wrong" | "missing";

const memory = new Map<string, CaptchaSession>();
const timers = new Map<string, NodeJS.Timeout>();
const taken = new Set<string>();

function storageKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

function redisKey(id: string): string {
  return `tozatg:captcha:${id}`;
}

function parseSession(raw: string): CaptchaSession | null {
  try {
    const value = JSON.parse(raw) as Partial<CaptchaSession>;
    if (
      typeof value.chatId !== "number" ||
      typeof value.userId !== "number" ||
      (value.kind !== "join_request" && value.kind !== "group") ||
      typeof value.correctIndex !== "number"
    ) {
      return null;
    }
    return {
      chatId: value.chatId,
      userId: value.userId,
      kind: value.kind,
      correctIndex: value.correctIndex,
      messageId: typeof value.messageId === "number" ? value.messageId : null,
    };
  } catch {
    return null;
  }
}

async function writeRedis(id: string, session: CaptchaSession): Promise<void> {
  if (!isQueueReady()) return;
  await redis.set(redisKey(id), JSON.stringify(session), "EX", CAPTCHA_TTL_SECONDS);
}

async function deleteRedis(id: string): Promise<void> {
  if (!isQueueReady()) return;
  await redis.del(redisKey(id));
}

export function createChallenge(): CaptchaChallenge {
  const left = 2 + Math.floor(Math.random() * 8);
  const right = 2 + Math.floor(Math.random() * 8);
  const answer = left + right;
  const choices = new Set<number>([answer]);

  while (choices.size < 3) {
    const delta = 1 + Math.floor(Math.random() * 5);
    const candidate = Math.random() < 0.5 ? answer + delta : answer - delta;
    if (candidate > 0 && candidate !== answer) choices.add(candidate);
  }

  const options = [...choices].sort(() => Math.random() - 0.5);
  return {
    question: `${left} + ${right} = ?`,
    options: options.map(String),
    correctIndex: options.indexOf(answer),
  };
}

async function loadSession(id: string): Promise<CaptchaSession | null> {
  const local = memory.get(id);
  if (local) return local;
  if (!isQueueReady()) return null;
  try {
    const raw = await redis.get(redisKey(id));
    if (!raw) return null;
    const session = parseSession(raw);
    if (session) memory.set(id, session);
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[captcha] Redis o'qilmadi: ${message}`);
    return null;
  }
}

async function deleteSession(id: string): Promise<void> {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  memory.delete(id);
  await deleteRedis(id).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[captcha] Redis tozalanmadi: ${message}`);
  });
}

async function takeSession(id: string): Promise<CaptchaSession | null> {
  if (taken.has(id)) return null;
  taken.add(id);
  try {
    const current = await loadSession(id);
    if (!current) return null;
    await deleteSession(id);
    return current;
  } finally {
    taken.delete(id);
  }
}

export async function rememberCaptcha(input: {
  chatId: number;
  userId: number;
  kind: CaptchaKind;
  correctIndex: number;
  onExpire: () => Promise<void>;
}): Promise<void> {
  const id = storageKey(input.chatId, input.userId);
  await deleteSession(id);

  const session: CaptchaSession = {
    chatId: input.chatId,
    userId: input.userId,
    kind: input.kind,
    correctIndex: input.correctIndex,
    messageId: null,
  };
  memory.set(id, session);
  await writeRedis(id, session).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[captcha] Redis yozilmadi, xotira ishlatiladi: ${message}`);
  });

  const timer = setTimeout(() => {
    void takeSession(id)
      .then((current) => {
        if (!current) return undefined;
        return input.onExpire();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[captcha] muddat tugaganda xato: ${message}`);
      });
  }, CAPTCHA_TTL_SECONDS * 1000);
  timers.set(id, timer);
}

export async function setCaptchaMessage(chatId: number, userId: number, messageId: number): Promise<void> {
  const id = storageKey(chatId, userId);
  const current = await loadSession(id);
  if (!current) return;
  current.messageId = messageId;
  memory.set(id, current);
  await writeRedis(id, current).catch(() => undefined);
}

export async function clearCaptcha(chatId: number, userId: number): Promise<void> {
  await deleteSession(storageKey(chatId, userId));
}

export async function answerCaptcha(chatId: number, userId: number, index: number): Promise<CaptchaResult> {
  const current = await takeSession(storageKey(chatId, userId));
  if (!current) return "missing";
  return index === current.correctIndex ? "correct" : "wrong";
}
