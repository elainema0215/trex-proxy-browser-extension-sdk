# 同一扩展内双 SDK 共存说明

本文档说明在**同一个浏览器扩展**（如 trex-extension）中，同时使用 **@reclaimprotocol/browser-extension-sdk** 与基于其复制的 **@trex-proxy-browser-extension-sdk** 的可行性与要求：一部分验证走 Reclaim 官方 SDK，另一部分验证走 Trex 自维护 SDK。

---

## 1. 结论

**可以共存。** 同一扩展内跑两套「Reclaim 式」SDK 在技术上是可行的，前提是：**@trex-proxy-browser-extension-sdk 在消息、存储、脚本路径、资源路径等所有与运行时环境交互的地方，都要与 @reclaimprotocol/browser-extension-sdk 完全区分开**，否则会互相抢消息、抢存储、抢 content/offscreen。

---

## 2. 两套 SDK 会共享/冲突的点（Fork 必须做命名隔离）

| 维度 | 当前 Reclaim SDK 的用法 | 冲突点 | Fork (@trex-proxy-browser-extension-sdk) 需要做的 |
|------|--------------------------|--------|---------------------------------------------|
| **Background 初始化** | `reclaimExtensionSDK.initializeBackground()` 注册 `chrome.runtime.onMessage` 等 | 若两套用同一批 action/type，一条消息会被两个 listener 处理或只被一个“抢走” | Fork 里所有与 background 通信的 **message type / action 名** 用独立前缀（如 `TREX_SDK_*`），与 Reclaim 的 `RECLAIM_*` 完全分开 |
| **Storage** | Session、proof queue、状态等使用 `chrome.storage.local` | 若 key 相同会互相覆盖 | Fork 里所有 storage 的 key 用独立前缀（如 `trex_sdk_*`），不与 Reclaim 或现有 `trex_reclaim_status` 等混用 |
| **Content 脚本** | 通过 `registerContentScripts` 注入 `reclaim-browser-extension-sdk/content/content.bundle.js`，id: `reclaim-sdk` | 同一页面注入两套 content 时，若都响应同一种 message 会乱 | Fork 的 content bundle 放到不同路径（如 `trex-browser-extension-sdk/content/content.bundle.js`），注册时用不同 `id`（如 `trex-sdk`），且 content 内只处理 fork 自己的 message 类型 |
| **Web 可访问资源** | offscreen、interceptor、verification popup 等在 `reclaim-browser-extension-sdk/...` | 若 fork 也用同一路径会覆盖或冲突 | Fork 的 build 输出到单独目录（如 `trex-browser-extension-sdk/`），manifest 里 `web_accessible_resources` 和脚本引用都指到该新目录 |
| **Offscreen 文档** | 用于 ZK 等，一个 URL 对应一个 document | 两个 SDK 若都开 offscreen 必须用不同 URL | Fork 的 offscreen 用独立路径，如 `trex-browser-extension-sdk/offscreen/offscreen.html`，并在 fork 的 background 逻辑里只创建/使用自己的 offscreen |
| **扩展内调用入口** | 如 `reclaimExtensionSDK.init(...)`、`ReclaimExtensionProofRequest` | 无冲突，只是两套 API 在扩展里选谁用 | **扩展**（宿主扩展内发起验证的代码，如 side panel、content script、background）决定：某次验证用 Reclaim 还是 Trex，各调各的 init/startVerification |

---

## 3. Fork 侧建议的改动清单（在 @trex-proxy-browser-extension-sdk 内完成）

1. **消息 / Action 类型**  
   把所有与 background/content/offscreen 之间通信的 type/action 从 `RECLAIM_*` 改成例如 `TREX_SDK_*`，保证 Reclaim 的 listener 只处理 Reclaim 的，Trex 的只处理 Trex 的。

2. **Storage key**  
   所有 `chrome.storage` 的 key 加统一前缀（如 `trex_sdk_`），避免与 Reclaim 或现有 `trex_reclaim_status` 等冲突。

3. **Build 输出与扩展内路径**  
   - 构建产物输出到单独目录，在宿主扩展中复制为例如 `trex-browser-extension-sdk/`（与现有 `reclaim-browser-extension-sdk/` 并列）。  
   - Content script、offscreen、interceptor、verification popup 等全部引用该新路径。

4. **Content script 注册**  
   在宿主扩展（如 trex-extension）的 background 里为 fork 再注册一个 content script：不同 `id`（如 `trex-sdk`）、不同 `js` 路径（如 `trex-browser-extension-sdk/content/content.bundle.js`）。

5. **Manifest**  
   - `web_accessible_resources` 中增加 `trex-browser-extension-sdk/` 下所有需要被加载的资源（offscreen、interceptor、popup 等）。  
   - 若 Trex SDK 也使用 343.bundle 等，把对应文件一并列入。

6. **Background 双初始化**  
   在宿主扩展的 service worker 中：  
   - 保留 `reclaimExtensionSDK.initializeBackground()`（走 Reclaim 的验证）；  
   - 再增加 `trexExtensionSDK.initializeBackground()`（或 fork 导出的等价方法），用于走 @trex-proxy-browser-extension-sdk 的验证。

---

## 4. 小结

- 可以在同一扩展内同时使用 **@reclaimprotocol/browser-extension-sdk** 与 **@trex-proxy-browser-extension-sdk**，实现「一部分验证走 Reclaim、一部分走 Trex」。
- 关键在于 **@trex-proxy-browser-extension-sdk** 做**命名与资源隔离**：消息类型、storage key、content script 路径与 id、offscreen 与 web_accessible_resources 路径、以及 background 的 message 处理，都不与 Reclaim 那套共用或重叠。
- **扩展**（如 trex-extension）在「发起验证」时选择调用哪一套 SDK 的 API（Reclaim 的 `reclaimExtensionSDK.init(...)` 或 Trex 的 `trexExtensionSDK.init(...)`），两套可并行存在、互不干扰。
