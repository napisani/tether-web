import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type {
  CallActionCommand,
  CallConnectionStatus,
  DaemonEvent,
  PhoneCall,
} from "../../protocol";

type CallAction = "dial" | CallActionCommand["action"];

type PendingAction = { action: CallAction; path: string; status: "waiting" | "uncertain" };

export type CallsState = {
  calls: PhoneCall[];
  loaded: boolean;
  status: CallConnectionStatus | null;
  number: string;
  pending: Record<string, PendingAction>;
  error: string;
};

const initialState: CallsState = {
  calls: [],
  loaded: false,
  status: null,
  number: "",
  pending: {},
  error: "",
};

const actionTimeoutMs = 15_000;

export function callActionKey(action: CallAction, path = "") {
  return path ? `${action}:${path}` : action;
}

function actionFinished(attempt: PendingAction, calls: PhoneCall[]) {
  // A new outgoing call could have been placed on the iPhone or by another
  // browser; without an operation ID, it cannot confirm this browser's dial.
  if (attempt.action === "dial") return false;

  const call = calls.find((entry) => entry.path === attempt.path);

  if (attempt.action === "answer") return !call || !call.ringing;

  if (attempt.action === "hangup") return !call || call.state === "disconnected";

  return false;
}

function canSendAction(action: CallAction, path: string, value: CallsState) {
  if (
    !value.status?.available ||
    value.pending[callActionKey(action, path)] ||
    (path && Object.values(value.pending).some((attempt) => attempt.path === path))
  )
    return false;

  if (action === "dial") return Boolean(value.number.trim());

  if (action === "audio_here")
    return Boolean(value.status.audio) && value.status.audio !== "active";

  if (action === "audio_phone") return value.status.audio === "active";
  const call = value.calls.find((entry) => entry.path === path);

  return Boolean(
    path && call && call.state !== "disconnected" && (action !== "answer" || call.ringing),
  );
}

export function useCalls(visible: boolean) {
  const [state, setState] = useState<CallsState>(initialState);
  const current = useRef(state);
  const visibleRef = useRef(visible);

  useLayoutEffect(() => {
    current.current = state;
    visibleRef.current = visible;
  }, [state, visible]);
  const online = useRef(false);
  const hfpReady = useRef(false);
  const timers = useRef(new Map<string, number>());
  const epoch = useRef(0);

  const change = useCallback((update: (value: CallsState) => CallsState) => {
    setState((previous) => {
      const next = update(previous);
      current.current = next;

      return next;
    });
  }, []);

  const clearTimer = useCallback((key: string) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
  }, []);

  const refresh = useCallback(() => {
    const requestEpoch = epoch.current;
    void sendDaemonCommand({ command: "bt_list_calls" }).catch(() => {
      if (requestEpoch === epoch.current && visibleRef.current && online.current) {
        change((value) => ({
          ...value,
          error: "Could not refresh calls. Check the tetherd connection.",
        }));
      }
    });
  }, [change]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const resetConnection = useCallback(
    (reason: string) => {
      hfpReady.current = false;
      epoch.current++;

      for (const key of timers.current.keys()) clearTimer(key);
      change((value) => ({
        ...initialState,
        number: value.number,
        status: { available: false, reason },
        error: Object.values(value.pending).length
          ? "Connection lost; a call action may have reached your iPhone. " +
            "Check it before trying again."
          : value.error.startsWith("Connection lost;")
            ? value.error
            : "",
      }));
    },
    [change, clearTimer],
  );

  const handleDisconnect = useCallback(() => {
    online.current = false;
    resetConnection("Calls are not connected.");
  }, [resetConnection]);

  const applyCallList = useCallback(
    (calls: PhoneCall[]) => {
      if (!online.current || !hfpReady.current) return;
      const pending = { ...current.current.pending };

      for (const [key, attempt] of Object.entries(pending)) {
        if (!actionFinished(attempt, calls)) continue;
        clearTimer(key);
        delete pending[key];
      }

      change((value) => ({
        ...value,
        calls,
        loaded: true,
        pending,
        error:
          Object.keys(pending).length === 0 && Object.keys(value.pending).length > 0
            ? ""
            : value.error,
      }));
    },
    [change, clearTimer],
  );

  const applyConnectionStatus = useCallback(
    (status: CallConnectionStatus | null) => {
      if (!online.current) return;

      if (!status?.available) {
        resetConnection(status?.reason || "The iPhone has not connected Hands-Free.");

        return;
      }

      const wasAvailable = hfpReady.current;
      hfpReady.current = true;
      const pending = { ...current.current.pending };

      for (const [key, attempt] of Object.entries(pending)) {
        const routed =
          (attempt.action === "audio_here" && status.audio === "active") ||
          (attempt.action === "audio_phone" && status.audio !== "active");

        if (!routed) continue;
        clearTimer(key);
        delete pending[key];
      }

      change((value) => ({
        ...value,
        status,
        pending,
        error:
          Object.keys(pending).length === 0 && Object.keys(value.pending).length > 0
            ? ""
            : value.error,
      }));

      if (visibleRef.current && !wasAvailable) refresh();
    },
    [change, clearTimer, refresh, resetConnection],
  );

  const handleEvent = useCallback(
    (event: DaemonEvent) => {
      switch (event.command) {
        case "gateway_status":
          online.current = event.daemon_connected;
          break;
        case "bt_calls":
          applyCallList(event.calls);
          break;
        case "bt_connection_changed":
          applyConnectionStatus(event.calls ?? null);
          break;
        case "bt_call_result":
          // Results are global and uncorrelated; use them only to refresh the
          // observed call list, never to resolve this browser's pending action.
          if (visibleRef.current && online.current) refresh();
          break;
      }
    },
    [applyCallList, applyConnectionStatus, refresh],
  );

  useEffect(
    () => () => {
      for (const timeout of timers.current.values()) window.clearTimeout(timeout);
      timers.current.clear();
    },
    [],
  );

  const setNumber = (number: string) => change((value) => ({ ...value, number, error: "" }));

  const resolveUncertain = () =>
    change((value) => ({
      ...value,
      error: "",
      pending: Object.fromEntries(
        Object.entries(value.pending).filter(([, attempt]) => attempt.status !== "uncertain"),
      ),
    }));

  const sendAction = (action: CallAction, path = "") => {
    const value = current.current;

    if (!online.current || !canSendAction(action, path, value)) return;
    const key = callActionKey(action, path);
    const number = value.number.trim();

    change((previous) => ({
      ...previous,
      error: "",
      pending: { ...previous.pending, [key]: { action, path, status: "waiting" } },
    }));
    timers.current.set(
      key,
      window.setTimeout(() => {
        if (!current.current.pending[key] || current.current.pending[key].status === "uncertain")
          return;
        timers.current.delete(key);
        change((previous) => ({
          ...previous,
          pending: {
            ...previous.pending,
            [key]: { ...previous.pending[key], status: "uncertain" },
          },
          error: "No confirmation from the iPhone. Check the call before trying again.",
        }));
      }, actionTimeoutMs),
    );

    const command: CallActionCommand | { command: "bt_call_dial"; number: string } =
      action === "dial"
        ? { command: "bt_call_dial", number }
        : { command: "bt_call_action", action };

    if (command.command === "bt_call_action" && path) command.path = path;
    // The global result contains only an action, not this tab's request. Treat
    // it as advisory; only the daemon's call/audio state completes the action.
    void sendDaemonCommand(command).catch(() => {
      if (current.current.pending[key])
        change((previous) => ({
          ...previous,
          error: "Could not confirm the call request. Check the iPhone before trying again.",
        }));
    });
  };

  return { state, setNumber, sendAction, resolveUncertain, refresh, handleEvent, handleDisconnect };
}
