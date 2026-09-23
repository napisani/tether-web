import { useCallback, type Dispatch } from "react";
import type { AppAction } from "../../app/appState";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { WifiPeer } from "./devicesState";

const discoveryResultTimeoutMs = 8_000;
const pairingResultTimeoutMs = 20_000;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach tetherd.";
}

export function usePeerCommands(dispatch: Dispatch<AppAction>) {
  const send = useCallback(async (
    command: Parameters<typeof sendDaemonCommand>[0],
    onFailure?: (message: string) => void,
  ) => {
    try {
      await sendDaemonCommand(command);
    } catch (error) {
      const message = failureMessage(error);
      if (onFailure) onFailure(message);
      else dispatch({ type: "peer-command-failed", message });
    }
  }, [dispatch]);

  const discover = useCallback(() => {
    const token = crypto.randomUUID();
    dispatch({ type: "peer-discovery-started", token });
    window.setTimeout(
      () => dispatch({ type: "peer-discovery-timeout", token }),
      discoveryResultTimeoutMs,
    );
    void send(
      { command: "discover" },
      (message) => dispatch({ type: "peer-discovery-failed", token, message }),
    );
  }, [dispatch, send]);

  const pair = useCallback((peer: WifiPeer) => {
    if (!peer.address) return;
    const token = crypto.randomUUID();
    dispatch({ type: "peer-pair-started", fingerprint: peer.fingerprint, token });
    window.setTimeout(
      () => dispatch({ type: "peer-pair-timeout", fingerprint: peer.fingerprint, token }),
      pairingResultTimeoutMs,
    );
    void send(
      { command: "pair_request", host: peer.address, port: peer.port, device_name: peer.name },
      (message) => dispatch({ type: "peer-pair-failed", fingerprint: peer.fingerprint, token, message }),
    );
  }, [dispatch, send]);

  const accept = useCallback((peer: WifiPeer) => {
    void send({ command: "accept_device", fingerprint: peer.fingerprint, device_name: peer.name });
  }, [send]);

  const forget = useCallback((peer: WifiPeer) => {
    void send({ command: "forget_device", fingerprint: peer.fingerprint });
  }, [send]);

  return { discover, pair, accept, forget };
}

export type PeerActions = ReturnType<typeof usePeerCommands>;
