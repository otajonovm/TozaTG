import { isAdmin } from "../../config/env";
import { addBotKeyboard } from "../keyboards";
import type { BotContext } from "../context";

export async function startCommand(ctx: BotContext): Promise<void> {
  const username = ctx.me.username;
  if (!username) {
    await ctx.reply("Bot username topilmadi.");
    return;
  }

  if (ctx.chat?.type !== "private") {
    await ctx.reply("Sozlamalar va tozalash uchun menga shaxsiy yozing.", {
      reply_markup: addBotKeyboard(username),
    });
    return;
  }

  const name = ctx.from?.first_name ?? "do'st";
  const adminLine = ctx.from && isAdmin(ctx.from.id) ? "\nSiz platforma adminisiz." : "";

  await ctx.reply(
    [
      `Salom, ${name}. Men TozaTG.`,
      "Kanal va guruhlarni himoya qilaman, o'chirilgan akkauntlarni tozalayman va guruhni moderatsiya qilaman.",
      adminLine,
      "",
      "Buyruqlar:",
      "/mychats — ulangan chatlar",
      "/settings — captcha va filtrlar",
      "/scan — a'zolarni skanerlash",
      "/clean — bitta chatni tozalash",
      "/cleanall — barcha kanal va guruhlarni tozalash",
      "/fresh — post va xabarlarni o'chirib, yangi holatga keltirish",
      "/audit — kanal tozalik pasporti",
      "/clean_deleted — o'chirilgan akkaunt va botlarni chiqarish",
      "/estimate — kanal bozor narxi",
      "",
      "Botni admin qiling. Kanalda join request, guruhda esa xabarni o'chirish va a'zolarni cheklash huquqi kerak.",
      "Guruhdagi barcha xabarlarni ko'rishim uchun @BotFather da Privacy rejimini o'chiring.",
    ].join("\n"),
    { reply_markup: addBotKeyboard(username) },
  );
}
