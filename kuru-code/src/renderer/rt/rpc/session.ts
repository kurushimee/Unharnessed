// T3 Code's RPC session: its WebSocket to a server. kuru code's window talks
// to its main process over IPC, one session for the window's life.
export interface RpcSession {
  readonly kind: "local";
}

export const LOCAL_RPC_SESSION: RpcSession = Object.freeze({ kind: "local" });
