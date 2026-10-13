import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { DaemonEvent, RecentCall } from "../../protocol";

export type CallHistoryState =
  | { kind: "unavailable"; reason: string }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; calls: RecentCall[] };

const disconnected = {
  kind: "unavailable",
  reason: "Connect your iPhone's Phone Book service to load recent calls.",
} satisfies CallHistoryState;

export function useCallHistory(visible: boolean) {
  const [state, setState] = useState<CallHistoryState>(disconnected);
  const online = useRef(false);
  const pbap = useRef(false);
  const shown = useRef(visible);
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    shown.current = visible;
  }, [visible]);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const refresh = useCallback(() => {
    if (!online.current || !pbap.current || !shown.current) return;
    const request = ++generation.current;
    clearTimer();
    setState({ kind: "loading" });

    const fail = (reason: string) => {
      if (request !== generation.current || !online.current || !pbap.current) return;
      clearTimer();
      setState({ kind: "unavailable", reason });
    };

    timer.current = window.setTimeout(
      () =>
        fail(
          "Recent calls did not respond. This daemon may not support call history. Try refreshing.",
        ),
      12_000,
    );
    void sendDaemonCommand({ command: "bt_list_call_history" }).catch(() =>
      fail("Could not request recent calls. Try refreshing."),
    );
  }, [clearTimer]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const handleDisconnect = useCallback(() => {
    online.current = false;
    pbap.current = false;
    generation.current++;
    clearTimer();
    setState(disconnected);
  }, [clearTimer]);

  const handleEvent = useCallback(
    (event: DaemonEvent) => {
      switch (event.command) {
        case "gateway_status":
          if (!event.daemon_connected) handleDisconnect();
          else {
            online.current = true;
          }

          break;
        case "bt_connection_changed": {
          if (!online.current) break;
          const wasOpen = pbap.current;
          pbap.current = event.pbap_open === true;

          if (!pbap.current) {
            generation.current++;
            clearTimer();
            setState({
              kind: "unavailable",
              reason: event.pbap_error || event.profile_reason || disconnected.reason,
            });
          } else if (!wasOpen) refresh();
          break;
        }

        case "bt_call_history":
          if (!online.current || !pbap.current) break;
          generation.current++;
          clearTimer();
          setState(
            event.calls.length
              ? { kind: "ready", calls: event.calls.slice(0, 100) }
              : { kind: "empty" },
          );
          break;
      }
    },
    [clearTimer, handleDisconnect, refresh],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { state, refresh, handleEvent, handleDisconnect };
}
