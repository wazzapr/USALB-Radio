import app from "./app";
import { logger } from "./lib/logger";
import { ensureSeedData } from "./lib/seed";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { addListener } from "./lib/radio-state";
import { createServer } from "node:http";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });

webSocketServer.on("connection", (socket) => {
  addListener(randomUUID(), socket);
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws" && url.pathname !== "/api/ws") {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    webSocketServer.emit("connection", client, request);
  });
});

await ensureSeedData();

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
