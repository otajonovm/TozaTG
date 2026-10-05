import { session } from "grammy";
import type { BotContext, SessionData } from "../context";

export function sessionMiddleware() {
  return session<SessionData, BotContext>({
    initial: () => ({}),
  });
}
