import { useEffect } from "react";
import type { DaemonCommand, DaemonEvent } from "../protocol";

const commandTimeoutMs = 10_000;

export class DaemonCommandTimeoutError extends Error {
  constructor() {
    super("tetherd command timed out");
    this.name = "DaemonCommandTimeoutError";
  }
}

export type DaemonClientHandlers = {
  onConnectionChange: (connected: boolean) => void;
  onEvent: (event: DaemonEvent) => void;
};

export function useDaemonClient({ onConnectionChange, onEvent }: DaemonClientHandlers) {
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    events.onerror = () => onConnectionChange(false);
    events.onmessage = (message) => {
      const event = parseDaemonEvent(message.data);
      if (event) onEvent(event);
    };

    return () => events.close();
  }, [onConnectionChange, onEvent]);
}

export function parseDaemonEvent(data: string): DaemonEvent | undefined {
  try {
    const value: unknown = JSON.parse(data);
    if (!isRecord(value) || typeof value.command !== "string" || !isOptionalOperationId(value.operation_id)) return undefined;
    switch (value.command) {
      case "protocol_info":
        if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1 ||
            !Array.isArray(value.capabilities) ||
            !value.capabilities.every((capability) => typeof capability === "string")) return undefined;
        break;
      case "bt_status":
        if (typeof value.available !== "boolean" ||
            !isOptionalBoolean(value.enabled) || !isOptionalBoolean(value.ancs_enabled) ||
            !isOptionalString(value.device_address) || !isBluetoothCapability(value.capability)) return undefined;
        break;
      case "bt_connection_changed":
        if (!isOptionalBoolean(value.classic_connected) || !isOptionalBoolean(value.le_connected) ||
            !isOptionalBoolean(value.map_open) || !isOptionalBoolean(value.pbap_open) ||
            !isOptionalBoolean(value.ancs_ready) || !isOptionalString(value.map_error) ||
            !isOptionalString(value.pbap_error) || !isOptionalString(value.link_reason) ||
            !isOptionalString(value.profile_reason) || !isOptionalString(value.ancs_reason)) return undefined;
        break;
      case "bt_devices":
        if (!isBluetoothDeviceArray(value.devices)) return undefined;
        break;
      case "bt_scan_result":
        if (typeof value.success !== "boolean" || typeof value.message !== "string") return undefined;
        break;
      case "bt_pair_progress":
        if (typeof value.step !== "string" || typeof value.detail !== "string") return undefined;
        break;
      case "bt_pair_confirm_request":
        if (typeof value.code !== "string" || !/^\d{6}$/.test(value.code)) return undefined;
        break;
      case "bt_pair_result":
        if (typeof value.success !== "boolean" || typeof value.status !== "string" ||
            typeof value.message !== "string" || !isOptionalBoolean(value.dual_bond)) return undefined;
        break;
      case "bt_unpair_result":
        if (typeof value.success !== "boolean" || typeof value.message !== "string" ||
            !isOptionalString(value.status)) return undefined;
        break;
      case "bt_solicit_result":
        if (typeof value.success !== "boolean" || typeof value.message !== "string") return undefined;
        break;
      case "state_snapshot":
        if (!isKnownPeerArray(value.paired_devices) || !isKnownPeerArray(value.pending_pairs) ||
            !isConnectedPeerArray(value.connected_clients) || !isDiscoveredPeerArray(value.discovered_devices) ||
            typeof value.mdns_available !== "boolean" || typeof value.clipboard_available !== "boolean" ||
            typeof value.firewall_active !== "boolean") return undefined;
        break;
      case "discovery_result":
        if (!isDiscoveredPeerArray(value.devices)) return undefined;
        break;
      case "mdns_status":
        if (typeof value.available !== "boolean") return undefined;
        break;
      case "client_connected":
      case "client_disconnected":
        if (!hasPeerIdentity(value) || !isNonEmptyString(value.address) || typeof value.paired !== "boolean") return undefined;
        break;
      case "pair_request_received":
      case "untrusted_client_connected":
      case "pair_outbound_pending":
        if (!hasPeerIdentity(value) || !isNonEmptyString(value.address)) return undefined;
        break;
      case "pair_rejected":
        if (typeof value.fingerprint !== "string" || !isNonEmptyString(value.device_name) ||
            (value.fingerprint.length === 0 && !isNonEmptyString(value.address))) return undefined;
        break;
      case "pair_accepted":
        if (!isNonEmptyString(value.fingerprint) || typeof value.connected !== "boolean") return undefined;
        break;
      case "forget_device_result":
        if (!isNonEmptyString(value.fingerprint) || typeof value.forgotten !== "boolean") return undefined;
        break;
      case "file_upload_started":
      case "file_send_complete":
        if (!isNonEmptyString(value.operation_id) || typeof value.success !== "boolean" ||
            (value.message !== undefined && typeof value.message !== "string") ||
            (value.filename !== undefined && typeof value.filename !== "string")) return undefined;
        break;
    }
    return value as DaemonEvent;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalOperationId(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isBluetoothCapability(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value) || !["full", "compatibility"].includes(String(value.mode)) ||
      !Array.isArray(value.reasons) || !value.reasons.every((reason) => typeof reason === "string") ||
      !Array.isArray(value.setup)) return false;
  return value.setup.every((step) =>
    isRecord(step) && typeof step.what === "string" && typeof step.command === "string");
}

function isBluetoothDeviceArray(value: unknown): boolean {
  const booleanFields = [
    "iphone", "apple_nearby", "paired", "bonded", "trusted", "connected",
    "classic_connected", "le_bearer", "le_bonded", "le_connected", "map",
    "pbap", "ancs", "ancs_notifying", "airpods",
  ];
  return Array.isArray(value) && value.every((device) =>
    isRecord(device) && isNonEmptyString(device.address) &&
    isOptionalString(device.name) && isOptionalString(device.alias) &&
    booleanFields.every((field) => isOptionalBoolean(device[field])));
}

function isKnownPeerArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((peer) => isRecord(peer) && hasPeerIdentity(peer));
}

function isConnectedPeerArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((peer) =>
    isRecord(peer) && hasPeerIdentity(peer) && typeof peer.address === "string" && typeof peer.paired === "boolean");
}

function isDiscoveredPeerArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((peer) =>
    isRecord(peer) && typeof peer.name === "string" && isNonEmptyString(peer.fingerprint) &&
    Array.isArray(peer.addresses) && peer.addresses.every((address) =>
      isRecord(address) && isNonEmptyString(address.address) && isTcpPort(address.port)));
}

function hasPeerIdentity(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.fingerprint) && isNonEmptyString(value.device_name);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTcpPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535;
}

export async function sendDaemonCommand(command: DaemonCommand) {
  const signal = AbortSignal.timeout(commandTimeoutMs);
  let response: Response;
  try {
    response = await fetch("/api/v1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new DaemonCommandTimeoutError();
    throw error;
  }
  if (!response.ok) throw new Error(`command failed: ${response.status}`);
}
