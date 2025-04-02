import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { IUserInfo } from "./interfaces/user.interface";
import { IRoomCreated, ISocketResponse } from "./interfaces/response";

interface Env {
  ROOM_MANAGER: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/websocket", async (c) => {
  const id = c.env.ROOM_MANAGER.idFromName("room-manager");
  const obj = c.env.ROOM_MANAGER.get(id);
  return obj.fetch(c.req.raw);
});

export default app;

interface WebSocketMetadata {
  username: string;
  roomId: string;
}

export class RoomManager {
  state: DurableObjectState;
  rooms: Map<string, Map<WebSocket, WebSocketMetadata>>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.rooms = new Map();
  }

  async fetch(req: Request) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    server.addEventListener("message", (event) => {
      try {
        const data: IUserInfo = JSON.parse(event.data as string);

        if (data.type === "create") {
          const roomId = uuidv4().split("-")[0];
          // Create an empty Map for the room
          this.rooms.set(roomId, new Map());
          // Get the room's Map
          const room = this.rooms.get(roomId)!;
          // Set the WebSocket and its metadata in the room's Map
          room.set(server, { username: data.username, roomId: roomId });
          const response: ISocketResponse<IRoomCreated> = {
            type: "roomCreated",
            data: {
              roomId: roomId
            },
            message: "Room Creation Sucessful"
          }
          console.log(this.rooms)
          server.send(JSON.stringify(response));
        }

      } catch (error) {
        server.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    });

    server.addEventListener("close", () => {
      // Remove connection from all rooms
      for (const [roomId, clients] of this.rooms.entries()) {
        if (clients.has(server)) {
          const userData = clients.get(server);
          clients.delete(server);

          // Notify others that user left
          if (userData) {
            this.broadcastToRoom(roomId, {
              type: "user_left",
              username: userData.username,
            });
          }

          // Clean up empty rooms
          if (clients.size === 0) {
            this.rooms.delete(roomId);
          }
        }
      }
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private broadcastToRoom(roomId: string, message: any, excludeSocket?: WebSocket) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const messageStr = JSON.stringify(message);
    for (const [socket] of room.entries()) {
      if (socket !== excludeSocket) {
        socket.send(messageStr);
      }
    }
  }
}