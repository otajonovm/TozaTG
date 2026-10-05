export const VIEW_PRICE_UZS = { low: 30, high: 60 } as const;
export const PAYBACK_MONTHS = { low: 4, high: 7 } as const;
export const PAID_POSTS_PER_MONTH = 8;
export const UZS_PER_USD = 12_800;
export const DELETED_FREE_PERCENT = 5;

export const TOPICS = {
  finance: { id: "finance", label: "Kripto/Moliya", coefficient: 1.5 },
  news: { id: "news", label: "Yangiliklar", coefficient: 1.0 },
  entertainment: { id: "entertainment", label: "Ko'ngilochar/Mem", coefficient: 0.7 },
  lifestyle: { id: "lifestyle", label: "Ayollar/Pazandachilik", coefficient: 1.1 },
} as const;

export type TopicId = keyof typeof TOPICS;

export function isTopicId(value: string): value is TopicId {
  return value in TOPICS;
}

export interface ValuationInput {
  topic: TopicId;
  /** O'rtacha 24 soatlik yoki oxirgi postlar ko'rishi. */
  views: number;
  realMembers: number;
  /** 0–100. O'chirilgan akkauntlar ulushi. */
  deletedPercent: number;
}

export interface ValuationReport {
  topic: TopicId;
  topicLabel: string;
  coefficient: number;
  views: number;
  realMembers: number;
  er: number;
  deletedPercent: number;
  cleanPercent: number;
  discount: number;
  adLowUzs: number;
  adHighUzs: number;
  saleLowUzs: number;
  saleHighUzs: number;
  saleLowUsd: number;
  saleHighUsd: number;
  note: string;
}

function roundTo(value: number, step: number): number {
  if (step <= 0) return Math.round(value);
  return Math.max(0, Math.round(value / step) * step);
}

/** 5% dan oshgan har 1% uchun sotuv narxidan 1.5% chegirma, ko'pi bilan 40%. */
export function deletionDiscount(deletedPercent: number): number {
  if (deletedPercent <= DELETED_FREE_PERCENT) return 0;
  const extra = deletedPercent - DELETED_FREE_PERCENT;
  return Math.min(0.4, (extra * 1.5) / 100);
}

/** Ko'rish / haqiqiy a'zo. 15–25% oddiy, undan yuqori talabni biroz oshiradi. */
export function erFactor(er: number): number {
  if (er >= 25) return 1.05;
  if (er >= 15) return 1;
  if (er >= 8) return 0.9;
  return 0.75;
}

export function engagementRate(views: number, realMembers: number): number {
  if (realMembers <= 0 || views <= 0) return 0;
  return Math.round((views / realMembers) * 1000) / 10;
}

function cleanNote(cleanPercent: number, deletedPercent: number, discount: number): string {
  const clean = formatPercent(cleanPercent);
  if (discount > 0) {
    return `O'chirilgan akkauntlar ${formatPercent(deletedPercent)}% — sotuv narxidan ${formatPercent(discount * 100)}% chegirma qilindi. Tozalangach narx oshishi mumkin.`;
  }
  if (cleanPercent >= 90) {
    return `Kanal tozalik darajasi ${clean}% bo'lgani sababli bozor narxida yaxshi sotilishi mumkin.`;
  }
  if (cleanPercent >= 75) {
    return `Kanal tozalik darajasi ${clean}%. Bozorda o'rtacha narxda sotilishi mumkin.`;
  }
  return `Kanal tozalik darajasi ${clean}%. O'lik akkauntlarni tozalash narxni oshirishi mumkin.`;
}

export function valueChannel(input: ValuationInput): ValuationReport {
  const topic = TOPICS[input.topic];
  const views = Math.max(0, input.views);
  const realMembers = Math.max(0, Math.round(input.realMembers));
  const deletedPercent = Math.min(100, Math.max(0, input.deletedPercent));
  const cleanPercent = Math.round((100 - deletedPercent) * 10) / 10;
  const er = engagementRate(views, realMembers);
  const discount = deletionDiscount(deletedPercent);
  const factor = erFactor(er);

  const adLowUzs = roundTo(views * VIEW_PRICE_UZS.low * topic.coefficient, 1_000);
  const adHighUzs = roundTo(views * VIEW_PRICE_UZS.high * topic.coefficient, 1_000);
  const monthlyMid = ((adLowUzs + adHighUzs) / 2) * PAID_POSTS_PER_MONTH;
  const keep = (1 - discount) * factor;
  const saleLowUzs = roundTo(monthlyMid * PAYBACK_MONTHS.low * keep, 100_000);
  const saleHighUzs = roundTo(monthlyMid * PAYBACK_MONTHS.high * keep, 100_000);

  return {
    topic: input.topic,
    topicLabel: topic.label,
    coefficient: topic.coefficient,
    views,
    realMembers,
    er,
    deletedPercent,
    cleanPercent,
    discount,
    adLowUzs,
    adHighUzs: Math.max(adLowUzs, adHighUzs),
    saleLowUzs,
    saleHighUzs: Math.max(saleLowUzs, saleHighUzs),
    saleLowUsd: roundTo(saleLowUzs / UZS_PER_USD, 10),
    saleHighUsd: roundTo(Math.max(saleLowUzs, saleHighUzs) / UZS_PER_USD, 10),
    note: cleanNote(cleanPercent, deletedPercent, discount),
  };
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatMoney(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatValuation(report: ValuationReport): string {
  return [
    "📊 Kanal baholash hisoboti:",
    `• Mavzu: ${report.topicLabel}`,
    `• Haqiqiy a'zolar: ${formatMoney(report.realMembers)}`,
    `• ER: ${formatPercent(report.er)}%`,
    `• Taxminiy reklama narxi (1 post): ${formatMoney(report.adLowUzs)} – ${formatMoney(report.adHighUzs)} so‘m`,
    `• Tavsiya etiladigan sotuv narxi: $${formatMoney(report.saleLowUsd)} – $${formatMoney(report.saleHighUsd)} (${formatMoney(report.saleLowUzs)} – ${formatMoney(report.saleHighUzs)} so‘m)`,
    `💡 Izoh: ${report.note}`,
  ].join("\n");
}
