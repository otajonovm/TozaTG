export function toBigIntId(id: number): bigint {
  return BigInt(id);
}

export function toTelegramNumber(id: bigint): number {
  const value = Number(id);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Telegram id JS soniga sig'maydi: ${id.toString()}`);
  }
  return value;
}
