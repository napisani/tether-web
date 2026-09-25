import { useEffect } from "react";
import type { AppRoute } from "./AppShell";

export function useAppRouteEffects(route: AppRoute, showCalls: boolean, searchRequested: boolean,
  onNavigate: (route: AppRoute) => void, clearSearch: () => void) {
  useEffect(() => {
    if (route === "calls" && !showCalls) onNavigate("devices");
  }, [route, showCalls, onNavigate]);

  useEffect(() => {
    if (route !== "messages" || !searchRequested) return;

    document.getElementById("message-search")?.focus();
    clearSearch();
  }, [route, searchRequested, clearSearch]);
}

export function useAppShortcuts({ onNavigate, onNewMessage, onSearch, showCalls }: {
  onNavigate: (route: AppRoute) => void;
  onNewMessage: () => void;
  onSearch: () => void;
  showCalls: boolean;
}) {
  useEffect(() => {
    const routes: AppRoute[] = ["devices", "messages", "notifications", "contacts", "calls"];

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey || event.isComposing ||
        event.ctrlKey === event.metaKey) return;

      // A draft, selection, or native browser input shortcut owns its own focus.
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;

      const route = routes[Number(event.key) - 1];

      if (route && (route !== "calls" || showCalls)) {
        event.preventDefault();
        onNavigate(route);
      } else if (event.key === ",") {
        event.preventDefault();
        onNavigate("settings");
      } else if (event.key === "n") {
        event.preventDefault();
        onNewMessage();
      } else if (event.key === "f") {
        event.preventDefault();
        onSearch();
      }
      // Ctrl/Meta+W and Q stay with the browser, not a daemon-host window.
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onNavigate, onNewMessage, onSearch, showCalls]);
}
