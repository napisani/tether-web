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
import type { FileTransferActions } from "./useFileTransfer";
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
  onSetBluetoothEnabled: (enabled: boolean) => void;
  onSolicitPermissions: () => void;
  onResetPairing: () => void;
  airpodsActions: AirPodsActions;
  peerActions: PeerActions;
  fileTransfer: FileTransferActions;
};

export function DevicesView({
  daemon,
  state,
  onScan,
  onPair,
  onUnpair,
  onConfirmPairing,
  onSetBluetoothEnabled,
  onSolicitPermissions,
  onResetPairing,
  airpodsActions,
  peerActions,
  fileTransfer,
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

  const bluetoothControlAvailable =
    daemon.protocol?.capabilities.includes("bluetooth.connection") === true;

  const peerDiscoveryAvailable = daemon.protocol?.capabilities.includes("peers") === true;
  // Browser bytes are staged by the gateway; tetherd only needs send_file.
  const fileUploadAvailable = daemon.protocol?.capabilities.includes("files") === true;
  const bluetoothAvailable = state.bluetooth?.available ?? false;

  const isConfiguredDevice = Boolean(
    configuredAddress &&
    selectedDevice &&
    configuredAddress.toUpperCase() === selectedDevice.address.toUpperCase(),
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

        <DeviceContent
          daemonConnected={daemon.connected}
          selectedPeer={selectedPeer}
          selectedDevice={selectedDevice}
          bluetoothAvailable={bluetoothAvailable}
          pairingAvailable={pairingAvailable}
          bluetoothControlAvailable={bluetoothControlAvailable}
          fileUploadAvailable={fileUploadAvailable}
          clipboardAvailable={daemon.protocol?.capabilities.includes("clipboard") === true}
          isConfiguredDevice={isConfiguredDevice}
          state={state}
          connection={connection}
          peerActions={peerActions}
          fileTransfer={fileTransfer}
          airpodsActions={airpodsActions}
          onScan={onScan}
          onPair={onPair}
          onUnpair={setForgetAddress}
          onSetBluetoothEnabled={onSetBluetoothEnabled}
          onSolicitPermissions={onSolicitPermissions}
          onResetPairing={onResetPairing}
          onForgetPeer={setForgetFingerprint}
        />
      </main>

      <DeviceDialogs
        state={state}
        forgetFingerprint={forgetFingerprint}
        forgetAddress={forgetAddress}
        onConfirmPairing={onConfirmPairing}
        onCancelPeer={() => setForgetFingerprint(undefined)}
        onForgetPeer={(peer) => peerActions.forget(peer)}
        onCancelDevice={() => setForgetAddress(undefined)}
        onUnpair={onUnpair}
      />
    </div>
  );
}

function DeviceContent({
  daemonConnected,
  selectedPeer,
  selectedDevice,
  bluetoothAvailable,
  pairingAvailable,
  bluetoothControlAvailable,
  fileUploadAvailable,
  clipboardAvailable,
  isConfiguredDevice,
  state,
  connection,
  peerActions,
  fileTransfer,
  airpodsActions,
  onScan,
  onPair,
  onUnpair,
  onSetBluetoothEnabled,
  onSolicitPermissions,
  onResetPairing,
  onForgetPeer,
}: {
  daemonConnected: boolean;
  selectedPeer?: DevicesState["wifi"]["peers"][number];
  selectedDevice?: DevicesState["devices"][number];
  bluetoothAvailable: boolean;
  pairingAvailable: boolean;
  bluetoothControlAvailable: boolean;
  fileUploadAvailable: boolean;
  clipboardAvailable: boolean;
  isConfiguredDevice: boolean;
  state: DevicesState;
  connection: DevicesState["connection"];
  peerActions: PeerActions;
  fileTransfer: FileTransferActions;
  airpodsActions: AirPodsActions;
  onScan: () => void;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
  onSetBluetoothEnabled: (enabled: boolean) => void;
  onSolicitPermissions: () => void;
  onResetPairing: () => void;
  onForgetPeer: (fingerprint: string) => void;
}) {
  return (
    <section className="device-pane quiet-scrollbar">
      {!daemonConnected ? (
        <Notice
          title="Tether is reconnecting"
          body="The web interface cannot reach tetherd yet. It will retry automatically."
        />
      ) : selectedPeer ? (
        <PeerPane
          peer={selectedPeer}
          wifi={state.wifi}
          actions={peerActions}
          fileTransfer={fileTransfer}
          fileUploadAvailable={fileUploadAvailable}
          clipboardAvailable={clipboardAvailable}
          onForget={() => onForgetPeer(selectedPeer.fingerprint)}
        />
      ) : !bluetoothAvailable && !selectedDevice ? (
        <Notice
          title="Bluetooth is not ready"
          body="Complete the host Bluetooth setup, then restart the Tether deployment."
        />
      ) : selectedDevice?.airpods ? (
        <AirPodsPane
          device={selectedDevice}
          airpods={state.airpods?.address === selectedDevice.address ? state.airpods : undefined}
          bluetooth={state.bluetooth}
          connectingAddress={state.airpodsConnectingAddress}
          message={
            !state.airpodsMessage?.address ||
            state.airpodsMessage.address === selectedDevice.address
              ? state.airpodsMessage?.text
              : undefined
          }
          actions={airpodsActions}
        />
      ) : selectedDevice ? (
        <DevicePane
          device={selectedDevice}
          bluetooth={state.bluetooth}
          connection={isConfiguredDevice ? connection : undefined}
          isConfiguredDevice={isConfiguredDevice}
          pairingAvailable={pairingAvailable && bluetoothAvailable}
          bluetoothControlAvailable={bluetoothControlAvailable && bluetoothAvailable}
          pairingBusy={state.pairing.phase === "pairing" || state.pairing.phase === "confirming"}
          bluetoothBusy={Boolean(state.bluetoothEnabledToken || state.bluetoothSolicitToken)}
          bluetoothEnabledTarget={state.bluetoothEnabledTarget}
          bluetoothMessage={state.bluetoothMessage}
          onPair={onPair}
          onUnpair={onUnpair}
          onSetBluetoothEnabled={onSetBluetoothEnabled}
          onSolicitPermissions={onSolicitPermissions}
        />
      ) : (
        <Welcome onScan={onScan} scanning={state.scanning} pairingAvailable={pairingAvailable} />
      )}
      {state.pairing.phase !== "idle" ? (
        <PairingProgress pairing={state.pairing} onReset={onResetPairing} />
      ) : null}
    </section>
  );
}

function DeviceDialogs({
  state,
  forgetFingerprint,
  forgetAddress,
  onConfirmPairing,
  onCancelPeer,
  onForgetPeer,
  onCancelDevice,
  onUnpair,
}: {
  state: DevicesState;
  forgetFingerprint?: string;
  forgetAddress?: string;
  onConfirmPairing: (accept: boolean) => void;
  onCancelPeer: () => void;
  onForgetPeer: (peer: DevicesState["wifi"]["peers"][number]) => void;
  onCancelDevice: () => void;
  onUnpair: (address: string) => void;
}) {
  const peer = forgetFingerprint
    ? state.wifi.peers.find((candidate) => candidate.fingerprint === forgetFingerprint)
    : undefined;

  return (
    <>
      {state.pairing.phase === "confirming" && state.pairing.code ? (
        <PairingCodeDialog code={state.pairing.code} onAnswer={onConfirmPairing} />
      ) : null}
      {forgetFingerprint ? (
        <ConfirmPeerForgetDialog
          name={peer?.name || "this device"}
          onCancel={onCancelPeer}
          onConfirm={() => {
            if (peer) onForgetPeer(peer);
            onCancelPeer();
          }}
        />
      ) : null}
      {forgetAddress ? (
        <ConfirmForgetDialog
          name={deviceDisplayName(state.devices.find((device) => device.address === forgetAddress))}
          onCancel={onCancelDevice}
          onConfirm={() => {
            onUnpair(forgetAddress);
            onCancelDevice();
          }}
        />
      ) : null}
    </>
  );
}
