export interface ISocketResponse<T> {
    type: string,
    data: T,
    error?: any,
    message: string,
}


export interface IRoomCreated {
    roomId: string
}

//doing this because maybe in future we need to send more things when user joins room 
export interface IRoomJoined {
    roomId: string,
}

export interface IChatResponse {
    sender: string,
    message: string
}