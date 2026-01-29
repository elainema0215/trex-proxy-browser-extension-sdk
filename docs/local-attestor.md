# 本地部署 Attestor 并与 Extension SDK 联调

可以将 **attestor-core** 在本地部署，并让 **reclaim-browser-extension-sdk** 的证明生成走本地 attestor，便于联调与开发。

---

## 一、在本地运行 attestor-core

attestor-core 仓库内已提供本地运行方式，参考 [Run your own Attestor](https://github.com/reclaimprotocol/attestor-core/blob/main/docs/run-server.md)。

### 1. 克隆并安装

```bash
cd /path/to/attestor-core
npm install
```

### 2. 环境变量

在项目根目录创建 `.env.development`（或根据 `NODE_ENV` 使用 `.env.<NODE_ENV>`），**至少**配置：

- **`PRIVATE_KEY`**：attestor 签名用私钥（以太坊格式，如 `0x...`），必填。

其余变量见仓库内的 `.env.sample`（若存在）。可选：

- **TOPRF**：若需 threshold OPRF，运行 `npm run generate:toprf-keys` 并按输出配置 `TOPRF_PUBLIC_KEY`、`TOPRF_SHARE_*`。
- **认证**：若需限制连接，可配置 `AUTHENTICATION_PUBLIC_KEY` 并在客户端传 `authRequest`。

### 3. 启动服务

```bash
npm run start
```

（脚本内部为 `run:tsc` 执行 `src/scripts/start-server.ts`。）

默认在 **8001** 端口启动：

- **WebSocket（attestor 协议）**：`ws://localhost:8001/ws`
- **静态资源（browser RPC 等）**：`http://localhost:8001/browser-rpc`

### 4. 可选：Docker 方式

```bash
# 需在 .env 或环境中提供 PRIVATE_KEY 等
docker compose up
```

同样会暴露 8001 端口。

---

## 二、让 Extension SDK 使用本地 Attestor

SDK 在构造 claim 时会把 attestor 的 WebSocket 地址传给 attestor-core 的 `createClaimOnAttestor`。该地址来自 **`ATTESTOR_WS_URL`**。

### 1. 修改常量（开发时）

在 **reclaim-browser-extension-sdk** 中编辑 `src/utils/constants/constants.js`：

```js
/** Attestor WebSocket URL for proof generation. For local attestor, set to e.g. "ws://localhost:8001/ws". */
export const ATTESTOR_WS_URL = "ws://localhost:8001/ws";
```

保存后重新打包/运行扩展，证明生成会走本地 attestor。

### 2. 恢复线上环境

联调结束后改回：

```js
export const ATTESTOR_WS_URL = "wss://attestor.reclaimprotocol.org/ws";
```

### 3. 说明

- 会话初始化、Provider 拉取、状态更新等仍走 **api.reclaimprotocol.org**（`BACKEND_URL`），不受 `ATTESTOR_WS_URL` 影响。
- 只有 **证明生成**（offscreen 里 `createClaimOnAttestor`）会连 `ATTESTOR_WS_URL`。本地 attestor 仅需保证 WebSocket `/ws` 和协议行为正确即可。

---

## 三、自建 attestor 的 HTTPS / 公网部署

若 attestor 部署在带域名的服务器上：

1. 用 Nginx 等反向代理暴露 HTTP/WS，并配置 **HTTPS** 与 **WebSocket 升级**。
2. RPC 地址形如：`wss://<你的域名>/ws`。
3. 在 SDK 的 `constants.js` 中把 `ATTESTOR_WS_URL` 设为该 `wss://...` 地址。

详见 attestor-core 文档中的 [Deploying to the Cloud](https://github.com/reclaimprotocol/attestor-core/blob/main/docs/run-server.md#deploying-to-the-cloud)。

---

## 四、简要检查清单

| 步骤          | 说明                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| attestor 本地 | 在 attestor-core 目录配置 `PRIVATE_KEY`，执行 `npm run start:tsc`，确认 8001 端口监听 |
| SDK 常量      | 将 `ATTESTOR_WS_URL` 改为 `ws://localhost:8001/ws` 并重新构建扩展                     |
| 扩展环境      | 会话/Provider 仍用 Reclaim 线上 API；仅 proof 走本地 attestor                         |

按以上步骤即可在本地部署 attestor-core，并与 reclaim-browser-extension-sdk 联调。

---

## 五、常见问题

- **`npm run start` 报错 `TypeScript namespace declaration is not supported in strip-only mode`**  
  attestor-core 使用 `node --experimental-strip-types` 直接跑 TS，Node 22 下生成的 proto 代码会触发此限制。可尝试：**使用 Node 20 LTS**（如 `nvm use 20` 或 `n 20` 后再 `npm run start`）。
- **用 `npx tsx src/scripts/start-server.ts` 报错 `esprima-next` 不提供 `ArrayExpression`**  
  属 ESM/tsx 与依赖导出方式不兼容，建议仍用官方 `npm run start` 并配合 Node 20。
- **Docker 方式**  
  若本机已安装 Docker，可在 attestor-core 目录执行 `PRIVATE_KEY=0x... docker compose up --build`，容器内使用 Node 24，可避免本机 Node 版本问题。
- **必须设置 `PRIVATE_KEY`**  
  若未配置 `.env.development` 或环境变量 `PRIVATE_KEY`，服务会在加载时报错。可用任意合法以太坊私钥（如测试用 `0x` + 64 位十六进制）先让服务跑起来。
