import { describe, expect, it } from "vitest";
import type { BluetoothDevice, DaemonCommand, DaemonEvent, TextMessage } from "./protocol";
import { daemonCommandSchema, daemonEventSchema } from "./protocolSchemas";

describe("validated browser protocol model", () => {
  it("uses parsed events as the feature types while retaining additive daemon fields", () => {
    const event: DaemonEvent = daemonEventSchema.parse({
      command: "bt_devices", devices: [{ address: "40:F6:64:3D:7A:F1", future_device_field: 7 }],
      future_event_field: "kept",
    });

    expect(event.command).toBe("bt_devices");

    if (event.command !== "bt_devices") throw new Error("wrong event");
    const device: BluetoothDevice = event.devices[0];
    expect(device.future_device_field).toBe(7);
    expect(event.future_event_field).toBe("kept");
  });

  it("uses parsed command and nested message shapes without a second field list", () => {
    const command: DaemonCommand = daemonCommandSchema.parse({
      command: "bt_send_message", operation_id: "send-1", thread: "+15550123", body: "test",
    });

    const event: DaemonEvent = daemonEventSchema.parse({
      command: "bt_messages", thread: "+15550123",
      messages: [{ handle: "m1", thread: "+15550123", body: "test", timestamp: 10, outgoing: true, read: true }],
    });

    if (event.command !== "bt_messages") throw new Error("wrong event");
    const message: TextMessage = event.messages[0];
    expect(command.command).toBe("bt_send_message");
    expect(message.outgoing).toBe(true);
  });
});
