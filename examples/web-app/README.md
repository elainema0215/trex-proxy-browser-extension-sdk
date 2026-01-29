# Reclaim Extension SDK — Web App 测试页

从**网页**触发 Reclaim 验证流程，通过已安装的扩展完成证明生成并回传结果。用于联调「网页 ↔ 扩展 ↔ 本地 attestor」全链路。

## 一、SDK 如何调用 attestor

- **证明生成**时，SDK 在扩展的 offscreen 里会连 **attestor 的 WebSocket**（`ATTESTOR_WS_URL`），完成 tunnel → TLS → claim 协议后拿到签名 proof。
- 配置在 **reclaim-browser-extension-sdk** 的 `src/utils/constants/constants.js`：
  - 本地联调：`ATTESTOR_WS_URL = "ws://localhost:8001/ws"`（需先启动 attestor-core）
  - 线上：`ATTESTOR_WS_URL = "wss://attestor.reclaimprotocol.org/ws"`
- 会话 / Provider 等仍走 Reclaim 线上 API（`BACKEND_URL`），只有 proof 签名走你配置的 attestor。

当前仓库里 `constants.js` 已设为 `ws://localhost:8001/ws`，与本地 attestor 一致，**代码是正确的**。

## 二、测试前提

1. **本地 attestor**（联调 proof 时必选）：在 attestor-core 目录启动，例如  
   `PRIVATE_KEY=0x... NODE_ENV=development npx tsx src/scripts/start-server.ts`  
   确认 8001 端口监听、BGP 已连接。
2. **已安装的扩展**：使用本仓库的 **basic-extension** 构建并加载到 Chrome，记下扩展 ID（在 `chrome://extensions` 中查看）。
3. **SDK 已构建**：在 `reclaim-browser-extension-sdk` 根目录执行 `npm run build`，再在 basic-extension 里执行 `npm run build` 并加载其 `dist`。

## 三、在 web-app 中测试

### 1. 安装依赖

```bash
cd /Users/elaine/Desktop/reclaim-browser-extension-sdk/examples/web-app
npm install
```

### 2. 配置扩展 ID（重要）

网页需要知道你的扩展 ID 才能通过 `postMessage` 与扩展通信。

- **方式 A**：环境变量（推荐）  
  在项目根目录创建 `.env`（或 `.env.local`），例如：
  ```env
  VITE_RECLAIM_APP_ID=你的 APP_ID
  VITE_RECLAIM_APP_SECRET=你的 APP_SECRET
  VITE_RECLAIM_EXTENSION_ID=你的扩展ID
  ```
  扩展 ID 在 Chrome 打开 `chrome://extensions`，开启「开发者模式」，在对应扩展卡片上可以看到。

- **方式 B**：直接改代码  
  编辑 `src/ReclaimDemo.jsx` 里默认值：
  ```js
  const EXTENSION_ID = import.meta.env.VITE_RECLAIM_EXTENSION_ID || "你的扩展ID";
  ```

### 3. 启动开发服务器

```bash
npm run dev
```

浏览器打开控制台给出的地址（一般为 `http://localhost:5173`）。

### 4. 页面操作

1. 点击 **「Check Extension」**：应显示 “Extension detected” / “Ready”。若为 “Extension not found”，检查扩展是否已加载、EXTENSION_ID 是否一致。
2. 选择 **Provider**（如 Trex - Instagram）。
3. 点击 **「Start verification」**：会打开 Provider 页、走扩展与本地 attestor 生成 proof，完成后结果会显示在页面上。

### 5. 使用官方 attestor（不跑本地 attestor）

若不想跑 attestor-core，可把 SDK 的 `constants.js` 里 `ATTESTOR_WS_URL` 改为  
`wss://attestor.reclaimprotocol.org/ws`，并在 SDK 根目录重新 `npm run build`，再重新构建 basic-extension。此时 proof 会走官方 attestor，web-app 测试步骤不变。

## 四、小结

| 步骤 | 说明 |
|------|------|
| attestor | 本地联调：attestor-core 监听 8001；SDK 中 `ATTESTOR_WS_URL = "ws://localhost:8001/ws"` |
| 扩展 | basic-extension 构建并加载，记下扩展 ID |
| web-app | 配置 `VITE_RECLAIM_EXTENSION_ID`（或改默认 EXTENSION_ID），`npm run dev` 打开页面 |
| 测试 | Check Extension → 选 Provider → Start verification，在页面上查看 proof 结果 |

当前 SDK 中 attestor 的调用与常量配置是正确的；按上述步骤即可在 web-app 中完成从网页到扩展、再到本地 attestor 的完整测试。
