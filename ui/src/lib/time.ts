import { useEffect, useState } from 'react';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago `iso` was, short, as a comment's header shows it: "now", "5m ago", "3h ago", "2d ago", then the date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const ago = Math.max(0, now - then);
  if (ago < MINUTE) return 'now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

/** The full date and time, for a relative time's tooltip. */
export function fullTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  return new Date(then).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The current time, updated each minute, so relative times stay true while the page is open. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** One or two letters for an avatar: the first and last names' initials, or "Y" for You. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? '') : '';
  return (first + last).toUpperCase();
}
