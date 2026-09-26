import type { DaemonEvent, ProtocolInfoEvent } from "../protocol";
import {
  initialDevicesState,
  reduceDevicesEvent,
  reduceDevicesState,
  type DevicesAction,
  type DevicesState,
} from "../views/devices/devicesState";

export type DaemonState = {
  connected: boolean;
  protocol?: ProtocolInfoEvent;
};

export type AppState = {
  daemon: DaemonState;
  devices: DevicesState;
};

export const initialAppState: AppState = {
  daemon: { connected: false },
  devices: initialDevicesState,
};

export type AppAction =
  | { type: "daemon-connected"; connected: boolean }
  | { type: "daemon-event"; event: DaemonEvent }
  | DevicesAction;

export function reduceAppState(state: AppState, action: AppAction): AppState {
  if (action.type === "daemon-connected") {
    return {
      ...state,
      daemon: { ...state.daemon, connected: action.connected },
      devices: action.connected
        ? state.devices
        : reduceDevicesState(state.devices, { type: "daemon-disconnected" }),
    };
  }

  if (action.type === "daemon-event") {
    const disconnected =
      action.event.command === "gateway_status" && !action.event.daemon_connected;

    return {
      daemon: reduceDaemonEvent(state.daemon, action.event),
      devices: disconnected
        ? reduceDevicesState(state.devices, { type: "daemon-disconnected" })
        : reduceDevicesEvent(state.devices, action.event),
    };
  }

  return { ...state, devices: reduceDevicesState(state.devices, action) };
}

function reduceDaemonEvent(state: DaemonState, event: DaemonEvent): DaemonState {
  switch (event.command) {
    case "gateway_status":
      return { ...state, connected: event.daemon_connected };
    case "protocol_info":
      return { ...state, protocol: event };
    default:
      return state;
  }
}
