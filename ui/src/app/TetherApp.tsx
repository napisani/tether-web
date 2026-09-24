import { useCallback, useEffect, useReducer } from "react";
import { sendDaemonCommand, useDaemonClient } from "../daemon/DaemonClient";
import type { DaemonEvent } from "../protocol";
import { DevicesView } from "../views/devices/DevicesView";
import { useAirPodsCommands } from "../views/devices/useAirPodsCommands";
import { useBluetoothCommands } from "../views/devices/useBluetoothCommands";
import { usePeerCommands } from "../views/devices/usePeerCommands";
import { useFileTransfer } from "../views/devices/useFileTransfer";
import { AppShell } from "./AppShell";
import { initialAppState, reduceAppState } from "./appState";

export function TetherApp() {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const fileTransfer = useFileTransfer();

  const onConnectionChange = useCallback(
    (connected: boolean) => {
      if (!connected) fileTransfer.handleDisconnect();
      dispatch({ type: "daemon-connected", connected });
    },
    [fileTransfer.handleDisconnect],
  );

  const onEvent = useCallback(
    (event: DaemonEvent) => {
      fileTransfer.handleEvent(event);
      dispatch({ type: "daemon-event", event });

      if (event.command === "bt_pair_result" || event.command === "bt_unpair_result") {
        void Promise.allSettled([
          sendDaemonCommand({ command: "bt_status" }),
          sendDaemonCommand({ command: "bt_list_devices" }),
        ]);
      }
    },
    [fileTransfer.handleEvent],
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
      daemonConnected={state.daemon.connected}
      bluetoothAvailable={bluetoothAvailable}
      wifiConnected={wifiConnected}
      wifiAvailable={state.devices.wifi.mdnsAvailable}
      phoneConnected={phoneConnected}
      version={state.devices.bluetooth?.version}
    >
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
    </AppShell>
  );
}
