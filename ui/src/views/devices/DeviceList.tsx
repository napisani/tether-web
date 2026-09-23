import type { BluetoothDevice } from "./device";
import { deviceDisplayName } from "./device";

export function DeviceList({
  devices,
  selectedAddress,
  pairingAvailable,
  bluetoothAvailable,
  scanning,
  scanMessage,
  onSelect,
  onScan,
}: {
  devices: BluetoothDevice[];
  selectedAddress?: string;
  pairingAvailable: boolean;
  bluetoothAvailable: boolean;
  scanning: boolean;
  scanMessage?: string;
  onSelect: (address: string) => void;
  onScan: () => void;
}) {
  const scanDisabled = scanning || !bluetoothAvailable;
  return (
    <aside className="device-list-pane">
      <div className="device-list-heading">
        <div>
          <span className="eyebrow">Bluetooth</span>
          <h1>Devices</h1>
        </div>
        {pairingAvailable ? (
          <button className="icon-button" type="button" onClick={onScan} disabled={scanDisabled} aria-label="Scan for iPhones">
            <span aria-hidden="true">↻</span>
          </button>
        ) : null}
      </div>

      <div className="device-list" aria-live="polite">
        {devices.length === 0 ? (
          <div className="empty-device">
            <span className="phone-outline" aria-hidden="true" />
            <strong>No iPhone found</strong>
            <span>Unlock your iPhone and open Settings → Bluetooth.</span>
          </div>
        ) : (
          devices.map((device) => (
            <button
              className={`device-row ${selectedAddress === device.address ? "selected" : ""}`}
              type="button"
              key={device.address}
              onClick={() => onSelect(device.address)}
            >
              <span className="device-glyph" aria-hidden="true">{device.airpods ? "◖◗" : "▯"}</span>
              <span className="device-copy">
                <strong>{deviceDisplayName(device)}</strong>
                <small>
                  {device.airpods
                    ? device.connected ? "Connected" : device.paired ? "Paired" : "Nearby"
                    : device.bonded ? "Paired" : device.iphone ? "Ready to pair" : "Possible iPhone"}
                </small>
              </span>
              <span className={`row-dot ${device.connected ? "online" : ""}`} aria-hidden="true" />
            </button>
          ))
        )}
      </div>

      {pairingAvailable ? (
        <button className="scan-button" type="button" onClick={onScan} disabled={scanDisabled}>
          {scanning ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">⌁</span>}
          {scanning ? "Scanning…" : "Scan for iPhone"}
        </button>
      ) : null}
      {scanMessage && <p className="device-list-message">{scanMessage}</p>}
    </aside>
  );
}
