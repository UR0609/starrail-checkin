const OFFSET_MS = 8 * 60 * 60 * 1000;

export function shanghaiParts(now = new Date()) {
  const shifted = new Date(now.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function shanghaiDate(now = new Date()) {
  const parts = shanghaiParts(now);
  const month = String(parts.month + 1).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function nextRunAt(hour, minute, now = new Date()) {
  const parts = shanghaiParts(now);
  let slot = Date.UTC(parts.year, parts.month, parts.day, hour, minute, 0) - OFFSET_MS;
  if (slot <= now.getTime()) {
    slot = Date.UTC(parts.year, parts.month, parts.day + 1, hour, minute, 0) - OFFSET_MS;
  }
  return new Date(slot).toISOString();
}

export function isPastSlot(hour, minute, now = new Date()) {
  const parts = shanghaiParts(now);
  return parts.hour * 60 + parts.minute >= hour * 60 + minute;
}

export function shouldCatchUp({ now = new Date(), hour, minute, lastAutoDate }) {
  return isPastSlot(hour, minute, now) && lastAutoDate !== shanghaiDate(now);
}

export function clampTime(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || h < 0 || h > 23) {
    throw new Error("小时要在 0 到 23 之间");
  }
  if (!Number.isInteger(m) || m < 0 || m > 59) {
    throw new Error("分钟要在 0 到 59 之间");
  }
  return { hour: h, minute: m };
}
