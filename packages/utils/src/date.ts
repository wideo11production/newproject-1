import { format, formatDistanceToNow, parseISO, isValid, differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays, differenceInWeeks, differenceInMonths, differenceInYears } from "date-fns";

export function formatDate(date: Date | string, pattern = "PPP"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "Invalid date";
  return format(d, pattern);
}

export function formatDateTime(date: Date | string): string {
  return formatDate(date, "PPP p");
}

export function formatTime(date: Date | string): string {
  return formatDate(date, "p");
}

export function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "Invalid date";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function getTimeAgo(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "Invalid date";

  const now = new Date();
  const seconds = differenceInSeconds(now, d);
  const minutes = differenceInMinutes(now, d);
  const hours = differenceInHours(now, d);
  const days = differenceInDays(now, d);
  const weeks = differenceInWeeks(now, d);
  const months = differenceInMonths(now, d);
  const years = differenceInYears(now, d);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

export function isToday(date: Date | string): boolean {
  const d = typeof date === "string" ? parseISO(date) : date;
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

export function isYesterday(date: Date | string): boolean {
  const d = typeof date === "string" ? parseISO(date) : date;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  );
}

export function startOfDay(date: Date | string): Date {
  const d = typeof date === "string" ? parseISO(date) : date;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date | string): Date {
  const d = typeof date === "string" ? parseISO(date) : date;
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? parseISO(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function subtractDays(date: Date | string, days: number): Date {
  return addDays(date, -days);
}

export function parseDateSafe(date: string | null | undefined): Date | null {
  if (!date) return null;
  const d = parseISO(date);
  return isValid(d) ? d : null;
}