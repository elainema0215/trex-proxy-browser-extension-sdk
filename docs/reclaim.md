# Reclaim 架构模式分析：Proxy 与 MPC

## 结论概览

| 项目                              | 模式           | 说明                                                                                                                                                |
| --------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **reclaim-browser-extension-sdk** | **Proxy 模式** | 通过 attestor-core 的 `createClaimOnAttestor` 连到 attestor，流量经 attestor 出网，证明由 attestor 签发。                                           |
| **attestor-core**                 | **Proxy 模式** | 实现「attestor 作为代理」的架构：用户 ↔ attestor ↔ 互联网，证明由 attestor 签发；支持两种*脱敏方式*（key-update / zk），但都是同一套 proxy 架构。 |

---

## 1. reclaim-browser-extension-sdk：Proxy 模式

- **证明从哪来**  
  Background 把任务交给 offscreen，offscreen 里调用的是 **attestor-core** 的 `createClaimOnAttestor`（`src/offscreen/offscreen.js` 第 240 行）。

- **和 attestor 的关系**  
  使用 `wss://attestor.reclaimprotocol.org/ws` 等 attestor 端点（见 `proof-formatter.js`、`claim-creator.js`），通过 WebSocket 连到 attestor。

- **流程**  
  网页/扩展 → SDK → Background → Offscreen → **createClaimOnAttestor(claimData)** → 与 attestor 建 tunnel、经 attestor 做 TLS、claim tunnel、拿到 attestor 签名的 proof。  
  即：**流量经 attestor 转发，证明由 attestor 签发**。

- **关于 README 中的「offscreen + WebAssembly 生成 proof」**  
  指的是在浏览器里跑 attestor-core 的客户端逻辑（含可能用到的 WASM/ZK），但**证明的生成和签名仍然依赖与 attestor 的交互**，并不是「完全本地、不经 attestor」的另一种模式。

---

## 核心流程：建 tunnel → 经 attestor 做 TLS → claim tunnel → 拿 proof

以下四步均在 **attestor-core** 的 `createClaimOnAttestor`（`src/client/create-claim.ts`）内完成，由 Extension 的 offscreen 调用并传入 `claimData`（含 `client.url`、provider、params 等）。

### 1. 与 attestor 建 tunnel

- **客户端**  
  - `getAttestorClientFromPool(clientInit.url, ...)` 得到/创建 WebSocket 连到 attestor（`client.url` 即 `ATTESTOR_WS_URL`）。  
  - `AttestorClient` 构造时把 **initRequest** 和**首条 createTunnel 请求**一起打包进 URL 的 `messages` 参数，连上 WS 即发 init（`client-socket.ts`）。  
  - `makeRpcTlsTunnel` 里：TLS 客户端第一次要**写**数据时，在 `write` 回调里先不建 TCP tunnel，而是调用 `connect([createTunnelRequest, { tunnelMessage: { tunnelId, message } }])`，把 **createTunnelRequest**（host、port、geoLocation、proxySessionId、id）和**第一个 TLS 包**同一次发给 attestor（`make-rpc-tls-tunnel.ts` 约 69–88 行）。  
  - 然后 `makeTunnel()` → `makeRpcTcpTunnel`：之后所有 TLS 数据都通过 `client.sendMessage({ tunnelMessage: { tunnelId, message } })` 发往 attestor，并监听 `tunnel-message` 收 attestor 转发的数据（`make-rpc-tcp-tunnel.ts`）。

- **服务端**  
  - **init**（`handlers/init.ts`）：处理 initRequest，存 `client.metadata`，返回 toprfPublicKey 等。  
  - **createTunnel**（`handlers/createTunnel.ts`）：校验 host 白名单、隧道 id 不重复，调用 `makeTcpTunnel({ host, port, geoLocation, proxySessionId, ... })` 在 attestor 本机建立到**目标站 host:port** 的 TCP 连接（直连或经 HTTPS 代理）；之后把该 TCP 的 data 通过 `client.sendMessage({ tunnelMessage: { tunnelId, message } })` 回传给客户端。  
  - 因此：**tunnel 是 attestor 到目标站的一条 TCP 连接**，客户端与 attestor 之间则是 WebSocket；客户端发来的二进制都经 attestor 原样转发到该 TCP，TCP 收的数据原样经 WS 推给客户端。

**小结**：建 tunnel = 客户端通过 WS 发 createTunnel，attestor 建好到目标 host:port 的 TCP，之后双方通过 `tunnelMessage` 在该逻辑隧道上收发数据。

### 2. 经 attestor 做 TLS

- **逻辑**  
  - 客户端在本地跑 **TLS 客户端**（`@reclaimprotocol/tls` 的 `makeTLSClient`），但**不**直接连目标站；每条要发的 TLS 记录都通过上面的 tunnel 发给 attestor，attestor 写入到「attestor ↔ 目标站」的 TCP；目标站回复的 TLS 数据由 attestor 从 TCP 读出，经 `tunnelMessage` 推回客户端，客户端交给 `tls.handleReceivedBytes(data)` 解密。  
  - 因此：**TLS 握手与后续应用数据都是在「客户端 ↔ attestor ↔ 目标站」这条链路上完成的**；真实出网、握 TLS、收 HTTP 的是 attestor，客户端只和 attestor 交换密文并本地做 TLS 状态机。

- **脱敏**  
  - **key-update**：在要隐藏的请求段前 `tunnel.tls.updateTrafficKeys()`，attestor 侧无法用当前密钥解密该段；在可揭示段再 Key Update 回来。  
  - **zk**：请求照常加密发出，客户端对需脱敏的包附上 ZK 证明，在后面的 claim 阶段把「脱敏后的 transcript」给 attestor 验证。

- **证书**  
  - 客户端需要目标站证书时，不直接连目标站，而是通过 `fetchCertificateBytesFromAttestor(url)` 调 attestor 的 **fetchCertificateBytes** RPC，由 attestor 去拿证书并返回（`create-claim.ts` 内 `tlsOpts.fetchCertificateBytes`）。

**小结**：经 attestor 做 TLS = 客户端与 attestor 之间只传 tunnel 上的二进制；attestor 与目标站之间完成真实 TCP + TLS；客户端本地维护 TLS 会话并可选 key-update/zk 对 attestor 脱敏。

### 3. claim tunnel

- **时机**  
  - 客户端在收到完整 HTTP 响应、`tunnel.close()` 之后，用本地 **transcript**（客户端记录的 TLS 收发）生成带 reveal 信息的 transcript（含 key-update 或 ZK 的揭示/证明），再发 **claimTunnel** RPC（`create-claim.ts` 约 297–322 行）。

- **请求内容**  
  - `ClaimTunnelRequest`：包含原来的 `createTunnelRequest`、provider 名、parameters、context、timestamp、owner、**transcript**（带 reveal）、zkEngine、fixedServerIV/fixedClientIV、以及用 owner 私钥签的 **requestSignature**。

- **服务端**（`handlers/claimTunnel.ts`）  
  - 根据 `request.id` 取到对应 tunnel，关闭 tunnel。  
  - 校验 `tunnel.createRequest` 与 claim 里的 request（host/port/geoLocation/proxySessionId）一致。  
  - `assertTranscriptsMatch(claimRequest.transcript, tunnel.transcript)`：确保客户端声称的 transcript 与 attestor 侧记录的**密文** transcript 一致（不泄露明文）。  
  - `assertValidClaimRequest`：验 requestSignature、用 transcript 中的 reveal/ZK 解密得到 receipt、用 provider 的校验逻辑断言这是一次合法 claim。  
  - 通过后构造 `ClaimTunnelResponse`，填入 `claim`（含 identifier 等），并对 claim 和整份 response 做 **attestor 签名**（`signAsAttestor`），返回给客户端。

**小结**：claim tunnel = 客户端把「本次 tunnel 的请求+transcript+签名」交给 attestor；attestor 核对 tunnel 一致性、transcript、provider 规则后，签发 claim 和 resultSignature。

### 4. 拿到 attestor 签名的 proof

- **返回**  
  - `claimTunnel` 的返回值即 `ClaimTunnelResponse`，内有 `res.claim` 和 `res.signatures`（attestorAddress、claimSignature、resultSignature）。  
  - 客户端 `createClaimOnAttestor` 将该 result 原样返回（`create-claim.ts` 约 322–323 行），Extension 的 offscreen 收到后通过 `GENERATE_PROOF_RESPONSE` 回传给 Background，最终作为「attestor 签名的 proof」交给上层。

- **proof 的含义**  
  - attestor 用私钥对 `createSignDataForClaim(claim)` 和 `ClaimTunnelResponse.encode(res).finish()` 签名，证明：**某次经本 attestor 的 tunnel 上发生了符合 provider 规则的交互，且 transcript 与 attestor 记录一致**；第三方可验 attestor 公钥与签名，从而信任该 proof。

**小结**：拿 proof = 从 claimTunnel RPC 的 response 里取回 attestor 签名的 claim 与 resultSignature，即「与 attestor 建 tunnel、经 attestor 做 TLS、claim tunnel」的最终可验证结果。

---

## 2. attestor-core：Proxy 模式 + 两种 Redaction 方式

- **架构**（`docs/claim-creation.md`、README）  
  Attestor 是「坐在用户和互联网之间的服务器」；用户把数据经 attestor 发到互联网，attestor 签名后把证明返回给用户。  
  这就是典型的 **proxy 架构**：用户 ↔ attestor（代理）↔ 目标站。

- **RedactionMode**（`src/types/providers.ts` 第 31、101–109 行）
  - `RedactionMode = 'key-update' | 'zk'`
  - **key-update**：用 TLS 1.3 Key Update 在「可给 attestor 看」和「不可给 attestor 看」的段之间切换密钥，默认、高效。
  - **zk**：用 ZK 证明只向 attestor 揭示需要的部分，兼容 TLS 1.2 等，更慢。  
    两者都是「在**经 attestor 转发**的前提下，如何对 attestor 脱敏」，而不是「不走 attestor 的另一种模式」。

- **proxySessionId / geoLocation**（`src/types/providers.ts` 第 87–96 行）  
  控制的是 attestor 出网时用的代理 IP/地域（同一会话同 IP 等），属于「proxy 架构下的代理配置」。

---

## 总结

- **reclaim-browser-extension-sdk**：**Proxy mode**（通过 attestor-core 连 attestor，流量经 attestor，证明由 attestor 签发）。
- **attestor-core**：**Proxy mode**（实现 attestor 代理架构；支持 key-update 与 zk 两种 redaction，但都是同一 proxy 架构）。
