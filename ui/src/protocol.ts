export type JsonRecord = Record<string, unknown>;

interface DaemonEventBase extends JsonRecord {
  operation_id?: string;
}

export interface ProtocolInfoEvent extends DaemonEventBase {
  command: "protocol_info";
  version: number;
  capabilities: string[];
}

export interface BluetoothSetupStep extends JsonRecord {
  what: string;
  command: string;
}

export interface BluetoothCapability extends JsonRecord {
  mode: "full" | "compatibility";
  reasons: string[];
  setup: BluetoothSetupStep[];
}

export interface BluetoothStatusEvent extends DaemonEventBase {
  command: "bt_status";
  available: boolean;
  enabled?: boolean;
  ancs_enabled?: boolean;
  ancs_content_enabled?: boolean;
  retention?: "encrypted" | "plaintext" | "none";
  retention_ready?: boolean;
  desktop_popups_enabled?: boolean;
  lock_on_away?: boolean;
  capability?: BluetoothCapability | null;
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
  map_error?: string;
  pbap_error?: string;
  ancs_ready?: boolean;
  link_reason?: string;
  profile_reason?: string;
  ancs_reason?: string;
  calls?: CallConnectionStatus | null;
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

export interface BluetoothSolicitResultEvent extends DaemonEventBase {
  command: "bt_solicit_result";
  success: boolean;
  message: string;
}

export type BluetoothResultEvent =
  | BluetoothScanResultEvent
  | BluetoothPairResultEvent
  | BluetoothUnpairResultEvent
  | BluetoothSolicitResultEvent;

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

export interface PeerAddress extends JsonRecord {
  address: string;
  port: number;
}

export interface DiscoveredPeer extends JsonRecord {
  name: string;
  fingerprint: string;
  addresses: PeerAddress[];
}

export interface StateSnapshotEvent extends DaemonEventBase {
  command: "state_snapshot";
  paired_devices: Array<{ fingerprint: string; device_name: string }>;
  pending_pairs: Array<{ fingerprint: string; device_name: string }>;
  connected_clients: Array<{
    fingerprint: string;
    device_name: string;
    address: string;
    paired: boolean;
  }>;
  discovered_devices: DiscoveredPeer[];
  mdns_available: boolean;
  clipboard_available: boolean;
  firewall_active: boolean;
}

export interface DiscoveryResultEvent extends DaemonEventBase {
  command: "discovery_result";
  devices: DiscoveredPeer[];
}

export interface MdnsStatusEvent extends DaemonEventBase {
  command: "mdns_status";
  available: boolean;
}

export interface PeerConnectionEvent extends DaemonEventBase {
  command: "client_connected" | "client_disconnected";
  fingerprint: string;
  device_name: string;
  address: string;
  paired: boolean;
}

export interface PeerRequestEvent extends DaemonEventBase {
  command: "pair_request_received" | "untrusted_client_connected";
  fingerprint: string;
  device_name: string;
  address: string;
}

export interface PeerOutboundPendingEvent extends DaemonEventBase {
  command: "pair_outbound_pending";
  fingerprint: string;
  device_name: string;
  address: string;
}

export interface PeerRejectedEvent extends DaemonEventBase {
  command: "pair_rejected";
  fingerprint: string;
  device_name: string;
  address?: string;
  reason?: "unreachable" | "refused" | "unresolved" | "failed" | string;
}

export interface PeerAcceptedEvent extends DaemonEventBase {
  command: "pair_accepted";
  fingerprint: string;
  device_name?: string;
  address?: string;
  connected: boolean;
}

export interface ForgetPeerResultEvent extends DaemonEventBase {
  command: "forget_device_result";
  fingerprint: string;
  forgotten: boolean;
}

export type PeerLifecycleEvent =
  | PeerConnectionEvent
  | PeerRequestEvent
  | PeerOutboundPendingEvent
  | PeerRejectedEvent
  | PeerAcceptedEvent
  | ForgetPeerResultEvent;

export interface FileSendCompleteEvent extends DaemonEventBase {
  command: "file_send_complete";
  operation_id: string;
  filename?: string;
  success: boolean;
  message?: string;
}

export interface MessageThread extends JsonRecord {
  thread: string;
  name?: string;
  address?: string;
  preview?: string;
  timestamp?: number;
  unread?: number;
  group?: boolean;
  repliable?: boolean;
  reply_reason?: string;
}

export interface ThreadListEvent extends DaemonEventBase {
  command: "bt_threads";
  threads: MessageThread[];
}

export interface TextMessage extends JsonRecord {
  handle: string;
  thread: string;
  body: string;
  timestamp: number;
  outgoing: boolean;
  read: boolean;
  folder?: string;
}

export interface MessageListEvent extends DaemonEventBase {
  command: "bt_messages";
  thread: string;
  messages: TextMessage[];
}

export interface NewMessageEvent extends DaemonEventBase, TextMessage {
  command: "bt_message";
}

export interface MessageSendResultEvent extends DaemonEventBase {
  command: "bt_send_result";
  thread: string;
  success: boolean;
  message?: string;
}

export interface MessageReadEvent extends DaemonEventBase {
  command: "bt_message_read";
  handles: string[];
  read: boolean;
  success: boolean;
  message?: string;
}

export interface ContactSuggestion extends JsonRecord {
  name: string;
  addresses: string[];
}

export interface ContactListEvent extends DaemonEventBase {
  command: "bt_contacts";
  query: string;
  contacts: ContactSuggestion[];
}

export interface PhoneNotification extends JsonRecord {
  uid: number;
  app_id?: string;
  app_name?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  category?: number;
  timestamp?: number;
  silent?: boolean;
  positive_action?: boolean;
  negative_action?: boolean;
}

export interface NotificationListEvent extends DaemonEventBase {
  command: "bt_notifications";
  notifications: PhoneNotification[];
}

export interface NewNotificationEvent extends DaemonEventBase, PhoneNotification {
  command: "bt_notification";
}

export interface NotificationRemovedEvent extends DaemonEventBase {
  command: "bt_notification_removed";
  uid: number;
}

export interface NotificationActionResultEvent extends DaemonEventBase {
  command: "bt_notification_action_result";
  uid: number;
  success: boolean;
}

export interface PhoneCall extends JsonRecord {
  path: string;
  number?: string;
  name?: string;
  state?: string;
  withheld?: boolean;
  ringing?: boolean;
  connected?: boolean;
  outgoing?: boolean;
  incoming_line?: string;
  multiparty?: boolean;
}

export interface CallConnectionStatus extends JsonRecord {
  available: boolean;
  reason?: string;
  audio?: string;
  indicators?: boolean;
  operator?: string;
  service?: boolean;
  signal?: number;
  roaming?: boolean;
  battery?: number;
}

export interface CallListEvent extends DaemonEventBase {
  command: "bt_calls";
  calls: PhoneCall[];
}

export interface CallResultEvent extends DaemonEventBase {
  command: "bt_call_result";
  action: string;
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
  | StateSnapshotEvent
  | DiscoveryResultEvent
  | MdnsStatusEvent
  | PeerLifecycleEvent
  | FileSendCompleteEvent
  | ThreadListEvent
  | MessageListEvent
  | NewMessageEvent
  | MessageSendResultEvent
  | MessageReadEvent
  | ContactListEvent
  | NotificationListEvent
  | NewNotificationEvent
  | NotificationRemovedEvent
  | NotificationActionResultEvent
  | CallListEvent
  | CallResultEvent
  | GatewayStatusEvent;

export interface BluetoothScanCommand extends JsonRecord {
  command: "bt_scan";
}

export interface BluetoothStatusCommand extends JsonRecord {
  command: "bt_status";
}

export interface BluetoothListDevicesCommand extends JsonRecord {
  command: "bt_list_devices";
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

export interface BluetoothSetEnabledCommand extends JsonRecord {
  command: "bt_set_enabled";
  enabled: boolean;
}

export interface BluetoothSolicitCommand extends JsonRecord {
  command: "bt_solicit";
}

// Enable, pause, and handoff settings complete when tetherd republishes bt_status;
// unlike connect and listening-mode changes, they do not have result events.
export interface DiscoverCommand extends JsonRecord {
  command: "discover";
}

export interface PairPeerCommand extends JsonRecord {
  command: "pair_request";
  host: string;
  port: number;
  device_name: string;
}

export interface AcceptPeerCommand extends JsonRecord {
  command: "accept_device";
  fingerprint: string;
  device_name: string;
}

export interface ForgetPeerCommand extends JsonRecord {
  command: "forget_device";
  fingerprint: string;
}

// Gateway transport commands: stage bytes on the shared runtime volume, then
// forward one daemon send_file with the same operation ID.
export interface FileUploadStartCommand extends JsonRecord {
  command: "file_upload_start";
  operation_id: string;
  filename: string;
  size: number;
}

export interface FileUploadChunkCommand extends JsonRecord {
  command: "file_upload_chunk";
  operation_id: string;
  chunk_index: number;
  data: string;
}

export interface FileUploadFinishCommand extends JsonRecord {
  command: "file_upload_finish";
  operation_id: string;
}

export interface FileUploadCancelCommand extends JsonRecord {
  command: "file_upload_cancel";
  operation_id: string;
}

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

export interface ListThreadsCommand extends JsonRecord {
  command: "bt_list_threads";
}

export interface ListMessagesCommand extends JsonRecord {
  command: "bt_list_messages";
  thread: string;
}

export interface ListContactsCommand extends JsonRecord {
  command: "bt_list_contacts";
  query: string;
  limit?: number;
}

export interface MarkMessagesReadCommand extends JsonRecord {
  command: "bt_mark_read";
  handles: string[];
  read: true;
}

export interface SendMessageCommand extends JsonRecord {
  command: "bt_send_message";
  thread: string;
  body: string;
  operation_id: string;
}

export interface ListNotificationsCommand extends JsonRecord {
  command: "bt_list_notifications";
}

export interface DismissNotificationCommand extends JsonRecord {
  command: "bt_notification_action";
  uid: number;
  action: "negative";
}

export interface ProtocolInfoCommand extends JsonRecord {
  command: "protocol_info";
}

export interface BluetoothSetAncsCommand extends JsonRecord {
  command: "bt_set_ancs" | "bt_set_ancs_content" | "bt_set_calls";
  enabled: boolean;
}

export interface BluetoothSetRetentionCommand extends JsonRecord {
  command: "bt_set_retention";
  retention: "encrypted" | "plaintext" | "none";
}

export interface ListCallsCommand extends JsonRecord {
  command: "bt_list_calls";
}

export interface DialCallCommand extends JsonRecord {
  command: "bt_call_dial";
  number: string;
}

export interface CallActionCommand extends JsonRecord {
  command: "bt_call_action";
  action: "answer" | "hangup" | "audio_here" | "audio_phone";
  path?: string;
}

export type DaemonCommand =
  | BluetoothScanCommand
  | BluetoothStatusCommand
  | BluetoothListDevicesCommand
  | BluetoothPairCommand
  | BluetoothUnpairCommand
  | BluetoothPairConfirmationCommand
  | BluetoothSetEnabledCommand
  | BluetoothSetAncsCommand
  | BluetoothSetRetentionCommand
  | BluetoothSolicitCommand
  | AirPodsEnableCommand
  | AirPodsPauseCommand
  | AirPodsHandoffCommand
  | AirPodsModeCommand
  | AirPodsConnectCommand
  | DiscoverCommand
  | PairPeerCommand
  | AcceptPeerCommand
  | ForgetPeerCommand
  | FileUploadStartCommand
  | FileUploadChunkCommand
  | FileUploadFinishCommand
  | FileUploadCancelCommand
  | ListThreadsCommand
  | ListMessagesCommand
  | ListContactsCommand
  | MarkMessagesReadCommand
  | SendMessageCommand
  | ListNotificationsCommand
  | DismissNotificationCommand
  | ProtocolInfoCommand
  | ListCallsCommand
  | DialCallCommand
  | CallActionCommand;

export interface GatewayState {
  daemon_connected: boolean;
  events: Record<string, DaemonEvent>;
}
