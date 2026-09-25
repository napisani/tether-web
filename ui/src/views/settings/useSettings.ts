import { useCallback, useEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { BluetoothStatusEvent, DaemonCommand, DaemonEvent } from "../../protocol";

type Retention = "encrypted" | "plaintext" | "none";

type ToggleSetting = "ancs_enabled" | "ancs_content_enabled" | "calls_enabled";

type Setting = ToggleSetting | "retention";

type Pending = { setting: Setting; expected: boolean | Retention; phase: "waiting" | "uncertain" };

export interface SettingsState {
  status: BluetoothStatusEvent | null;
  pending: Pending | null;
  error: string;
}

const timeoutMs = 12_000;

const refreshError = "Could not refresh host settings. Try again.";

export function useSettings(visible: boolean) {
  const [state, setState] = useState<SettingsState>({ status: null, pending: null, error: "" });
  const pending = useRef<Pending | null>(null);
  const online = useRef(false);
  const visibleRef = useRef(visible);
  const timer = useRef<number | undefined>(undefined);
  const epoch = useRef(0);
  const refreshSequence = useRef(0);
  const statusSequence = useRef(0);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const refresh = useCallback(() => {
    if (!online.current) return;

    const requestEpoch = epoch.current;
    const requestSequence = ++refreshSequence.current;
    const previousStatus = statusSequence.current;

    void sendDaemonCommand({ command: "bt_status" }).catch(() => {
      if (requestEpoch === epoch.current && requestSequence === refreshSequence.current &&
        previousStatus === statusSequence.current && visibleRef.current) {
        setState((value) => ({ ...value, error: refreshError }));
      }
    });
  }, []);

  useEffect(() => {
    visibleRef.current = visible;

    if (visible) refresh();
  }, [visible, refresh]);

  const handleDisconnect = useCallback(() => {
    epoch.current++;
    online.current = false;
    clearTimer();

    if (pending.current) pending.current = { ...pending.current, phase: "uncertain" };

    setState({ status: null, pending: pending.current,
      error: pending.current ? "Connection lost; the setting may have changed. Check the host before retrying." : "" });
  }, [clearTimer]);

  const handleEvent = useCallback((event: DaemonEvent) => {
    if (event.command === "gateway_status") {
      if (!event.daemon_connected) handleDisconnect();
      else {
        online.current = true;

        if (visibleRef.current) refresh();
      }
    }

    if (event.command !== "bt_status" || !online.current) return;

    statusSequence.current++;
    const active = pending.current;

    if (active && event[active.setting] === active.expected) {
      clearTimer();
      pending.current = null;
    }

    setState((value) => ({ ...value, status: event, pending: pending.current,
      error: active && !pending.current || value.error === refreshError ? "" : value.error }));
  }, [clearTimer, handleDisconnect, refresh]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const sendChange = (setting: Setting, expected: boolean | Retention, command: DaemonCommand) => {
    if (!online.current || pending.current || state.status?.[setting] === expected) return;

    const status = state.status;
    const bonded = Boolean(status?.available && status.device_address && status.enabled !== false);
    const retentionAllowed = Boolean(status?.available && status.device_address);

    if (setting === "retention" ? !retentionAllowed : !bonded || (setting === "ancs_content_enabled" && !status?.ancs_enabled)) return;

    if (status?.[setting] === undefined) return;

    const attempt: Pending = { setting, expected, phase: "waiting" };

    pending.current = attempt;
    setState((value) => ({ ...value, pending: attempt, error: "" }));
    timer.current = window.setTimeout(() => {
      if (pending.current !== attempt) return;

      pending.current = { ...attempt, phase: "uncertain" };
      timer.current = undefined;
      setState((value) => ({ ...value, pending: pending.current,
        error: "No confirmation from the host. Check its setting before retrying." }));
    }, timeoutMs);
    void sendDaemonCommand(command).catch(() => {
      if (pending.current !== attempt) return;

      setState((value) => ({ ...value,
        error: "Could not confirm the request reached the host. Wait for its status or check before retrying." }));
    });
  };

  const toggle = (setting: ToggleSetting, enabled: boolean) => {
    const names: Record<ToggleSetting, "bt_set_ancs" | "bt_set_ancs_content" | "bt_set_calls"> = {
      ancs_enabled: "bt_set_ancs", ancs_content_enabled: "bt_set_ancs_content", calls_enabled: "bt_set_calls",
    };

    sendChange(setting, enabled, { command: names[setting], enabled });
  };

  const setRetention = (retention: Retention) => {
    sendChange("retention", retention, { command: "bt_set_retention", retention });
  };

  const resolveUncertain = () => {
    if (pending.current?.phase !== "uncertain") return;

    pending.current = null;
    setState((value) => ({ ...value, pending: null, error: "" }));
    refresh();
  };

  return { state, refresh, handleEvent, handleDisconnect, toggle, setRetention, resolveUncertain };
}
