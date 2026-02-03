# Trex Extension Offscreen Logic Analysis

通过对 `trex-extension` 项目代码的深度分析，目前的 **Offscreen Document (离屏文档)** 及其相关逻辑主要集中在 **Reclaim SDK** 内部，主业务代码中并没有直接使用。

以下是详细的代码分布与功能分析：

### 1. 核心配置文件
*   **文件**: `/Users/elaine/Desktop/trex-extension/manifest.json`
*   **代码位置**:
    *   `permissions`: 第 44 行声明了 `"offscreen"` 权限。
    *   `web_accessible_resources`: 第 116-117 行暴露了 SDK 内部的离屏资源：
        ```json
        "reclaim-browser-extension-sdk/offscreen/offscreen.html",
        "reclaim-browser-extension-sdk/offscreen/offscreen.bundle.js",
        ```

### 2. 实现代码 (SDK 内部)
Offscreen 的实际创建和逻辑处理被封装在 `reclaim-browser-extension-sdk` 中，而不是在 `src/` 源码里。

*   **创建者 (Creator)**:
    *   **文件**: `/Users/elaine/Desktop/trex-extension/public/reclaim-browser-extension-sdk/ReclaimExtensionSDK.bundle.js`
    *   **逻辑**: SDK 在初始化时会调用 `chrome.offscreen.createDocument`。
    *   **参数**:
        *   `url`: 指向 `reclaim-browser-extension-sdk/offscreen/offscreen.html`
        *   `reasons`: `['DOM_PARSER', 'IFRAME_SCRIPTING', 'BLOBS']`
        *   **用途**: 代码注释表明它主要用于 "Manages DOM-dependent operations like crypto and ZK proof generation"（处理加密和 ZK 零知识证明生成等依赖 DOM 的操作）。

*   **执行者 (The Document)**:
    *   **文件**: `/Users/elaine/Desktop/trex-extension/public/reclaim-browser-extension-sdk/offscreen/offscreen.html`
    *   **内容**: 一个极简的 HTML 外壳，只负责加载 `offscreen.bundle.js`。
    *   **文件**: `/Users/elaine/Desktop/trex-extension/public/reclaim-browser-extension-sdk/offscreen/offscreen.bundle.js`
    *   **内容**: 包含实际执行 DOM 解析、加密计算的具体 JS 逻辑。

### 总结
目前的架构非常清晰：
1.  **业务层 (`src/`)**: **不包含** Offscreen API 的直接调用。
2.  **底层能力 (`public/sdk`)**: Reclaim SDK **全权管理** 离屏文档的生命周期，用于处理复杂的 ZK 证明生成。
3.  **配置层 (`manifest.json`)**: 仅声明权限和资源访问。
