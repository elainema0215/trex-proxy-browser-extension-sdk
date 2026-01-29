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
