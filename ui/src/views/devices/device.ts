import type { BluetoothDevice } from "../../protocol";

export type { BluetoothDevice };

export function deviceDisplayName(device?: BluetoothDevice): string {
  if (!device) return "this iPhone";
  const addressAlias = device.address.replaceAll(":", "-");

  if (device.apple_nearby && (!device.name || device.name.toUpperCase() === addressAlias)) {
    return "Nearby Apple device";
  }

  return device.name || (device.airpods ? "AirPods" : "iPhone");
}
