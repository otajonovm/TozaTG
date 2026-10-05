import { Api } from "grammy";
import { env } from "../config/env";
import { toTelegramNumber } from "../lib/telegram-id";

export async function notifyUser(telegramUserId: bigint, text: string): Promise<void> {
  try {
    const api = new Api(env.BOT_TOKEN);
    await api.sendMessage(toTelegramNumber(telegramUserId), text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[notify] ${message}`);
  }
}
