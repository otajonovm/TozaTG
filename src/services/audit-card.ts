import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { AuditReport } from "./audit.service";

const WIDTH = 1200;
const HEIGHT = 760;

const months = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

function formatDate(date: Date): string {
  const month = months[date.getMonth()] ?? "";
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}

function formatCount(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function drawBar(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  detail: string,
  percent: number,
  color: string,
): void {
  ctx.font = "600 22px Segoe UI";
  ctx.fillStyle = "#E7EEF5";
  ctx.textAlign = "left";
  ctx.fillText(label, x, y);
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.fillText(`${percent}%`, x + width, y);

  ctx.font = "400 16px Segoe UI";
  ctx.fillStyle = "#8FA0B3";
  ctx.textAlign = "left";
  ctx.fillText(detail, x, y + 26);

  const trackY = y + 40;
  roundRect(ctx, x, trackY, width, 14, 7);
  ctx.fillStyle = "#243140";
  ctx.fill();

  const fillWidth = Math.max(percent > 0 ? 14 : 0, (width * Math.min(percent, 100)) / 100);
  if (fillWidth > 0) {
    roundRect(ctx, x, trackY, fillWidth, 14, 7);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawSeal(ctx: SKRSContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#3DDC97";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 48, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(61, 220, 151, 0.45)";
  ctx.stroke();

  ctx.fillStyle = "#3DDC97";
  ctx.font = "700 13px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText("TOZATG", 0, -6);
  ctx.font = "600 12px Segoe UI";
  ctx.fillText("AUDIT", 0, 14);
  ctx.restore();
}

export function renderAuditCard(report: AuditReport): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#101820");
  background.addColorStop(1, "#0B1B2B");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(980, 140, 20, 980, 180, 280);
  glow.addColorStop(0, "rgba(42, 171, 238, 0.28)");
  glow.addColorStop(1, "rgba(42, 171, 238, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#2AABEE";
  ctx.fillRect(0, 0, 8, HEIGHT);

  ctx.font = "700 16px Segoe UI";
  ctx.fillStyle = "#2AABEE";
  ctx.textAlign = "left";
  ctx.fillText("TOZATG", 56, 64);
  ctx.fillStyle = "#8FA0B3";
  ctx.font = "600 16px Segoe UI";
  ctx.fillText("KANAL TOZALIK PASPORTI", 148, 64);

  ctx.font = "700 42px Segoe UI";
  ctx.fillStyle = "#F4F7FB";
  const title = fitText(ctx, report.title, 760);
  ctx.fillText(title, 56, 140);

  ctx.font = "500 24px Segoe UI";
  ctx.fillStyle = "#7FB6D6";
  ctx.fillText(report.username ? `@${report.username}` : "Maxfiy kanal", 56, 184);

  ctx.font = "600 18px Segoe UI";
  ctx.fillStyle = "#8FA0B3";
  ctx.fillText(`Audit sanasi: ${formatDate(report.auditedAt)}`, 56, 228);
  ctx.fillStyle = "#3DDC97";
  ctx.fillText("TozaTG Tasdiqlangan Audit", 56, 258);

  drawSeal(ctx, 1040, 150);

  ctx.font = "700 40px Segoe UI";
  ctx.fillStyle = "#F4F7FB";
  const scoreLine = `Tozalik ko'rsatkichi: ${report.score}/100 (${report.grade})`;
  ctx.fillText(fitText(ctx, scoreLine, 1000), 56, 340);

  ctx.font = "400 18px Segoe UI";
  ctx.fillStyle = "#8FA0B3";
  ctx.fillText(
    `${formatCount(report.total)} a'zo   ·   ${formatCount(report.deleted)} o'lik   ·   ${formatCount(report.bots)} bot   ·   ${formatCount(report.premium)} Premium`,
    56,
    382,
  );

  drawBar(
    ctx,
    56,
    450,
    1088,
    "Haqiqiy faol obunachilar",
    `${formatCount(report.real)} ta — o'lik va bot emas`,
    report.realPercent,
    "#3DDC97",
  );
  drawBar(
    ctx,
    56,
    540,
    1088,
    "Premium a'zolar",
    `${formatCount(report.premium)} ta`,
    report.premiumPercent,
    "#E2B340",
  );
  drawBar(
    ctx,
    56,
    630,
    1088,
    "Chiqitlar / o'liklar",
    `${formatCount(report.deleted)} ta o'chirilgan akkaunt`,
    report.deadPercent,
    "#FF5D5D",
  );

  return canvas.toBuffer("image/png");
}
