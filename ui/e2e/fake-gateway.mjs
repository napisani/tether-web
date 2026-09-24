import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const dist = fileURLToPath(new URL("../../cmd/tether-web/dist", import.meta.url));

const clients = new Set();

const timers = new Set();

const history = [];

let nextEventId = 0;

let failNextCommand;

let discoverablePeers = [];

// The real gateway multiplexes every browser tab onto one owned tetherd socket,
// so uploads are process-global here rather than owned by individual HTTP clients.
const uploads = new Map();

let messageThreads = [];

let messageHistory = [];

let phoneNotifications = [];

let phoneCalls = [];

const maxUploadBytes = 256 * 1024 * 1024;

const maxChunkBytes = 48 * 1024;

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
    capabilities: ["airpods", "bluetooth.connection", "bluetooth.pairing", "files", "peers"],
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
  durable.protocol_info.capabilities = ["airpods", "bluetooth.connection", "bluetooth.pairing", "files", "peers"];

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

function reset({ paired = false, withAirPods = false, withPeer = false, discoverPeer = false, bluetoothSetup = false, withMessages = false, withNotifications = false, withCalls = false } = {}) {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  history.length = 0;
  nextEventId = 0;
  failNextCommand = undefined;
  discoverablePeers = discoverPeer || withPeer ? [peer] : [];
  uploads.clear();
  messageThreads = withMessages ? [{ thread: "tel:+15550102", name: "Ada", address: "+15550102", preview: "See you soon", timestamp: 1_700_000_000, unread: 1, repliable: true }] : [];
  messageHistory = withMessages ? [{ handle: "message-1", thread: "tel:+15550102", body: "See you soon", timestamp: 1_700_000_000, outgoing: false, read: false }] : [];
  resetNotificationScenario(withMessages, withNotifications);
  durable.bt_status = baseBluetoothStatus();
  setPhonePaired([paired, withMessages, withNotifications, withCalls].some(Boolean));
  resetCallsScenario(withCalls);
  durable.state_snapshot = emptyStateSnapshot();

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

function frame(event, id) {
  const idLine = id ? `id: ${id}\n` : "";

  return `${idLine}data: ${JSON.stringify(event)}\n\n`;
}

function publish(event) {
  if (Object.hasOwn(durable, event.command)) durable[event.command] = event;
  const streamed = { id: ++nextEventId, event: structuredClone(event) };
  history.push(streamed);

  if (history.length > 256) history.shift();
  const data = frame(streamed.event, streamed.id);

  for (const response of clients) response.write(data);
}

function writeSnapshot(response) {
  response.write(frame({ command: "gateway_status", daemon_connected: true }));

  for (const command of Object.keys(durable).sort()) response.write(frame(durable[command]));
}

function handleCommand(command) {
  return commandHandlers[command.command]?.(command);
}

function respondToCommand(response, command) {
  response.writeHead(handleCommand(command) === false ? 409 : 202).end();
}

const commandHandlers = {
  protocol_info: () => later(() => publish(durable.protocol_info), 10),
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
  file_upload_start: handleUploadStart,
  file_upload_chunk: handleUploadChunk,
  file_upload_finish: handleUploadFinish,
  file_upload_cancel: (command) => {
    const upload = uploads.get(command.operation_id);

    if (!upload || upload.sending) return false;
    uploads.delete(command.operation_id);
  },
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
  bt_solicit: () => later(() => publish({ command: "bt_solicit_result", success: true, message: "Asked the iPhone to re-offer notification access." }), 20),
  bt_list_threads: () => later(() => publish({ command: "bt_threads", threads: messageThreads }), 10),
  bt_list_messages: (command) => later(() => publish({ command: "bt_messages", thread: command.thread, messages: messageHistory.filter((item) => item.thread === command.thread) }), 10),
  bt_list_contacts: (command) => later(() => publish({ command: "bt_contacts", query: command.query,
    contacts: [{ name: "Ada", addresses: ["tel:+15550102"] }] }), 10),
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

function handleUploadStart(command) {
  const validId = typeof command.operation_id === "string" && command.operation_id.length <= 128 &&
    /^[A-Za-z0-9_.-]+$/.test(command.operation_id) && command.operation_id !== "." && command.operation_id !== "..";

  const validSize = Number.isSafeInteger(command.size) && command.size >= 0 && command.size <= maxUploadBytes;

  const success = validId && validSize && typeof command.filename === "string" && command.filename.length > 0 &&
    !uploads.has(command.operation_id) && uploads.size < 2;

  if (success) uploads.set(command.operation_id, { filename: command.filename, size: command.size, bytes: 0, nextChunk: 0, sending: false });

  return success;
}

function handleUploadChunk(command) {
  const upload = uploads.get(command.operation_id);

  const validBase64 = typeof command.data === "string" && command.data.length > 0 && command.data.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(command.data);

  const bytes = validBase64 ? Buffer.from(command.data, "base64").byteLength : 0;
  const valid = upload && !upload.sending && upload.nextChunk === command.chunk_index && bytes > 0 && bytes <= maxChunkBytes && upload.bytes + bytes <= upload.size;

  if (valid) {
    upload.bytes += bytes;
    upload.nextChunk += 1;

    return true;
  }

  return false;
}

function handleUploadFinish(command) {
  const upload = uploads.get(command.operation_id);
  const success = Boolean(upload && !upload.sending && upload.bytes === upload.size);

  if (!success) return false;

  upload.sending = true;
  later(() => {
    uploads.delete(command.operation_id);
    publish({ command: "file_send_complete", operation_id: command.operation_id, filename: upload.filename, success: true, message: "File sent." });
  }, 20);

  return true;
}

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

const server = createServer(async (request, response) => {
  if (request.url === "/__test/reset" && request.method === "POST") {
    reset(await readJSON(request));
    response.writeHead(204).end();

    return;
  }

  if (request.url === "/__test/fail-next-command" && request.method === "POST") {
    const body = await readJSON(request);
    failNextCommand = body.command || "*";
    response.writeHead(204).end();

    return;
  }

  if (request.url === "/api/v1/state") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ daemon_connected: true, events: durable }));

    return;
  }

  if (request.url === "/api/v1/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const lastEventId = Number(request.headers["last-event-id"] ?? 0);

    if (lastEventId) {
      for (const streamed of history) {
        if (streamed.id > lastEventId) response.write(frame(streamed.event, streamed.id));
      }
    }

    writeSnapshot(response);
    clients.add(response);
    request.on("close", () => clients.delete(response));

    return;
  }

  if (request.url === "/api/v1/commands" && request.method === "POST") {
    const command = await readJSON(request);

    if (failNextCommand === "*" || failNextCommand === command.command) {
      failNextCommand = undefined;
      response.writeHead(503).end();

      return;
    }

    respondToCommand(response, command);

    return;
  }

  const requested = request.url === "/" ? "index.html" : request.url.slice(1);
  let path = join(dist, requested);

  if (!existsSync(path) || statSync(path).isDirectory()) path = join(dist, "index.html");
  const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  response.writeHead(200, { "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});

reset();

server.listen(4173, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
