import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonCommandTimeoutError, parseDaemonEvent, sendDaemonCommand } from "./DaemonClient";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseDaemonEvent", () => {
  it("validates protocol capabilities before exposing them to the UI", () => {
    expect(parseDaemonEvent(JSON.stringify({ command: "protocol_info", version: 1, capabilities: null }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "protocol_info", version: 0, capabilities: [] }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "protocol_info",
      version: 1,
      capabilities: ["bluetooth.pairing"],
    }))).toMatchObject({ command: "protocol_info", version: 1 });
  });

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

  it("validates Bluetooth status, diagnostics, and solicitation results", () => {
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_status", available: "yes" }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_status", available: true, enabled: "yes" }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_status", available: true, ancs_enabled: 1 }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_status",
      available: true,
      capability: { mode: "compatibility", reasons: [], setup: [{ what: "Enable support", command: 42 }] },
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_connection_changed",
      map_open: true,
      map_error: false,
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_solicit_result", success: true }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_pair_result",
      operation_id: "pair-1",
      success: "yes",
      status: "paired",
      message: "Paired.",
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_pair_confirm_request",
      operation_id: "pair-1",
      code: 42731,
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_pair_confirm_request",
      operation_id: "pair-1",
      code: "confirm me",
    }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_status",
      available: true,
      enabled: false,
      ancs_enabled: true,
      capability: {
        mode: "compatibility",
        reasons: ["LE support is unavailable."],
        setup: [{ what: "Enable support", command: "sudo systemctl restart bluetooth" }],
      },
    }))).toMatchObject({
      command: "bt_status",
      available: true,
      enabled: false,
      ancs_enabled: true,
    });
    expect(parseDaemonEvent(JSON.stringify({
      command: "bt_pair_confirm_request",
      operation_id: "pair-1",
      code: "042731",
    }))).toMatchObject({ command: "bt_pair_confirm_request", operation_id: "pair-1" });
  });

  it("rejects malformed file-transfer result events", () => {
    expect(parseDaemonEvent(JSON.stringify({ command: "file_send_complete", success: true }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({
      command: "file_send_complete",
      operation_id: "upload-1",
      success: true,
      filename: "notes.txt",
    }))).toMatchObject({ command: "file_send_complete", operation_id: "upload-1" });
  });

  it("validates Messages payloads before rendering them", () => {
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_threads", threads: [{ name: "Missing key" }] }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_messages", thread: "tel:+15550102", messages: [{ body: "Hi" }] }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_send_result", thread: "tel:+15550102", success: "yes" }))).toBeUndefined();
    expect(parseDaemonEvent(JSON.stringify({ command: "bt_send_result", thread: "tel:+15550102", success: true, operation_id: "send-1" })))
      .toMatchObject({ command: "bt_send_result", operation_id: "send-1" });
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
