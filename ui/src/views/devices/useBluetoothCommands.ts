import { useCallback, type Dispatch } from "react";
import { DaemonCommandTimeoutError, sendDaemonCommand } from "../../daemon/DaemonClient";
import type { DevicesAction } from "./devicesState";

export function useBluetoothCommands(operationId: string | undefined, dispatch: Dispatch<DevicesAction>) {
  const scan = useCallback(() => {
    dispatch({ type: "scan-started" });
    void sendDaemonCommand({ command: "bt_scan" }).catch((error: unknown) =>
      dispatch({
        type: "scan-failed",
        message: commandFailureMessage(error, "Bluetooth scanning timed out.", "Could not ask tetherd to scan."),
      }),
    );
  }, [dispatch]);

  const pair = useCallback((address: string) => {
    const nextOperationId = crypto.randomUUID();
    dispatch({ type: "pair-started", operationId: nextOperationId, address });
    void sendDaemonCommand({ command: "bt_pair", address, operation_id: nextOperationId }).catch((error: unknown) =>
      dispatch({
        type: "operation-failed",
        message: commandFailureMessage(error, "Bluetooth pairing timed out.", "Could not start Bluetooth pairing."),
      }),
    );
  }, [dispatch]);

  const unpair = useCallback((address: string) => {
    const nextOperationId = crypto.randomUUID();
    dispatch({ type: "unpair-started", operationId: nextOperationId, address });
    void sendDaemonCommand({ command: "bt_unpair", address, operation_id: nextOperationId }).catch((error: unknown) =>
      dispatch({
        type: "operation-failed",
        message: commandFailureMessage(error, "Removing the Bluetooth pairing timed out.", "Could not remove the Bluetooth pairing."),
      }),
    );
  }, [dispatch]);

  const confirmPairing = useCallback((accept: boolean) => {
    if (!operationId) return;
    dispatch({ type: "pair-confirmation-sent" });
    void sendDaemonCommand({
      command: "bt_pair_confirm",
      operation_id: operationId,
      accept,
    }).catch((error: unknown) =>
      dispatch({
        type: "operation-failed",
        message: commandFailureMessage(
          error,
          "Sending the pairing confirmation timed out.",
          "Could not send the pairing confirmation.",
        ),
      }),
    );
  }, [dispatch, operationId]);

  const resetPairing = useCallback(() => dispatch({ type: "pair-reset" }), [dispatch]);

  return { scan, pair, unpair, confirmPairing, resetPairing };
}

function commandFailureMessage(error: unknown, timeoutMessage: string, fallback: string): string {
  return error instanceof DaemonCommandTimeoutError ? timeoutMessage : fallback;
}
