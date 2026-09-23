import { useMemo, useState } from "react";
import type { DaemonState } from "../../app/appState";
import { AirPodsPane } from "./AirPodsPane";
import { ConfirmForgetDialog, PairingCodeDialog, PairingProgress } from "./BluetoothPairing";
import { DeviceList } from "./DeviceList";
import { DevicePane } from "./DevicePane";
import { ConfirmPeerForgetDialog, PeerPane } from "./PeerPane";
import { deviceDisplayName } from "./device";
import type { DevicesState } from "./devicesState";
import type { AirPodsActions } from "./useAirPodsCommands";
import type { PeerActions } from "./usePeerCommands";
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
  airpodsActions: AirPodsActions;
  peerActions: PeerActions;
};

export function DevicesView({
  daemon,
  state,
  onScan,
  onPair,
  onUnpair,
  onConfirmPairing,
  onResetPairing,
  airpodsActions,
  peerActions,
}: DevicesViewProps) {
  const configuredAddress = state.bluetooth?.device_address;
  const initialAddress = configuredAddress || state.devices[0]?.address || "";
  const [selectedAddress, setSelectedAddress] = useState(initialAddress);
  const [selectedFingerprint, setSelectedFingerprint] = useState<string>();
  const [forgetAddress, setForgetAddress] = useState<string>();
  const [forgetFingerprint, setForgetFingerprint] = useState<string>();
  const selectedDevice = useMemo(
    () =>
      state.devices.find((device) => device.address === selectedAddress) ??
      state.devices.find((device) => device.address === configuredAddress) ??
      state.devices[0],
    [configuredAddress, selectedAddress, state.devices],
  );
  const selectedPeer =
    state.wifi.peers.find((peer) => peer.fingerprint === selectedFingerprint) ??
    (!selectedDevice ? state.wifi.peers[0] : undefined);
  const connection = state.connection;
  const pairingAvailable = daemon.protocol?.capabilities.includes("bluetooth.pairing") === true;
  const peerDiscoveryAvailable = daemon.protocol?.capabilities.includes("peers") === true;
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
          peers={state.wifi.peers}
          selectedAddress={selectedPeer ? undefined : selectedDevice?.address}
          selectedFingerprint={selectedPeer?.fingerprint}
          pairingAvailable={pairingAvailable}
          bluetoothAvailable={bluetoothAvailable}
          peerDiscoveryAvailable={peerDiscoveryAvailable}
          scanning={state.scanning}
          discovering={state.wifi.discovering}
          scanMessage={state.scanMessage}
          peerMessage={state.wifi.message}
          onSelect={(address) => {
            setSelectedFingerprint(undefined);
            setSelectedAddress(address);
          }}
          onSelectPeer={(fingerprint) => {
            setSelectedAddress("");
            setSelectedFingerprint(fingerprint);
          }}
          onScan={onScan}
        />

        <section className="device-pane">
          {!daemon.connected ? (
            <Notice title="Tether is reconnecting" body="The web interface cannot reach tetherd yet. It will retry automatically." />
          ) : selectedPeer ? (
            <PeerPane
              peer={selectedPeer}
              wifi={state.wifi}
              actions={peerActions}
              onForget={() => setForgetFingerprint(selectedPeer.fingerprint)}
            />
          ) : !bluetoothAvailable ? (
            <Notice title="Bluetooth is not ready" body="Complete the host Bluetooth setup, then restart the Tether deployment." />
          ) : selectedDevice?.airpods ? (
            <AirPodsPane
              device={selectedDevice}
              airpods={state.airpods?.address === selectedDevice.address ? state.airpods : undefined}
              bluetooth={state.bluetooth}
              connectingAddress={state.airpodsConnectingAddress}
              message={
                !state.airpodsMessage?.address || state.airpodsMessage.address === selectedDevice.address
                  ? state.airpodsMessage?.text
                  : undefined
              }
              actions={airpodsActions}
            />
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
      {forgetFingerprint ? (
        <ConfirmPeerForgetDialog
          name={state.wifi.peers.find((peer) => peer.fingerprint === forgetFingerprint)?.name || "this device"}
          onCancel={() => setForgetFingerprint(undefined)}
          onConfirm={() => {
            const peer = state.wifi.peers.find((candidate) => candidate.fingerprint === forgetFingerprint);
            if (peer) peerActions.forget(peer);
            setForgetFingerprint(undefined);
          }}
        />
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
