import type { BluetoothConnectionEvent } from "../../protocol";
import type { BluetoothDevice } from "./device";
import { deviceDisplayName } from "./device";

export function DevicePane({
  device,
  connection,
  isConfiguredDevice,
  pairingAvailable,
  pairingBusy,
  onPair,
  onUnpair,
}: {
  device: BluetoothDevice;
  connection?: BluetoothConnectionEvent;
  isConfiguredDevice: boolean;
  pairingAvailable: boolean;
  pairingBusy: boolean;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
}) {
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
          {device.connected ? "Connected" : device.bonded ? "Paired" : "Not paired"}
        </span>
      </div>

      <section className="status-section" aria-labelledby="connection-status-title">
        <div className="section-heading">
          <h3 id="connection-status-title">Current status</h3>
          <span>Live from tetherd</span>
        </div>
        <div className="status-grid">
          <CapabilityCard label="Classic Bluetooth" detail="Phone link" active={Boolean(device.classic_connected)} />
          <CapabilityCard label="Low Energy" detail="Notification link" active={Boolean(device.le_connected)} />
          <CapabilityCard label="Messages" detail={isConfiguredDevice ? "MAP" : "Not supervised"} active={Boolean(connection?.map_open)} />
          <CapabilityCard label="Contacts" detail={isConfiguredDevice ? "PBAP" : "Not supervised"} active={Boolean(connection?.pbap_open)} />
          <CapabilityCard label="Notifications" detail={isConfiguredDevice ? "ANCS" : "Not supervised"} active={Boolean(connection?.ancs_ready)} />
        </div>
      </section>

      {connection && (connection.link_reason || connection.profile_reason || connection.ancs_reason) ? (
        <div className="diagnostic-note">
          <span aria-hidden="true">i</span>
          <p>{connection.link_reason || connection.profile_reason || connection.ancs_reason}</p>
        </div>
      ) : null}

      <div className="actions">
        {pairingAvailable ? (
          device.bonded ? (
            <button className="secondary-button danger" type="button" onClick={() => onUnpair(device.address)} disabled={pairingBusy}>
              Forget iPhone
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => onPair(device.address)} disabled={pairingBusy}>
              Pair over Bluetooth
            </button>
          )
        ) : (
          <p>This version of tetherd does not advertise browser pairing controls.</p>
        )}
        {pairingAvailable && !device.bonded ? <p>Keep the iPhone unlocked on its Bluetooth settings screen while pairing.</p> : null}
      </div>
    </div>
  );
}

function CapabilityCard({ label, detail, active }: { label: string; detail: string; active: boolean }) {
  return (
    <div className={`capability-card ${active ? "active" : ""}`}>
      <span className="capability-state" aria-hidden="true">{active ? "✓" : "—"}</span>
      <div><strong>{label}</strong><small>{active ? "Connected" : detail}</small></div>
    </div>
  );
}
