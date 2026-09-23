import { useMemo, useState } from "react";
import type { DaemonState } from "../../app/appState";
import { ConfirmForgetDialog, PairingCodeDialog, PairingProgress } from "./BluetoothPairing";
import { DeviceList } from "./DeviceList";
import { DevicePane } from "./DevicePane";
import { deviceDisplayName } from "./device";
import type { DevicesState } from "./devicesState";
import { Notice, Welcome } from "./EmptyStates";
import "./DevicesView.css";

type DevicesViewProps = {
  daemon: DaemonState;
  state: DevicesState;
  onScan: () => void;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
  onConfirmPairing: (accept: boolean) => void;
  onResetPairing: () => void;
};

export function DevicesView({
  daemon,
  state,
  onScan,
  onPair,
  onUnpair,
  onConfirmPairing,
  onResetPairing,
}: DevicesViewProps) {
  const configuredAddress = state.bluetooth?.device_address;
  const initialAddress = configuredAddress || state.devices[0]?.address || "";
  const [selectedAddress, setSelectedAddress] = useState(initialAddress);
  const [forgetAddress, setForgetAddress] = useState<string>();
  const selectedDevice = useMemo(
    () =>
      state.devices.find((device) => device.address === selectedAddress) ??
      state.devices.find((device) => device.address === configuredAddress) ??
      state.devices[0],
    [configuredAddress, selectedAddress, state.devices],
  );
  const connection = state.connection;
  const pairingAvailable = daemon.protocol?.capabilities.includes("bluetooth.pairing") === true;
  const bluetoothAvailable = state.bluetooth?.available ?? false;
  const pairingBusy = state.pairing.phase === "pairing" || state.pairing.phase === "confirming";
  const isConfiguredDevice = Boolean(
    configuredAddress && selectedDevice && configuredAddress.toUpperCase() === selectedDevice.address.toUpperCase(),
  );

  return (
    <div className="devices-view">
      <main className="devices-workspace">
        <DeviceList
          devices={state.devices}
          selectedAddress={selectedDevice?.address}
          pairingAvailable={pairingAvailable}
          bluetoothAvailable={bluetoothAvailable}
          scanning={state.scanning}
          scanMessage={state.scanMessage}
          onSelect={setSelectedAddress}
          onScan={onScan}
        />

        <section className="device-pane">
          {!daemon.connected ? (
            <Notice title="Tether is reconnecting" body="The web interface cannot reach tetherd yet. It will retry automatically." />
          ) : !bluetoothAvailable ? (
            <Notice title="Bluetooth is not ready" body="Complete the host Bluetooth setup, then restart the Tether deployment." />
          ) : selectedDevice ? (
            <DevicePane
              device={selectedDevice}
              connection={isConfiguredDevice ? connection : undefined}
              isConfiguredDevice={isConfiguredDevice}
              pairingAvailable={pairingAvailable}
              pairingBusy={pairingBusy}
              onPair={onPair}
              onUnpair={setForgetAddress}
            />
          ) : (
            <Welcome onScan={onScan} scanning={state.scanning} pairingAvailable={pairingAvailable} />
          )}
          {state.pairing.phase !== "idle" ? (
            <PairingProgress pairing={state.pairing} onReset={onResetPairing} />
          ) : null}
        </section>
      </main>

      {state.pairing.phase === "confirming" && state.pairing.code ? (
        <PairingCodeDialog code={state.pairing.code} onAnswer={onConfirmPairing} />
      ) : null}
      {forgetAddress ? (
        <ConfirmForgetDialog
          name={deviceDisplayName(state.devices.find((device) => device.address === forgetAddress))}
          onCancel={() => setForgetAddress(undefined)}
          onConfirm={() => {
            onUnpair(forgetAddress);
            setForgetAddress(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
