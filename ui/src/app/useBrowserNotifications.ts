import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonEvent } from "../protocol";

const preferenceKey = "tether-web:browser-notifications:v1";

export interface BrowserNotificationsState {
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  error: string;
}

function supported(): boolean {
  return window.isSecureContext === true && "Notification" in window;
}

function savedPreference(): boolean {
  try {
    return window.localStorage.getItem(preferenceKey) === "enabled";
  } catch {
    return false;
  }
}

function savePreference(enabled: boolean): boolean {
  try {
    window.localStorage.setItem(preferenceKey, enabled ? "enabled" : "disabled");

    return true;
  } catch {
    return false;
  }
}

function rememberUid(seen: Set<number>, uid: number) {
  if (seen.size >= 128) {
    const oldest = seen.values().next().value;

    if (oldest !== undefined) seen.delete(oldest);
  }

  seen.add(uid);
}

function initialState(): BrowserNotificationsState {
  const permission = supported() ? Notification.permission : "unsupported";

  return { enabled: savedPreference() && permission === "granted", permission, error: "" };
}

export function useBrowserNotifications(onOpenNotifications: () => void) {
  const [state, setState] = useState<BrowserNotificationsState>(initialState);
  const current = useRef(state);
  const onOpen = useRef(onOpenNotifications);
  const online = useRef(false);
  const statusSeen = useRef(false);
  const statusAllowsAlerts = useRef(false);
  const deviceAddress = useRef<string | undefined>(undefined);
  const connectionReady = useRef(false);
  const ready = useRef(false);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    current.current = state;
  }, [state]);
  useEffect(() => {
    onOpen.current = onOpenNotifications;
  }, [onOpenNotifications]);

  const syncPermission = useCallback(() => {
    const permission = supported() ? Notification.permission : "unsupported";

    if (current.current.enabled && permission !== "granted") savePreference(false);
    current.current = {
      ...current.current,
      enabled: current.current.enabled && permission === "granted",
      permission,
    };
    setState((value) => {
      const enabled = value.enabled && permission === "granted";

      return value.enabled === enabled && value.permission === permission
        ? value
        : { ...value, enabled, permission, error: "" };
    });

    return permission;
  }, []);

  useEffect(() => {
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);

    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, [syncPermission]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== preferenceKey && event.key !== null) return;

      setState((value) => ({
        ...value,
        enabled:
          event.newValue === "enabled" && supported() && Notification.permission === "granted",
        error: "",
      }));
    };

    window.addEventListener("storage", onStorage);

    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const enable = async () => {
    if (!supported()) {
      setState((value) => ({
        ...value,
        enabled: false,
        permission: "unsupported",
        error: "Browser notifications require a secure origin and Notification support.",
      }));

      return;
    }

    try {
      const permission =
        Notification.permission === "granted" ? "granted" : await Notification.requestPermission();

      const enabled = permission === "granted";
      const saved = savePreference(enabled);

      setState({
        enabled,
        permission,
        error:
          enabled && !saved
            ? "Enabled for this tab, but the browser could not save this preference."
            : enabled
              ? ""
              : "Browser notification permission was not granted.",
      });
    } catch {
      setState((value) => ({
        ...value,
        enabled: false,
        error: "Could not request browser notification permission.",
      }));
    }
  };

  const disable = () => {
    const saved = savePreference(false);

    setState((value) => ({
      ...value,
      enabled: false,
      error: saved ? "" : "Disabled for this tab, but the browser could not save this preference.",
    }));
  };

  const handleDisconnect = useCallback(() => {
    online.current = false;
    statusSeen.current = false;
    statusAllowsAlerts.current = false;
    deviceAddress.current = undefined;
    connectionReady.current = false;
    ready.current = false;
    seen.current.clear();
  }, []);

  const handleStatus = useCallback((event: Extract<DaemonEvent, { command: "bt_status" }>) => {
    const deviceChanged =
      deviceAddress.current !== undefined &&
      event.device_address !== undefined &&
      deviceAddress.current !== event.device_address;

    if (event.device_address !== undefined) deviceAddress.current = event.device_address;
    statusSeen.current = true;
    statusAllowsAlerts.current =
      event.available && event.enabled !== false && event.ancs_enabled !== false;

    if (deviceChanged || !statusAllowsAlerts.current) {
      connectionReady.current = false;
      ready.current = false;
      seen.current.clear();
    } else {
      // Gateway snapshots sort the connection event before bt_status.
      ready.current = connectionReady.current;
    }
  }, []);

  const handleEvent = useCallback(
    (event: DaemonEvent) => {
      switch (event.command) {
        case "gateway_status":
          online.current = event.daemon_connected;

          if (!event.daemon_connected) handleDisconnect();
          break;
        case "bt_status":
          handleStatus(event);
          break;
        case "bt_connection_changed":
          if (!online.current) break;

          // Preserve a snapshot connection that precedes bt_status, but do not
          // resurrect readiness from a late event while status explicitly denies ANCS.
          connectionReady.current =
            event.ancs_ready === true && (!statusSeen.current || statusAllowsAlerts.current);
          ready.current = statusAllowsAlerts.current && connectionReady.current;

          if (!ready.current) seen.current.clear();

          break;
        case "bt_notifications":
          // A gateway snapshot can deliver the list before bt_status; seed UIDs
          // without showing alerts, then require authoritative status for delivery.
          if (online.current && connectionReady.current) {
            event.notifications.forEach((item) => rememberUid(seen.current, item.uid));
          }

          break;
        case "bt_notification":
          if (
            syncPermission() !== "granted" ||
            !online.current ||
            !statusAllowsAlerts.current ||
            !ready.current ||
            !current.current.enabled ||
            document.visibilityState !== "hidden" ||
            seen.current.has(event.uid)
          )
            break;

          try {
            const notice = new Notification("New iPhone notification", {
              body: "Open Tether to view it.",
              tag: `tether-ancs-${event.uid}`,
            });

            rememberUid(seen.current, event.uid);
            notice.onclick = () => {
              window.focus();
              onOpen.current();
              notice.close();
            };
          } catch {
            setState((value) => ({ ...value, error: "Could not show a browser notification." }));
          }

          break;
      }
    },
    [handleDisconnect, handleStatus, syncPermission],
  );

  return { state, enable, disable, handleEvent, handleDisconnect };
}
