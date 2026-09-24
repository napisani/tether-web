import { useEffect } from "react";
import type { DaemonCommand, DaemonEvent } from "../protocol";
import { daemonCommandSchema, daemonEventSchema } from "../protocolSchemas";

const commandTimeoutMs = 10_000;

export class DaemonCommandTimeoutError extends Error {
  constructor() {
    super("tetherd command timed out");
    this.name = "DaemonCommandTimeoutError";
  }
}

export type DaemonClientHandlers = {
  onConnectionChange: (connected: boolean) => void;
  onEvent: (event: DaemonEvent) => void;
};

export function useDaemonClient({ onConnectionChange, onEvent }: DaemonClientHandlers) {
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    events.onerror = () => onConnectionChange(false);
    events.onmessage = (message) => {
      const event = parseDaemonEvent(message.data);

      if (event) onEvent(event);
    };

    return () => events.close();
  }, [onConnectionChange, onEvent]);
}

export function parseDaemonEvent(data: string): DaemonEvent | undefined {
  try {
    const parsed = daemonEventSchema.safeParse(JSON.parse(data));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function sendDaemonCommand(command: DaemonCommand) {
  const parsed = daemonCommandSchema.safeParse(command);

  if (!parsed.success) throw new Error("invalid tetherd command");

  const signal = AbortSignal.timeout(commandTimeoutMs);
  let response: Response;

  try {
    response = await fetch("/api/v1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new DaemonCommandTimeoutError();
    throw error;
  }

  if (!response.ok) throw new Error(`command failed: ${response.status}`);
}
