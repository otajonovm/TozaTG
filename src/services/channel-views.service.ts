import { withManagedChat } from "./chat-access.service";
import { getMtprotoClient, hasMtprotoSession, waitForFlood } from "./telegram-mtproto.service";

/** Oxirgi postlarning o'rtacha ko'rishi. Kanal ko'rinmasa null. */
export async function averageRecentViews(telegramChatId: bigint, _username: string | null): Promise<number | null> {
  if (!hasMtprotoSession()) return null;

  try {
    return await withManagedChat(telegramChatId, async (entity) => {
      const client = await getMtprotoClient();
      const views: number[] = [];
      let offsetId = 0;
      while (views.length < 20) {
        try {
          const page = offsetId > 0 ? { limit: 20, offsetId } : { limit: 20 };
          for await (const message of client.iterMessages(entity, page)) {
            if (typeof message.id === "number") offsetId = message.id;
            if (typeof message.views === "number" && message.views > 0) views.push(message.views);
            if (views.length >= 20) break;
          }
          break;
        } catch (error) {
          const waited = await waitForFlood(error);
          if (waited) continue;
          return average(views);
        }
      }
      return average(views);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[estimate] ko'rish o'qilmadi: ${message}`);
    return null;
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round(sum / values.length);
}
