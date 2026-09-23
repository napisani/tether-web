import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonCommandTimeoutError, parseDaemonEvent, sendDaemonCommand } from "./DaemonClient";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseDaemonEvent", () => {
  it("rejects malformed peer lifecycle and discovery events", () => {
    expect(parseDaemonEvent(JSON.stringify({ command: "pair_accepted", connected: true }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "discovery_result", devices: [{ name: "Phone" }] }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "discovery_result",
      devices: [{ name: "Phone", fingerprint: "peer", addresses: [{ address: "10.0.0.2", port: 70_000 }] }],
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "state_snapshot",
      paired_devices: [],
      pending_pairs: [],
      connected_clients: [],
      discovered_devices: [],
      mdns_available: true,
      clipboard_available: true,
    }))).toBeUndefined();
  });

  it("rejects malformed file-transfer result events", () => {
    expect(parseDaemonEvent(JSON.stringify({ command: "file_send_complete", success: true }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "file_upload_started",
      operation_id: "upload-1",
      success: "yes",
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "file_send_complete",
      operation_id: "upload-1",
      success: true,
      filename: "notes.txt",
    }))).toMatchObject({ command: "file_send_complete", operation_id: "upload-1" });
  });

  it("accepts complete peer lifecycle events, including pre-TLS rejection", () => {
    expect(parseDaemonEvent(JSON.stringify({
      command: "pair_accepted",
      fingerprint: "peer-1",
      connected: true,
    }))).toMatchObject({ command: "pair_accepted", fingerprint: "peer-1" });
    expect(parseDaemonEvent(JSON.stringify({
      command: "pair_rejected",
      fingerprint: "",
      device_name: "Nearby phone",
      address: "10.0.0.2",
      reason: "unreachable",
    }))).toMatchObject({ command: "pair_rejected", reason: "unreachable" });
  });
});

describe("sendDaemonCommand", () => {
  it("aborts a stalled command and reports a timeout", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      ),
    );

    const command = sendDaemonCommand({ command: "bt_scan" });
    controller.abort();

    await expect(command).rejects.toBeInstanceOf(DaemonCommandTimeoutError);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/commands",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
