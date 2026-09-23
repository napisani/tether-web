import type { Dispatch } from "react";
import type { AppAction } from "../../app/appState";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { AirPodsEvent, BluetoothStatusEvent } from "../../protocol";

function commandError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach tetherd.";
}

const connectResultTimeoutMs = 30_000;

export function useAirPodsCommands(dispatch: Dispatch<AppAction>) {
  const send = async (
    command: Parameters<typeof sendDaemonCommand>[0],
    failure: { connect: boolean; address?: string } = { connect: false },
  ) => {
    try {
      await sendDaemonCommand(command);
    } catch (error) {
      dispatch({ type: "airpods-command-failed", message: commandError(error), ...failure });
    }
  };

  return {
    connect(address: string, connect: boolean) {
      const token = crypto.randomUUID();
      dispatch({ type: "airpods-connect-started", address, token });
      window.setTimeout(
        () => dispatch({ type: "airpods-connect-timeout", address, token }),
        connectResultTimeoutMs,
      );
      void send({ command: "bt_airpods_connect", address, connect }, { connect: true, address });
    },
    setManaged(enabled: boolean) {
      void send({ command: "bt_airpods_enable", enabled });
    },
    setMode(mode: NonNullable<AirPodsEvent["anc"]>) {
      void send({ command: "bt_airpods_mode", mode });
    },
    setPause(mode: NonNullable<BluetoothStatusEvent["airpods_pause"]>) {
      void send({ command: "bt_airpods_pause", mode });
    },
    setHandoff(enabled: boolean) {
      void send({ command: "bt_airpods_handoff", enabled });
    },
  };
}

export type AirPodsActions = ReturnType<typeof useAirPodsCommands>;
