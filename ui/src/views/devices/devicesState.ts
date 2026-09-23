import type {
  AirPodsEvent,
  BluetoothConnectionEvent,
  BluetoothDevice,
  BluetoothStatusEvent,
  DaemonEvent,
  DiscoveredPeer,
  StateSnapshotEvent,
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

export type WifiPeer = {
  fingerprint: string;
  name: string;
  address?: string;
  port: number;
  paired: boolean;
  connected: boolean;
  pending: boolean;
};

export type WifiState = {
  peers: WifiPeer[];
  mdnsAvailable: boolean;
  clipboardAvailable: boolean;
  firewallActive: boolean;
  discovering: boolean;
  discoveryToken?: string;
  pairingFingerprint?: string;
  pairingToken?: string;
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
  bluetoothEnabledTarget?: boolean;
  bluetoothEnabledToken?: string;
  bluetoothSolicitToken?: string;
  bluetoothMessage?: string;
  wifi: WifiState;
};

export const initialDevicesState: DevicesState = {
  devices: [],
  scanning: false,
  pairing: { phase: "idle" },
  wifi: {
    peers: [],
    mdnsAvailable: true,
    clipboardAvailable: true,
    firewallActive: false,
    discovering: false,
  },
};

export type DevicesAction =
  | { type: "scan-started" }
  | { type: "pair-started"; operationId: string; address: string }
  | { type: "unpair-started"; operationId: string; address: string }
  | { type: "pair-confirmation-sent"; operationId: string }
  | { type: "operation-failed"; operationId: string; message: string }
  | { type: "scan-failed"; message: string }
  | { type: "daemon-disconnected" }
  | { type: "pair-reset" }
  | { type: "airpods-connect-started"; address: string; token: string }
  | { type: "airpods-connect-timeout"; address: string; token: string }
  | { type: "airpods-command-failed"; message: string; address?: string; connect: boolean }
  | { type: "bluetooth-enabled-started"; enabled: boolean; token: string }
  | { type: "bluetooth-enabled-failed"; token: string; message: string }
  | { type: "bluetooth-enabled-timeout"; token: string }
  | { type: "bluetooth-solicit-started"; token: string }
  | { type: "bluetooth-solicit-failed"; token: string; message: string }
  | { type: "bluetooth-solicit-timeout"; token: string }
  | { type: "peer-discovery-started"; token: string }
  | { type: "peer-discovery-failed"; token: string; message: string }
  | { type: "peer-discovery-timeout"; token: string }
  | { type: "peer-pair-started"; fingerprint: string; token: string }
  | { type: "peer-pair-failed"; fingerprint: string; token: string; message: string }
  | { type: "peer-pair-timeout"; fingerprint: string; token: string }
  | { type: "peer-command-failed"; message: string };

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
      if (state.pairing.operationId !== action.operationId || state.pairing.phase !== "confirming") return state;
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
      if (
        state.pairing.operationId !== action.operationId
        || (state.pairing.phase !== "pairing" && state.pairing.phase !== "confirming")
      ) return state;
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
        bluetoothEnabledTarget: undefined,
        bluetoothEnabledToken: undefined,
        bluetoothSolicitToken: undefined,
        bluetoothMessage: state.bluetoothEnabledToken || state.bluetoothSolicitToken
          ? "Bluetooth operation stopped while Tether reconnects."
          : state.bluetoothMessage,
        wifi: {
          ...state.wifi,
          discovering: false,
          discoveryToken: undefined,
          pairingFingerprint: undefined,
          pairingToken: undefined,
          message: state.wifi.discovering || state.wifi.pairingFingerprint
            ? "Wi-Fi operation stopped while Tether reconnects."
            : state.wifi.message,
        },
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
    case "bluetooth-enabled-started":
      return {
        ...state,
        bluetoothEnabledTarget: action.enabled,
        bluetoothEnabledToken: action.token,
        bluetoothMessage: "Updating Bluetooth preference…",
      };
    case "bluetooth-enabled-failed":
      if (state.bluetoothEnabledToken !== action.token) return state;
      return {
        ...state,
        bluetoothEnabledTarget: undefined,
        bluetoothEnabledToken: undefined,
        bluetoothMessage: action.message,
      };
    case "bluetooth-enabled-timeout":
      if (state.bluetoothEnabledToken !== action.token) return state;
      return {
        ...state,
        bluetoothEnabledTarget: undefined,
        bluetoothEnabledToken: undefined,
        bluetoothMessage: "No updated Bluetooth status arrived from tetherd. Check the connection before trying again.",
      };
    case "bluetooth-solicit-started":
      return { ...state, bluetoothSolicitToken: action.token, bluetoothMessage: "Asking the iPhone to show its permissions…" };
    case "bluetooth-solicit-failed":
      if (state.bluetoothSolicitToken !== action.token) return state;
      return { ...state, bluetoothSolicitToken: undefined, bluetoothMessage: action.message };
    case "bluetooth-solicit-timeout":
      if (state.bluetoothSolicitToken !== action.token) return state;
      return {
        ...state,
        bluetoothSolicitToken: undefined,
        bluetoothMessage: "No permission result arrived from tetherd. Check the iPhone, then try again.",
      };
    case "peer-discovery-started":
      return {
        ...state,
        wifi: { ...state.wifi, discovering: true, discoveryToken: action.token, message: "Looking for nearby devices…" },
      };
    case "peer-discovery-failed":
      if (state.wifi.discoveryToken !== action.token) return state;
      return {
        ...state,
        wifi: { ...state.wifi, discovering: false, discoveryToken: undefined, message: action.message },
      };
    case "peer-discovery-timeout":
      if (state.wifi.discoveryToken !== action.token) return state;
      return {
        ...state,
        wifi: {
          ...state.wifi,
          discovering: false,
          discoveryToken: undefined,
          message: "No discovery result arrived from tetherd. Try scanning again.",
        },
      };
    case "peer-pair-started":
      return {
        ...state,
        wifi: {
          ...state.wifi,
          pairingFingerprint: action.fingerprint,
          pairingToken: action.token,
          message: "Sending pair request…",
        },
      };
    case "peer-pair-failed":
      if (state.wifi.pairingFingerprint !== action.fingerprint || state.wifi.pairingToken !== action.token) return state;
      return {
        ...state,
        wifi: { ...state.wifi, pairingFingerprint: undefined, pairingToken: undefined, message: action.message },
      };
    case "peer-pair-timeout":
      if (state.wifi.pairingFingerprint !== action.fingerprint || state.wifi.pairingToken !== action.token) return state;
      return {
        ...state,
        wifi: {
          ...state.wifi,
          pairingFingerprint: undefined,
          pairingToken: undefined,
          message: "No pairing result arrived from tetherd. Check the other device, then try again.",
        },
      };
    case "peer-command-failed":
      return { ...state, wifi: { ...state.wifi, message: action.message } };
  }
}

export function reduceDevicesEvent(state: DevicesState, event: DaemonEvent): DevicesState {
  switch (event.command) {
    case "state_snapshot":
      return { ...state, wifi: wifiFromSnapshot(event) };
    case "mdns_status":
      return { ...state, wifi: { ...state.wifi, mdnsAvailable: event.available } };
    case "discovery_result":
      return {
        ...state,
        wifi: {
          ...state.wifi,
          peers: mergeDiscoveredPeers(state.wifi.peers, event.devices),
          discovering: false,
          discoveryToken: undefined,
          message: event.devices.length === 0 ? "No nearby Wi-Fi devices found." : `Found ${event.devices.length} nearby device${event.devices.length === 1 ? "" : "s"}.`,
        },
      };
    case "client_connected":
      return { ...state, wifi: { ...state.wifi, peers: updatePeerConnection(state.wifi.peers, event, true) } };
    case "client_disconnected":
      return { ...state, wifi: { ...state.wifi, peers: updatePeerConnection(state.wifi.peers, event, false) } };
    case "pair_request_received":
      return { ...state, wifi: { ...state.wifi, peers: upsertPendingPeer(state.wifi.peers, event) } };
    case "untrusted_client_connected":
      return { ...state, wifi: { ...state.wifi, peers: upsertPendingPeer(state.wifi.peers, event, true) } };
    case "pair_outbound_pending":
      if (!state.wifi.pairingFingerprint || event.fingerprint !== state.wifi.pairingFingerprint) return state;
      return { ...state, wifi: { ...state.wifi, message: `Waiting for approval on ${event.device_name || "the other device"}…` } };
    case "pair_rejected":
      if (!belongsToActivePeerPair(state.wifi, event)) return state;
      return {
        ...state,
        wifi: {
          ...state.wifi,
          pairingFingerprint: undefined,
          pairingToken: undefined,
          message: peerRejectionMessage(event.reason),
        },
      };
    case "pair_accepted":
      return {
        ...state,
        wifi: {
          ...state.wifi,
          peers: acceptPeer(state.wifi.peers, event.fingerprint, event.connected),
          pairingFingerprint: state.wifi.pairingFingerprint === event.fingerprint
            ? undefined
            : state.wifi.pairingFingerprint,
          pairingToken: state.wifi.pairingFingerprint === event.fingerprint
            ? undefined
            : state.wifi.pairingToken,
          message: "Device paired.",
        },
      };
    case "forget_device_result":
      return {
        ...state,
        wifi: {
          ...state.wifi,
          peers: event.forgotten ? forgetPeer(state.wifi.peers, event.fingerprint) : state.wifi.peers,
          message: event.forgotten ? "Device forgotten." : "Could not forget the device.",
        },
      };
    case "bt_status": {
      const completed = state.bluetoothEnabledToken && event.enabled === state.bluetoothEnabledTarget;
      return {
        ...state,
        bluetooth: event as BluetoothStatusEvent,
        bluetoothEnabledTarget: completed ? undefined : state.bluetoothEnabledTarget,
        bluetoothEnabledToken: completed ? undefined : state.bluetoothEnabledToken,
        bluetoothMessage: completed ? "Bluetooth connection preference updated." : state.bluetoothMessage,
      };
    }
    case "bt_devices": {
      const configuredAddress = state.bluetooth?.device_address?.toUpperCase();
      const visible = event.devices.filter((device) =>
        device.iphone || device.apple_nearby || device.airpods ||
        (configuredAddress !== undefined && device.address.toUpperCase() === configuredAddress));
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
    case "bt_solicit_result":
      if (!state.bluetoothSolicitToken) return state;
      return { ...state, bluetoothSolicitToken: undefined, bluetoothMessage: event.message };
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
  const active = pairing.phase === "pairing" || pairing.phase === "confirming";
  return Boolean(active && operationId && pairing.operationId && operationId === pairing.operationId);
}

function wifiFromSnapshot(event: StateSnapshotEvent): WifiState {
  const peers = new Map<string, WifiPeer>();
  for (const peer of event.paired_devices || []) {
    peers.set(peer.fingerprint, {
      fingerprint: peer.fingerprint,
      name: peer.device_name || "Unknown Device",
      port: 5134,
      paired: true,
      connected: false,
      pending: false,
    });
  }
  for (const peer of event.discovered_devices || []) mergeDiscoveredPeer(peers, peer);
  for (const client of event.connected_clients || []) {
    const existing = peers.get(client.fingerprint);
    peers.set(client.fingerprint, {
      fingerprint: client.fingerprint,
      name: client.device_name || existing?.name || "Unknown Device",
      address: client.address || existing?.address,
      port: existing?.port || 5134,
      paired: client.paired,
      connected: true,
      pending: !client.paired,
    });
  }
  for (const pending of event.pending_pairs || []) {
    const existing = peers.get(pending.fingerprint);
    peers.set(pending.fingerprint, {
      fingerprint: pending.fingerprint,
      name: pending.device_name || existing?.name || "Unknown Device",
      address: existing?.address,
      port: existing?.port || 5134,
      paired: existing?.paired || false,
      connected: existing?.connected || false,
      pending: true,
    });
  }
  return {
    peers: sortPeers([...peers.values()]),
    mdnsAvailable: event.mdns_available ?? true,
    clipboardAvailable: event.clipboard_available ?? true,
    firewallActive: event.firewall_active ?? false,
    discovering: false,
  };
}

function mergeDiscoveredPeer(peers: Map<string, WifiPeer>, discovered: DiscoveredPeer) {
  const existing = peers.get(discovered.fingerprint);
  const firstAddress = discovered.addresses?.[0];
  peers.set(discovered.fingerprint, {
    fingerprint: discovered.fingerprint,
    name: discovered.name || existing?.name || "Unknown Device",
    address: firstAddress?.address || existing?.address,
    port: firstAddress?.port || existing?.port || 5134,
    paired: existing?.paired || false,
    connected: existing?.connected || false,
    pending: existing?.pending || false,
  });
}

function mergeDiscoveredPeers(current: WifiPeer[], discovered: DiscoveredPeer[]): WifiPeer[] {
  const durable = current.filter((peer) => peer.paired || peer.connected || peer.pending);
  const peers = new Map(durable.map((peer) => [peer.fingerprint, peer]));
  for (const peer of discovered) mergeDiscoveredPeer(peers, peer);
  return sortPeers([...peers.values()]);
}

function updatePeerConnection(
  peers: WifiPeer[],
  event: { fingerprint?: string; device_name?: string; address?: string; paired?: boolean },
  connected: boolean,
): WifiPeer[] {
  if (!event.fingerprint) return peers;
  const existing = peers.find((peer) => peer.fingerprint === event.fingerprint);
  const updated: WifiPeer = {
    fingerprint: event.fingerprint,
    name: event.device_name || existing?.name || "Unknown Device",
    address: event.address || existing?.address,
    port: existing?.port || 5134,
    paired: event.paired ?? existing?.paired ?? false,
    connected,
    pending: connected && !(event.paired ?? existing?.paired ?? false),
  };
  return sortPeers([...peers.filter((peer) => peer.fingerprint !== event.fingerprint), updated]);
}

function upsertPendingPeer(
  peers: WifiPeer[],
  event: { fingerprint?: string; device_name?: string; address?: string },
  connected = false,
): WifiPeer[] {
  if (!event.fingerprint) return peers;
  const existing = peers.find((peer) => peer.fingerprint === event.fingerprint);
  const updated: WifiPeer = {
    fingerprint: event.fingerprint,
    name: event.device_name || existing?.name || "Unknown Device",
    address: event.address || existing?.address,
    port: existing?.port || 5134,
    paired: false,
    connected: connected || existing?.connected || false,
    pending: true,
  };
  return sortPeers([...peers.filter((peer) => peer.fingerprint !== event.fingerprint), updated]);
}

function acceptPeer(peers: WifiPeer[], fingerprint?: string, connected = false): WifiPeer[] {
  return sortPeers(peers.map((peer) => peer.fingerprint === fingerprint
    ? { ...peer, paired: true, pending: false, connected: connected || peer.connected }
    : peer));
}

function forgetPeer(peers: WifiPeer[], fingerprint?: string): WifiPeer[] {
  return peers.filter((peer) => peer.fingerprint !== fingerprint);
}

function sortPeers(peers: WifiPeer[]): WifiPeer[] {
  return [...peers].sort((left, right) =>
    Number(right.connected) - Number(left.connected) ||
    Number(right.paired) - Number(left.paired) ||
    left.name.localeCompare(right.name));
}

function belongsToActivePeerPair(
  wifi: WifiState,
  event: { fingerprint: string; address?: string },
): boolean {
  if (!wifi.pairingFingerprint) return false;
  if (event.fingerprint) return event.fingerprint === wifi.pairingFingerprint;
  const activePeer = wifi.peers.find((peer) => peer.fingerprint === wifi.pairingFingerprint);
  return Boolean(event.address && activePeer?.address === event.address);
}

function peerRejectionMessage(reason?: string): string {
  switch (reason) {
    case "unreachable": return "Could not reach that device. Check that TCP 5134 is allowed through its firewall.";
    case "refused": return "That device refused the connection. Is Tether running on it?";
    case "unresolved": return "That device address could not be resolved.";
    case "failed": return "Could not connect to that device.";
    default: return "Pair request was rejected.";
  }
}

function isAirPodsEvent(event: DaemonEvent): event is AirPodsEvent {
  if (event.command !== "bt_airpods" || typeof event.address !== "string" || typeof event.name !== "string") return false;
  if (typeof event.left !== "number" || typeof event.right !== "number" || typeof event.case !== "number") return false;
  if (!event.ear || typeof event.ear !== "object") return false;
  const ear = event.ear as Record<string, unknown>;
  return typeof ear.primary === "string" && typeof ear.secondary === "string" && typeof event.in_ear === "number";
}
