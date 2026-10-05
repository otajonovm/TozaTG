import { MemberStatus } from "@prisma/client";
import { Api } from "telegram";
import { prisma } from "../lib/prisma";
import { withManagedChat } from "./chat-access.service";
import { getMtprotoClient, hasMtprotoSession, iterateMembers } from "./telegram-mtproto.service";

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

export interface AuditReport {
  title: string;
  username: string | null;
  auditedAt: Date;
  total: number;
  deleted: number;
  bots: number;
  premium: number;
  real: number;
  realPercent: number;
  premiumPercent: number;
  deadPercent: number;
  botPercent: number;
  score: number;
  grade: string;
}

function activeMembers(chatId: string) {
  return { chatId, status: { notIn: [MemberStatus.KICKED, MemberStatus.LEFT] } };
}

function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * 100 balldan boshlanadi.
 * O'chirilgan akkauntning har 1% i 1.15 ball olib tashlaydi.
 * Tirik botning har 1% i 0.35 ball olib tashlaydi.
 */
export function cleanScore(total: number, deleted: number, bots: number): number {
  if (total <= 0) return 0;
  const raw = 100 - (deleted / total) * 115 - (bots / total) * 35;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function scoreGrade(score: number): string {
  if (score >= 90) return "A'lo";
  if (score >= 75) return "Yaxshi";
  if (score >= 60) return "O'rtacha";
  if (score >= 40) return "Past";
  return "Yomon";
}

function toReport(input: {
  title: string;
  username: string | null;
  auditedAt: Date;
  total: number;
  deleted: number;
  bots: number;
  premium: number;
}): AuditReport {
  const real = Math.max(0, input.total - input.deleted - input.bots);
  const score = cleanScore(input.total, input.deleted, input.bots);
  return {
    ...input,
    real,
    realPercent: share(real, input.total),
    premiumPercent: share(input.premium, input.total),
    deadPercent: share(input.deleted, input.total),
    botPercent: share(input.bots, input.total),
    score,
    grade: scoreGrade(score),
  };
}

async function readStoredAudit(
  chatId: string,
  title: string,
  username: string | null,
): Promise<AuditReport | null> {
  const where = activeMembers(chatId);
  const [total, deleted, bots, premium, latest] = await Promise.all([
    prisma.chatMember.count({ where }),
    prisma.chatMember.count({ where: { ...where, isDeleted: true } }),
    prisma.chatMember.count({ where: { ...where, isBot: true, isDeleted: false } }),
    prisma.chatMember.count({ where: { ...where, hasPremium: true, isDeleted: false } }),
    prisma.chatMember.findFirst({
      where,
      orderBy: { scannedAt: "desc" },
      select: { scannedAt: true },
    }),
  ]);

  if (total === 0) return null;
  return toReport({
    title,
    username,
    auditedAt: latest?.scannedAt ?? new Date(),
    total,
    deleted,
    bots,
    premium,
  });
}

async function saveParticipant(chatId: string, user: Api.User): Promise<void> {
  const userId = BigInt(user.id.toString());
  await prisma.chatMember.upsert({
    where: { chatId_userId: { chatId, userId } },
    create: {
      chatId,
      userId,
      isDeleted: Boolean(user.deleted),
      isBot: Boolean(user.bot),
      hasPremium: Boolean(user.premium),
      status: "MEMBER",
    },
    update: {
      isDeleted: Boolean(user.deleted),
      isBot: Boolean(user.bot),
      hasPremium: Boolean(user.premium),
      scannedAt: new Date(),
    },
  });
}

async function refreshFromTelegram(chatId: string, telegramChatId: bigint): Promise<void> {
  if (!hasMtprotoSession()) {
    throw new AuditError("A'zolar bazasi bo'sh. Avval /scan yuboring yoki akkaunt sessiyasini ulang.");
  }

  try {
    await withManagedChat(telegramChatId, async (entity) => {
      const client = await getMtprotoClient();
      for await (const user of iterateMembers(client, entity)) {
        await saveParticipant(chatId, user);
      }
    });
  } catch (error) {
    if (error instanceof AuditError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AuditError(message);
  }
}

export async function buildAudit(input: {
  chatId: string;
  telegramChatId: bigint;
  title: string;
  username: string | null;
}): Promise<AuditReport> {
  const stored = await readStoredAudit(input.chatId, input.title, input.username);
  if (stored) return stored;

  await refreshFromTelegram(input.chatId, input.telegramChatId);
  const fresh = await readStoredAudit(input.chatId, input.title, input.username);
  if (!fresh) {
    throw new AuditError("A'zolar topilmadi. Kanalni avval /scan qiling.");
  }
  return fresh;
}
