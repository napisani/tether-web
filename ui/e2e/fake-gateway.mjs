import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../cmd/tether-web/dist", import.meta.url));
const clients = new Set();
const timers = new Set();
const history = [];
let nextEventId = 0;
let failNextCommand = false;

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

const durable = {
  protocol_info: {
    command: "protocol_info",
    version: 1,
    capabilities: ["bluetooth.connection", "bluetooth.pairing"],
  },
  bt_status: {
    command: "bt_status",
    available: true,
    enabled: true,
    device_address: "",
    version: "0.2.32-e2e",
  },
  bt_devices: { command: "bt_devices", devices: [] },
  bt_connection_changed: disconnectedConnection(),
};

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

function reset({ paired = false } = {}) {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  history.length = 0;
  nextEventId = 0;
  failNextCommand = false;
  setPhonePaired(paired);
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
  if (command.command === "bt_scan") {
    later(() => publish({ command: "bt_devices", devices: [phone] }), 20);
    later(() => {
      publish({ command: "bt_scan_result", success: true, message: "Bluetooth scan finished." });
      publish({ command: "bt_devices", devices: [] });
    }, 40);
  }
  if (command.command === "bt_pair") {
    later(() => {
      publish({
        command: "bt_pair_progress",
        operation_id: command.operation_id,
        step: "pair",
        detail: "Waiting for the iPhone",
      });
      publish({
        command: "bt_pair_confirm_request",
        operation_id: command.operation_id,
        code: "042731",
      });
    }, 20);
  }
  if (command.command === "bt_pair_confirm") {
    later(() => {
      if (!command.accept) {
        publish({
          command: "bt_pair_result",
          operation_id: command.operation_id,
          success: false,
          status: "rejected",
          message: "Pairing was cancelled.",
        });
        return;
      }
      setPhonePaired(true);
      publish({
        command: "bt_pair_result",
        operation_id: command.operation_id,
        success: true,
        status: "paired",
        message: "Paired with someone’s iPhone.",
        dual_bond: true,
      });
      publish(durable.bt_devices);
      publish(durable.bt_connection_changed);
    }, 20);
  }
  if (command.command === "bt_unpair") {
    later(() => {
      setPhonePaired(false);
      publish({
        command: "bt_unpair_result",
        operation_id: command.operation_id,
        success: true,
        status: "unpaired",
        message: "Forgot someone’s iPhone.",
      });
      publish(durable.bt_status);
      publish(durable.bt_devices);
      publish(durable.bt_connection_changed);
    }, 20);
  }
}

async function readJSON(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = createServer(async (request, response) => {
  if (request.url === "/__test/reset" && request.method === "POST") {
    reset(await readJSON(request));
    response.writeHead(204).end();
    return;
  }
  if (request.url === "/__test/fail-next-command" && request.method === "POST") {
    failNextCommand = true;
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
    if (failNextCommand) {
      failNextCommand = false;
      response.writeHead(503).end();
      return;
    }
    handleCommand(command);
    response.writeHead(202).end();
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
