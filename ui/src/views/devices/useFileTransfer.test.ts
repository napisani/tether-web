import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daemonCommandSchema } from "../../protocolSchemas";
import { requestBody } from "../../test-helpers";
import { maxUploadBytes, useFileTransfer } from "./useFileTransfer";

const operationId = "11111111-1111-4111-8111-111111111111";

function parseCommandBody(body: string) {
  return daemonCommandSchema.parse(JSON.parse(body));
}

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(operationId);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser file transfer", () => {
  it("uploads a file as ordered bounded commands", async () => {
    const { result } = renderHook(() => useFileTransfer());
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    await act(async () => result.current.sendFile(file));

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const commands = fetchMock.mock.calls.map(([, init]) => parseCommandBody(requestBody(init)));
    expect(commands).toEqual([
      { command: "file_upload_start", operation_id: operationId, filename: "notes.txt", size: 5 },
      { command: "file_upload_chunk", operation_id: operationId, chunk_index: 0, data: "aGVsbG8=" },
      { command: "file_upload_finish", operation_id: operationId },
    ]);
    expect(result.current.state).toMatchObject({
      filename: "notes.txt",
      sentBytes: 5,
      status: "sending",
    });
  });

  it("keeps every raw chunk within 48 KiB and preserves order", async () => {
    const { result } = renderHook(() => useFileTransfer());
    const bytes = new Uint8Array(48 * 1024 + 17).fill(7);

    await act(async () => result.current.sendFile(new File([bytes], "large.bin")));

    const commands = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => parseCommandBody(requestBody(init)));

    const chunks = commands.filter((command) => command.command === "file_upload_chunk");
    expect(chunks.map((chunk) => chunk.chunk_index)).toEqual([0, 1]);
    expect(chunks.map((chunk) => atob(String(chunk.data)).length)).toEqual([48 * 1024, 17]);
  });

  it("rejects an oversized file before sending a command", async () => {
    const { result } = renderHook(() => useFileTransfer());
    const file = { name: "too-large.bin", size: maxUploadBytes + 1 } as File;

    await act(async () => result.current.sendFile(file));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      message: "Choose a file no larger than 256 MiB.",
    });
  });

  it("only applies completion events owned by the active upload", async () => {
    const { result } = renderHook(() => useFileTransfer());
    await act(async () => result.current.sendFile(new File(["ok"], "ok.txt")));

    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: "another-upload",
        success: true,
      }),
    );
    expect(result.current.state.status).toBe("sending");

    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: operationId,
        filename: "ok.txt",
        success: true,
        message: "File sent.",
      }),
    );
    expect(result.current.state).toMatchObject({ status: "complete", message: "File sent." });
  });

  it("best-effort cancels an unfinished upload when tetherd disconnects", async () => {
    let resolveStart: ((response: Response) => void) | undefined;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStart = resolve;
          }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));

    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFileTransfer());
    let transfer: Promise<void> | undefined;
    act(() => {
      transfer = result.current.sendFile(new File(["ok"], "ok.txt"));
    });

    act(() => result.current.handleDisconnect());

    expect(parseCommandBody(requestBody(fetchMock.mock.calls[1]?.[1]))).toEqual({
      command: "file_upload_cancel",
      operation_id: operationId,
    });
    expect(result.current.state).toMatchObject({
      status: "error",
      message: "The connection to tetherd was lost.",
    });
    resolveStart?.(new Response(null, { status: 202 }));
    await act(async () => transfer);
  });

  it("cancels and stops an unfinished upload when its view unmounts", async () => {
    let resolveStart: ((response: Response) => void) | undefined;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStart = resolve;
          }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));

    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useFileTransfer());
    let transfer: Promise<void> | undefined;
    act(() => {
      transfer = result.current.sendFile(new File(["ok"], "ok.txt"));
    });

    unmount();

    expect(parseCommandBody(requestBody(fetchMock.mock.calls[1]?.[1]))).toEqual({
      command: "file_upload_cancel",
      operation_id: operationId,
    });
    resolveStart?.(new Response(null, { status: 202 }));
    await act(async () => transfer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous finish non-cancellable", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockRejectedValueOnce(new Error("connection reset"));

    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFileTransfer());

    await act(async () => result.current.sendFile(new File(["ok"], "ok.txt")));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.state).toMatchObject({
      status: "sending",
      message: "The finish request was interrupted; waiting for tetherd’s result…",
    });
    act(() => result.current.cancel());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("releases the operation promptly when finish was definitely not forwarded", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response("upload is incomplete", {
          status: 409,
          headers: { "X-Tether-Upload-Outcome": "not-forwarded" },
        }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));

    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFileTransfer());

    await act(async () => result.current.sendFile(new File([], "empty.txt")));

    expect(result.current.state).toMatchObject({ status: "error", message: "command failed: 409" });
    expect(
      fetchMock.mock.calls.map(([, init]) => parseCommandBody(requestBody(init)).command),
    ).toEqual(["file_upload_start", "file_upload_finish", "file_upload_cancel"]);
    await act(async () => result.current.sendFile(new File([], "next.txt")));
    expect(result.current.state).toMatchObject({ filename: "next.txt", status: "sending" });
  });

  it("continues a batch after a definitely rejected finish", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(operationId)
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 202 }))
        .mockResolvedValueOnce(
          new Response(null, {
            status: 409,
            headers: { "X-Tether-Upload-Outcome": "not-forwarded" },
          }),
        )
        .mockResolvedValue(new Response(null, { status: 202 })),
    );
    const { result } = renderHook(() => useFileTransfer());
    act(() => result.current.sendFiles([new File([], "first.txt"), new File([], "second.txt")]));

    await waitFor(() =>
      expect(result.current.state).toMatchObject({ filename: "second.txt", status: "sending" }),
    );
    expect(result.current.batch).toMatchObject({ total: 2, completed: 1, failed: 1, active: true });
    expect(
      vi.mocked(fetch).mock.calls.map(([, init]) => parseCommandBody(requestBody(init)).command),
    ).toEqual([
      "file_upload_start",
      "file_upload_finish",
      "file_upload_cancel",
      "file_upload_start",
      "file_upload_finish",
    ]);
  });

  it("keeps a terminal result when it arrives before the finish HTTP response", async () => {
    let resolveFinish: ((response: Response) => void) | undefined;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFinish = resolve;
          }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useFileTransfer());
    let transfer: Promise<void> | undefined;

    act(() => {
      transfer = result.current.sendFile(new File([], "empty.txt"));
    });
    await waitFor(() => expect(result.current.state.status).toBe("sending"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: operationId,
        success: true,
        message: "File sent.",
      }),
    );
    resolveFinish?.(new Response(null, { status: 503 }));
    await act(async () => transfer);

    expect(result.current.state).toMatchObject({ status: "complete", message: "File sent." });
  });

  it("keeps waiting for an owned send result through an event-stream reconnect", async () => {
    const { result } = renderHook(() => useFileTransfer());
    await act(async () => result.current.sendFile(new File(["ok"], "ok.txt")));
    const callsBeforeDisconnect = vi.mocked(fetch).mock.calls.length;

    act(() => result.current.handleDisconnect());

    expect(fetch).toHaveBeenCalledTimes(callsBeforeDisconnect);
    expect(result.current.state).toMatchObject({
      status: "sending",
      message: "Reconnecting while the other device receives the file…",
    });
  });

  it("bounds the wait for a missing send result", async () => {
    vi.useFakeTimers();

    try {
      const { result } = renderHook(() => useFileTransfer());
      await act(async () => result.current.sendFile(new File([], "empty.txt")));

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(result.current.state).toMatchObject({
        status: "sending",
        message: "Timed out waiting for the file-send result. The send may still be in progress.",
      });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks the batch and new selections after an uncertain timeout", async () => {
    vi.useFakeTimers();

    try {
      const { result } = renderHook(() => useFileTransfer());
      act(() => result.current.sendFiles([new File([], "first.txt"), new File([], "second.txt")]));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.state.status).toBe("sending");
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(result.current.batch).toMatchObject({ active: false, completed: 0, pending: 0 });
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([, init]) => parseCommandBody(requestBody(init)).command === "file_upload_start",
          ),
      ).toHaveLength(1);

      act(() => result.current.sendFiles([new File([], "third.txt")]));
      expect(result.current.state.message).toContain("Wait for the current send");
      act(() =>
        result.current.handleEvent({
          command: "file_send_complete",
          operation_id: operationId,
          success: true,
        }),
      );
      expect(result.current.batch).toMatchObject({ completed: 1, sent: 1, active: false });
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([, init]) => parseCommandBody(requestBody(init)).command === "file_upload_start",
          ),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues files and reports failures and skipped items", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(operationId)
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const { result } = renderHook(() => useFileTransfer());

    act(() => result.current.sendFiles([new File(["a"], "a.txt"), new File(["b"], "b.txt")], 1));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ filename: "a.txt", status: "sending" }),
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([, init]) => parseCommandBody(requestBody(init)).command === "file_upload_start",
        ),
    ).toHaveLength(1);

    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: operationId,
        success: false,
        message: "Peer rejected file.",
      }),
    );
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ filename: "b.txt", status: "sending" }),
    );
    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: "22222222-2222-4222-8222-222222222222",
        success: true,
      }),
    );

    expect(result.current.batch).toMatchObject({
      total: 2,
      completed: 2,
      sent: 1,
      failed: 1,
      skipped: 1,
      active: false,
    });
    expect(result.current.batch.message).toContain(
      "Sent 1 of 2 files. 1 failed. Skipped 1 non-file item.",
    );
  });

  it("continues past an oversized item and reports the failure", async () => {
    const oversized = { name: "oversized.bin", size: maxUploadBytes + 1 } as File;
    const { result } = renderHook(() => useFileTransfer());
    act(() => result.current.sendFiles([oversized, new File(["ok"], "ok.txt")]));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ filename: "ok.txt", status: "sending" }),
    );
    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: operationId,
        success: true,
      }),
    );
    expect(result.current.batch).toMatchObject({ sent: 1, failed: 1, completed: 2, active: false });
  });

  it("cancels the active upload and drops remaining queued files", async () => {
    const { result } = renderHook(() => useFileTransfer());
    act(() => result.current.sendFiles([new File(["a"], "a.txt"), new File(["b"], "b.txt")]));
    await waitFor(() => expect(result.current.state.filename).toBe("a.txt"));
    act(() => result.current.cancelBatch());
    expect(result.current.batch).toMatchObject({ active: false, pending: 0 });
    expect(result.current.batch.message).toContain("1 queued files dropped");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([, init]) => parseCommandBody(requestBody(init)).command === "file_upload_start",
        ),
    ).toHaveLength(1);
  });

  it("cancelling after finish keeps the accepted file but drops queued items", async () => {
    const { result } = renderHook(() => useFileTransfer());
    act(() => result.current.sendFiles([new File(["a"], "a.txt"), new File(["b"], "b.txt")]));
    await waitFor(() => expect(result.current.state.status).toBe("sending"));
    const calls = vi.mocked(fetch).mock.calls.length;
    act(() => result.current.cancelBatch());
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(result.current.batch.message).toContain("1 queued files dropped");
    act(() => result.current.sendFiles([new File(["c"], "c.txt")]));
    expect(result.current.state.message).toContain("Wait for the current send");
    expect(fetch).toHaveBeenCalledTimes(calls);
    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: operationId,
        success: true,
      }),
    );
    expect(result.current.batch.sent).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it("drops queued files on disconnect while preserving an accepted send", async () => {
    const { result } = renderHook(() => useFileTransfer());
    act(() => result.current.sendFiles([new File(["a"], "a.txt"), new File(["b"], "b.txt")]));
    await waitFor(() => expect(result.current.state.status).toBe("sending"));
    act(() => result.current.handleDisconnect());
    expect(result.current.batch).toMatchObject({ active: false, pending: 0 });
    act(() =>
      result.current.handleEvent({
        command: "file_send_complete",
        operation_id: operationId,
        success: true,
      }),
    );
    expect(result.current.batch.sent).toBe(1);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([, init]) => parseCommandBody(requestBody(init)).command === "file_upload_start",
        ),
    ).toHaveLength(1);
  });

  it("stops an upload when gateway staging rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValue(new Response(null, { status: 202 })),
    );
    const { result } = renderHook(() => useFileTransfer());
    await act(async () => result.current.sendFile(new File(["ok"], "ok.txt")));

    expect(result.current.state).toMatchObject({ status: "error", message: "command failed: 429" });
    expect(fetch).toHaveBeenCalledTimes(2); // start and best-effort cancel
  });
});
