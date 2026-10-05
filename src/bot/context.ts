import type { Context, SessionFlavor } from "grammy";

export interface SessionData {
  lastChatId?: string;
}

export type BotContext = Context & SessionFlavor<SessionData>;
