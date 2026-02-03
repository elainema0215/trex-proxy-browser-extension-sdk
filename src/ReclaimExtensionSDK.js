import "./utils/polyfills";
import { Wallet, keccak256, getBytes } from "ethers";
import initBackground from "./background/background";
import { BACKEND_URL, API_ENDPOINTS, RECLAIM_SDK_ACTIONS } from "./utils/constants";
import { loggerService } from "./utils/logger/LoggerService";

// 用于序列化扩展会话的全局验证队列（后台为单会话） (background is single-session)

const _verificationQueue = [];
let _queueRunning = false;
// eslint-disable-next-line no-undef
const SDK_VERSION = __SDK_VERSION__;

// 将验证任务添加到队列并触发队列处理
function _enqueueVerification(task) {
  return new Promise((resolve, reject) => {
    _verificationQueue.push({ task, resolve, reject });
    _drainQueue();
  });
}

// 处理队列中的下一个验证任务
async function _drainQueue() {
  if (_queueRunning) return;
  const next = _verificationQueue.shift();
  if (!next) return;
  _queueRunning = true;
  try {
    const result = await next.task();
    next.resolve(result);
  } catch (e) {
    next.reject(e);
  } finally {
    _queueRunning = false;
    _drainQueue();
  }
}

// ReclaimExtensionProofRequest 类
/**
 * 单次验证请求实例：负责会话配置、事件监听、与 Content/Background 的通信桥接。
 * 运行环境分为 extension（扩展 popup/options 页）与 web（第三方网页），通信方式不同。
 */
class ReclaimExtensionProofRequest {
  constructor(applicationId, providerId, options = {}) {
    // ---------- 会话与配置字段 ----------
    this.applicationId = applicationId;
    this.providerId = providerId;
    this.sessionId = "";
    this.signature = "";
    this.timestamp = Date.now().toString();
    this.parameters = {};
    this.context = { contextAddress: "0x0", contextMessage: "sample context" };
    this.redirectUrl = "";
    this.sdkVersion = `ext-${SDK_VERSION}`;
    this.resolvedProviderVersion = "";
    this.jsonProofResponse = false;
    this.extensionID = options.extensionID || "";
    this.providerVersion = options.providerVersion || "";
    this.acceptAiProviders = !!options.acceptAiProviders;
    this.callbackUrl = options.callbackUrl || "";

    this._backgroundInitialized = false;
    this._ctx = null;

    // ---------- 事件：started / completed / error / progress ----------
    this._listeners = {
      started: new Set(),
      completed: new Set(),
      error: new Set(),
      progress: new Set(),
    };
    this._boundWindowListener = this._handleWindowMessage.bind(this);
    window.addEventListener("message", this._boundWindowListener);

    // ---------- 运行模式：根据当前页面协议判断是扩展内页还是第三方网页 ----------
    this._mode =
      typeof chrome !== "undefined" && chrome.runtime && location?.protocol === "chrome-extension:"
        ? "extension"
        : "web";
    // extension 模式：直接监听 chrome.runtime.onMessage，接收 Background 广播的 PROOF_SUBMITTED / 失败
    if (this._mode === "extension") {
      this._boundChromeHandler = (message) => {
        const { action, data, error } = message || {};
        const messageId = data?.sessionId;
        if (this.sessionId && this.sessionId !== messageId) return;
        if (action === "PROOF_SUBMITTED") {
          const proofs = data?.formattedProofs || data?.proof || data;
          this._emit("completed", proofs);
        } else if (action === "PROOF_SUBMISSION_FAILED" || action === "PROOF_GENERATION_FAILED") {
          this._emit("error", error || new Error("Verification failed"));
        }
      };
      try {
        chrome.runtime.onMessage.addListener(this._boundChromeHandler);
      } catch {}
    }
  }

  /**
   * 创建并初始化一次验证请求：校验参数 → 构造实例 → 签名 → 后端创建会话。
   * 调用方需先 init 再 startVerification；fromConfig 用于服务端下发的配置反序列化。
   */
  static async init(applicationId, appSecret, providerId, options = {}) {
    if (!applicationId || typeof applicationId !== "string") {
      throw new Error("applicationId must be a non-empty string");
    }
    if (!appSecret || typeof appSecret !== "string") {
      throw new Error("appSecret must be a non-empty string");
    }
    if (!providerId || typeof providerId !== "string") {
      throw new Error("providerId must be a non-empty string");
    }

    const instance = new ReclaimExtensionProofRequest(applicationId, providerId, options);

    // 对规范化的 { providerId, timestamp } 做 keccak256 后用 appSecret 对应私钥签名，供后端校验
    const canonical = `{"providerId":"${providerId}","timestamp":"${instance.timestamp}"}`;
    const hash = keccak256(new TextEncoder().encode(canonical));
    const wallet = new Wallet(appSecret);
    const signature = await wallet.signMessage(getBytes(hash));
    instance.signature = signature;

    // 调用后端 /api/sdk/init/session/ 创建会话，拿到 sessionId 与 resolvedProviderVersion
    const initRes = await instance._initSession({
      providerId,
      appId: applicationId,
      timestamp: instance.timestamp,
      signature,
      versionNumber: instance.providerVersion || "",
    });
    instance.sessionId = initRes.sessionId || "";
    instance.resolvedProviderVersion = initRes.resolvedProviderVersion || "";
    console.log("调用后端 /api/sdk/init/session/ 拿到的结果是 :", initRes);
    return instance;
  }

  /** 从 JSON 字符串或对象反序列化为实例，常用于服务端下发配置、网页端不暴露 appSecret 的场景 */
  static fromJsonString(json, options = {}) {
    const cfg = typeof json === "string" ? JSON.parse(json) : json;
    return this.fromConfig(cfg, options);
  }

  /** 从配置对象还原实例：sessionId、signature、callbackUrl 等均从 config 填充，sdkVersion 保持 ext-* 不信任入参 */
  static fromConfig(config, options = {}) {
    if (!config || typeof config !== "object") throw new Error("invalid config");
    const instance = new ReclaimExtensionProofRequest(
      String(config.applicationId || ""),
      String(config.providerId || ""),
      options || {},
    );

    instance.sessionId = String(config.sessionId || "");
    instance.signature = String(config.signature || "");
    instance.timestamp = String(config.timeStamp || config.timestamp || Date.now());
    instance.parameters = config.parameters || {};
    instance.context = config.context || instance.context;
    instance.callbackUrl = String(config.appCallbackUrl || config.callbackUrl || "");
    instance.jsonProofResponse = !!(config.jsonProofResponse ?? instance.jsonProofResponse);
    instance.resolvedProviderVersion = String(config.resolvedProviderVersion || "");
    instance.providerVersion = String(config.providerVersion || "");
    instance.redirectUrl = String(config.redirectUrl || "");
    instance.acceptAiProviders = !!(
      config.acceptAiProviders ??
      config.options?.acceptAiProviders ??
      instance.acceptAiProviders
    );

    if (options?.extensionID) instance.extensionID = String(options.extensionID);

    // sdkVersion 保持构造函数中的 ext-<version>，不采用 config 中的值，防止伪造
    return instance;
  }

  // ---------- 配置辅助：callback / redirect / context / parameters / statusUrl ----------
  setAppCallbackUrl(url, jsonProofResponse = false) {
    if (!url || typeof url !== "string") throw new Error("callbackUrl must be a non-empty string");
    this.callbackUrl = url;
    this.jsonProofResponse = !!jsonProofResponse;
  }

  setRedirectUrl(url) {
    if (!url || typeof url !== "string") throw new Error("redirectUrl must be a non-empty string");
    this.redirectUrl = url;
  }

  addContext(address, message) {
    if (!address || !message) throw new Error("Both address and message are required");
    this.context = { contextAddress: String(address), contextMessage: String(message) };
  }

  setParams(params) {
    if (!params || typeof params !== "object") throw new Error("params must be an object");
    this.parameters = { ...this.parameters, ...params };
  }

  /** 返回当前会话的状态查询 URL（后端 /api/sdk/session/:sessionId） */
  getStatusUrl() {
    if (!this.sessionId) throw new Error("Session not initialized");

    console.log("getStatusUrl is :", API_ENDPOINTS.STATUS_URL(this.sessionId));
    return API_ENDPOINTS.STATUS_URL(this.sessionId);
  }

  // ---------- 事件订阅：on 返回取消订阅函数 ----------
  on(event, cb) {
    if (!this._listeners[event]) throw new Error(`Unknown event: ${event}`);
    this._listeners[event].add(cb);
    return () => this.off(event, cb);
  }
  off(event, cb) {
    if (!this._listeners[event]) return;
    this._listeners[event].delete(cb);
  }

  /**
   * 对外 API：开始验证。先进入全局队列串行执行（Background 单会话），再执行 _startVerificationInternal。
   * 返回的 Promise 在收到 completed 时 resolve(proofs)，收到 error 时 reject。
   */
  async startVerification() {
    return _enqueueVerification(() => this._startVerificationInternal());
  }

  /**
   * 取消当前验证：通过 postMessage 通知 Content（再转 Background 执行 cancelSession），
   * 等待 error 事件（Content 收到 PROOF_GENERATION_FAILED 后 postMessage VERIFICATION_FAILED）或超时。
   */
  async cancel(timeoutMs = 5000) {
    if (!this.sessionId) return;
    return new Promise((resolve) => {
      let done = false;
      const offErr = this.on("error", () => {
        if (!done) {
          done = true;
          offErr();
          resolve(true);
        }
      });
      // 向页面广播取消，由注入的 Content Script 转发给 Background
      window.postMessage(
        {
          action: RECLAIM_SDK_ACTIONS.CANCEL_VERIFICATION,
          messageId: this.sessionId,
          extensionID: this.extensionID,
        },
        "*",
      );
      setTimeout(() => {
        if (!done) {
          offErr();
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  /**
   * 内部：组装 templateData，根据 _mode 选择通信方式，返回一个由 completed/error 事件驱动的 Promise。
   * - extension：chrome.runtime.sendMessage 发给 Background，started 由回调里 _emit。
   * - web：window.postMessage 发给页面内 Content Script（需 extensionID），started/completed/error 由 _handleWindowMessage 收到 Content 转发后 _emit。
   */
  async _startVerificationInternal() {
    if (!this.sessionId) throw new Error("Session not initialized");
    if (!this.signature) throw new Error("Signature not set");

    const templateData = {
      sessionId: this.sessionId,
      providerId: this.providerId,
      applicationId: this.applicationId,
      signature: this.signature,
      timestamp: this.timestamp,
      callbackUrl: this.callbackUrl || "",
      context: JSON.stringify(this.context || {}),
      parameters: this.parameters || {},
      redirectUrl: this.redirectUrl || "",
      acceptAiProviders: !!this.acceptAiProviders,
      sdkVersion: this.sdkVersion,
      providerVersion: this.providerVersion || "",
      resolvedProviderVersion: this.resolvedProviderVersion || "",
      jsonProofResponse: !!this.jsonProofResponse,
    };

    const messageId = this.sessionId;

    // 一次性 Promise：completed 时 resolve(payload)，error 时 reject(err)，并移除本次注册的监听
    return new Promise((resolve, reject) => {
      const offStarted = this.on("started", () => {});
      const offCompleted = this.on("completed", (payload) => {
        cleanup();
        resolve(payload);
      });
      const offError = this.on("error", (err) => {
        cleanup();
        reject(err);
      });
      const cleanup = () => {
        offStarted && offStarted();
        offCompleted && offCompleted();
        offError && offError();
      };
      console.log("templateData is :", templateData);
      console.log("_mode is :", this._mode);
      if (this._mode === "extension") {
        try {
          chrome.runtime.sendMessage(
            {
              action: "START_VERIFICATION",
              source: "content-script",
              target: "background",
              data: templateData,
            },
            (resp) => {
              if (resp && resp.success)
                this._emit("started", { sessionId: this.sessionId, messageId });
            },
          );
        } catch (e) {
          this._emit("error", e instanceof Error ? e : new Error(String(e)));
        }
      } else {
        // 网页环境：必须传 extensionID，由页面内 Content Script 根据 extensionID 校验后转发给 Background
        if (!this.extensionID) {
          this._emit("error", new Error("extensionID is required when running on a web page"));
          return;
        }
        window.postMessage(
          {
            action: RECLAIM_SDK_ACTIONS.START_VERIFICATION,
            messageId,
            data: templateData,
            extensionID: this.extensionID,
          },
          "*",
        );
      }
    });
  }

  /** 移除 window 与 chrome.runtime 的监听，并清空所有事件回调，避免泄漏 */
  dispose() {
    window.removeEventListener("message", this._boundWindowListener);
    if (this._boundChromeHandler && chrome?.runtime?.onMessage?.removeListener) {
      try {
        chrome.runtime.onMessage.removeListener(this._boundChromeHandler);
      } catch {}
    }
    this._listeners.started.clear();
    this._listeners.completed.clear();
    this._listeners.error.clear();
    this._listeners.progress.clear();
  }

  /** 调用后端 /api/sdk/init/session/ 创建会话，返回 { sessionId, resolvedProviderVersion } 等 */
  async _initSession(payload) {
    const res = await fetch(`${BACKEND_URL}/api/sdk/init/session/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || "Failed to initialize session");
    return data;
  }

  /** 向当前实例已订阅的 event 回调派发 payload */
  _emit(event, payload) {
    if (!this._listeners[event]) return;
    for (const cb of this._listeners[event]) {
      try {
        cb(payload);
      } catch (_) {}
    }
  }

  /**
   * 处理来自同源 window 的 postMessage：Content Script 会把 VERIFICATION_STARTED / COMPLETED / FAILED 转发到页面，
   * 这里根据 messageId 过滤是否为本会话，再 _emit 对应事件（web 模式下 started/completed/error 均由此驱动）。
   */
  _handleWindowMessage(event) {
    if (event.source !== window) return;
    const { action, messageId, data, error } = event.data || {};
    const isForMe = !this.sessionId || this.sessionId === messageId;
    if (!isForMe) return;

    if (action === RECLAIM_SDK_ACTIONS.VERIFICATION_COMPLETED) {
      const proofs = data?.proofs || data?.formattedProofs || data;
      this._emit("completed", proofs);
      return;
    }
    if (action === RECLAIM_SDK_ACTIONS.VERIFICATION_FAILED) {
      this._emit("error", error || new Error("Verification failed"));
      return;
    }
    if (action === RECLAIM_SDK_ACTIONS.VERIFICATION_STARTED) {
      this._emit("started", { sessionId: this.sessionId, messageId });
      return;
    }
  }
}

//  对外 SDK 单例
class ReclaimExtensionSDK {
  constructor() {
    this._backgroundInitialized = false;
    this._ctx = null;
    this._mode =
      typeof chrome !== "undefined" && chrome.runtime && location?.protocol === "chrome-extension:"
        ? "extension"
        : "web";
  }

  // Must be called from the consumer's own background service worker.
  initializeBackground() {
    if (this._backgroundInitialized) return this._ctx;
    try {
      const ctx = initBackground();
      this._backgroundInitialized = true;
      this._ctx = ctx;
      return ctx;
    } catch (error) {
      throw error;
    }
  }

  // 检查扩展程序是否已安装且与扩展ID匹配
  isExtensionInstalled({ extensionID, timeout = 500 } = {}) {
    return new Promise((resolve) => {
      const messageId = `reclaim-check-${Date.now()}`;
      const handler = (event) => {
        if (
          event.source === window &&
          event.data?.action === RECLAIM_SDK_ACTIONS.EXTENSION_RESPONSE &&
          event.data?.messageId === messageId
        ) {
          window.removeEventListener("message", handler);
          resolve(!!event.data.installed);
        }
      };
      window.addEventListener("message", handler);
      window.postMessage(
        { action: RECLAIM_SDK_ACTIONS.CHECK_EXTENSION, extensionID, messageId },
        "*",
      );
      setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve(false);
      }, timeout);
    });
  }

  getVersion() {
    return SDK_VERSION;
  }

  // 主要API：为每个请求创建一个实例
  async init(applicationId, appSecret, providerId, options = {}) {
    return await ReclaimExtensionProofRequest.init(applicationId, appSecret, providerId, options);
  }

  fromJsonString(json, options = {}) {
    return ReclaimExtensionProofRequest.fromJsonString(json, options);
  }

  /**
   * 设置日志配置并持久化存储
   * 扩展环境下直接存储到 chrome.storage，网页环境下通过 postMessage 委托给 content script
   */
  setLogConfig(config, extensionID) {
    loggerService.setConfig(config);

    // 在扩展上下文中，持久化到存储（传播到所有上下文）
    try {
      if (this._mode === "extension" && typeof chrome !== "undefined" && chrome.storage?.local) {
        const { LOG_CONFIG_STORAGE_KEY } = require("./utils/logger/constants");
        chrome.storage.local.set({
          [LOG_CONFIG_STORAGE_KEY]: { ...loggerService.config, ...config },
        });
        return;
      }
    } catch {}

    // 在网页上下文中，要求内容脚本持久化它
    window.postMessage(
      {
        action: RECLAIM_SDK_ACTIONS.SET_LOG_CONFIG,
        extensionID,
        data: { config },
      },
      "*",
    );
  }

  getLogConfig() {
    return loggerService.config;
  }
}

export const reclaimExtensionSDK = new ReclaimExtensionSDK();
export { ReclaimExtensionProofRequest };
export default ReclaimExtensionSDK;
