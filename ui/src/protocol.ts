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

export type DaemonCommand =
  | BluetoothScanCommand
  | BluetoothPairCommand
  | BluetoothUnpairCommand
  | BluetoothPairConfirmationCommand;

export interface GatewayState {
  daemon_connected: boolean;
  events: Record<string, DaemonEvent>;
}
