import { expect, it } from "vitest";
import { daemonCommandSchema, daemonEventSchema } from "./protocolSchemas";

it("accepts upstream history and optional favorite metadata", () => {
  expect(daemonCommandSchema.safeParse({ command: "bt_list_call_history" }).success).toBe(true);
  expect(
    daemonEventSchema.safeParse({
      command: "bt_call_history",
      calls: [{ number: "123", name: "Ada", type: "missed", timestamp: 123 }],
    }).success,
  ).toBe(true);

  const event = daemonEventSchema.parse({
    command: "bt_contacts",
    query: "",
    contacts: [
      { name: "Ada", addresses: [], favorite: true },
      { name: "Old", addresses: [] },
    ],
  });

  expect(event.command === "bt_contacts" && event.contacts[0].favorite).toBe(true);
});
