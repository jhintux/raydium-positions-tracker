export type YearWindow = {
  gte: number;
  lt?: number;
  lte?: number;
};

export function localParts(unixSeconds: number, now = new Date(unixSeconds * 1000)) {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

export function yearWindow(year: number, now = new Date()): YearWindow {
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const gte = Math.floor(start.getTime() / 1000);
  if (year === now.getFullYear()) {
    return { gte, lte: Math.floor(now.getTime() / 1000) };
  }
  const end = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  return { gte, lt: Math.floor(end.getTime() / 1000) };
}

export function inMonth(unixSeconds: number, year: number, month: number) {
  const parts = localParts(unixSeconds);
  return parts.year === year && parts.month === month;
}

export function daysOpen(openedAt: number, closedAt: number | null, now = new Date()) {
  const end = closedAt ?? Math.floor(now.getTime() / 1000);
  const startDate = new Date(openedAt * 1000);
  const endDate = new Date(end * 1000);
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.max(0, Math.round((endUtc - startUtc) / 86_400_000));
}

export function monthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

export function monthName(month: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(2026, month - 1, 1));
}

export function formatTimestamp(unixSeconds: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

export function formatDay(unixSeconds: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(unixSeconds * 1000));
}
