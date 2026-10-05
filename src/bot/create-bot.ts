import { Bot } from "grammy";
import { env } from "../config/env";
import type { BotContext } from "./context";
import { auditCommand } from "./commands/audit.command";
import { cleanDeletedCommand } from "./commands/clean-deleted";
import { cleanAllCommand, cleanCommand, scanCommand } from "./commands/clean";
import { estimateCommand, handleEstimateViews } from "./commands/estimate";
import { freshCommand } from "./commands/fresh";
import { myChatsCommand } from "./commands/mychats";
import { settingsCommand } from "./commands/settings";
import { startCommand } from "./commands/start";
import { callbackHandler } from "./handlers/callback";
import { joinRequestHandler } from "./handlers/join-request.handler";
import { membershipHandler } from "./handlers/chat-member.handler";
import { messageHandler } from "./handlers/message";
import { authMiddleware } from "./middlewares/auth";
import { sessionMiddleware } from "./middlewares/session";

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  bot.use(sessionMiddleware());
  bot.use(authMiddleware);

  bot.command("start", startCommand);
  bot.command("mychats", myChatsCommand);
  bot.command("settings", settingsCommand);
  bot.command("scan", scanCommand);
  bot.command("clean", cleanCommand);
  bot.command("cleanall", cleanAllCommand);
  bot.command("fresh", freshCommand);
  bot.command("audit", auditCommand);
  bot.command("clean_deleted", cleanDeletedCommand);
  bot.command("estimate", estimateCommand);

  bot.on("callback_query:data", callbackHandler);
  bot.on("chat_join_request", joinRequestHandler);
  bot.on("my_chat_member", membershipHandler);
  bot.on("message:text", async (ctx, next) => {
    if (await handleEstimateViews(ctx)) return;
    await next();
  });
  bot.on("message", messageHandler);

  bot.catch((botError) => {
    const message = botError.error instanceof Error ? botError.error.message : String(botError.error);
    console.error(`[bot] ${message}`);
    const chatType = botError.ctx.chat?.type;
    if (chatType === "private" || chatType === "group" || chatType === "supergroup") {
      return botError.ctx.reply("Xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.").catch(() => undefined);
    }
    return undefined;
  });

  return bot;
}
