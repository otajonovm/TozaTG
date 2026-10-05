import type { ChatSettings } from "@prisma/client";
import type { Message } from "grammy/types";

const PROFANITY = [
  "qotaq",
  "qotoq",
  "qotak",
  "kotak",
  "jalab",
  "sikaman",
  "sikish",
  "sikding",
  "gandon",
  "xaromzada",
  "кўтак",
  "кутак",
  "жаляб",
];

const INVITE_LINK =
  /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)\S+/i;
const ANY_LINK = /(?:https?:\/\/|t\.me\/|telegram\.me\/|www\.)\S+/gi;

const SERVICE_FIELDS = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "message_auto_delete_timer_changed",
  "pinned_message",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_scheduled",
  "video_chat_participants_invited",
] as const satisfies readonly (keyof Message)[];

export type ModerationReason = "profanity" | "invite_link" | "link_spam" | "non_latin";

export function isServiceMessage(message: Message): boolean {
  return SERVICE_FIELDS.some((field) => message[field] !== undefined);
}

function normalize(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е").replaceAll("o‘", "o").replaceAll("o'", "o").replaceAll("g‘", "g").replaceAll("g'", "g");
}

export function classifyText(
  text: string,
  settings: Pick<ChatSettings, "filterNonLatin" | "filterSpam"> | null,
): ModerationReason | null {
  const normalized = normalize(text);
  const spamOn = settings?.filterSpam !== false;

  if (spamOn && PROFANITY.some((word) => normalized.includes(word))) {
    return "profanity";
  }

  if (spamOn && INVITE_LINK.test(text)) {
    return "invite_link";
  }

  const links = text.match(ANY_LINK);
  if (spamOn && links && links.length >= 3) {
    return "link_spam";
  }

  if (settings?.filterNonLatin && isMostlyForeignScript(text)) {
    return "non_latin";
  }

  return null;
}

function isMostlyForeignScript(text: string): boolean {
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  if (letters.length < 8) return false;
  const allowed = letters.filter((char) => /\p{Script=Latin}|\p{Script=Cyrillic}/u.test(char));
  return allowed.length / letters.length < 0.5;
}
