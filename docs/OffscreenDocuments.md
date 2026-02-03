# Chrome Extension Offscreen Documents 详解

## 0. 术语解释：Manifest Version 3 (MV3)
**Manifest Version 3** (简称 MV3) 是 Google Chrome 浏览器扩展程序（Chrome Extension）平台的最新版本规范。它是对扩展程序系统的一次重大架构升级，旨在取代旧版的 Manifest Version 2 (MV2)。

其主要目标包括：
*   **安全性 (Security)**: 限制扩展程序执行远程托管的代码，降低恶意软件风险。
*   **隐私性 (Privacy)**: 改进权限系统，让用户对扩展程序访问网站数据的行为有更多控制权。
*   **性能 (Performance)**: 引入 **Service Worker** 来替代旧版的后台页面（Background Pages），以减少内存占用和提高浏览器启动速度。

简单来说，Manifest Version 3 是目前及未来开发 Chrome 扩展程序必须遵循的标准和规则集。

## 1. 核心概念：它是什么？
在 **Manifest Version 3** 架构中，**Offscreen Document (离屏文档)** 是一个特殊的、隐藏的 HTML 页面。它允许扩展程序在不打开可见标签页或窗口的情况下，运行需要完整 DOM 访问权限的代码。

## 2. 为什么需要它？(背景与痛点)
这是为了解决 MV3 架构中的一个关键痛点：
*   **MV3 的核心是 Service Worker**：MV3 使用 Service Worker 作为后台脚本。Service Worker 运行在独立的线程中，**没有访问 DOM (Document Object Model) 的权限**（例如 `document`、`window` 对它是不可用的）。
*   **功能受限**：许多在 MV2 后台页面（Background Page）中能做的事情（如解析 HTML 字符串、剪切板操作、音频播放），在 Service Worker 中无法直接完成，因为它们依赖 DOM API。
*   **Offscreen 的作用**：它充当了一个“助手”。当 Service Worker 需要用到 DOM API 时，它可以创建一个临时的 Offscreen Document，把任务派发给它，处理完后再关闭。

## 3. 核心特性与限制
根据官方 API (`chrome.offscreen`)，它有以下严格的规定：

*   **完全不可见**：它不会出现在用户的标签页栏、窗口列表或屏幕上。它在后台悄悄运行。
*   **单例模式**：每个扩展程序在同一时间**只能打开一个** Offscreen Document。如果你尝试打开第二个，会报错。
*   **不允许用户交互**：它是非交互式的，不可以被聚焦（Focus）。
*   **受限的生存周期**：它不应该像 MV2 的 Background Page 那样一直常驻。官方建议**用完即关**，即处理完特定任务后应立即关闭，以节省内存。
*   **权限声明**：必须在 `manifest.json` 中声明 `"offscreen"` 权限。

## 4. 常见的使用场景 (Valid Reasons)
Google 对 Offscreen Document 的使用有严格的语义要求。当你创建它时，必须声明**原因 (Reason)**，这些原因被硬编码在 API 枚举中：

1.  **`DOM_PARSER` / `DOM_SCRAPING`**：
    *   **场景**：Service Worker 获取了一段 HTML 字符串，想用 `DOMParser` 去解析它并提取数据。
    *   **解释**：这是最常用的场景。Service Worker 无法解析 DOM，所以交给 Offscreen 处理。

2.  **`CLIPBOARD`**：
    *   **场景**：读写系统剪切板。
    *   **解释**：剪切板操作通常依赖 DOM 元素（如聚焦隐藏的 input 框），这在 Service Worker 中做不到。

3.  **`AUDIO_PLAYBACK`**：
    *   **场景**：在后台播放音频。
    *   **解释**：Service Worker 本身不能播放音频。如果你想做一个背景音乐播放器或消息提示音，需要 Offscreen。

4.  **`IFRAME_SCRIPTING` / `BLOBS`**：
    *   **场景**：需要在隔离的 iframe 中运行不可信的代码，或者处理 Blob 对象。

## 5. 生命周期管理 (代码逻辑)

1.  **创建 (Create)**： Service Worker 检查是否已有 Offscreen Document。如果没有，调用 `chrome.offscreen.createDocument()`。
    *   参数包含：`url` (HTML 文件路径), `reasons` (用途数组), `justification` (用途说明字符串)。
2.  **通信 (Message)**： Service Worker 通过 `chrome.runtime.sendMessage` 发送指令给 Offscreen Document。
3.  **执行 (Execute)**： Offscreen Document 里的 JS 接收消息，利用 DOM API 执行任务（如解析 HTML）。
4.  **反馈 (Reply)**： 任务完成后，Offscreen Document 将结果发回给 Service Worker。
5.  **销毁 (Close)**： 任务结束，调用 `chrome.offscreen.closeDocument()` 销毁文档。

## 总结
Offscreen Document 是 **Manifest Version 3** 时代 Service Worker 缺失 DOM 能力的官方补丁。它虽然拥有完整的 DOM 环境，但它被设计为**临时性的、单一用途的**工具，而不是用来替代旧版 Background Page 的常驻运行环境。
