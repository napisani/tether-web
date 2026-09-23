import type {
  AirPodsEvent,
  BluetoothConnectionEvent,
  BluetoothDevice,
  BluetoothStatusEvent,
  DaemonEvent,
} from "../../protocol";

export type PairingPhase = "idle" | "pairing" | "confirming" | "complete" | "error";

export type PairingState = {
  phase: PairingPhase;
  kind?: "pair" | "unpair";
  operationId?: string;
  address?: string;
  step?: string;
  detail?: string;
  code?: string;
  message?: string;
};

export type DevicesState = {
  bluetooth?: BluetoothStatusEvent;
  connection?: BluetoothConnectionEvent;
  devices: BluetoothDevice[];
  scanning: boolean;
  scanMessage?: string;
  pairing: PairingState;
  airpods?: AirPodsEvent;
  airpodsConnectingAddress?: string;
  airpodsConnectingToken?: string;
  airpodsMessage?: { address?: string; text: string };
};

export const initialDevicesState: DevicesState = {
  devices: [],
  scanning: false,
  pairing: { phase: "idle" },
};

export type DevicesAction =
  | { type: "scan-started" }
  | { type: "pair-started"; operationId: string; address: string }
  | { type: "unpair-started"; operationId: string; address: string }
  | { type: "pair-confirmation-sent" }
  | { type: "operation-failed"; message: string }
  | { type: "scan-failed"; message: string }
  | { type: "daemon-disconnected" }
  | { type: "pair-reset" }
  | { type: "airpods-connect-started"; address: string; token: string }
  | { type: "airpods-connect-timeout"; address: string; token: string }
  | { type: "airpods-command-failed"; message: string; address?: string; connect: boolean };

export function reduceDevicesState(state: DevicesState, action: DevicesAction): DevicesState {
  switch (action.type) {
    case "scan-started":
      return {
        ...state,
        devices: state.devices.filter((device) => !isAnonymousCandidate(device)),
        scanning: true,
        scanMessage: "Looking for nearby iPhones…",
      };
    case "pair-started":
      return {
        ...state,
        pairing: {
          phase: "pairing",
          kind: "pair",
          operationId: action.operationId,
          address: action.address,
          detail: "Starting Bluetooth pairing…",
        },
      };
    case "unpair-started":
      return {
        ...state,
        pairing: {
          phase: "pairing",
          kind: "unpair",
          operationId: action.operationId,
          address: action.address,
          detail: "Removing the Bluetooth pairing…",
        },
      };
    case "pair-confirmation-sent":
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: "pairing",
          code: undefined,
          detail: "Waiting for the iPhone to finish pairing…",
        },
      };
    case "operation-failed":
      return {
        ...state,
        pairing: { ...state.pairing, phase: "error", code: undefined, detail: undefined, message: action.message },
      };
    case "scan-failed":
      return { ...state, scanning: false, scanMessage: action.message };
    case "daemon-disconnected": {
      const operationInProgress = state.pairing.phase === "pairing" || state.pairing.phase === "confirming";
      return {
        ...state,
        scanning: false,
        scanMessage: state.scanning ? "Bluetooth scan stopped while Tether reconnects." : state.scanMessage,
        airpodsConnectingAddress: undefined,
        airpodsConnectingToken: undefined,
        airpodsMessage: state.airpodsConnectingAddress
          ? { address: state.airpodsConnectingAddress, text: "Connection to tetherd was lost. Try again after it reconnects." }
          : state.airpodsMessage,
        pairing: operationInProgress
          ? {
              ...state.pairing,
              phase: "error",
              code: undefined,
              detail: undefined,
              message: "Connection to tetherd was lost. Try again after it reconnects.",
            }
          : state.pairing,
      };
    }
    case "pair-reset":
      return { ...state, pairing: { phase: "idle" } };
    case "airpods-connect-started":
      return {
        ...state,
        airpodsConnectingAddress: action.address,
        airpodsConnectingToken: action.token,
        airpodsMessage: undefined,
      };
    case "airpods-connect-timeout":
      if (state.airpodsConnectingAddress !== action.address || state.airpodsConnectingToken !== action.token) return state;
      return {
        ...state,
        airpodsConnectingAddress: undefined,
        airpodsConnectingToken: undefined,
        airpodsMessage: { address: action.address, text: "No answer from tetherd. The AirPods connection may still have changed." },
      };
    case "airpods-command-failed":
      return {
        ...state,
        airpodsConnectingAddress: action.connect ? undefined : state.airpodsConnectingAddress,
        airpodsConnectingToken: action.connect ? undefined : state.airpodsConnectingToken,
        airpodsMessage: { address: action.address, text: action.message },
      };
  }
}

export function reduceDevicesEvent(state: DevicesState, event: DaemonEvent): DevicesState {
  switch (event.command) {
    case "bt_status":
      return { ...state, bluetooth: event as BluetoothStatusEvent };
    case "bt_devices": {
      const visible = event.devices.filter((device) => device.iphone || device.apple_nearby || device.airpods);
      const remembered = state.devices.filter(isAnonymousCandidate);
      return { ...state, devices: mergeDevices(remembered, visible) };
    }
    case "bt_connection_changed":
      return { ...state, connection: event as BluetoothConnectionEvent };
    case "bt_airpods":
      if (!isAirPodsEvent(event)) return state;
      return { ...state, airpods: event, airpodsMessage: undefined };
    case "bt_airpods_connect_result": {
      const address = state.airpodsConnectingAddress;
      return {
        ...state,
        airpodsConnectingAddress: undefined,
        airpodsConnectingToken: undefined,
        airpodsMessage: event.success
          ? undefined
          : { address, text: event.message || "Could not change the AirPods connection." },
      };
    }
    case "bt_airpods_mode_result":
      return {
        ...state,
        airpodsMessage: event.success
          ? undefined
          : { address: state.airpods?.address, text: event.message || "Could not change the listening mode." },
      };
    case "bt_scan_result":
      return { ...state, scanning: false, scanMessage: event.message };
    case "bt_pair_progress":
      if (!belongsToActivePairing(state.pairing, event.operation_id)) return state;
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: "pairing",
          step: event.step,
          detail: event.detail,
          code: undefined,
        },
      };
    case "bt_pair_confirm_request":
      if (!belongsToActivePairing(state.pairing, event.operation_id)) return state;
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: "confirming",
          code: event.code,
          detail: "Compare this code with the code shown on your iPhone.",
        },
      };
    case "bt_pair_result":
    case "bt_unpair_result":
      if (!belongsToActivePairing(state.pairing, event.operation_id)) return state;
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: event.success ? "complete" : "error",
          message: event.message,
          code: undefined,
          detail: undefined,
        },
      };
    default:
      return state;
  }
}

function isAnonymousCandidate(device: BluetoothDevice): boolean {
  return Boolean(device.apple_nearby && !device.paired && !device.bonded);
}

function mergeDevices(...groups: BluetoothDevice[][]): BluetoothDevice[] {
  const devices = new Map<string, BluetoothDevice>();
  for (const group of groups) {
    for (const device of group) devices.set(device.address, device);
  }
  return [...devices.values()];
}

function belongsToActivePairing(pairing: PairingState, operationId?: string): boolean {
  return !operationId || operationId === pairing.operationId;
}

function isAirPodsEvent(event: DaemonEvent): event is AirPodsEvent {
  if (event.command !== "bt_airpods" || typeof event.address !== "string" || typeof event.name !== "string") return false;
  if (typeof event.left !== "number" || typeof event.right !== "number" || typeof event.case !== "number") return false;
  if (!event.ear || typeof event.ear !== "object") return false;
  const ear = event.ear as Record<string, unknown>;
  return typeof ear.primary === "string" && typeof ear.secondary === "string" && typeof event.in_ear === "number";
}
