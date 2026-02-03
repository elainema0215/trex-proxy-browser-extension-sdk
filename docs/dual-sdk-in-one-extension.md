# 同一扩展内双 SDK 共存说明

本文档说明在**同一个浏览器扩展**（如 trex-extension）中，同时接入 **@reclaimprotocol/browser-extension-sdk** 与基于其复制的 **@trexproxy/browser-extension-sdk** 的可行性与要求。**单次验证只用其中一套**：要么用 Reclaim 官方 SDK，要么用 Trex 自维护 SDK。

---

## 1. 结论

**可以共存。** 同一扩展内跑两套「Reclaim 式」SDK 在技术上是可行的，前提是：

- **命名与资源隔离**：@trexproxy/browser-extension-sdk 在消息、存储、脚本路径、资源路径等与 @reclaimprotocol/browser-extension-sdk 完全区分开。
- **Offscreen 串行**：Manifest V3（MV3）全局同一时刻仅允许一个 offscreen document；Fork 侧创建前检查、用完后关闭，与 Reclaim 串行使用（见 3.1 节）。

---

## 2. 两套 SDK 会共享/冲突的点（Fork 必须做命名隔离）

| 维度 | 当前 Reclaim SDK 的用法 | 冲突点 | Fork (@trexproxy/browser-extension-sdk) 需要做的 |
|------|--------------------------|--------|---------------------------------------------|
| **npm 包名** | 官方包名为 `@reclaimprotocol/browser-extension-sdk` | Fork 若沿用同名，宿主扩展无法同时安装两套包（依赖解析冲突） | package.json 的 `name` 改为 `@trexproxy/browser-extension-sdk` |
| **Background 初始化** | `reclaimExtensionSDK.initializeBackground()` 注册 `chrome.runtime.onMessage` 等 | 若两套用同一批 action/type，一条消息会被两个 listener 处理或只被一个“抢走” | message type / action 从 `RECLAIM_*` 改为 `TREX_SDK_*` |
| **Storage** | Session、proof queue、状态等使用 `chrome.storage.local` | 若 key 相同会互相覆盖 | chrome.storage 的 key 前缀改为 `trex_sdk_*` |
| **Content 脚本** | 通过 `registerContentScripts` 注入 `reclaim-browser-extension-sdk/content/content.bundle.js`，id: `reclaim-sdk` | 同一页面注入两套 content 时，若都响应同一种 message 会乱 | content bundle 路径改为 `trex-browser-extension-sdk/content/content.bundle.js`，注册 id 改为 `trex-sdk` |
| **Web 可访问资源** | offscreen、interceptor、verification popup 等在 `reclaim-browser-extension-sdk/...` | 若 fork 也用同一路径会覆盖或冲突 | build 输出目录改为 `trex-browser-extension-sdk/`，manifest 的 `web_accessible_resources` 与脚本引用该路径 |
| **Offscreen 文档** | 用于 ZK 等，background 通过 `chrome.offscreen.createDocument` 创建 | **Chrome Manifest V3（MV3）全局同一时刻只允许一个 offscreen document** | Fork 侧：创建前检查是否已有 document、有则轮询等待；用完后 `closeDocument`；URL 用 `trex-browser-extension-sdk/...`（见 3.1 节） |
| **扩展内调用入口** | 如 `reclaimExtensionSDK.init(...)`、`ReclaimExtensionProofRequest` | 无冲突 | **扩展**（side panel、content script、background）在发起验证时二选一：本次用 Reclaim 或 Trex |

---

## 3. Fork 侧建议的改动清单（在 @trexproxy/browser-extension-sdk 内完成）

0. **npm 包名**  
   package.json 的 `name` 改为 `@trexproxy/browser-extension-sdk`。

1. **消息 / Action 类型**  
   message type / action 从 `RECLAIM_*` 改为 `TREX_SDK_*`。

2. **Storage key**  
   chrome.storage 的 key 前缀改为 `trex_sdk_`。

3. **Build 输出与扩展内路径**  
   - build 输出目录改为 `trex-browser-extension-sdk/`（与 `reclaim-browser-extension-sdk/` 并列）。  
   - content script、offscreen、interceptor、verification popup 等引用该路径。

4. **Content script 注册**  
   宿主扩展 background 中为 fork 再注册一条：id 改为 `trex-sdk`，js 路径改为 `trex-browser-extension-sdk/content/content.bundle.js`。

5. **Manifest**  
   - `web_accessible_resources` 增加 `trex-browser-extension-sdk/` 下所需资源（offscreen、interceptor、popup 等）；若使用 343.bundle，一并列入。

6. **Background 双初始化**  
   宿主扩展 service worker 中：保留 `reclaimExtensionSDK.initializeBackground()`，再增加 `trexExtensionSDK.initializeBackground()`（fork 导出）。

---

## 3.1 Offscreen 共存方案（Manifest V3 / MV3 单 document 限制）

Chrome Manifest V3（MV3）规定：**同一扩展全局同一时刻只能存在一个 offscreen document**。两套 SDK 不能同时各开一个，只能**串行使用**：同一时刻只有一方创建并使用 offscreen，用完后关闭，另一方再用。

### 推荐做法：串行使用，各用各的 offscreen URL

两套 SDK 仍各自使用自己的 offscreen 页面（Reclaim 用 `reclaim-browser-extension-sdk/offscreen/offscreen.html`，Fork 用 `trex-browser-extension-sdk/offscreen/offscreen.html`），但**创建前先确认当前没有别的 offscreen**，避免冲突。

**Reclaim 侧**：无需改。照常「需要时 `createDocument`(Reclaim 的 offscreen URL)，用完关闭」。

**Fork 侧具体实施路径（代码级）**：以下按「改哪个文件、改哪一段、做什么」写出可执行步骤，对应本仓库（@trexproxy/browser-extension-sdk）当前结构。

**步骤 1：Fork 使用自己的 offscreen URL**

- **文件**：`src/utils/offscreen-manager.js`
- **位置**：`createOffscreenDocumentInternal` 内（约第 82–84 行）
- **改动**：将  
  `chrome.runtime.getURL("reclaim-browser-extension-sdk/offscreen/offscreen.html")`  
  改为  
  `chrome.runtime.getURL("trex-browser-extension-sdk/offscreen/offscreen.html")`  
  这样 Fork 创建的 offscreen 加载的是 Fork 的 offscreen 页面与脚本。

**步骤 2：创建前检查——已有 offscreen 时轮询等待**

- **文件**：`src/utils/offscreen-manager.js`
- **位置**：`ensureOffscreenDocument` 内，在「若 no context found and not ready, and no creation in progress, attempt to create」这一段（约第 258–269 行）**之前**插入等待逻辑。
- **逻辑**：
  - 若已存在 `chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })` 且 `contexts.length > 0`，说明当前已有 offscreen（多半是 Reclaim 的），Fork 不能立刻 `createDocument`（会报 “Only a single offscreen document may be created”）。
  - 实现**轮询等待**：在循环内每隔约 1–2 秒再次调用 `getContexts`，直到 `contexts.length === 0`（表示对方已关闭），再执行后续的 `createOffscreenDocumentInternal`。
  - 设置**最大等待时间**（例如 60 秒）或最大重试次数，超时则 `throw new Error("...")` 或 `reject`，避免无限等。
- **注意**：当前代码在「有 context 存在」时是直接 `waitForOffscreenReadyInternal` 并 return，即认为「已有的 document 是我们的」。在双 SDK 场景下，若 document 是 Reclaim 创建的（Reclaim 的 URL），Fork 不能复用，必须等其关闭后再创建自己的。因此需要区分「已有 context 是否为我们 Fork 创建的」：若无法区分（getContexts 不返回 URL），则**统一视为别人在用**，只做「等待 contexts.length === 0 再创建」，不进入「已有 context 则等待 ready」分支。

**步骤 3：用完后关闭 offscreen**

- **文件 1**：`src/utils/offscreen-manager.js`
  - **新增**：导出方法 `closeOffscreenDocument()`：内部调用 `chrome.offscreen.closeDocument()`（若存在），并将本模块内用于「标记 offscreen 就绪」的变量（如 `offscreenReady`）置为 `false`，以便下次 `ensureOffscreenDocument` 会重新创建。
- **文件 2**：`src/utils/proof-generator/proof-generator.js`
  - **位置**：在 `generateProof` 里，注册的 `messageListener` 收到 `GENERATE_PROOF_RESPONSE` 且 `response.success === true` 时，在 `clearTimeout(messageTimeout)` 和 `removeListener` 之后、在 `resolve(...)` 之前或之后，调用上述 `closeOffscreenDocument()`。
  - 这样**每次 proof 成功生成并返回后**，Fork 会关闭自己的 offscreen，Reclaim 或下一次 Trex 验证即可再创建。
- **可选**：若希望「整轮验证会话只关一次」，可在 `src/background/proofQueue.js` 的 `processNextQueueItem` 的 `finally` 中，当 `ctx.proofGenerationQueue.length === 0` 且即将调用 `ctx.submitProofs()` 时，再调用 `closeOffscreenDocument()`；并去掉 proof-generator 里每次成功就关的逻辑，避免同一会话内多次开关。

**步骤 4：宿主扩展（可选）**

- 在宿主扩展的 background（如 trex-extension 的 `src/pages/background/index.ts`）中：
  - 维护 `chrome.storage.local` 的一项，例如 `offscreenOwner: 'reclaim' | 'trex' | null`；或用一个模块级变量。
  - Reclaim 的 offscreen 创建前/关闭后由宿主包装调用并更新该标记（若 Reclaim 不提供钩子，则只能通过「Fork 侧在创建前读该标记、若为 'reclaim' 则等待」来配合）。
  - Fork 侧在 `ensureOffscreenDocument` 的「准备 create 前」读该标记；若为 `'reclaim'` 则轮询等待直到变为 `null` 再创建；创建后写为 `'trex'`，`closeOffscreenDocument` 后写回 `null`。
  - 若不改 Reclaim 源码，宿主无法在 Reclaim 创建/关闭时写标记，则**仅靠步骤 2 的 getContexts 轮询**即可：Fork 发现已有 offscreen 就等它消失再创建。

**小结（实施顺序）**

1. 改 `offscreen-manager.js` 的 offscreen URL 为 `trex-browser-extension-sdk/...`（步骤 1）。  
2. 在同一文件 `ensureOffscreenDocument` 中加入「已有 OFFSCREEN_DOCUMENT 时轮询等待直至消失再创建」及超时（步骤 2）。  
3. 在 `offscreen-manager.js` 新增并导出 `closeOffscreenDocument`，在 `proof-generator.js` 的 proof 成功回调里调用它（步骤 3）。  
4. 按需在宿主扩展做 offscreen 使用权标记（步骤 4）。

---

## 4. 小结

- 同一扩展内可同时接入 **@reclaimprotocol/browser-extension-sdk** 与 **@trexproxy/browser-extension-sdk**；单次验证只用其一（要么 Reclaim 要么 Trex）。
- **命名与资源隔离**：消息类型、storage key、content script 路径与 id、web_accessible_resources 路径、background 的 message 处理，两套完全区分；**offscreen 串行使用**，创建前检查、用完后关闭（见 3.1 节）。
- **扩展**在发起验证时二选一调用：`reclaimExtensionSDK.init(...)` 或 `trexExtensionSDK.init(...)`，两套共存。
