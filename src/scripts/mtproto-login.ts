import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { env } from "../config/env";

const envPath = path.join(process.cwd(), ".env");

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function saveSession(session: string): Promise<void> {
  const raw = await readFile(envPath, "utf8");
  const line = `MTPROTO_SESSION="${session}"`;
  const next = /^MTPROTO_SESSION=.*$/m.test(raw)
    ? raw.replace(/^MTPROTO_SESSION=.*$/m, line)
    : `${raw.trimEnd()}\n${line}\n`;
  await writeFile(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

async function main(): Promise<void> {
  if (!input.isTTY) {
    throw new Error("Bu buyruqni Cursor terminalida ishga tushiring: npm run mtproto:login");
  }

  console.log("TozaTG — admin akkauntini ulash");
  console.log("Kanal a'zolarini o'qish uchun bot tokeni yetarli emas.");
  console.log("Shu yerda kanalda admin bo'lgan oddiy Telegram akkauntingizga kirasiz.");
  console.log("Parol va kod saqlanmaydi. .env ga faqat sessiya yoziladi.\n");

  const client = new TelegramClient(new StringSession(""), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 5,
    deviceModel: "TozaTG",
    appVersion: "0.1.0",
  });

  await client.start({
    phoneNumber: async () => {
      const phone = await ask("Telefon (+998...): ");
      if (!/^\+\d{8,15}$/.test(phone)) {
        throw new Error("Raqam + belgisi bilan xalqaro formatda bo'lishi kerak. Masalan: +998901234567");
      }
      return phone;
    },
    phoneCode: async (isCodeViaApp) => {
      const where = isCodeViaApp === false ? "SMS dagi" : "Telegram ilovasidagi";
      return ask(`${where} kod: `);
    },
    password: async (hint) => {
      const suffix = hint ? ` (eslatma: ${hint})` : "";
      return ask(`Ikki bosqichli parol${suffix}: `);
    },
    onError: async (error) => {
      console.error(error.message);
      return false;
    },
  });

  const saved = (client.session as StringSession).save();
  if (saved.length < 20) {
    throw new Error("Sessiya olinmadi.");
  }

  await saveSession(saved);
  const me = await client.getMe();
  await client.disconnect();

  const name = [me.firstName, me.lastName].filter(Boolean).join(" ");
  console.log(`\nUlandi: ${name}${me.username ? ` (@${me.username})` : ""}.`);
  console.log("Sessiya .env dagi MTPROTO_SESSION ga yozildi.");
  console.log("Botni qayta ishga tushiring, so'ng kanalda /scan yuboring.");
  console.log("Bu akkaunt shu kanalning admini bo'lishi shart.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${message}`);
  process.exit(1);
});
