import { useCallback, useEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { DaemonEvent, PhoneNotification } from "../../protocol";

type Dismissal = "waiting" | "uncertain" | "accepted";

export interface NotificationsState {
  items: PhoneNotification[];
  loaded: boolean;
  ready: boolean;
  reason: string;
  pending: Record<number, Dismissal>;
  error: string;
}

const dismissalTimeoutMs = 12_000;

const initialState: NotificationsState = {
  items: [], loaded: false, ready: false, reason: "Waiting for the iPhone.", pending: {}, error: "",
};

export function useNotifications(visible: boolean) {
  const [state, setState] = useState(initialState);
  const current = useRef(state);
  current.current = state;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const timers = useRef(new Map<number, number>());
  // List replies are uncorrelated; suppress removed UIDs until the ANCS session resets.
  const removed = useRef(new Set<number>());
  const acceptingNotifications = useRef(false);
  const daemonOnline = useRef(false);
  const connectionEpoch = useRef(0);

  const change = useCallback((update: (value: NotificationsState) => NotificationsState) => {
    setState((previous) => {
      const next = update(previous);
      current.current = next;

      return next;
    });
  }, []);

  const clearTimer = useCallback((uid: number) => {
    window.clearTimeout(timers.current.get(uid));
    timers.current.delete(uid);
  }, []);

  const invalidate = useCallback((reason: string) => {
    acceptingNotifications.current = false;
    connectionEpoch.current++;
    removed.current.clear();

    for (const uid of timers.current.keys()) clearTimer(uid);
    change((value) => ({ ...initialState, reason,
      error: Object.values(value.pending).some((pending) => pending !== "accepted")
        ? "Connection lost; the dismissal may have reached your iPhone. Check it before trying again."
        : value.error.startsWith("Connection lost;") ? value.error : "" }));
  }, [change, clearTimer]);

  const refresh = useCallback(() => {
    const epoch = connectionEpoch.current;
    void sendDaemonCommand({ command: "bt_list_notifications" }).catch(() => {
      if (epoch === connectionEpoch.current && visibleRef.current) {
        change((value) => ({ ...value, error: "Could not refresh notifications. Check the tetherd connection and try again." }));
      }
    });
  }, [change]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const handleEvent = useCallback((event: DaemonEvent) => {
    switch (event.command) {
      case "bt_notifications": {
        if (!daemonOnline.current || !acceptingNotifications.current) break;
        const items = event.notifications.filter((item) => !removed.current.has(item.uid));
        const present = new Set(items.map((item) => item.uid));

        for (const uid of timers.current.keys()) {
          if (!present.has(uid)) clearTimer(uid);
        }

        change((value) => ({ ...value, items, loaded: true,
          pending: Object.fromEntries(Object.entries(value.pending).filter(([uid]) => present.has(Number(uid)))) }));
        break;
      }

      case "bt_notification":
        if (acceptingNotifications.current && visibleRef.current) refresh();
        break;
      case "bt_notification_removed":
        if (!acceptingNotifications.current) break;
        removed.current.add(event.uid);
        clearTimer(event.uid);
        change((value) => {
          const pending = { ...value.pending };
          const hadPending = Boolean(pending[event.uid]);
          delete pending[event.uid];

          return { ...value, pending, items: value.items.filter((item) => item.uid !== event.uid),
            error: hadPending ? "" : value.error };
        });

        if (visibleRef.current) refresh();
        break;
      case "bt_notification_action_result":
        if (!acceptingNotifications.current || !current.current.pending[event.uid]) break;
        clearTimer(event.uid);
        change((value) => {
          const pending = { ...value.pending };

          pending[event.uid] = event.success ? "accepted" : "uncertain";

          return { ...value, pending,
            error: event.success ? "" : "The iPhone did not confirm the dismissal. Check it before trying again." };
        });

        if (event.success && visibleRef.current) refresh();
        break;
      case "bt_connection_changed": {
        if (!daemonOnline.current) break;

        if (event.ancs_ready !== true) {
          invalidate(event.ancs_reason || "Notification mirroring is unavailable.");
          break;
        }

        const wasReady = acceptingNotifications.current;
        acceptingNotifications.current = true;
        change((value) => ({ ...value, ready: true, reason: "" }));

        if (!wasReady && visibleRef.current) refresh();
        break;
      }

      case "gateway_status":
        daemonOnline.current = event.daemon_connected;
        break;
    }
  }, [change, clearTimer, invalidate, refresh]);

  const handleDisconnect = useCallback(() => {
    daemonOnline.current = false;
    invalidate(initialState.reason);
  }, [invalidate]);

  useEffect(() => () => {
    for (const timeout of timers.current.values()) window.clearTimeout(timeout);
    timers.current.clear();
  }, []);

  const dismiss = (uid: number) => {
    const value = current.current;

    if (!value.ready || value.pending[uid] || !value.items.some((item) => item.uid === uid && item.negative_action)) return;

    change((previous) => ({ ...previous, pending: { ...previous.pending, [uid]: "waiting" }, error: "" }));
    timers.current.set(uid, window.setTimeout(() => {
      if (current.current.pending[uid] !== "waiting") return;
      timers.current.delete(uid);
      change((previous) => ({ ...previous, pending: { ...previous.pending, [uid]: "uncertain" },
        error: "No answer about that dismissal; check your iPhone before trying again." }));
    }, dismissalTimeoutMs));
    // A failed HTTP write can still have reached tetherd. Wait for the UID result
    // or timeout rather than repeating an action on the phone.
    void sendDaemonCommand({ command: "bt_notification_action", uid, action: "negative" }).catch(() => {
      if (current.current.pending[uid] === "waiting") {
        change((previous) => ({ ...previous,
          error: "Could not confirm the dismissal request. Wait for a result or check your iPhone." }));
      }
    });
  };

  return { state, refresh, dismiss, handleEvent, handleDisconnect };
}
