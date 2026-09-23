import { useRef, useState, type DragEvent } from "react";
import type { FileTransferActions } from "./useFileTransfer";
import { maxUploadBytes } from "./useFileTransfer";

export function FileTransfer({ available, actions }: { available: boolean; actions: FileTransferActions }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = actions.state.status === "uploading" || actions.state.status === "sending";
  const cancellable = actions.state.status === "uploading";
  const progress = actions.state.totalBytes > 0
    ? Math.round((actions.state.sentBytes / actions.state.totalBytes) * 100)
    : busy ? 0 : 100;

  const choose = (file?: File) => {
    setDragging(false);
    if (file && available && !busy) void actions.sendFile(file);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    choose(event.dataTransfer.files[0]);
  };

  return (
    <section className="status-section file-transfer" aria-labelledby="send-file-title">
      <div className="section-heading">
        <h3 id="send-file-title">Send a file</h3>
        <span>Up to {maxUploadBytes / 1024 / 1024} MiB</span>
      </div>
      <div
        className={`file-drop-zone ${dragging ? "dragging" : ""} ${!available || busy ? "disabled" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={drop}
      >
        <input
          ref={inputRef}
          type="file"
          aria-label="Choose a file to send"
          disabled={!available || busy}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <p>{dragging ? "Drop to send" : "Drop a file here, or choose one from this device."}</p>
        <button
          className="secondary-button"
          type="button"
          disabled={!available || busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </button>
      </div>

      {actions.state.status !== "idle" ? (
        <div className="file-transfer-status" aria-live="polite">
          <div className="file-transfer-summary">
            <span>{actions.state.filename}</span>
            <span>{busy ? `${progress}%` : transferLabel(actions.state.status)}</span>
          </div>
          {busy ? <progress aria-label={`Sending ${actions.state.filename || "file"}`} max="100" value={progress}>{progress}%</progress> : null}
          {actions.state.message ? <p className={actions.state.status === "error" ? "error-text" : ""}>{actions.state.message}</p> : null}
          {cancellable ? <button className="text-button" type="button" onClick={actions.cancel}>Cancel transfer</button> : null}
        </div>
      ) : null}
      {!available ? <p className="route-detail">This tetherd version does not support browser file uploads.</p> : null}
    </section>
  );
}

function transferLabel(status: FileTransferActions["state"]["status"]): string {
  switch (status) {
    case "complete": return "Sent";
    case "cancelled": return "Cancelled";
    case "error": return "Failed";
    default: return "";
  }
}
