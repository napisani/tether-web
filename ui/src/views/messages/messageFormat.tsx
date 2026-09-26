import type { ReactNode } from "react";

const linkPattern = /(https?:\/\/|www\.)[^\s<>"']+/gi;

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
    parts.push(
      <a href={href} target="_blank" rel="noopener noreferrer" key={at}>
        {text}
      </a>,
    );
    cursor = at + text.length;
  }

  parts.push(body.slice(cursor));

  return <span>{parts}</span>;
}
