import { useCallback, useEffect, type Dispatch } from "react";
import { DaemonCommandTimeoutError, sendDaemonCommand } from "../../daemon/DaemonClient";
import type { DevicesAction, PairingState } from "./devicesState";

const settingTimeoutMs = 15_000;

const solicitationTimeoutMs = 60_000;

const pairResultTimeoutMs = 5 * 60_000;

const unpairResultTimeoutMs = 30_000;

export function useBluetoothCommands(pairing: PairingState, dispatch: Dispatch<DevicesAction>) {
  const operationId = pairing.operationId;
  useEffect(() => {
    const active = pairing.phase === "pairing" || pairing.phase === "confirming";

    if (!active || !operationId) return;
    const timeout = pairing.kind === "unpair" ? unpairResultTimeoutMs : pairResultTimeoutMs;

    const timer = window.setTimeout(
      () =>
        dispatch({
          type: "operation-failed",
          operationId,
          message:
            pairing.kind === "unpair"
              ? "Timed out waiting for tetherd to remove the Bluetooth pairing."
              : "Timed out waiting for tetherd to finish Bluetooth pairing.",
        }),
      timeout,
    );

    return () => window.clearTimeout(timer);
  }, [dispatch, operationId, pairing.kind, pairing.phase]);

  const scan = useCallback(() => {
    dispatch({ type: "scan-started" });
    void sendDaemonCommand({ command: "bt_scan" }).catch((error: unknown) =>
      dispatch({
        type: "scan-failed",
        message: commandFailureMessage(
          error,
          "Bluetooth scanning timed out.",
          "Could not ask tetherd to scan.",
        ),
      }),
    );
  }, [dispatch]);

  const pair = useCallback(
    (address: string) => {
      const nextOperationId = crypto.randomUUID();
      dispatch({ type: "pair-started", operationId: nextOperationId, address });
      void sendDaemonCommand({ command: "bt_pair", address, operation_id: nextOperationId }).catch(
        (error: unknown) =>
          dispatch({
            type: "operation-failed",
            operationId: nextOperationId,
            message: commandFailureMessage(
              error,
              "Bluetooth pairing timed out.",
              "Could not start Bluetooth pairing.",
            ),
          }),
      );
    },
    [dispatch],
  );

  const unpair = useCallback(
    (address: string) => {
      const nextOperationId = crypto.randomUUID();
      dispatch({ type: "unpair-started", operationId: nextOperationId, address });
      void sendDaemonCommand({
        command: "bt_unpair",
        address,
        operation_id: nextOperationId,
      }).catch((error: unknown) =>
        dispatch({
          type: "operation-failed",
          operationId: nextOperationId,
          message: commandFailureMessage(
            error,
            "Removing the Bluetooth pairing timed out.",
            "Could not remove the Bluetooth pairing.",
          ),
        }),
      );
    },
    [dispatch],
  );

  const confirmPairing = useCallback(
    (accept: boolean) => {
      if (!operationId) return;
      dispatch({ type: "pair-confirmation-sent", operationId });
      void sendDaemonCommand({
        command: "bt_pair_confirm",
        operation_id: operationId,
        accept,
      }).catch((error: unknown) =>
        dispatch({
          type: "operation-failed",
          operationId,
          message: commandFailureMessage(
            error,
            "Sending the pairing confirmation timed out.",
            "Could not send the pairing confirmation.",
          ),
        }),
      );
    },
    [dispatch, operationId],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      const token = crypto.randomUUID();
      dispatch({ type: "bluetooth-enabled-started", enabled, token });
      window.setTimeout(
        () => dispatch({ type: "bluetooth-enabled-timeout", token }),
        settingTimeoutMs,
      );
      void sendDaemonCommand({ command: "bt_set_enabled", enabled }).catch((error: unknown) =>
        dispatch({
          type: "bluetooth-enabled-failed",
          token,
          message: commandFailureMessage(
            error,
            "Updating the Bluetooth preference timed out.",
            "Could not update the Bluetooth preference.",
          ),
        }),
      );
    },
    [dispatch],
  );

  const solicitPermissions = useCallback(() => {
    const token = crypto.randomUUID();
    dispatch({ type: "bluetooth-solicit-started", token });
    window.setTimeout(
      () => dispatch({ type: "bluetooth-solicit-timeout", token }),
      solicitationTimeoutMs,
    );
    void sendDaemonCommand({ command: "bt_solicit" }).catch((error: unknown) =>
      dispatch({
        type: "bluetooth-solicit-failed",
        token,
        message: commandFailureMessage(
          error,
          "Asking the iPhone for permissions timed out.",
          "Could not ask the iPhone for permissions.",
        ),
      }),
    );
  }, [dispatch]);

  const resetPairing = useCallback(() => dispatch({ type: "pair-reset" }), [dispatch]);

  return { scan, pair, unpair, confirmPairing, setEnabled, solicitPermissions, resetPairing };
}

export type BluetoothActions = ReturnType<typeof useBluetoothCommands>;

function commandFailureMessage(error: unknown, timeoutMessage: string, fallback: string): string {
  return error instanceof DaemonCommandTimeoutError ? timeoutMessage : fallback;
}
