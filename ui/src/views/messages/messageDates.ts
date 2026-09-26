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
