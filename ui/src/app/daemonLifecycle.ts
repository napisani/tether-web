import { useCallback, useRef, type Dispatch } from "react";
import { sendDaemonCommand } from "../daemon/DaemonClient";
import type { DaemonEvent } from "../protocol";
import type { AppAction } from "./appState";

type Feature = {
  handleEvent: (event: DaemonEvent) => void;
  handleDisconnect: () => void;
};

type Features = {
  fileTransfer: Feature;
  messages: Feature;
  contacts: Feature;
  settings: Feature;
  browserNotifications: Feature;
  notifications: Feature;
  calls: Feature;
};

// Keep the app's daemon lifecycle in one place: a stream error and an offline
// gateway event are two reports of the same loss, not two different cleanups.
export function useDaemonLifecycle({
  features,
  dispatch,
  onResetCapabilities,
  onProtocolInfo,
  onBluetoothStatus,
}: {
  features: Features;
  dispatch: Dispatch<AppAction>;
  onResetCapabilities: () => void;
  onProtocolInfo: () => void;
  onBluetoothStatus: (enabled: boolean) => void;
}) {
  const { fileTransfer, messages, contacts, settings, browserNotifications, notifications, calls } =
    features;

  const { handleDisconnect: disconnectFiles, handleEvent: onFileEvent } = fileTransfer;
  const { handleDisconnect: disconnectMessages, handleEvent: onMessageEvent } = messages;
  const { handleDisconnect: disconnectContacts, handleEvent: onContactEvent } = contacts;
  const { handleDisconnect: disconnectSettings, handleEvent: onSettingsEvent } = settings;

  const { handleDisconnect: disconnectBrowserAlerts, handleEvent: onBrowserAlertEvent } =
    browserNotifications;

  const { handleDisconnect: disconnectNotifications, handleEvent: onNotificationEvent } =
    notifications;

  const { handleDisconnect: disconnectCalls, handleEvent: onCallEvent } = calls;

  const online = useRef(false);

  const disconnect = useCallback(() => {
    if (!online.current) return;
    online.current = false;
    onResetCapabilities();
    disconnectFiles();
    disconnectMessages();
    disconnectContacts();
    disconnectSettings();
    disconnectBrowserAlerts();
    disconnectNotifications();
    disconnectCalls();
  }, [
    onResetCapabilities,
    disconnectFiles,
    disconnectMessages,
    disconnectContacts,
    disconnectSettings,
    disconnectBrowserAlerts,
    disconnectNotifications,
    disconnectCalls,
  ]);

  const onConnectionChange = useCallback(
    (connected: boolean) => {
      if (connected) online.current = true;
      else disconnect();
      dispatch({ type: "daemon-connected", connected });
    },
    [disconnect, dispatch],
  );

  const onEvent = useCallback(
    (event: DaemonEvent) => {
      if (event.command === "gateway_status" && !event.daemon_connected) {
        disconnect();
        dispatch({ type: "daemon-event", event });

        return;
      }

      if (event.command === "gateway_status") online.current = true;

      if (event.command === "protocol_info") onProtocolInfo();

      onFileEvent(event);
      onMessageEvent(event);
      onContactEvent(event);
      onSettingsEvent(event);
      onBrowserAlertEvent(event);
      onNotificationEvent(event);
      onCallEvent(event);
      dispatch({ type: "daemon-event", event });

      if (event.command === "bt_status" && event.calls_enabled !== undefined)
        onBluetoothStatus(event.calls_enabled);

      if (event.command === "bt_pair_result" || event.command === "bt_unpair_result") {
        void Promise.allSettled([
          sendDaemonCommand({ command: "bt_status" }),
          sendDaemonCommand({ command: "bt_list_devices" }),
        ]);
      }
    },
    [
      disconnect,
      dispatch,
      onProtocolInfo,
      onBluetoothStatus,
      onFileEvent,
      onMessageEvent,
      onContactEvent,
      onSettingsEvent,
      onBrowserAlertEvent,
      onNotificationEvent,
      onCallEvent,
    ],
  );

  return { onConnectionChange, onEvent };
}
