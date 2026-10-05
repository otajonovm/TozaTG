import { Api } from "telegram";
import { prisma } from "../lib/prisma";
import { notifyUser } from "../services/notify.service";
import { withManagedChat } from "../services/chat-access.service";
import { getMtprotoClient, waitForFlood } from "../services/telegram-mtproto.service";

function readDcId(user: Api.User): number | null {
  if (user.photo && user.photo.className === "UserProfilePhoto") {
    return user.photo.dcId;
  }
  return null;
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
      dcId: readDcId(user),
      status: "MEMBER",
    },
    update: {
      isDeleted: Boolean(user.deleted),
      isBot: Boolean(user.bot),
      hasPremium: Boolean(user.premium),
      dcId: readDcId(user),
      scannedAt: new Date(),
    },
  });
}

export async function runScanTask(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { chat: { include: { owner: true } } },
  });
  if (!task) return;

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "RUNNING", error: null, processed: 0 },
  });

  let processed = 0;
  await withManagedChat(task.chat.telegramChatId, async (entity) => {
    const client = await getMtprotoClient();
    let offset = 0;
    while (true) {
      try {
        // showTotal ichida channels.GetFullChannel bor. Yopiq kanalda u CHANNEL_PRIVATE qaytaradi.
        for await (const user of client.iterParticipants(entity, { offset, showTotal: false })) {
          await saveParticipant(task.chatId, user);
          processed += 1;
          offset += 1;
          if (processed % 50 === 0) {
            await prisma.task.update({
              where: { id: task.id },
              data: { processed, total: processed },
            });
          }
        }
        return;
      } catch (error) {
        const waited = await waitForFlood(error);
        if (waited) continue;
        throw error;
      }
    }
  });

  await prisma.task.update({
    where: { id: task.id },
    data: { status: "COMPLETED", processed, total: processed },
  });

  const deleted = await prisma.chatMember.count({
    where: { chatId: task.chatId, isDeleted: true, status: { notIn: ["KICKED", "LEFT"] } },
  });
  await notifyUser(
    task.chat.owner.telegramId,
    `${task.chat.title}: skaner tugadi. ${processed} ta a'zo, shundan ${deleted} tasi o'chirilgan. Chiqarish uchun /clean.`,
  );
}
