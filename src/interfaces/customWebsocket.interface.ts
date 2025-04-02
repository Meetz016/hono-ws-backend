import { WebSocket, WebSocketServer } from "ws";

export interface CustomWebSocket extends WebSocket {
    username: string,
    roomId: string,
}