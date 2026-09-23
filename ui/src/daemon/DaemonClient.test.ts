import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonCommandTimeoutError, sendDaemonCommand } from "./DaemonClient";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
