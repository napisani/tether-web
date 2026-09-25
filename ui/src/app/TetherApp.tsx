import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { sendDaemonCommand, useDaemonClient } from "../daemon/DaemonClient";
import type { DaemonEvent, ProtocolInfoEvent } from "../protocol";
import { DevicesView } from "../views/devices/DevicesView";
import { useAirPodsCommands } from "../views/devices/useAirPodsCommands";
import { useBluetoothCommands } from "../views/devices/useBluetoothCommands";
import { usePeerCommands } from "../views/devices/usePeerCommands";
import { useFileTransfer } from "../views/devices/useFileTransfer";
import { MessagesView } from "../views/messages/MessagesView";
import { useMessages } from "../views/messages/useMessages";
import { NotificationsView } from "../views/notifications/NotificationsView";
import { useNotifications } from "../views/notifications/useNotifications";
import { CallsView } from "../views/calls/CallsView";
import { useCalls } from "../views/calls/useCalls";
import { ContactsView } from "../views/contacts/ContactsView";
import { useContacts } from "../views/contacts/useContacts";
import { SettingsView } from "../views/settings/SettingsView";
import { useSettings } from "../views/settings/useSettings";
import { AppShell, type AppRoute } from "./AppShell";
import { initialAppState, reduceAppState } from "./appState";

function settingsSupported(protocol: ProtocolInfoEvent | undefined, current: boolean): boolean {
  return current && protocol?.capabilities.includes("settings") === true;
}

export function TetherApp() {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const [route, setRoute] = useState<AppRoute>("devices");
  const [settingsProtocolKnown, setSettingsProtocolKnown] = useState(false);
  const fileTransfer = useFileTransfer();
  const messages = useMessages(route === "messages");
  const hasCapability = (capability: string) => state.daemon.protocol?.capabilities.includes(capability) === true;
  const contactsAvailable = hasCapability("contacts");
  const contacts = useContacts(route === "contacts" && contactsAvailable);
  const settingsAvailable = settingsSupported(state.daemon.protocol, settingsProtocolKnown);
  const settings = useSettings(route === "settings" && settingsAvailable);
  const notificationsAvailable = hasCapability("notifications");
  const notifications = useNotifications(route === "notifications" && notificationsAvailable);
  const callsAvailable = hasCapability("calls");
  const calls = useCalls(route === "calls" && callsAvailable);
  const lastCallsEnabled = useRef<boolean | undefined>(undefined);
  const [callsCapabilityError, setCallsCapabilityError] = useState(false);

  const refreshCallsCapability = useCallback((enabled: boolean, force = false) => {
    if (!force && lastCallsEnabled.current === enabled) return;
    lastCallsEnabled.current = enabled;
    // bt_set_calls broadcasts bt_status, not the resulting protocol_info.
    void sendDaemonCommand({ command: "protocol_info" }).then(() => {
      if (lastCallsEnabled.current === enabled) setCallsCapabilityError(false);
    }).catch(() => {
      if (lastCallsEnabled.current === enabled) {
        lastCallsEnabled.current = undefined;
        setCallsCapabilityError(true);
      }
    });
  }, []);

  const onConnectionChange = useCallback(
    (connected: boolean) => {
      if (!connected) {
        setSettingsProtocolKnown(false);
        lastCallsEnabled.current = undefined;
        setCallsCapabilityError(false);
        fileTransfer.handleDisconnect();
        messages.handleDisconnect();
        contacts.handleDisconnect();
        settings.handleDisconnect();
        notifications.handleDisconnect();
        calls.handleDisconnect();
      }

      dispatch({ type: "daemon-connected", connected });
    },
    [fileTransfer.handleDisconnect, messages.handleDisconnect, contacts.handleDisconnect,
      settings.handleDisconnect, notifications.handleDisconnect, calls.handleDisconnect],
  );

  const onEvent = useCallback(
    (event: DaemonEvent) => {
      if (event.command === "protocol_info") setSettingsProtocolKnown(true);

      fileTransfer.handleEvent(event);
      messages.handleEvent(event);
      contacts.handleEvent(event);
      settings.handleEvent(event);
      notifications.handleEvent(event);
      calls.handleEvent(event);

      if (event.command === "gateway_status" && !event.daemon_connected) {
        setSettingsProtocolKnown(false);
        lastCallsEnabled.current = undefined;
        setCallsCapabilityError(false);
        messages.handleDisconnect();
        contacts.handleDisconnect();
        settings.handleDisconnect();
        notifications.handleDisconnect();
        calls.handleDisconnect();
      }

      dispatch({ type: "daemon-event", event });

      if (event.command === "bt_status" && event.calls_enabled !== undefined) {
        refreshCallsCapability(event.calls_enabled);
      }

      if (event.command === "bt_pair_result" || event.command === "bt_unpair_result") {
        void Promise.allSettled([
          sendDaemonCommand({ command: "bt_status" }),
          sendDaemonCommand({ command: "bt_list_devices" }),
        ]);
      }
    },
    [fileTransfer.handleEvent, messages.handleEvent, messages.handleDisconnect,
      contacts.handleEvent, contacts.handleDisconnect, settings.handleEvent, settings.handleDisconnect,
      notifications.handleEvent, notifications.handleDisconnect, calls.handleEvent, calls.handleDisconnect,
      refreshCallsCapability],
  );

  useDaemonClient({ onConnectionChange, onEvent });

  const actions = useBluetoothCommands(state.devices.pairing, dispatch);
  const airpodsActions = useAirPodsCommands(dispatch);
  const peerActions = usePeerCommands(dispatch);
  const peerDiscoveryAvailable = state.daemon.protocol?.capabilities.includes("peers") === true;
  const bluetoothPairingAvailable = state.daemon.protocol?.capabilities.includes("bluetooth.pairing") === true;
  useEffect(() => {
    if (state.daemon.connected && peerDiscoveryAvailable) peerActions.discover();
  }, [peerActions.discover, peerDiscoveryAvailable, state.daemon.connected]);

  const bluetoothAvailable = state.devices.bluetooth?.available ?? false;
  const wifiConnected = state.devices.wifi.peers.some((peer) => peer.paired && peer.connected);

  const phoneConnected = Boolean(
    state.devices.connection?.classic_connected || state.devices.connection?.le_connected,
  );

  return (
    <AppShell
      route={route}
      onNavigate={setRoute}
      daemonConnected={state.daemon.connected}
      bluetoothAvailable={bluetoothAvailable}
      wifiConnected={wifiConnected}
      wifiAvailable={state.devices.wifi.mdnsAvailable}
      phoneConnected={phoneConnected}
      version={state.devices.bluetooth?.version}
    >
      {route === "notifications" && <NotificationsView notifications={notifications} daemonConnected={state.daemon.connected}
        available={notificationsAvailable}
        onOpenDevices={() => setRoute("devices")} />}
      {route === "calls" && <CallsView calls={calls} daemonConnected={state.daemon.connected}
        available={callsAvailable} enabled={state.devices.bluetooth?.calls_enabled}
        capabilityError={callsCapabilityError}
        onRetryCapability={() => {
          if (state.devices.bluetooth?.calls_enabled !== undefined) {
            refreshCallsCapability(state.devices.bluetooth.calls_enabled, true);
          }
        }} />}
      {route === "messages" && <MessagesView messages={messages} daemonConnected={state.daemon.connected}
        available={hasCapability("messages")} />}
      {route === "contacts" && <ContactsView contacts={contacts} daemonConnected={state.daemon.connected}
        available={contactsAvailable} onOpenDevices={() => setRoute("devices")}
        onMessage={(thread, name) => { messages.openThread(thread, name); setRoute("messages"); }} />}
      {route === "settings" && <SettingsView settings={settings} daemonConnected={state.daemon.connected}
        available={settingsAvailable} checking={!settingsProtocolKnown} onOpenDevices={() => setRoute("devices")} />}
      {route === "devices" && <DevicesView
        daemon={state.daemon}
        state={state.devices}
        onScan={() => {
          if (bluetoothPairingAvailable && bluetoothAvailable) actions.scan();

          if (peerDiscoveryAvailable) peerActions.discover();
        }}
        onPair={actions.pair}
        onUnpair={actions.unpair}
        onConfirmPairing={actions.confirmPairing}
        onSetBluetoothEnabled={actions.setEnabled}
        onSolicitPermissions={actions.solicitPermissions}
        onResetPairing={actions.resetPairing}
        airpodsActions={airpodsActions}
        peerActions={peerActions}
        fileTransfer={fileTransfer}
      />}
    </AppShell>
  );
}
