export const BACKEND_URL = "https://api.reclaimprotocol.org";

/**
 * Attestor 的 WebSocket 地址：证明生成时 offscreen 里 attestor-core 客户端会连这里，
 * 完成 tunnel → TLS → claim 协议后拿到签名 proof。这是 Reclaim 官方的托管 attestor 服务。
 * 本地联调时改为 "ws://localhost:8001/ws" 并先启动 attestor-core。
 * 官方地址：wss://attestor.reclaimprotocol.org/ws
 */

export const ATTESTOR_WS_URL = "ws://localhost:8001/ws";

export const API_ENDPOINTS = {
  PROVIDER_URL: (providerId) => `${BACKEND_URL}/api/providers/${providerId}`,
  SUBMIT_PROOF: (sessionId) => `${BACKEND_URL}/session/${sessionId}/proof`,
  UPDATE_SESSION_STATUS: () => `${BACKEND_URL}/api/sdk/update/session/`,
  STATUS_URL: (sessionId) => `${BACKEND_URL}/api/sdk/session/${sessionId}`,
};
