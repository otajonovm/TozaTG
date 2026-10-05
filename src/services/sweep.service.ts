import { prisma } from "../lib/prisma";
import { notifyUser } from "./notify.service";
import { hasMtprotoSession } from "./telegram-mtproto.service";
import { enqueueClean, enqueueScan, waitForTask } from "./task.service";
import type { ChatWithSettings } from "./chat.service";

let sweepRunning = false;

export function isSweepRunning(): boolean {
  return sweepRunning;
}

async function enableGuard(chatId: string): Promise<void> {
  await prisma.chatSettings.upsert({
    where: { chatId },
    create: {
      chatId,
      captchaEnabled: true,
      deleteServiceMessages: true,
    },
    update: {
      captchaEnabled: true,
      deleteServiceMessages: true,
    },
  });
}

export async function sweepChats(requesterTelegramId: number, chats: ChatWithSettings[]): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;

  const lines: string[] = [];
  try {
    for (const chat of chats) {
      await enableGuard(chat.id);

      if (!hasMtprotoSession()) {
        lines.push(`• ${chat.title}: sessiya yo'q, skaner o'tkazilmadi`);
        continue;
      }

      const scan = await enqueueScan(chat.id);
      const scanned = await waitForTask(scan.task.id);
      if (scanned.status === "FAILED") {
        lines.push(`• ${chat.title}: skaner yiqildi`);
        continue;
      }

      const deleted = await prisma.chatMember.count({
        where: {
          chatId: chat.id,
          isDeleted: true,
          status: { notIn: ["KICKED", "LEFT"] },
        },
      });

      if (deleted === 0) {
        lines.push(`• ${chat.title}: ${scanned.processed} a'zo, o'chirilgani yo'q`);
        continue;
      }

      const clean = await enqueueClean(chat.id, deleted);
      const cleaned = await waitForTask(clean.task.id);
      lines.push(
        cleaned.status === "COMPLETED"
          ? `• ${chat.title}: ${deleted} ta o'chirilgan akkaunt chiqarildi`
          : `• ${chat.title}: chiqarish yiqildi`,
      );
    }

    await notifyUser(
      BigInt(requesterTelegramId),
      [
        "Barcha chatlar tekshirildi.",
        ...lines,
        "",
        "Guruh va kanallarda captcha hamda servis xabarlarni o'chirish yoqildi. Yangi kirganlar tekshiruvdan o'tadi.",
      ].join("\n"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await notifyUser(BigInt(requesterTelegramId), `Umumiy tozalash to'xtadi: ${message.slice(0, 300)}`);
  } finally {
    sweepRunning = false;
  }
}
