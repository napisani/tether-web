import type { WifiPeer } from "./devicesState";
import type { BluetoothDevice } from "./device";
import { deviceDisplayName } from "./device";

export function DeviceList({
  devices,
  peers,
  selectedAddress,
  selectedFingerprint,
  pairingAvailable,
  bluetoothAvailable,
  peerDiscoveryAvailable,
  scanning,
  discovering,
  scanMessage,
  peerMessage,
  onSelect,
  onSelectPeer,
  onScan,
}: {
  devices: BluetoothDevice[];
  peers: WifiPeer[];
  selectedAddress?: string;
  selectedFingerprint?: string;
  pairingAvailable: boolean;
  bluetoothAvailable: boolean;
  peerDiscoveryAvailable: boolean;
  scanning: boolean;
  discovering: boolean;
  scanMessage?: string;
  peerMessage?: string;
  onSelect: (address: string) => void;
  onSelectPeer: (fingerprint: string) => void;
  onScan: () => void;
}) {
  const bluetoothScanAvailable = pairingAvailable && bluetoothAvailable;
  const scanDisabled = scanning || discovering || (!bluetoothScanAvailable && !peerDiscoveryAvailable);
  const empty = devices.length === 0 && peers.length === 0;
  return (
    <aside className="device-list-pane">
      <div className="device-list-heading">
        <div><span className="eyebrow">Wi-Fi + Bluetooth</span><h1>Devices</h1></div>
        <button className="icon-button" type="button" onClick={onScan} disabled={scanDisabled} aria-label="Scan for devices">
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <div className="device-list" aria-live="polite">
        {empty ? (
          <div className="empty-device">
            <span className="phone-outline" aria-hidden="true" />
            <strong>No devices found</strong>
            <span>Open Tether nearby or unlock your iPhone and open Bluetooth settings.</span>
          </div>
        ) : null}
        {peers.length > 0 ? <DeviceGroupHeading>Wi-Fi</DeviceGroupHeading> : null}
        {peers.map((peer) => (
          <button
            className={`device-row ${selectedFingerprint === peer.fingerprint ? "selected" : ""}`}
            type="button"
            key={`wifi:${peer.fingerprint}`}
            onClick={() => onSelectPeer(peer.fingerprint)}
          >
            <span className="device-glyph" aria-hidden="true">⌁</span>
            <span className="device-copy">
              <strong>{peer.name}</strong>
              <small>{peer.connected ? "Connected" : peer.paired ? "Offline" : peer.pending ? "Approval needed" : "Nearby"}</small>
            </span>
            <span className={`row-dot ${peer.connected ? "online" : ""}`} aria-hidden="true" />
          </button>
        ))}
        {devices.length > 0 ? <DeviceGroupHeading>Bluetooth</DeviceGroupHeading> : null}
        {devices.map((device) => (
          <button
            className={`device-row ${selectedAddress === device.address ? "selected" : ""}`}
            type="button"
            key={`bluetooth:${device.address}`}
            onClick={() => onSelect(device.address)}
          >
            <span className="device-glyph" aria-hidden="true">{device.airpods ? "◖◗" : "▯"}</span>
            <span className="device-copy">
              <strong>{deviceDisplayName(device)}</strong>
              <small>
                {device.airpods
                  ? device.connected ? "Connected" : device.paired ? "Paired" : "Nearby"
                  : device.paired ? "Paired" : device.iphone ? "Ready to pair" : "Possible iPhone"}
              </small>
            </span>
            <span className={`row-dot ${device.connected ? "online" : ""}`} aria-hidden="true" />
          </button>
        ))}
      </div>

      <button className="scan-button" type="button" onClick={onScan} disabled={scanDisabled}>
        {scanning || discovering ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">⌁</span>}
        {scanning || discovering ? "Scanning…" : "Scan for devices"}
      </button>
      {scanMessage ? <p className="device-list-message" role="status"><strong>Bluetooth:</strong> {scanMessage}</p> : null}
      {peerMessage ? <p className="device-list-message" role="status"><strong>Wi-Fi:</strong> {peerMessage}</p> : null}
      {!pairingAvailable && devices.length > 0 ? <p className="device-list-message">Bluetooth pairing needs a newer tetherd.</p> : null}
    </aside>
  );
}

function DeviceGroupHeading({ children }: { children: string }) {
  return <h2 className="device-group-heading">{children}</h2>;
}
