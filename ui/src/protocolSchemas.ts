import { z } from "zod";

const operationId = z.string().min(1).optional();

const open = <Fields extends Record<string, z.ZodTypeAny>>(fields: Fields) => z.object(fields).passthrough();

const optionalString = z.string().optional();

const optionalBoolean = z.boolean().optional();

export const airPodsPauseSchema = z.enum(["never", "one-removed", "both-removed"]);

const tcpPort = z.number().int().min(1).max(65_535);

export const bluetoothSetupStepSchema = open({
  what: z.string(),
  command: z.string(),
});

export const bluetoothCapabilitySchema = open({
  mode: z.enum(["full", "compatibility"]),
  reasons: z.array(z.string()),
  setup: z.array(bluetoothSetupStepSchema),
});

export const protocolInfoEventSchema = open({
  command: z.literal("protocol_info"),
  operation_id: operationId,
  version: z.number().int().min(1),
  capabilities: z.array(z.string()),
});

export const bluetoothStatusEventSchema = open({
  command: z.literal("bt_status"),
  operation_id: operationId,
  available: z.boolean(),
  enabled: optionalBoolean,
  ancs_enabled: optionalBoolean,
  capability: bluetoothCapabilitySchema.nullable().optional(),
  error: optionalString,
  version: optionalString,
  version_supported: optionalBoolean,
  experimental: optionalBoolean,
  experimental_supported: optionalBoolean,
  secure_connections: optionalBoolean,
  secure_connections_supported: optionalBoolean,
  device_address: optionalString,
  airpods_enabled: optionalBoolean,
  airpods_pause: airPodsPauseSchema.optional(),
  airpods_handoff: optionalBoolean,
  apple_device_id: optionalBoolean,
  calls_enabled: optionalBoolean,
});

export const bluetoothDeviceSchema = open({
  address: z.string().min(1),
  name: optionalString,
  alias: optionalString,
  iphone: optionalBoolean,
  apple_nearby: optionalBoolean,
  paired: optionalBoolean,
  bonded: optionalBoolean,
  trusted: optionalBoolean,
  connected: optionalBoolean,
  classic_connected: optionalBoolean,
  le_bearer: optionalBoolean,
  le_bonded: optionalBoolean,
  le_connected: optionalBoolean,
  map: optionalBoolean,
  pbap: optionalBoolean,
  ancs: optionalBoolean,
  ancs_notifying: optionalBoolean,
  airpods: optionalBoolean,
});

export const bluetoothDevicesEventSchema = open({
  command: z.literal("bt_devices"),
  operation_id: operationId,
  devices: z.array(bluetoothDeviceSchema),
});

export const bluetoothConnectionEventSchema = open({
  command: z.literal("bt_connection_changed"),
  operation_id: operationId,
  device_present: optionalBoolean,
  device_paired: optionalBoolean,
  classic_connected: optionalBoolean,
  le_available: optionalBoolean,
  le_connected: optionalBoolean,
  map_open: optionalBoolean,
  pbap_open: optionalBoolean,
  map_error: optionalString,
  pbap_error: optionalString,
  ancs_ready: optionalBoolean,
  link_reason: optionalString,
  profile_reason: optionalString,
  ancs_reason: optionalString,
  last_error: optionalString,
  remedy: optionalString,
});

const bluetoothScanResultEventSchema = open({
  command: z.literal("bt_scan_result"),
  operation_id: operationId,
  success: z.boolean(),
  message: z.string(),
});

const bluetoothPairResultEventSchema = open({
  command: z.literal("bt_pair_result"),
  operation_id: operationId,
  success: z.boolean(),
  status: z.string(),
  message: z.string(),
  dual_bond: optionalBoolean,
});

const bluetoothUnpairResultEventSchema = open({
  command: z.literal("bt_unpair_result"),
  operation_id: operationId,
  success: z.boolean(),
  status: optionalString,
  message: z.string(),
});

const bluetoothSolicitResultEventSchema = open({
  command: z.literal("bt_solicit_result"),
  operation_id: operationId,
  success: z.boolean(),
  message: z.string(),
});

const bluetoothPairingProgressEventSchema = open({
  command: z.literal("bt_pair_progress"),
  operation_id: operationId,
  step: z.string(),
  detail: z.string(),
});

const bluetoothPairingConfirmationEventSchema = open({
  command: z.literal("bt_pair_confirm_request"),
  operation_id: operationId,
  code: z.string().regex(/^\d{6}$/),
});

const peerIdentity = {
  fingerprint: z.string().min(1),
  device_name: z.string().min(1),
};

const peerAddress = open({
  address: z.string().min(1),
  port: tcpPort,
});

const discoveredPeerSchema = open({
  name: z.string(),
  fingerprint: z.string().min(1),
  addresses: z.array(peerAddress),
});

const knownPeerSchema = open(peerIdentity);

const connectedPeerSchema = open({
  ...peerIdentity,
  address: z.string(),
  paired: z.boolean(),
});

const stateSnapshotEventSchema = open({
  command: z.literal("state_snapshot"),
  operation_id: operationId,
  paired_devices: z.array(knownPeerSchema),
  pending_pairs: z.array(knownPeerSchema),
  connected_clients: z.array(connectedPeerSchema),
  discovered_devices: z.array(discoveredPeerSchema),
  mdns_available: z.boolean(),
  clipboard_available: z.boolean(),
  firewall_active: z.boolean(),
});

const discoveryResultEventSchema = open({
  command: z.literal("discovery_result"),
  operation_id: operationId,
  devices: z.array(discoveredPeerSchema),
});

const mdnsStatusEventSchema = open({
  command: z.literal("mdns_status"),
  operation_id: operationId,
  available: z.boolean(),
});

const peerConnectionEventSchema = open({
  ...peerIdentity,
  command: z.enum(["client_connected", "client_disconnected"]),
  operation_id: operationId,
  address: z.string().min(1),
  paired: z.boolean(),
});

const peerRequestEventSchema = open({
  ...peerIdentity,
  command: z.enum(["pair_request_received", "untrusted_client_connected"]),
  operation_id: operationId,
  address: z.string().min(1),
});

const peerOutboundPendingEventSchema = open({
  ...peerIdentity,
  command: z.literal("pair_outbound_pending"),
  operation_id: operationId,
  address: z.string().min(1),
});

const peerRejectedEventSchema = open({
  command: z.literal("pair_rejected"),
  operation_id: operationId,
  fingerprint: z.string(),
  device_name: z.string().min(1),
  address: optionalString,
  reason: z.string().optional(),
}).refine((event) => event.fingerprint.length > 0 || Boolean(event.address?.trim()));

const peerAcceptedEventSchema = open({
  command: z.literal("pair_accepted"),
  operation_id: operationId,
  fingerprint: z.string().min(1),
  device_name: optionalString,
  address: optionalString,
  connected: z.boolean(),
});

const forgetPeerResultEventSchema = open({
  command: z.literal("forget_device_result"),
  operation_id: operationId,
  fingerprint: z.string().min(1),
  forgotten: z.boolean(),
});

const fileSendCompleteEventSchema = open({
  command: z.literal("file_send_complete"),
  operation_id: z.string().min(1),
  filename: optionalString,
  success: z.boolean(),
  message: optionalString,
});

export const airPodsEventSchema = open({
  command: z.literal("bt_airpods"),
  operation_id: operationId,
  address: z.string().min(1),
  name: z.string(),
  left: z.number(),
  right: z.number(),
  case: z.number(),
  ear: open({
    primary: z.enum(["unknown", "in_ear", "out_of_ear", "in_case"]),
    secondary: z.enum(["unknown", "in_ear", "out_of_ear", "in_case"]),
  }),
  in_ear: z.number(),
  peer_taking_over: z.boolean(),
  peer_active: z.boolean(),
  peer_audio: z.boolean(),
  peer_call: z.boolean(),
  peer_holds_audio: z.boolean(),
  anc: z.enum(["off", "transparency", "adaptive", "anc"]).optional(),
  status: z.enum(["idle", "connecting", "live", "busy", "failed"]),
  reason: z.string(),
});

const airPodsConnectResultEventSchema = open({
  command: z.literal("bt_airpods_connect_result"),
  operation_id: operationId,
  success: z.boolean(),
  message: optionalString,
});

const airPodsModeResultEventSchema = open({
  command: z.literal("bt_airpods_mode_result"),
  operation_id: operationId,
  success: z.boolean(),
  message: optionalString,
});

const gatewayStatusEventSchema = open({
  command: z.literal("gateway_status"),
  operation_id: operationId,
  daemon_connected: z.boolean(),
  error: optionalString,
});

export const daemonEventSchema = z.discriminatedUnion("command", [
  protocolInfoEventSchema,
  bluetoothStatusEventSchema,
  bluetoothDevicesEventSchema,
  bluetoothConnectionEventSchema,
  bluetoothScanResultEventSchema,
  bluetoothPairResultEventSchema,
  bluetoothUnpairResultEventSchema,
  bluetoothSolicitResultEventSchema,
  bluetoothPairingProgressEventSchema,
  bluetoothPairingConfirmationEventSchema,
  stateSnapshotEventSchema,
  discoveryResultEventSchema,
  mdnsStatusEventSchema,
  peerConnectionEventSchema,
  peerRequestEventSchema,
  peerOutboundPendingEventSchema,
  peerRejectedEventSchema,
  peerAcceptedEventSchema,
  forgetPeerResultEventSchema,
  fileSendCompleteEventSchema,
  airPodsEventSchema,
  airPodsConnectResultEventSchema,
  airPodsModeResultEventSchema,
  gatewayStatusEventSchema,
]);

export const daemonCommandSchema = z.discriminatedUnion("command", [
  open({ command: z.literal("bt_scan") }),
  open({ command: z.literal("bt_status") }),
  open({ command: z.literal("bt_list_devices") }),
  open({ command: z.literal("bt_pair"), address: z.string().min(1), operation_id: z.string().min(1) }),
  open({ command: z.literal("bt_unpair"), address: z.string().min(1), operation_id: z.string().min(1) }),
  open({ command: z.literal("bt_pair_confirm"), operation_id: z.string().min(1), accept: z.boolean() }),
  open({ command: z.literal("bt_set_enabled"), enabled: z.boolean() }),
  open({ command: z.literal("bt_solicit") }),
  open({ command: z.literal("bt_airpods_enable"), enabled: z.boolean() }),
  open({ command: z.literal("bt_airpods_pause"), mode: airPodsPauseSchema }),
  open({ command: z.literal("bt_airpods_handoff"), enabled: z.boolean() }),
  open({ command: z.literal("bt_airpods_mode"), mode: z.enum(["off", "transparency", "adaptive", "anc"]) }),
  open({ command: z.literal("bt_airpods_connect"), address: z.string().min(1), connect: z.boolean() }),
  open({ command: z.literal("discover") }),
  open({ command: z.literal("pair_request"), host: z.string().min(1), port: tcpPort, device_name: z.string().min(1) }),
  open({ command: z.literal("accept_device"), fingerprint: z.string().min(1), device_name: z.string().min(1) }),
  open({ command: z.literal("forget_device"), fingerprint: z.string().min(1) }),
  open({ command: z.literal("file_upload_start"), operation_id: z.string().min(1), filename: z.string().min(1), size: z.number().finite().nonnegative() }),
  open({ command: z.literal("file_upload_chunk"), operation_id: z.string().min(1), chunk_index: z.number().int().nonnegative(), data: z.string().min(1) }),
  open({ command: z.literal("file_upload_finish"), operation_id: z.string().min(1) }),
  open({ command: z.literal("file_upload_cancel"), operation_id: z.string().min(1) }),
]);

export const commandBodySchema = daemonCommandSchema;

export const daemonEventJsonSchema = daemonEventSchema;

export type ParsedDaemonEvent = z.infer<typeof daemonEventSchema>;

export type ParsedDaemonCommand = z.infer<typeof daemonCommandSchema>;
