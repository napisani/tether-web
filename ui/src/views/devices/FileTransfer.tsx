import { useRef, useState, type DragEvent } from "react";
import type { FileTransferActions } from "./useFileTransfer";
import { maxUploadBytes } from "./useFileTransfer";

export function FileTransfer({
  available,
  actions,
}: {
  available: boolean;
  actions: FileTransferActions;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = actions.state.status === "uploading" || actions.state.status === "sending";
  const cancellable = actions.state.status === "uploading";

  const progress =
    actions.state.totalBytes > 0
      ? Math.round((actions.state.sentBytes / actions.state.totalBytes) * 100)
      : busy
        ? 0
        : 100;

  const choose = (files: File[], skipped = 0) => {
    setDragging(false);

    if (available) actions.sendFiles(files, skipped);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const { files, skipped } = droppedFiles(event.dataTransfer);
    choose(files, skipped);
  };

  return (
    <section className="status-section file-transfer" aria-labelledby="send-file-title">
      <div className="section-heading">
        <h3 id="send-file-title">Send files</h3>
        <span>Up to {maxUploadBytes / 1024 / 1024} MiB</span>
      </div>
      <div
        className={`file-drop-zone ${dragging ? "dragging" : ""} ${!available ? "disabled" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();

          if (available) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;

          if (!event.currentTarget.contains(relatedTarget)) setDragging(false);
        }}
        onDrop={drop}
      >
        <input
          ref={inputRef}
          type="file"
          aria-label="Choose files to send"
          multiple
          disabled={!available}
          onChange={(event) => {
            choose(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
        <p>{dragging ? "Drop to send" : "Drop files here, or choose them from this device."}</p>
        <button
          className="secondary-button"
          type="button"
          disabled={!available}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </button>
      </div>

      <BatchProgress actions={actions} />
      {actions.state.status !== "idle" ? (
        <div className="file-transfer-status" aria-live="polite">
          <div className="file-transfer-summary">
            <span>{actions.state.filename}</span>
            <span>{busy ? `${progress}%` : transferLabel(actions.state.status)}</span>
          </div>
          {busy ? (
            <progress
              aria-label={`Sending ${actions.state.filename || "file"}`}
              max="100"
              value={progress}
            >
              {progress}%
            </progress>
          ) : null}
          {actions.state.message ? (
            <p className={actions.state.status === "error" ? "error-text" : ""}>
              {actions.state.message}
            </p>
          ) : null}
          {cancellable && !actions.batch.active ? (
            <button className="text-button" type="button" onClick={actions.cancel}>
              Cancel transfer
            </button>
          ) : null}
        </div>
      ) : null}
      {!available ? (
        <p className="route-detail">This tetherd version does not support browser file uploads.</p>
      ) : null}
    </section>
  );
}

function droppedFiles(data: DataTransfer) {
  const items = Array.from(data.items);

  if (!items.length) return { files: Array.from(data.files), skipped: 0 };

  const files: File[] = [];
  let skipped = 0;

  for (const item of items) {
    const file =
      item.kind === "file" && !item.webkitGetAsEntry?.()?.isDirectory ? item.getAsFile() : null;

    if (file) files.push(file);
    else skipped++;
  }

  return { files, skipped };
}

function BatchProgress({ actions }: { actions: FileTransferActions }) {
  const { batch } = actions;

  if (!batch.total && !batch.skipped) return null;

  return (
    <div className="file-batch-status" role="status" aria-live="polite">
      <p>
        {batch.active
          ? `File ${batch.completed + 1} of ${batch.total}: ` +
            (actions.state.filename || "Preparing…")
          : batch.message}
      </p>
      <p>
        {batch.sent} sent · {batch.failed} failed · {batch.skipped} skipped · {batch.pending} queued
      </p>
      {batch.active ? (
        <button className="text-button" type="button" onClick={actions.cancelBatch}>
          Cancel batch
        </button>
      ) : null}
    </div>
  );
}

function transferLabel(status: FileTransferActions["state"]["status"]): string {
  switch (status) {
    case "complete":
      return "Sent";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Failed";
    default:
      return "";
  }
}
