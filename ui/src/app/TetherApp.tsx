import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { sendDaemonCommand, useDaemonClient } from "../daemon/DaemonClient";
import type { BluetoothStatusEvent, ProtocolInfoEvent } from "../protocol";
import { DevicesView } from "../views/devices/DevicesView";
import { useAirPodsCommands } from "../views/devices/useAirPodsCommands";
import { useBluetoothCommands } from "../views/devices/useBluetoothCommands";
import { usePeerCommands } from "../views/devices/usePeerCommands";
import { useFileTransfer } from "../views/devices/useFileTransfer";
import { MessagesView } from "../views/messages/MessagesView";
import { useMessages, type MessagesState } from "../views/messages/useMessages";
import { NotificationsView } from "../views/notifications/NotificationsView";
import { useNotifications } from "../views/notifications/useNotifications";
import { CallsView } from "../views/calls/CallsView";
import { useCalls } from "../views/calls/useCalls";
import { ContactsView } from "../views/contacts/ContactsView";
import { useContacts } from "../views/contacts/useContacts";
import { SettingsView } from "../views/settings/SettingsView";
import { useSettings } from "../views/settings/useSettings";
import { AppShell, type AppRoute } from "./AppShell";
import { useAppRouteEffects, useAppShortcuts } from "./useAppShortcuts";
import { useDaemonLifecycle } from "./daemonLifecycle";
import { useBrowserNotifications } from "./useBrowserNotifications";
import { initialAppState, reduceAppState } from "./appState";

function settingsSupported(protocol: ProtocolInfoEvent | undefined, current: boolean): boolean {
  return current && protocol?.capabilities.includes("settings") === true;
}

function callsTabVisible(daemonConnected: boolean, status?: BluetoothStatusEvent): boolean {
  return daemonConnected && status?.calls_enabled === true;
}

function unreadMessageCount(connected: boolean, messages: MessagesState): number {
  if (!connected || !messages.mapOpen || !messages.threadsKnown) return 0;

  return messages.threads.reduce((total, thread) => total + (thread.unread ?? 0), 0);
}

export function TetherApp() {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const [route, setRoute] = useState<AppRoute>("devices");
  const [searchRequested, setSearchRequested] = useState(false);
  const [settingsProtocolKnown, setSettingsProtocolKnown] = useState(false);
  const fileTransfer = useFileTransfer();
  const messages = useMessages(route === "messages");

  const hasCapability = (capability: string) =>
    state.daemon.protocol?.capabilities.includes(capability) === true;

  const contactsAvailable = hasCapability("contacts");
  const contacts = useContacts(route === "contacts" && contactsAvailable);
  const settingsAvailable = settingsSupported(state.daemon.protocol, settingsProtocolKnown);
  const settings = useSettings(route === "settings" && settingsAvailable);
  const browserNotifications = useBrowserNotifications(() => setRoute("notifications"));
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
    void sendDaemonCommand({ command: "protocol_info" })
      .then(() => {
        if (lastCallsEnabled.current === enabled) setCallsCapabilityError(false);
      })
      .catch(() => {
        if (lastCallsEnabled.current === enabled) {
          lastCallsEnabled.current = undefined;
          setCallsCapabilityError(true);
        }
      });
  }, []);

  const resetCapabilities = useCallback(() => {
    setSettingsProtocolKnown(false);
    lastCallsEnabled.current = undefined;
    setCallsCapabilityError(false);
  }, []);

  const markProtocolKnown = useCallback(() => setSettingsProtocolKnown(true), []);

  const lifecycle = useDaemonLifecycle({
    features: {
      fileTransfer,
      messages,
      contacts,
      settings,
      browserNotifications,
      notifications,
      calls,
    },
    dispatch,
    onResetCapabilities: resetCapabilities,
    onProtocolInfo: markProtocolKnown,
    onBluetoothStatus: refreshCallsCapability,
  });

  useDaemonClient(lifecycle);

  const actions = useBluetoothCommands(state.devices.pairing, dispatch);
  const airpodsActions = useAirPodsCommands(dispatch);
  const peerActions = usePeerCommands(dispatch);
  const discoverPeers = peerActions.discover;
  const peerDiscoveryAvailable = state.daemon.protocol?.capabilities.includes("peers") === true;

  const bluetoothPairingAvailable =
    state.daemon.protocol?.capabilities.includes("bluetooth.pairing") === true;

  useEffect(() => {
    if (state.daemon.connected && peerDiscoveryAvailable) discoverPeers();
  }, [discoverPeers, peerDiscoveryAvailable, state.daemon.connected]);

  const bluetoothAvailable = state.devices.bluetooth?.available ?? false;
  const wifiConnected = state.devices.wifi.peers.some((peer) => peer.paired && peer.connected);

  const phoneConnected = Boolean(
    state.devices.connection?.classic_connected || state.devices.connection?.le_connected,
  );

  const showCalls = callsTabVisible(state.daemon.connected, state.devices.bluetooth);

  useAppShortcuts({
    onNavigate: setRoute,
    onNewMessage: () => {
      messages.startCompose();
      setRoute("messages");
    },
    onSearch: () => {
      setSearchRequested(true);
      setRoute("messages");
    },
    showCalls,
  });
  useAppRouteEffects(route, showCalls, searchRequested, setRoute, () => setSearchRequested(false));

  return (
    <AppShell
      route={route}
      onNavigate={setRoute}
      daemonConnected={state.daemon.connected}
      bluetoothAvailable={bluetoothAvailable}
      wifiConnected={wifiConnected}
      wifiAvailable={state.devices.wifi.mdnsAvailable}
      phoneConnected={phoneConnected}
      unreadCount={unreadMessageCount(state.daemon.connected, messages.state)}
      showCalls={showCalls}
      version={state.devices.bluetooth?.version}
    >
      {route === "notifications" && (
        <NotificationsView
          notifications={notifications}
          daemonConnected={state.daemon.connected}
          available={notificationsAvailable}
          onOpenDevices={() => setRoute("devices")}
        />
      )}
      {route === "calls" && (
        <CallsView
          calls={calls}
          daemonConnected={state.daemon.connected}
          available={callsAvailable}
          enabled={state.devices.bluetooth?.calls_enabled}
          capabilityError={callsCapabilityError}
          onRetryCapability={() => {
            if (state.devices.bluetooth?.calls_enabled !== undefined) {
              refreshCallsCapability(state.devices.bluetooth.calls_enabled, true);
            }
          }}
        />
      )}
      {route === "messages" && (
        <MessagesView
          messages={messages}
          daemonConnected={state.daemon.connected}
          available={hasCapability("messages")}
        />
      )}
      {route === "contacts" && (
        <ContactsView
          contacts={contacts}
          daemonConnected={state.daemon.connected}
          available={contactsAvailable}
          onOpenDevices={() => setRoute("devices")}
          onMessage={(thread, name) => {
            messages.openThread(thread, name);
            setRoute("messages");
          }}
        />
      )}
      {route === "settings" && (
        <SettingsView
          settings={settings}
          daemonConnected={state.daemon.connected}
          available={settingsAvailable}
          checking={!settingsProtocolKnown}
          onOpenDevices={() => setRoute("devices")}
          browserNotifications={browserNotifications}
        />
      )}
      {route === "devices" && (
        <DevicesView
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
        />
      )}
    </AppShell>
  );
}
