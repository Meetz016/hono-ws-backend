import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { IUserInfo } from "./interfaces/user.interface";
import { IChatResponse, IRoomCreated, IRoomJoined, ISocketResponse } from "./interfaces/response";

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
        } else if (data.type == "join") {
          const roomId = data.room_id;

          if (!roomId) {
            const response: ISocketResponse<null> = {
              type: "error",
              data: null,
              message: "No room Id Provided."
            }
            server.send(JSON.stringify(response));
            return;
          }
          //try to search if roomId Exists or not
          const room = this.rooms.get(roomId);
          if (!room) {
            const response: ISocketResponse<null> = {
              type: "error",
              data: null,
              message: "Invalid Room Id.",
              error: "Provide a valid Room Id."
            }
            server.send(JSON.stringify(response));
            return;
          }
          //if we get room just add the client ws to that room
          room.set(server, { username: data.username, roomId: roomId });
          const response: ISocketResponse<IRoomJoined> = {
            type: "roomJoined",
            data: {
              roomId: roomId
            },
            message: "Room Joined Successfully"
          }
          server.send(JSON.stringify(response));

          //trying to broadcast
          console.log("active...", this.rooms)

          room.forEach((metadata, client) => {
            if (client !== server && client.readyState === WebSocket.OPEN) {
              const joinedMessage: ISocketResponse<{ username: string }> = {
                type: "userJoined",
                data: { username: data.username },
                message: `${data.username} has joined the room`
              };
              client.send(JSON.stringify(joinedMessage));
            }
          })
        } else if (data.type == "chat") {
          //broadcast the message
          const roomId = data.room_id;

          if (!roomId) {
            const response: ISocketResponse<null> = {
              type: "error",
              data: null,
              message: "You are not in a room.",
            };
            server.send(JSON.stringify(response));
            return;
          }
          const room = this.rooms.get(roomId)
          if (!room) {
            const response: ISocketResponse<null> = {
              type: "error",
              data: null,
              message: "Invalid Room Id.",
              error: "Provide a valid Room Id."
            }
            server.send(JSON.stringify(response));
            return;
          }
          if (!data.message) {
            const response: ISocketResponse<null> = {
              type: "error",
              data: null,
              message: "No message provided.",
              error: "Message content is empty."
            }
            server.send(JSON.stringify(response));
            return;
          }

          room.forEach((metadata, client) => {
            if (client != server && client.readyState === WebSocket.OPEN) {
              const chatResponse: ISocketResponse<IChatResponse> = {
                type: "chat",
                data: {
                  message: data.message ?? "",
                  sender: data.username
                },
                message: "New Message"
              }
              client.send(JSON.stringify(chatResponse));
            }
          })
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