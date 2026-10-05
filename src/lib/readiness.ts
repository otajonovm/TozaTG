let queueReady = false;

export function setQueueReady(ready: boolean): void {
  queueReady = ready;
}

export function isQueueReady(): boolean {
  return queueReady;
}
