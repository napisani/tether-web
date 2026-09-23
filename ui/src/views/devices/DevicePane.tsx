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
  const classicConnected = isConfiguredDevice
    ? Boolean(connection?.classic_connected)
    : Boolean(device.classic_connected);
  const leConnected = isConfiguredDevice ? Boolean(connection?.le_connected) : Boolean(device.le_connected);
  const mapOpen = isConfiguredDevice && Boolean(connection?.map_open);
  const pbapOpen = isConfiguredDevice && Boolean(connection?.pbap_open);
  const ancsReady = isConfiguredDevice && Boolean(connection?.ancs_ready);
  const mapError = connection?.map_error || "none";
  const pbapError = connection?.pbap_error || "none";
  const setup = bluetooth?.capability?.setup || [];
  const setupCommands = setup.map((step) => step.command).filter(Boolean).join("\n");
  const allProfilesLive = bluetooth?.available === true &&
    mapOpen && pbapOpen && (ancsReady || bluetooth.ancs_enabled === false);
  const showSolicit = isConfiguredDevice &&
    (mapError === "forbidden" || mapError === "no_record" || !ancsReady);
  const connectionReason = deviceReason(device, bluetooth, connection, isConfiguredDevice);

  const copySetupCommands = async () => {
    try {
      await navigator.clipboard.writeText(setupCommands);
      setCopyStatus("Setup commands copied.");
    } catch {
      setCopyStatus("Could not copy setup commands.");
    }
  };

  return (
    <div className="device-pane-content">
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

      <section className="status-section" aria-labelledby="connection-status-title">
        <div className="section-heading">
          <h3 id="connection-status-title">Current status</h3>
          <span>Live from tetherd</span>
        </div>
        <div className="status-grid">
          <CapabilityCard
            label="Classic Bluetooth"
            detail={classicConnected ? "BR/EDR connected" : "BR/EDR off"}
            active={classicConnected}
          />
          <CapabilityCard
            label="Low Energy"
            detail={leConnected ? "LE connected" : "LE off"}
            active={leConnected}
          />
          <CapabilityCard
            label="Messages"
            detail={capabilityDetail(isConfiguredDevice, mapOpen, mapError, "MAP")}
            active={mapOpen}
          />
          <CapabilityCard
            label="Contacts"
            detail={capabilityDetail(isConfiguredDevice, pbapOpen, pbapError, "PBAP")}
            active={pbapOpen}
          />
          <CapabilityCard
            label="Notifications"
            detail={capabilityDetail(isConfiguredDevice, ancsReady, connection?.ancs_reason, "ANCS")}
            active={ancsReady}
          />
        </div>
      </section>

      {bluetooth ? <BluetoothMode bluetooth={bluetooth} /> : null}

      {setup.length > 0 && !allProfilesLive ? (
        <section className="bluetooth-setup" aria-labelledby="bluetooth-setup-title">
          <div>
            <h3 id="bluetooth-setup-title">Bluetooth setup needed</h3>
            <ol>{setup.map((step) => <li key={`${step.what}:${step.command}`}>{step.what}</li>)}</ol>
          </div>
          {setupCommands ? (
            <>
              <pre><code>{setupCommands}</code></pre>
              <div className="copy-command-action">
                <button className="secondary-button" type="button" onClick={() => void copySetupCommands()}>
                  Copy commands
                </button>
                {copyStatus !== "Copy commands" ? <span role="status">{copyStatus}</span> : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {connectionReason ? (
        <div className="diagnostic-note">
          <span aria-hidden="true">i</span>
          <p>{connectionReason}</p>
        </div>
      ) : null}

      {bluetoothControlAvailable && isConfiguredDevice ? (
        <div className="settings-group">
          <label className="setting-row">
            <input
              type="checkbox"
              checked={bluetoothEnabledTarget ?? bluetooth?.enabled ?? true}
              disabled={bluetoothBusy}
              onChange={(event) => onSetBluetoothEnabled(event.target.checked)}
            />
            <span>
              <strong>Connect to this iPhone over Bluetooth</strong>
              <small>
                Keep the link up and reconnect when it drops. Turning this off leaves an existing link alone.
              </small>
            </span>
          </label>
          {showSolicit ? (
            <div className="setting-action">
              <button
                className="secondary-button"
                type="button"
                disabled={bluetoothBusy}
                onClick={onSolicitPermissions}
              >
                {bluetoothBusy ? "Requesting permissions…" : "Show iPhone Permissions"}
              </button>
              <small>
                Re-advertise so the iPhone shows Show Message Notifications and Sync Contacts under Settings &gt; Bluetooth &gt; (i).
              </small>
            </div>
          ) : null}
          {bluetoothMessage ? <p className="muted-copy" role="status">{bluetoothMessage}</p> : null}
        </div>
      ) : null}

      <div className="actions">
        {pairingAvailable ? (
          <>
            {!paired || !isConfiguredDevice ? (
              <button className="primary-button" type="button" onClick={() => onPair(device.address)} disabled={pairingBusy}>
                Pair over Bluetooth
              </button>
            ) : null}
            {paired ? (
              <button className="secondary-button danger" type="button" onClick={() => onUnpair(device.address)} disabled={pairingBusy}>
                Forget iPhone
              </button>
            ) : null}
          </>
        ) : (
          <p>This version of tetherd does not advertise browser pairing controls.</p>
        )}
        {pairingAvailable && !paired ? <p>Keep the iPhone unlocked on its Bluetooth settings screen while pairing.</p> : null}
      </div>
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
