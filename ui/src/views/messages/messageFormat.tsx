import type { ReactNode } from "react";

const linkPattern = /(https?:\/\/|www\.)[^\s<>"']+/gi;

export function dayHeading(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function sameLocalDay(first: number, second: number): boolean {
  return new Date(first * 1000).toDateString() === new Date(second * 1000).toDateString();
}

export function MessageText({ body }: { body: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of body.matchAll(linkPattern)) {
    const at = match.index;
    const raw = match[0];
    const text = raw.replace(/[.,!?;:]+$/, "");

    if (!text) continue;
    const href = text.toLowerCase().startsWith("www.") ? `http://${text}` : text;
    const target = URL.canParse(href) ? new URL(href) : null;

    if (target?.protocol !== "http:" && target?.protocol !== "https:") continue;

    parts.push(body.slice(cursor, at));
    parts.push(<a href={href} target="_blank" rel="noopener noreferrer" key={at}>{text}</a>);
    cursor = at + text.length;
  }

  parts.push(body.slice(cursor));

  return <span>{parts}</span>;
}
