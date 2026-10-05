import { prisma } from "../lib/prisma";

export async function getChatStats(chatId: string): Promise<{
  total: number;
  deleted: number;
  bots: number;
  premium: number;
}> {
  const where = { chatId };
  const [total, deleted, bots, premium] = await Promise.all([
    prisma.chatMember.count({ where }),
    prisma.chatMember.count({ where: { ...where, isDeleted: true } }),
    prisma.chatMember.count({ where: { ...where, isBot: true } }),
    prisma.chatMember.count({ where: { ...where, hasPremium: true } }),
  ]);

  return { total, deleted, bots, premium };
}
