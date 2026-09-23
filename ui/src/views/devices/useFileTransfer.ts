import { useCallback, useEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { DaemonEvent } from "../../protocol";

const chunkBytes = 48 * 1024;
const sendResultTimeoutMs = 60_000;
export const maxUploadBytes = 256 * 1024 * 1024;

type TransferStatus = "idle" | "uploading" | "sending" | "complete" | "cancelled" | "error";

export type FileTransferState = {
  operationId?: string;
  filename?: string;
  sentBytes: number;
  totalBytes: number;
  status: TransferStatus;
  message?: string;
};

export type FileTransferActions = {
  state: FileTransferState;
  sendFile: (file: File) => Promise<void>;
  cancel: () => void;
  handleEvent: (event: DaemonEvent) => void;
  handleDisconnect: () => void;
};

const idleTransfer: FileTransferState = {
  sentBytes: 0,
  totalBytes: 0,
  status: "idle",
};

export function useFileTransfer(): FileTransferActions {
  const [state, setState] = useState<FileTransferState>(idleTransfer);
  const operationRef = useRef<string | undefined>(undefined);
  const cancellableOperations = useRef(new Set<string>());
  const stoppedOperations = useRef(new Set<string>());
  const sendTimeout = useRef<number | undefined>(undefined);

  const fail = useCallback((operationId: string, message: string) => {
    stoppedOperations.current.add(operationId);
    cancellableOperations.current.delete(operationId);
    if (sendTimeout.current !== undefined) window.clearTimeout(sendTimeout.current);
    sendTimeout.current = undefined;
    if (operationRef.current === operationId) operationRef.current = undefined;
    setState((current) => current.operationId === operationId
      ? { ...current, status: "error", message }
      : current);
  }, []);

  const handleEvent = useCallback((event: DaemonEvent) => {
    if (event.command !== "file_upload_started" && event.command !== "file_send_complete") return;
    if (!event.operation_id || event.operation_id !== operationRef.current) return;
    if (!event.success) {
      fail(event.operation_id, event.message || "The file could not be sent.");
      return;
    }
    if (event.command === "file_upload_started") {
      setState((current) => current.operationId === event.operation_id && current.status === "uploading"
        ? { ...current, message: undefined }
        : current);
      return;
    }
    stoppedOperations.current.delete(event.operation_id);
    cancellableOperations.current.delete(event.operation_id);
    if (sendTimeout.current !== undefined) window.clearTimeout(sendTimeout.current);
    sendTimeout.current = undefined;
    operationRef.current = undefined;
    setState((current) => current.operationId === event.operation_id
      ? { ...current, sentBytes: current.totalBytes, status: "complete", message: event.message }
      : current);
  }, [fail]);

  const cancel = useCallback(() => {
    const operationId = operationRef.current;
    if (!operationId || !cancellableOperations.current.has(operationId)) return;
    stoppedOperations.current.add(operationId);
    cancellableOperations.current.delete(operationId);
    operationRef.current = undefined;
    setState((current) => current.operationId === operationId
      ? { ...current, status: "cancelled", message: "File transfer cancelled." }
      : current);
    void sendDaemonCommand({ command: "file_upload_cancel", operation_id: operationId });
  }, []);

  const sendFile = useCallback(async (file: File) => {
    if (operationRef.current) return;
    if (file.size > maxUploadBytes) {
      setState({
        filename: file.name,
        sentBytes: 0,
        totalBytes: file.size,
        status: "error",
        message: "Choose a file no larger than 256 MiB.",
      });
      return;
    }

    const operationId = crypto.randomUUID();
    operationRef.current = operationId;
    cancellableOperations.current.add(operationId);
    stoppedOperations.current.delete(operationId);
    setState({ operationId, filename: file.name, sentBytes: 0, totalBytes: file.size, status: "uploading" });

    try {
      await sendDaemonCommand({
        command: "file_upload_start",
        operation_id: operationId,
        filename: file.name,
        size: file.size,
      });
      for (let offset = 0, chunkIndex = 0; offset < file.size; offset += chunkBytes, chunkIndex += 1) {
        if (stoppedOperations.current.has(operationId)) return;
        const end = Math.min(offset + chunkBytes, file.size);
        const data = encodeBase64(await readBlob(file.slice(offset, end)));
        await sendDaemonCommand({
          command: "file_upload_chunk",
          operation_id: operationId,
          chunk_index: chunkIndex,
          data,
        });
        setState((current) => current.operationId === operationId
          ? { ...current, sentBytes: end }
          : current);
      }
      if (stoppedOperations.current.has(operationId)) return;
      cancellableOperations.current.delete(operationId);
      setState((current) => current.operationId === operationId
        ? { ...current, status: "sending", message: "Waiting for the other device…" }
        : current);
      sendTimeout.current = window.setTimeout(() => {
        fail(operationId, "Timed out waiting for the file-send result.");
        void sendDaemonCommand({ command: "file_upload_cancel", operation_id: operationId });
      }, sendResultTimeoutMs);
      await sendDaemonCommand({ command: "file_upload_finish", operation_id: operationId });
    } catch (error) {
      if (stoppedOperations.current.has(operationId)) return;
      if (!cancellableOperations.current.has(operationId)) {
        setState((current) => current.operationId === operationId
          ? { ...current, message: "The finish request was interrupted; waiting for tetherd’s result…" }
          : current);
        return;
      }
      const message = error instanceof Error ? error.message : "The file upload failed.";
      fail(operationId, message);
      void sendDaemonCommand({ command: "file_upload_cancel", operation_id: operationId });
    }
  }, [fail]);

  const handleDisconnect = useCallback(() => {
    const operationId = operationRef.current;
    if (!operationId) return;
    if (!cancellableOperations.current.has(operationId)) {
      setState((current) => current.operationId === operationId
        ? { ...current, message: "Reconnecting while the other device receives the file…" }
        : current);
      return;
    }
    stoppedOperations.current.add(operationId);
    cancellableOperations.current.delete(operationId);
    operationRef.current = undefined;
    setState((current) => current.operationId === operationId
      ? { ...current, status: "error", message: "The connection to tetherd was lost." }
      : current);
    void sendDaemonCommand({ command: "file_upload_cancel", operation_id: operationId });
  }, []);

  useEffect(() => () => {
    const operationId = operationRef.current;
    if (operationId && cancellableOperations.current.has(operationId)) {
      stoppedOperations.current.add(operationId);
      cancellableOperations.current.delete(operationId);
      operationRef.current = undefined;
      void sendDaemonCommand({ command: "file_upload_cancel", operation_id: operationId });
    }
    if (sendTimeout.current !== undefined) window.clearTimeout(sendTimeout.current);
  }, []);

  return { state, sendFile, cancel, handleEvent, handleDisconnect };
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

export function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
