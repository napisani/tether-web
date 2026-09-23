import { useCallback, useReducer } from "react";
import { useDaemonClient } from "../daemon/DaemonClient";
import type { DaemonEvent } from "../protocol";
import { DevicesView } from "../views/devices/DevicesView";
import { useAirPodsCommands } from "../views/devices/useAirPodsCommands";
import { useBluetoothCommands } from "../views/devices/useBluetoothCommands";
import { AppShell } from "./AppShell";
import { initialAppState, reduceAppState } from "./appState";

export function TetherApp() {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const onConnectionChange = useCallback(
    (connected: boolean) => dispatch({ type: "daemon-connected", connected }),
    [],
  );
  const onEvent = useCallback(
    (event: DaemonEvent) => dispatch({ type: "daemon-event", event }),
    [],
  );
  useDaemonClient({ onConnectionChange, onEvent });

  const actions = useBluetoothCommands(state.devices.pairing.operationId, dispatch);
  const airpodsActions = useAirPodsCommands(dispatch);
  const bluetoothAvailable = state.devices.bluetooth?.available ?? false;
  const phoneConnected = Boolean(
    state.devices.connection?.classic_connected || state.devices.connection?.le_connected,
  );

  return (
    <AppShell
      daemonConnected={state.daemon.connected}
      bluetoothAvailable={bluetoothAvailable}
      phoneConnected={phoneConnected}
      version={state.devices.bluetooth?.version}
    >
      <DevicesView
        daemon={state.daemon}
        state={state.devices}
        onScan={actions.scan}
        onPair={actions.pair}
        onUnpair={actions.unpair}
        onConfirmPairing={actions.confirmPairing}
        onResetPairing={actions.resetPairing}
        airpodsActions={airpodsActions}
      />
    </AppShell>
  );
}
