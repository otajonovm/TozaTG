import type { NextFunction } from "grammy";
import type { BotContext } from "../context";
import { upsertUser } from "../../services/user.service";

export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (ctx.from && !ctx.from.is_bot) {
    try {
      await upsertUser(ctx.from);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[auth] ${message}`);
    }
  }

  await next();
}
