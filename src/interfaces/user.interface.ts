

export interface IUserInfo {
    type: "create" | "join" | "chat",
    username: string,
    room_id?: string,
    message?: string,
}
