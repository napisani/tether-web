export type JsonRecord = Record<string, unknown>;

interface DaemonEventBase extends JsonRecord {
  operation_id?: string;
}

export interface ProtocolInfoEvent extends DaemonEventBase {
  command: "protocol_info";
  version: number;
  capabilities: string[];
}

export interface BluetoothStatusEvent extends DaemonEventBase {
  command: "bt_status";
  available: boolean;
  enabled?: boolean;
  error?: string;
  version?: string;
  version_supported?: boolean;
  experimental?: boolean;
  experimental_supported?: boolean;
  secure_connections?: boolean;
  secure_connections_supported?: boolean;
  device_address?: string;
  airpods_enabled?: boolean;
  airpods_pause?: "never" | "one-removed" | "both-removed";
  airpods_handoff?: boolean;
  apple_device_id?: boolean;
  calls_enabled?: boolean;
}

export interface BluetoothDevice extends JsonRecord {
  address: string;
  name?: string;
  alias?: string;
  iphone?: boolean;
  apple_nearby?: boolean;
  paired?: boolean;
  bonded?: boolean;
  trusted?: boolean;
  connected?: boolean;
  classic_connected?: boolean;
  le_bearer?: boolean;
  le_bonded?: boolean;
  le_connected?: boolean;
  map?: boolean;
  pbap?: boolean;
  ancs?: boolean;
  ancs_notifying?: boolean;
  airpods?: boolean;
}

export interface BluetoothDevicesEvent extends DaemonEventBase {
  command: "bt_devices";
  devices: BluetoothDevice[];
}

export interface BluetoothConnectionEvent extends DaemonEventBase {
  command: "bt_connection_changed";
  device_present?: boolean;
  device_paired?: boolean;
  classic_connected?: boolean;
  le_available?: boolean;
  le_connected?: boolean;
  map_open?: boolean;
  pbap_open?: boolean;
  ancs_ready?: boolean;
  link_reason?: string;
  profile_reason?: string;
  ancs_reason?: string;
  last_error?: string;
  remedy?: string;
}

export interface BluetoothScanResultEvent extends DaemonEventBase {
  command: "bt_scan_result";
  success: boolean;
  message: string;
}

export interface BluetoothPairResultEvent extends DaemonEventBase {
  command: "bt_pair_result";
  success: boolean;
  status: string;
  message: string;
  dual_bond?: boolean;
}

export interface BluetoothUnpairResultEvent extends DaemonEventBase {
  command: "bt_unpair_result";
  success: boolean;
  status?: string;
  message: string;
}

export type BluetoothResultEvent =
  | BluetoothScanResultEvent
  | BluetoothPairResultEvent
  | BluetoothUnpairResultEvent;

export interface BluetoothPairingProgressEvent extends DaemonEventBase {
  command: "bt_pair_progress";
  step: string;
  detail: string;
}

export interface BluetoothPairingConfirmationEvent extends DaemonEventBase {
  command: "bt_pair_confirm_request";
  code: string;
}

export interface AirPodsEvent extends DaemonEventBase {
  command: "bt_airpods";
  address: string;
  name: string;
  left: number;
  right: number;
  case: number;
  ear: {
    primary: "unknown" | "in_ear" | "out_of_ear" | "in_case";
    secondary: "unknown" | "in_ear" | "out_of_ear" | "in_case";
  };
  in_ear: number;
  peer_taking_over: boolean;
  peer_active: boolean;
  peer_audio: boolean;
  peer_call: boolean;
  peer_holds_audio: boolean;
  anc?: "off" | "transparency" | "adaptive" | "anc";
  status: "idle" | "connecting" | "live" | "busy" | "failed";
  reason: string;
}

export interface AirPodsResultEvent extends DaemonEventBase {
  command: "bt_airpods_connect_result" | "bt_airpods_mode_result";
  success: boolean;
  message?: string;
}

export interface GatewayStatusEvent extends DaemonEventBase {
  command: "gateway_status";
  daemon_connected: boolean;
  error?: string;
}

export type DaemonEvent =
  | ProtocolInfoEvent
  | BluetoothStatusEvent
  | BluetoothDevicesEvent
  | BluetoothConnectionEvent
  | BluetoothResultEvent
  | BluetoothPairingProgressEvent
  | BluetoothPairingConfirmationEvent
  | AirPodsEvent
  | AirPodsResultEvent
  | GatewayStatusEvent;

export interface BluetoothScanCommand extends JsonRecord {
  command: "bt_scan";
}

export interface BluetoothPairCommand extends JsonRecord {
  command: "bt_pair";
  address: string;
  operation_id: string;
}

export interface BluetoothUnpairCommand extends JsonRecord {
  command: "bt_unpair";
  address: string;
  operation_id: string;
}

export interface BluetoothPairConfirmationCommand extends JsonRecord {
  command: "bt_pair_confirm";
  operation_id: string;
  accept: boolean;
}

// Enable, pause, and handoff settings complete when tetherd republishes bt_status;
// unlike connect and listening-mode changes, they do not have result events.
export interface AirPodsEnableCommand extends JsonRecord {
  command: "bt_airpods_enable";
  enabled: boolean;
}

export interface AirPodsPauseCommand extends JsonRecord {
  command: "bt_airpods_pause";
  mode: "never" | "one-removed" | "both-removed";
}

export interface AirPodsHandoffCommand extends JsonRecord {
  command: "bt_airpods_handoff";
  enabled: boolean;
}

export interface AirPodsModeCommand extends JsonRecord {
  command: "bt_airpods_mode";
  mode: "off" | "transparency" | "adaptive" | "anc";
}

export interface AirPodsConnectCommand extends JsonRecord {
  command: "bt_airpods_connect";
  address: string;
  connect: boolean;
}

export type DaemonCommand =
  | BluetoothScanCommand
  | BluetoothPairCommand
  | BluetoothUnpairCommand
  | BluetoothPairConfirmationCommand
  | AirPodsEnableCommand
  | AirPodsPauseCommand
  | AirPodsHandoffCommand
  | AirPodsModeCommand
  | AirPodsConnectCommand;

export interface GatewayState {
  daemon_connected: boolean;
  events: Record<string, DaemonEvent>;
}
