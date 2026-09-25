import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createUnixServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repo = fileURLToPath(new URL("../..", import.meta.url));

const sandbox = mkdtempSync(join(tmpdir(), "tether-web-e2e-"));

const socketPath = join(sandbox, "tetherd.sock");

const binary = join(sandbox, "tether-web");

const sockets = new Set();

const timers = new Set();

let scenarioEpoch = 0;

let discoverablePeers = [];

let messageThreads = [];

let messageHistory = [];

let phoneContacts = [];

let phoneNotifications = [];

let phoneCalls = [];

const phone = {
  address: "40:F6:64:3D:7A:F1",
  name: "40-F6-64-3D-7A-F1",
  iphone: false,
  apple_nearby: true,
  paired: false,
  bonded: false,
  trusted: false,
  connected: false,
  classic_connected: false,
  le_bearer: true,
  le_bonded: false,
  le_connected: false,
  map: false,
  pbap: false,
  ancs: false,
  ancs_notifying: false,
};

const airpods = {
  address: "AA:BB:CC:DD:EE:FF",
  name: "AirPods Pro",
  airpods: true,
  paired: true,
  connected: true,
};

const peer = {
  name: "Nearby phone",
  fingerprint: "peer-1",
  addresses: [{ address: "10.0.0.3", port: 5134 }],
};

const durable = {
  protocol_info: {
    command: "protocol_info",
    version: 1,
    capabilities: ["airpods", "bluetooth.connection", "bluetooth.pairing", "files", "peers", "settings"],
  },
  bt_status: baseBluetoothStatus(),
  bt_devices: { command: "bt_devices", devices: [] },
  bt_connection_changed: disconnectedConnection(),
  state_snapshot: emptyStateSnapshot(),
};

function baseBluetoothStatus() {
  return {
    command: "bt_status",
    available: true,
    enabled: true,
    ancs_enabled: true,
    ancs_content_enabled: true,
    retention: "encrypted",
    retention_ready: true,
    desktop_popups_enabled: true,
    lock_on_away: false,
    device_address: "",
    version: "0.2.32-e2e",
    capability: { mode: "full", reasons: [], setup: [] },
  };
}

function emptyStateSnapshot() {
  return {
    command: "state_snapshot",
    paired_devices: [],
    pending_pairs: [],
    connected_clients: [],
    discovered_devices: [],
    recent_received_files: [],
    mdns_available: true,
    clipboard_available: true,
    firewall_active: false,
  };
}

function disconnectedConnection() {
  return {
    command: "bt_connection_changed",
    device_present: false,
    device_paired: false,
    classic_connected: false,
    le_available: false,
    le_connected: false,
    map_open: false,
    pbap_open: false,
    ancs_ready: false,
  };
}

function connectedConnection() {
  return {
    command: "bt_connection_changed",
    device_present: true,
    device_paired: true,
    classic_connected: true,
    le_available: true,
    le_connected: true,
    map_open: true,
    pbap_open: true,
    ancs_ready: true,
  };
}

function setPhonePaired(paired) {
  Object.assign(phone, {
    name: paired ? "Someone’s iPhone" : "40-F6-64-3D-7A-F1",
    iphone: paired,
    paired,
    bonded: paired,
    trusted: paired,
    connected: paired,
    classic_connected: paired,
    le_bonded: paired,
    le_connected: paired,
    map: paired,
    pbap: paired,
    ancs: paired,
    ancs_notifying: paired,
  });
  durable.bt_status.device_address = paired ? phone.address : "";
  durable.bt_devices = { command: "bt_devices", devices: paired ? [phone] : [] };
  durable.bt_connection_changed = paired ? connectedConnection() : disconnectedConnection();
}

function resetNotificationScenario(withMessages, withNotifications) {
  phoneNotifications = withNotifications ? [
    { uid: 42, app_id: "com.example.mail", app_name: "Mail", title: "A letter", subtitle: "Sender",
      body: "Hello from your iPhone", timestamp: 1_700_000_000, negative_action: true },
    { uid: 43, app_id: "com.example.calendar", app_name: "Calendar", body: "Appointment",
      timestamp: 1_700_000_020, negative_action: false },
  ] : [];
  durable.protocol_info.capabilities = ["airpods", "bluetooth.connection", "bluetooth.pairing", "files", "peers", "settings"];

  if (withMessages) durable.protocol_info.capabilities.push("messages");

  if (withNotifications) durable.protocol_info.capabilities.push("notifications");
}

function resetCallsScenario(withCalls) {
  phoneCalls = withCalls ? [
    { path: "/call/1", name: "Ada", number: "+15550102", state: "incoming", ringing: true },
    { path: "/call/2", number: "", withheld: true, state: "active", connected: true },
  ] : [];
  durable.bt_status.calls_enabled = withCalls;

  if (withCalls) {
    durable.protocol_info.capabilities.push("calls");
    durable.bt_connection_changed = { ...durable.bt_connection_changed,
      calls: { available: true, reason: "Calls are controlled here; audio plays on the iPhone.",
        audio: "idle", indicators: true, operator: "Carrier", signal: 4, battery: 3, service: true } };
  }
}

function resetContactsScenario(withContacts) {
  phoneContacts = withContacts ? [
    { name: "Ada", addresses: ["tel:+15550102", "email:ada@example.com"] },
    { name: "Grace", addresses: ["tel:+15550103"] },
  ] : [];

  if (withContacts) durable.protocol_info.capabilities.push("contacts");
}

function expandLongMessages(enabled) {
  if (!enabled || !messageThreads.length) return;

  messageThreads.push(...Array.from({ length: 45 }, (_, index) => ({
    thread: `tel:+155502${String(index).padStart(2, "0")}`, name: `Contact ${index + 1}`,
    preview: `Conversation ${index + 1}`, timestamp: 1_700_000_000 - index, repliable: true,
  })));
  messageHistory.push(...Array.from({ length: 80 }, (_, index) => ({
    handle: `message-${index + 2}`, thread: "tel:+15550102", body: `Test message ${index + 2}`,
    timestamp: 1_700_000_300 + index * 300, outgoing: index % 2 === 0, read: true,
  })));
}

function reset({ paired = false, withAirPods = false, withPeer = false, discoverPeer = false, bluetoothSetup = false, withMessages = false, longMessages, withNotifications = false, withCalls = false, withContacts = false } = {}) {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  discoverablePeers = discoverPeer || withPeer ? [peer] : [];
  messageThreads = withMessages ? [{ thread: "tel:+15550102", name: "Ada", address: "+15550102", preview: "See you soon", timestamp: 1_700_000_000, unread: 1, repliable: true }] : [];
  messageHistory = withMessages ? [{ handle: "message-1", thread: "tel:+15550102", body: "See you soon", timestamp: 1_700_000_000, outgoing: false, read: false }] : [];
  expandLongMessages(longMessages);
  resetNotificationScenario(withMessages, withNotifications);
  durable.bt_status = baseBluetoothStatus();
  setPhonePaired([paired, withMessages, withNotifications, withCalls, withContacts].some(Boolean));
  resetCallsScenario(withCalls);
  resetContactsScenario(withContacts);
  durable.state_snapshot = emptyStateSnapshot();
  // This snapshot is the last sorted durable frame, so its epoch is a barrier
  // for all earlier status frames before the next browser navigates.
  durable.state_snapshot.test_epoch = ++scenarioEpoch;

  if (bluetoothSetup && paired) {
    durable.bt_status.capability = {
      mode: "compatibility",
      reasons: ["The adapter cannot advertise as a peripheral."],
      setup: [{
        what: "Enable BlueZ experimental mode, then restart Bluetooth.",
        command: "sudo systemctl restart bluetooth",
      }],
    };
    durable.bt_connection_changed = {
      ...connectedConnection(),
      map_open: false,
      map_error: "forbidden",
      ancs_ready: false,
      ancs_reason: "The iPhone has not granted notification access.",
    };
  }

  if (withPeer) {
    durable.state_snapshot.pending_pairs = [{ fingerprint: peer.fingerprint, device_name: peer.name }];
    durable.state_snapshot.connected_clients = [{
      fingerprint: peer.fingerprint,
      device_name: peer.name,
      address: peer.addresses[0].address,
      paired: false,
    }];
    durable.state_snapshot.discovered_devices = [peer];
  }

  if (withAirPods) {
    airpods.connected = true;
    durable.bt_status = {
      ...durable.bt_status,
      airpods_enabled: true,
      airpods_pause: "one-removed",
      airpods_handoff: true,
      calls_enabled: true,
    };
    durable.bt_devices = { command: "bt_devices", devices: [airpods] };
    durable.bt_airpods = {
      command: "bt_airpods",
      address: airpods.address,
      name: airpods.name,
      left: 82,
      right: 79,
      case: 45,
      ear: { primary: "in_ear", secondary: "out_of_ear" },
      in_ear: 1,
      peer_taking_over: false,
      peer_active: false,
      peer_audio: false,
      peer_call: false,
      peer_holds_audio: false,
      status: "live",
      reason: "",
      anc: "transparency",
    };
  } else {
    delete durable.bt_airpods;
  }
}

function later(callback, delay) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delay);

  timers.add(timer);
}

// The test adapter speaks tetherd's newline-delimited JSON on a Unix socket.
// The production Go gateway owns HTTP, SSE, upload staging, and event replay.
function publish(event) {
  if (Object.hasOwn(durable, event.command)) durable[event.command] = event;
  const line = `${JSON.stringify(event)}\n`;

  for (const socket of sockets) socket.write(line);
}

function publishSnapshot() {
  for (const command of Object.keys(durable).sort()) publish(durable[command]);
}

function handleCommand(command) {
  commandHandlers[command.command]?.(command);
}

const commandHandlers = {
  protocol_info: () => later(() => publish(durable.protocol_info), 10),
  bt_status: () => later(() => publish(durable.bt_status), 10),
  discover: () => later(() => publish({ command: "discovery_result", devices: discoverablePeers }), 10),
  accept_device: () => {
    durable.state_snapshot.pending_pairs = [];
    durable.state_snapshot.paired_devices = [{ fingerprint: peer.fingerprint, device_name: peer.name }];
    durable.state_snapshot.connected_clients[0].paired = true;
    publish({ command: "pair_accepted", fingerprint: peer.fingerprint, device_name: peer.name, connected: true });
  },
  pair_request: (command) => {
    publish({ command: "pair_outbound_pending", fingerprint: peer.fingerprint, device_name: command.device_name, address: command.host });
    later(() => publish({ command: "pair_accepted", fingerprint: peer.fingerprint, device_name: peer.name, connected: true }), 10);
  },
  forget_device: (command) => {
    durable.state_snapshot.paired_devices = [];
    durable.state_snapshot.connected_clients = [];
    publish({ command: "forget_device_result", fingerprint: command.fingerprint, forgotten: true });
  },
  send_file: (command) => later(() => {
    // Reading the staged path checks that the real gateway finished writing it.
    if (!command.operation_id || !existsSync(command.path)) return;
    readFileSync(command.path);
    publish({ command: "file_send_complete", operation_id: command.operation_id,
      filename: basename(command.path), success: true, message: "File sent." });
  }, 20),
  bt_scan: () => {
    later(() => publish({ command: "bt_devices", devices: [phone] }), 20);
    later(() => {
      publish({ command: "bt_scan_result", success: true, message: "Bluetooth scan finished." });
      publish({ command: "bt_devices", devices: [] });
    }, 40);
  },
  bt_pair: (command) => later(() => {
    publish({ command: "bt_pair_progress", operation_id: command.operation_id, step: "pair", detail: "Waiting for the iPhone" });
    publish({ command: "bt_pair_confirm_request", operation_id: command.operation_id, code: "042731" });
  }, 20),
  bt_pair_confirm: (command) => later(() => finishPairing(command), 20),
  bt_set_enabled: (command) => {
    durable.bt_status.enabled = command.enabled;
    publish(durable.bt_status);
  },
  bt_set_ancs: (command) => {
    durable.bt_status.ancs_enabled = command.enabled;
    publish(durable.bt_status);
  },
  bt_set_ancs_content: (command) => {
    durable.bt_status.ancs_content_enabled = command.enabled;
    publish(durable.bt_status);
  },
  bt_set_calls: (command) => {
    durable.bt_status.calls_enabled = command.enabled;
    durable.protocol_info.capabilities = durable.protocol_info.capabilities.filter((item) => item !== "calls");

    if (command.enabled) durable.protocol_info.capabilities.push("calls");
    publish(durable.bt_status);
  },
  bt_set_retention: (command) => {
    durable.bt_status.retention = command.retention;
    publish(durable.bt_status);
  },
  bt_solicit: () => later(() => publish({ command: "bt_solicit_result", success: true, message: "Asked the iPhone to re-offer notification access." }), 20),
  bt_list_threads: () => later(() => publish({ command: "bt_threads", threads: messageThreads }), 10),
  bt_list_messages: (command) => later(() => publish({ command: "bt_messages", thread: command.thread, messages: messageHistory.filter((item) => item.thread === command.thread) }), 10),
  bt_list_contacts: (command) => later(() => {
    const query = (command.query || "").toLowerCase();
    const available = query && !phoneContacts.length ? [{ name: "Ada", addresses: ["tel:+15550102"] }] : phoneContacts;
    publish({ command: "bt_contacts", query: command.query || "",
      contacts: available.filter((item) => `${item.name} ${item.addresses.join(" ")}`.toLowerCase().includes(query)).slice(0, command.limit || 5000) });
  }, 10),
  bt_mark_read: (command) => later(() => {
    messageHistory = messageHistory.map((item) => command.handles.includes(item.handle) ? { ...item, read: true } : item);
    messageThreads = messageThreads.map((item) => ({ ...item, unread: 0 }));
    publish({ command: "bt_message_read", handles: command.handles, read: command.read, success: true });
  }, 10),
  bt_list_notifications: () => later(() => publish({ command: "bt_notifications", notifications: phoneNotifications }), 10),
  bt_list_calls: () => later(() => publish({ command: "bt_calls", calls: phoneCalls }), 10),
  bt_call_dial: (command) => later(() => {
    if (!command.number?.trim()) {
      publish({ command: "bt_call_result", action: "dial", success: false, message: "Not a dialable number." });

      return;
    }

    phoneCalls.push({ path: `/call/${phoneCalls.length + 1}`, number: command.number,
      state: "dialing", outgoing: true });
    publish({ command: "bt_call_result", action: "dial", success: true });
    publish({ command: "bt_calls", calls: phoneCalls });
  }, 20),
  bt_call_action: (command) => later(() => {
    const call = phoneCalls.find((item) => item.path === command.path);

    const valid = command.action === "audio_here" || command.action === "audio_phone" ||
      Boolean(call && (command.action === "hangup" || (command.action === "answer" && call.ringing)));

    const result = { command: "bt_call_result", action: command.action, success: valid };

    if (!valid) result.message = "That call is no longer active.";
    publish(result);

    if (!valid) return;

    if (command.action === "answer") Object.assign(call, { state: "active", ringing: false, connected: true });

    if (command.action === "hangup") phoneCalls = phoneCalls.filter((item) => item.path !== command.path);

    if (command.action === "audio_here" || command.action === "audio_phone") {
      durable.bt_connection_changed.calls.audio = command.action === "audio_here" ? "active" : "idle";
      publish(durable.bt_connection_changed);
    }

    publish({ command: "bt_calls", calls: phoneCalls });
  }, 20),
  bt_notification_action: (command) => {
    if (command.action !== "negative" || !phoneNotifications.some((item) => item.uid === command.uid && item.negative_action)) return false;

    later(() => {
      publish({ command: "bt_notification_action_result", uid: command.uid, success: true });
      phoneNotifications = phoneNotifications.filter((item) => item.uid !== command.uid);
      publish({ command: "bt_notification_removed", uid: command.uid });
    }, 20);
  },
  bt_send_message: (command) => later(() => {
    const message = { command: "bt_message", handle: `sent-${messageHistory.length}`, thread: command.thread,
      body: command.body, timestamp: Math.floor(Date.now() / 1000), outgoing: true, read: true };

    messageHistory.push(message);
    messageThreads = messageThreads.map((item) => item.thread === command.thread
      ? { ...item, preview: command.body, timestamp: message.timestamp } : item);
    publish(message);
    publish({ command: "bt_send_result", thread: command.thread, operation_id: command.operation_id, success: true });
  }, 20),
  bt_airpods_connect: (command) => later(() => {
    airpods.connected = command.connect;
    durable.bt_devices = { command: "bt_devices", devices: [airpods] };
    publish({ command: "bt_airpods_connect_result", success: true, message: "" });
    publish(durable.bt_devices);
  }, 20),
  bt_airpods_mode: (command) => {
    durable.bt_airpods.anc = command.mode;
    publish({ command: "bt_airpods_mode_result", success: true, message: "" });
    publish(durable.bt_airpods);
  },
  bt_airpods_enable: (command) => {
    durable.bt_status.airpods_enabled = command.enabled;
    publish(durable.bt_status);
  },
  bt_airpods_pause: (command) => {
    durable.bt_status.airpods_pause = command.mode;
    publish(durable.bt_status);
  },
  bt_airpods_handoff: (command) => {
    durable.bt_status.airpods_handoff = command.enabled;
    publish(durable.bt_status);
  },
  bt_unpair: (command) => later(() => {
    setPhonePaired(false);
    publish({ command: "bt_unpair_result", operation_id: command.operation_id, success: true, status: "unpaired", message: "Forgot someone’s iPhone." });
    publish(durable.bt_status);
    publish(durable.bt_devices);
    publish(durable.bt_connection_changed);
  }, 20),
};

function finishPairing(command) {
  if (!command.accept) {
    publish({ command: "bt_pair_result", operation_id: command.operation_id, success: false, status: "rejected", message: "Pairing was cancelled." });

    return;
  }

  setPhonePaired(true);
  publish({ command: "bt_pair_result", operation_id: command.operation_id, success: true, status: "paired", message: "Paired with someone’s iPhone.", dual_bond: true });
  publish(durable.bt_devices);
  publish(durable.bt_connection_changed);
}

const requestBodySchema = z.object({}).passthrough();

async function readJSON(request) {
  let body = "";

  for await (const chunk of request) body += chunk;

  try {
    const parsed = requestBodySchema.safeParse(body ? JSON.parse(body) : {});

    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

async function waitForScenario(epoch) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4173/api/v1/state", { signal: AbortSignal.timeout(500) });
      const state = await response.json();

      if (state.daemon_connected && state.events.state_snapshot?.test_epoch === epoch) return;
    } catch { /* The gateway may be connecting to the fake daemon. */ }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("gateway did not observe the fresh test scenario");
}

// Control traffic is deliberately on a different loopback port: browser
// requests still reach the actual gateway with its production HTTP behavior.
const control = createServer(async (request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();

    return;
  }

  if (request.url === "/__test/reset") {
    reset(await readJSON(request));
    publishSnapshot();

    try {
      await waitForScenario(scenarioEpoch);
      response.writeHead(204).end();
    } catch (error) {
      console.error(error);
      response.writeHead(503).end();
    }

    return;
  }

  if (request.url === "/__test/emit-notification") {
    const body = await readJSON(request);

    if (!Number.isSafeInteger(body.uid) || body.uid < 0) {
      response.writeHead(400).end();

      return;
    }

    publish({ command: "bt_notification", uid: body.uid, title: "Secret title", body: "Secret body" });
    response.writeHead(204).end();

    return;
  }

  response.writeHead(404).end();
});

const build = spawnSync("go", ["build", "-o", binary, "./cmd/tether-web"], { cwd: repo, stdio: "inherit" });

if (build.status !== 0) {
  rmSync(sandbox, { recursive: true, force: true });
  process.exit(build.status || 1);
}

reset();

const daemon = createUnixServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let end = buffer.indexOf("\n");

    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);

      try { handleCommand(JSON.parse(line)); } catch (error) { console.error("bad daemon command", error); }

      end = buffer.indexOf("\n");
    }
  });
  publishSnapshot();
});

daemon.listen(socketPath);

control.listen(4174, "127.0.0.1");

const gateway = spawn(binary, [], { env: { ...process.env, TETHER_WEB_LISTEN: "127.0.0.1:4173", TETHER_SOCKET_PATH: socketPath }, stdio: "inherit" });

let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;
  gateway.kill("SIGTERM");
  control.close();
  daemon.close();
  setTimeout(() => { rmSync(sandbox, { recursive: true, force: true }); process.exit(0); }, 1500).unref();
}

gateway.on("exit", (code) => {
  rmSync(sandbox, { recursive: true, force: true });
  process.exit(stopping ? 0 : code || 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);
