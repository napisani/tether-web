// Browser protocol types come from the same schemas used to validate daemon
// traffic. Keep named aliases for feature code, but do not mirror field lists.
import type { ParsedDaemonCommand, ParsedDaemonEvent } from "./protocolSchemas";

export type DaemonEvent = ParsedDaemonEvent;

export type DaemonCommand = ParsedDaemonCommand;

type EventFor<Command extends DaemonEvent["command"]> = Extract<DaemonEvent, { command: Command }>;

type CommandFor<Command extends DaemonCommand["command"]> = Extract<DaemonCommand, { command: Command }>;

export type ProtocolInfoEvent = EventFor<"protocol_info">;

export type BluetoothStatusEvent = EventFor<"bt_status">;

export type BluetoothCapability = NonNullable<BluetoothStatusEvent["capability"]>;

export type BluetoothSetupStep = BluetoothCapability["setup"][number];

export type BluetoothDevicesEvent = EventFor<"bt_devices">;

export type BluetoothDevice = BluetoothDevicesEvent["devices"][number];

export type BluetoothConnectionEvent = EventFor<"bt_connection_changed">;

export type CallConnectionStatus = NonNullable<BluetoothConnectionEvent["calls"]>;

export type BluetoothScanResultEvent = EventFor<"bt_scan_result">;

export type BluetoothPairResultEvent = EventFor<"bt_pair_result">;

export type BluetoothUnpairResultEvent = EventFor<"bt_unpair_result">;

export type BluetoothSolicitResultEvent = EventFor<"bt_solicit_result">;

export type BluetoothResultEvent = BluetoothScanResultEvent | BluetoothPairResultEvent | BluetoothUnpairResultEvent | BluetoothSolicitResultEvent;

export type BluetoothPairingProgressEvent = EventFor<"bt_pair_progress">;

export type BluetoothPairingConfirmationEvent = EventFor<"bt_pair_confirm_request">;

export type AirPodsEvent = EventFor<"bt_airpods">;

export type AirPodsResultEvent = EventFor<"bt_airpods_connect_result" | "bt_airpods_mode_result">;

export type StateSnapshotEvent = EventFor<"state_snapshot">;

export type DiscoveredPeer = StateSnapshotEvent["discovered_devices"][number];

export type PeerAddress = DiscoveredPeer["addresses"][number];

export type DiscoveryResultEvent = EventFor<"discovery_result">;

export type MdnsStatusEvent = EventFor<"mdns_status">;

export type PeerConnectionEvent = EventFor<"client_connected" | "client_disconnected">;

export type PeerRequestEvent = EventFor<"pair_request_received" | "untrusted_client_connected">;

export type PeerOutboundPendingEvent = EventFor<"pair_outbound_pending">;

export type PeerRejectedEvent = EventFor<"pair_rejected">;

export type PeerAcceptedEvent = EventFor<"pair_accepted">;

export type ForgetPeerResultEvent = EventFor<"forget_device_result">;

export type PeerLifecycleEvent = PeerConnectionEvent | PeerRequestEvent | PeerOutboundPendingEvent | PeerRejectedEvent | PeerAcceptedEvent | ForgetPeerResultEvent;

export type FileSendCompleteEvent = EventFor<"file_send_complete">;

export type ThreadListEvent = EventFor<"bt_threads">;

export type MessageThread = ThreadListEvent["threads"][number];

export type MessageListEvent = EventFor<"bt_messages">;

export type TextMessage = MessageListEvent["messages"][number];

export type NewMessageEvent = EventFor<"bt_message">;

export type MessageSendResultEvent = EventFor<"bt_send_result">;

export type MessageReadEvent = EventFor<"bt_message_read">;

export type ContactListEvent = EventFor<"bt_contacts">;

export type ContactSuggestion = ContactListEvent["contacts"][number];

export type NotificationListEvent = EventFor<"bt_notifications">;

export type PhoneNotification = NotificationListEvent["notifications"][number];

export type NewNotificationEvent = EventFor<"bt_notification">;

export type NotificationRemovedEvent = EventFor<"bt_notification_removed">;

export type NotificationActionResultEvent = EventFor<"bt_notification_action_result">;

export type CallListEvent = EventFor<"bt_calls">;

export type PhoneCall = CallListEvent["calls"][number];

export type CallResultEvent = EventFor<"bt_call_result">;

export type GatewayStatusEvent = EventFor<"gateway_status">;

export type BluetoothScanCommand = CommandFor<"bt_scan">;

export type BluetoothStatusCommand = CommandFor<"bt_status">;

export type BluetoothListDevicesCommand = CommandFor<"bt_list_devices">;

export type BluetoothPairCommand = CommandFor<"bt_pair">;

export type BluetoothUnpairCommand = CommandFor<"bt_unpair">;

export type BluetoothPairConfirmationCommand = CommandFor<"bt_pair_confirm">;

export type BluetoothSetEnabledCommand = CommandFor<"bt_set_enabled">;

export type BluetoothSolicitCommand = CommandFor<"bt_solicit">;

export type DiscoverCommand = CommandFor<"discover">;

export type PairPeerCommand = CommandFor<"pair_request">;

export type AcceptPeerCommand = CommandFor<"accept_device">;

export type ForgetPeerCommand = CommandFor<"forget_device">;

export type FileUploadStartCommand = CommandFor<"file_upload_start">;

export type FileUploadChunkCommand = CommandFor<"file_upload_chunk">;

export type FileUploadFinishCommand = CommandFor<"file_upload_finish">;

export type FileUploadCancelCommand = CommandFor<"file_upload_cancel">;

export type AirPodsEnableCommand = CommandFor<"bt_airpods_enable">;

export type AirPodsPauseCommand = CommandFor<"bt_airpods_pause">;

export type AirPodsHandoffCommand = CommandFor<"bt_airpods_handoff">;

export type AirPodsModeCommand = CommandFor<"bt_airpods_mode">;

export type AirPodsConnectCommand = CommandFor<"bt_airpods_connect">;

export type ListThreadsCommand = CommandFor<"bt_list_threads">;

export type ListMessagesCommand = CommandFor<"bt_list_messages">;

export type ListContactsCommand = CommandFor<"bt_list_contacts">;

export type MarkMessagesReadCommand = CommandFor<"bt_mark_read">;

export type SendMessageCommand = CommandFor<"bt_send_message">;

export type ListNotificationsCommand = CommandFor<"bt_list_notifications">;

export type DismissNotificationCommand = CommandFor<"bt_notification_action">;

export type ProtocolInfoCommand = CommandFor<"protocol_info">;

export type BluetoothSetAncsCommand = CommandFor<"bt_set_ancs" | "bt_set_ancs_content" | "bt_set_calls">;

export type BluetoothSetRetentionCommand = CommandFor<"bt_set_retention">;

export type ListCallsCommand = CommandFor<"bt_list_calls">;

export type DialCallCommand = CommandFor<"bt_call_dial">;

export type CallActionCommand = CommandFor<"bt_call_action">;
