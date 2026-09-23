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
    if (!isRecord(value) || typeof value.command !== "string") return undefined;
    switch (value.command) {
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
    }
    return value as DaemonEvent;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
