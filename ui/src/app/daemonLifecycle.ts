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
export function useDaemonLifecycle({ features, dispatch, onResetCapabilities, onProtocolInfo, onBluetoothStatus }: {
  features: Features;
  dispatch: Dispatch<AppAction>;
  onResetCapabilities: () => void;
  onProtocolInfo: () => void;
  onBluetoothStatus: (enabled: boolean) => void;
}) {
  const { fileTransfer, messages, contacts, settings, browserNotifications, notifications, calls } = features;
  const online = useRef(false);

  const disconnect = useCallback(() => {
    if (!online.current) return;
    online.current = false;
    onResetCapabilities();
    fileTransfer.handleDisconnect();
    messages.handleDisconnect();
    contacts.handleDisconnect();
    settings.handleDisconnect();
    browserNotifications.handleDisconnect();
    notifications.handleDisconnect();
    calls.handleDisconnect();
  }, [onResetCapabilities, fileTransfer.handleDisconnect, messages.handleDisconnect,
    contacts.handleDisconnect, settings.handleDisconnect, browserNotifications.handleDisconnect,
    notifications.handleDisconnect, calls.handleDisconnect]);

  const onConnectionChange = useCallback((connected: boolean) => {
    if (connected) online.current = true;
    else disconnect();
    dispatch({ type: "daemon-connected", connected });
  }, [disconnect, dispatch]);

  const onEvent = useCallback((event: DaemonEvent) => {
    if (event.command === "gateway_status" && !event.daemon_connected) {
      disconnect();
      dispatch({ type: "daemon-event", event });

      return;
    }

    if (event.command === "gateway_status") online.current = true;

    if (event.command === "protocol_info") onProtocolInfo();

    fileTransfer.handleEvent(event);
    messages.handleEvent(event);
    contacts.handleEvent(event);
    settings.handleEvent(event);
    browserNotifications.handleEvent(event);
    notifications.handleEvent(event);
    calls.handleEvent(event);
    dispatch({ type: "daemon-event", event });

    if (event.command === "bt_status" && event.calls_enabled !== undefined) onBluetoothStatus(event.calls_enabled);

    if (event.command === "bt_pair_result" || event.command === "bt_unpair_result") {
      void Promise.allSettled([
        sendDaemonCommand({ command: "bt_status" }),
        sendDaemonCommand({ command: "bt_list_devices" }),
      ]);
    }
  }, [disconnect, dispatch, onProtocolInfo, onBluetoothStatus,
    fileTransfer.handleEvent, messages.handleEvent, contacts.handleEvent, settings.handleEvent,
    browserNotifications.handleEvent, notifications.handleEvent, calls.handleEvent]);

  return { onConnectionChange, onEvent };
}
