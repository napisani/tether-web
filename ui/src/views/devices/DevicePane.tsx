import { useState } from "react";
import type { BluetoothConnectionEvent, BluetoothStatusEvent } from "../../protocol";
import type { BluetoothDevice } from "./device";
import { deviceDisplayName } from "./device";

export function DevicePane({
  device,
  bluetooth,
  connection,
  isConfiguredDevice,
  pairingAvailable,
  bluetoothControlAvailable,
  pairingBusy,
  bluetoothBusy,
  bluetoothEnabledTarget,
  bluetoothMessage,
  onPair,
  onUnpair,
  onSetBluetoothEnabled,
  onSolicitPermissions,
}: {
  device: BluetoothDevice;
  bluetooth?: BluetoothStatusEvent;
  connection?: BluetoothConnectionEvent;
  isConfiguredDevice: boolean;
  pairingAvailable: boolean;
  bluetoothControlAvailable: boolean;
  pairingBusy: boolean;
  bluetoothBusy: boolean;
  bluetoothEnabledTarget?: boolean;
  bluetoothMessage?: string;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
  onSetBluetoothEnabled: (enabled: boolean) => void;
  onSolicitPermissions: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("Copy commands");
  const paired = Boolean(device.paired);
  const model = getDevicePaneModel(device, bluetooth, connection, isConfiguredDevice);

  const copySetupCommands = async () => {
    try {
      await navigator.clipboard.writeText(model.setupCommands);
      setCopyStatus("Setup commands copied.");
    } catch {
      setCopyStatus("Could not copy setup commands.");
    }
  };

  return (
    <div className="device-pane-content">
      <DeviceHeader device={device} paired={paired} />
      <DeviceStatus {...model} isConfiguredDevice={isConfiguredDevice} />
      {bluetooth ? <BluetoothMode bluetooth={bluetooth} /> : null}
      <SetupSection
        setup={model.setup}
        setupCommands={model.setupCommands}
        allProfilesLive={model.allProfilesLive}
        copyStatus={copyStatus}
        onCopy={() => void copySetupCommands()}
      />
      {model.connectionReason ? <DiagnosticNote message={model.connectionReason} /> : null}
      <BluetoothControls
        available={bluetoothControlAvailable && isConfiguredDevice}
        enabled={bluetoothEnabledTarget ?? bluetooth?.enabled ?? true}
        busy={bluetoothBusy}
        showSolicit={model.showSolicit}
        message={bluetoothMessage}
        onSetEnabled={onSetBluetoothEnabled}
        onSolicit={onSolicitPermissions}
      />
      <DeviceActions
        device={device}
        paired={paired}
        configured={isConfiguredDevice}
        available={pairingAvailable}
        busy={pairingBusy}
        onPair={onPair}
        onUnpair={onUnpair}
      />
    </div>
  );
}

function getDevicePaneModel(
  device: BluetoothDevice,
  bluetooth: BluetoothStatusEvent | undefined,
  connection: BluetoothConnectionEvent | undefined,
  configured: boolean,
) {
  const status = getConnectionStatus(device, bluetooth, connection, configured);
  const setup = bluetooth?.capability?.setup || [];

  return {
    ...status,
    setup,
    setupCommands: setup.map((step) => step.command).filter(Boolean).join("\n"),
    allProfilesLive: isFullyConnected(bluetooth, status),
    showSolicit: shouldSolicitPermissions(configured, status.mapError, status.ancsReady),
    connectionReason: deviceReason(device, bluetooth, connection, configured),
  };
}

function getConnectionStatus(
  device: BluetoothDevice,
  bluetooth: BluetoothStatusEvent | undefined,
  connection: BluetoothConnectionEvent | undefined,
  configured: boolean,
) {
  const classicConnected = configured ? Boolean(connection?.classic_connected) : Boolean(device.classic_connected);
  const leConnected = configured ? Boolean(connection?.le_connected) : Boolean(device.le_connected);
  const mapOpen = configured && Boolean(connection?.map_open);
  const pbapOpen = configured && Boolean(connection?.pbap_open);
  const ancsReady = configured && Boolean(connection?.ancs_ready);

  return {
    classicConnected,
    leConnected,
    mapOpen,
    mapError: connection?.map_error || "none",
    pbapOpen,
    pbapError: connection?.pbap_error || "none",
    ancsReady,
    ancsReason: connection?.ancs_reason,
  };
}

function isFullyConnected(bluetooth: BluetoothStatusEvent | undefined, status: { mapOpen: boolean; pbapOpen: boolean; ancsReady: boolean }) {
  return bluetooth?.available === true && status.mapOpen && status.pbapOpen && (status.ancsReady || bluetooth.ancs_enabled === false);
}

function shouldSolicitPermissions(configured: boolean, mapError: string, ancsReady: boolean) {
  return configured && (mapError === "forbidden" || mapError === "no_record" || !ancsReady);
}

function DeviceHeader({ device, paired }: { device: BluetoothDevice; paired: boolean }) {
  return (
    <div className="detail-heading">
      <div>
        <span className="eyebrow">{device.iphone ? "Selected iPhone" : "Possible iPhone"}</span>
        <h2>{deviceDisplayName(device)}</h2>
        <p className="address">{device.address}</p>
      </div>
      <span className={`connection-pill ${device.connected ? "connected" : ""}`}>
        <span className={`row-dot ${device.connected ? "online" : ""}`} aria-hidden="true" />
        {device.connected ? "Connected" : paired ? "Paired" : "Not paired"}
      </span>
    </div>
  );
}

function DeviceStatus({
  classicConnected,
  leConnected,
  isConfiguredDevice,
  mapOpen,
  mapError,
  pbapOpen,
  pbapError,
  ancsReady,
  ancsReason,
}: {
  classicConnected: boolean;
  leConnected: boolean;
  isConfiguredDevice: boolean;
  mapOpen: boolean;
  mapError: string;
  pbapOpen: boolean;
  pbapError: string;
  ancsReady: boolean;
  ancsReason?: string;
}) {
  return (
    <section className="status-section" aria-labelledby="connection-status-title">
      <div className="section-heading"><h3 id="connection-status-title">Current status</h3><span>Live from tetherd</span></div>
      <div className="status-grid">
        <CapabilityCard label="Classic Bluetooth" detail={classicConnected ? "BR/EDR connected" : "BR/EDR off"} active={classicConnected} />
        <CapabilityCard label="Low Energy" detail={leConnected ? "LE connected" : "LE off"} active={leConnected} />
        <CapabilityCard label="Messages" detail={capabilityDetail(isConfiguredDevice, mapOpen, mapError, "MAP")} active={mapOpen} />
        <CapabilityCard label="Contacts" detail={capabilityDetail(isConfiguredDevice, pbapOpen, pbapError, "PBAP")} active={pbapOpen} />
        <CapabilityCard label="Notifications" detail={capabilityDetail(isConfiguredDevice, ancsReady, ancsReason, "ANCS")} active={ancsReady} />
      </div>
    </section>
  );
}

function SetupSection({ setup, setupCommands, allProfilesLive, copyStatus, onCopy }: {
  setup: NonNullable<BluetoothStatusEvent["capability"]>["setup"];
  setupCommands: string;
  allProfilesLive: boolean;
  copyStatus: string;
  onCopy: () => void;
}) {
  if (setup.length === 0 || allProfilesLive) return null;

  return (
    <section className="bluetooth-setup" aria-labelledby="bluetooth-setup-title">
      <div><h3 id="bluetooth-setup-title">Bluetooth setup needed</h3><ol>{setup.map((step) => <li key={`${step.what}:${step.command}`}>{step.what}</li>)}</ol></div>
      {setupCommands ? <>
        <pre><code>{setupCommands}</code></pre>
        <div className="copy-command-action">
          <button className="secondary-button" type="button" onClick={onCopy}>Copy commands</button>
          {copyStatus !== "Copy commands" ? <span role="status">{copyStatus}</span> : null}
        </div>
      </> : null}
    </section>
  );
}

function DiagnosticNote({ message }: { message: string }) {
  return <div className="diagnostic-note"><span aria-hidden="true">i</span><p>{message}</p></div>;
}

function BluetoothControls({ available, enabled, busy, showSolicit, message, onSetEnabled, onSolicit }: {
  available: boolean;
  enabled: boolean;
  busy: boolean;
  showSolicit: boolean;
  message?: string;
  onSetEnabled: (enabled: boolean) => void;
  onSolicit: () => void;
}) {
  if (!available) return null;

  return (
    <div className="settings-group">
      <label className="setting-row">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => onSetEnabled(event.target.checked)} />
        <span><strong>Connect to this iPhone over Bluetooth</strong><small>Keep the link up and reconnect when it drops. Turning this off leaves an existing link alone.</small></span>
      </label>
      {showSolicit ? <div className="setting-action">
        <button className="secondary-button" type="button" disabled={busy} onClick={onSolicit}>{busy ? "Requesting permissions…" : "Show iPhone Permissions"}</button>
        <small>Re-advertise so the iPhone shows Show Message Notifications and Sync Contacts under Settings &gt; Bluetooth &gt; (i).</small>
      </div> : null}
      {message ? <p className="muted-copy" role="status">{message}</p> : null}
    </div>
  );
}

function DeviceActions({ device, paired, configured, available, busy, onPair, onUnpair }: {
  device: BluetoothDevice;
  paired: boolean;
  configured: boolean;
  available: boolean;
  busy: boolean;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
}) {
  return (
    <div className="actions">
      {available ? <>
        {!paired || !configured ? <button className="primary-button" type="button" onClick={() => onPair(device.address)} disabled={busy}>Pair over Bluetooth</button> : null}
        {paired ? <button className="secondary-button danger" type="button" onClick={() => onUnpair(device.address)} disabled={busy}>Forget iPhone</button> : null}
      </> : <p>This version of tetherd does not advertise browser pairing controls.</p>}
      {available && !paired ? <p>Keep the iPhone unlocked on its Bluetooth settings screen while pairing.</p> : null}
    </div>
  );
}

function BluetoothMode({ bluetooth }: { bluetooth: BluetoothStatusEvent }) {
  const capability = bluetooth.capability;

  const summary = !bluetooth.available || !capability
    ? "Bluetooth is unavailable on this machine."
    : capability.mode === "full"
      ? "Full mode — messages, contacts, and notifications."
      : capability.mode === "compatibility"
        ? "Compatibility mode — messages and contacts, no notification mirroring."
        : "This machine cannot carry the Bluetooth features.";

  return (
    <div className="bluetooth-mode">
      <strong>{summary}</strong>
      {capability?.reasons.map((reason) => <p key={reason}>{reason}</p>)}
    </div>
  );
}

function capabilityDetail(
  configured: boolean,
  active: boolean,
  error: string | undefined,
  fallback: string,
): string {
  if (!configured) return "Not supervised";

  if (active) return "Connected";

  return error && error !== "none" ? error : fallback;
}

function deviceReason(
  device: BluetoothDevice,
  bluetooth: BluetoothStatusEvent | undefined,
  connection: BluetoothConnectionEvent | undefined,
  configured: boolean,
): string | undefined {
  if (!device.paired) return "Not paired over Bluetooth yet.";

  if (!configured) return "Tether is not using this device. Pair it to select it.";

  if (bluetooth?.enabled === false) return "Bluetooth is switched off for this iPhone.";
  const linkDegraded = !connection?.classic_connected || !connection?.le_connected;

  return (linkDegraded ? connection?.link_reason : connection?.profile_reason) || connection?.link_reason || connection?.ancs_reason;
}

function CapabilityCard({ label, detail, active }: { label: string; detail: string; active: boolean }) {
  return (
    <div className={`capability-card ${active ? "active" : ""}`}>
      <span className="capability-state" aria-hidden="true">{active ? "✓" : "—"}</span>
      <div><strong>{label}</strong><small>{detail}</small></div>
    </div>
  );
}
