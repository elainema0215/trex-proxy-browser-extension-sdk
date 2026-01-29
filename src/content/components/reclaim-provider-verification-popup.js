/**
 * 创建 Reclaim 提供商验证弹窗
 * @param {string} providerName - 提供商名称
 * @param {string} description - 描述
 * @param {string} dataRequired - 所需数据说明
 * @param {string} sessionId - 会话 ID
 */
export function createProviderVerificationPopup(
  providerName,
  description,
  dataRequired,
  sessionId,
) {
  // 注入弹窗样式
  injectStyles();

  const popup = document.createElement("div");
  popup.id = "reclaim-protocol-popup";
  popup.className = "reclaim-popup";
  popup.style.animation = "reclaim-appear 0.3s ease-out";

  // 声明生成状态：总声明数、已完成数、是否已提交证明、是否进行中、错误信息
  const state = {
    totalClaims: 0,
    completedClaims: 0,
    proofSubmitted: false,
    inProgress: false,
    error: null,
  };

  // 拖拽状态：是否正在拖、鼠标与弹窗左上角的偏移
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  // 渲染初始 HTML 后初始化拖拽、复制、悬浮提示
  renderInitialContent().then(() => {
    // Initialize drag and copy functionality after content is rendered
    initializeDragFunctionality();
    initializeCopyFunctionality();
    initializeTooltipFunctionality();
  });

  // ---------- 样式与模板加载 ----------

  // 从扩展资源加载并注入 CSS
  async function loadCSS() {
    // Check if styles are already injected
    if (document.getElementById("reclaim-popup-styles")) {
      return;
    }

    try {
      const cssUrl = chrome.runtime.getURL(
        "reclaim-browser-extension-sdk/content/components/reclaim-provider-verification-popup.css",
      );
      const response = await fetch(cssUrl);
      const cssText = await response.text();

      const styleEl = document.createElement("style");
      styleEl.id = "reclaim-popup-styles";
      styleEl.textContent = cssText;

      // Handle document.head not being available yet
      const appendStyle = () => {
        if (document.head) {
          document.head.appendChild(styleEl);
        } else if (document.body) {
          document.body.appendChild(styleEl);
        } else {
          // If neither head nor body is available, try again later
          setTimeout(appendStyle, 10);
        }
      };

      appendStyle();
    } catch (error) {
      console.error("Failed to load Reclaim popup CSS:", error);
    }
  }

  // 从扩展资源加载 HTML 模板
  async function loadHTMLTemplate() {
    try {
      const htmlUrl = chrome.runtime.getURL(
        "reclaim-browser-extension-sdk/content/components/reclaim-provider-verification-popup.html",
      );
      const response = await fetch(htmlUrl);
      const htmlText = await response.text();
      return htmlText;
    } catch (error) {
      console.error("Failed to load Reclaim popup HTML template:", error);
      return "";
    }
  }

  // 触发 CSS 加载
  function injectStyles() {
    loadCSS();
  }

  // 用模板渲染弹窗初始内容，替换占位符为实际值
  async function renderInitialContent() {
    const htmlTemplate = await loadHTMLTemplate();

    if (!htmlTemplate) {
      console.error("Failed to load HTML template - popup will not render correctly");
      return;
    }

    // Replace template placeholders with actual values
    const renderedHTML = htmlTemplate
      // .replace(/\{\{logoUrl\}\}/g, chrome.runtime.getURL("assets/img/logo.png"))
      .replace(/\{\{providerName\}\}/g, providerName)
      .replace(/\{\{description\}\}/g, description)
      .replace(/\{\{dataRequired\}\}/g, dataRequired)
      .replace(/\{\{sessionId\}\}/g, sessionId);

    popup.innerHTML = renderedHTML;
  }

  // ---------- 交互：拖拽、复制、悬浮提示 ----------

  // 初始化标题栏拖拽移动弹窗
  function initializeDragFunctionality() {
    const header = popup.querySelector(".reclaim-popup-header");

    function handleMouseDown(e) {
      // Only allow dragging on left mouse button
      if (e.button !== 0) return;

      isDragging = true;
      popup.classList.add("dragging");

      // Calculate offset from mouse position to popup top-left corner
      const rect = popup.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      // Prevent text selection while dragging
      e.preventDefault();

      // Add global mouse event listeners
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    function handleMouseMove(e) {
      if (!isDragging) return;

      e.preventDefault();

      // Calculate new position
      let newX = e.clientX - dragOffset.x;
      let newY = e.clientY - dragOffset.y;

      // Get viewport dimensions
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popupWidth = popup.offsetWidth;
      const popupHeight = popup.offsetHeight;

      // Keep popup within viewport bounds
      newX = Math.max(0, Math.min(newX, viewportWidth - popupWidth));
      newY = Math.max(0, Math.min(newY, viewportHeight - popupHeight));

      // Update popup position
      popup.style.left = newX + "px";
      popup.style.top = newY + "px";
      popup.style.right = "auto";
      popup.style.bottom = "auto";
    }

    function handleMouseUp(e) {
      if (!isDragging) return;

      isDragging = false;
      popup.classList.remove("dragging");

      // Remove global mouse event listeners
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }

    // Add mousedown listener to header
    header.addEventListener("mousedown", handleMouseDown);

    // Prevent context menu on header to avoid interference
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }

  // 初始化复制按钮：复制目标元素文本到剪贴板并显示反馈
  function initializeCopyFunctionality() {
    const copyButton = popup.querySelector(".reclaim-copy-icon");
    const copyFeedback = popup.querySelector("#reclaim-copy-feedback");

    if (copyButton) {
      copyButton.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetId = copyButton.getAttribute("data-copy-target");
        const targetElement = popup.querySelector(`#${targetId}`);

        if (targetElement) {
          try {
            const textToCopy = targetElement.textContent.trim();

            // Use the Clipboard API if available
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(textToCopy);
              showCopyFeedback("Copied!");
            } else {
              // Fallback for older browsers
              const textArea = document.createElement("textarea");
              textArea.value = textToCopy;
              textArea.style.position = "fixed";
              textArea.style.left = "-9999px";
              textArea.style.top = "-9999px";
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();

              try {
                const successful = document.execCommand("copy");
                if (successful) {
                  showCopyFeedback("Copied!");
                } else {
                  showCopyFeedback("Failed to copy", true);
                }
              } catch (err) {
                showCopyFeedback("Failed to copy", true);
              }

              document.body.removeChild(textArea);
            }
          } catch (err) {
            showCopyFeedback("Failed to copy", true);
          }
        }
      });
    }

    function showCopyFeedback(message, isError = false) {
      if (copyFeedback) {
        copyFeedback.textContent = message;
        copyFeedback.style.color = isError ? "#ffffff" : "#ffffff";
        copyFeedback.style.background = isError
          ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
          : "linear-gradient(135deg, #10b981 0%, #059669 100%)";
        copyFeedback.classList.add("show");

        // Hide feedback after 2 seconds for more compact UX
        setTimeout(() => {
          copyFeedback.classList.remove("show");
        }, 2000);
      }
    }
  }

  // 为带 data-tooltip 的长文本初始化悬浮/点击显示完整内容的提示
  function initializeTooltipFunctionality() {
    const infoValues = popup.querySelectorAll(".reclaim-info-value[data-tooltip]");

    infoValues.forEach((element) => {
      const tooltipText = element.getAttribute("data-tooltip");
      const displayText = element.textContent.trim();

      // Only show tooltip if text is truncated
      if (tooltipText && tooltipText.length > 25) {
        let tooltip = null;
        let hoverTimeout = null;

        function showTooltip() {
          if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.className = "reclaim-info-tooltip";
            tooltip.textContent = tooltipText;
            element.appendChild(tooltip);
          }

          tooltip.classList.add("show");
        }

        function hideTooltip() {
          if (tooltip) {
            tooltip.classList.remove("show");
          }
        }

        element.addEventListener("mouseenter", () => {
          clearTimeout(hoverTimeout);
          hoverTimeout = setTimeout(showTooltip, 500);
        });

        element.addEventListener("mouseleave", () => {
          clearTimeout(hoverTimeout);
          hideTooltip();
        });

        // Also show tooltip on click for mobile
        element.addEventListener("click", (e) => {
          e.stopPropagation();
          if (tooltip && tooltip.classList.contains("show")) {
            hideTooltip();
          } else {
            showTooltip();
          }
        });
      }
    });

    // Hide all tooltips when clicking outside
    document.addEventListener("click", () => {
      const tooltips = popup.querySelectorAll(".reclaim-info-tooltip.show");
      tooltips.forEach((tooltip) => {
        tooltip.classList.remove("show");
      });
    });
  }

  // ---------- 状态 UI：加载中、进度条、成功、失败 ----------

  // 显示加载中：隐藏步骤、显示环形加载与进度条
  function showLoader(message = "Generating verification proof...") {
    const stepsContainer = popup.querySelector("#reclaim-steps-container");
    const statusContainer = popup.querySelector("#reclaim-status-container");
    const circularLoader = popup.querySelector("#reclaim-circular-loader");
    const progressContainer = popup.querySelector("#reclaim-status-progress");
    const statusText = popup.querySelector("#reclaim-status-text");
    const successIcon = popup.querySelector("#reclaim-success-icon");
    const errorIcon = popup.querySelector("#reclaim-error-icon");
    const contentContainer = popup.querySelector(".reclaim-popup-content");

    // Hide the steps using CSS classes instead of style manipulation
    if (stepsContainer) {
      stepsContainer.classList.add("hidden");
    }

    // Hide status icons
    if (successIcon) {
      successIcon.style.display = "none";
    }
    if (errorIcon) {
      errorIcon.style.display = "none";
    }

    // Show the status container using CSS classes
    statusContainer.classList.add("visible");
    contentContainer.classList.add("status-active");
    circularLoader.style.display = "flex";
    progressContainer.style.display = "block";
    statusText.textContent = message;

    state.inProgress = true;
    updateProgressBar();
  }

  // 根据已完成/总声明数更新进度条与计数显示
  function updateProgressBar() {
    const progressBar = popup.querySelector("#reclaim-progress-bar");
    const progressCounter = popup.querySelector("#reclaim-progress-counter");

    if (state.totalClaims > 0) {
      const percentage = state.completedClaims / state.totalClaims;
      // Use transform instead of width to avoid layout recalculations
      progressBar.style.transform = `scaleX(${percentage})`;
      progressCounter.textContent = `${state.completedClaims}/${state.totalClaims}`;
    } else {
      progressBar.style.transform = "scaleX(1)";
      progressBar.style.animation = "reclaim-progress-pulse 2s infinite";
      progressCounter.textContent = "";
    }
  }

  // 更新状态区副标题文案与颜色（错误时红色）
  function updateStatusMessage(message, isError = false) {
    const statusMessage = popup.querySelector("#reclaim-status-message");
    statusMessage.textContent = message;
    statusMessage.style.color = isError ? "#ef4444" : "rgba(255, 255, 255, 0.8)";
  }

  // 显示成功状态：进度条满、成功图标、提示即将跳回原页
  function showSuccess() {
    const stepsContainer = popup.querySelector("#reclaim-steps-container");
    const statusContainer = popup.querySelector("#reclaim-status-container");
    const circularLoader = popup.querySelector("#reclaim-circular-loader");
    const progressContainer = popup.querySelector("#reclaim-status-progress");
    const statusText = popup.querySelector("#reclaim-status-text");
    const progressBar = popup.querySelector("#reclaim-progress-bar");
    const progressCounter = popup.querySelector("#reclaim-progress-counter");
    const contentContainer = popup.querySelector(".reclaim-popup-content");

    // Hide the steps using CSS classes
    if (stepsContainer) {
      stepsContainer.classList.add("hidden");
    }

    // Hide circular loader
    circularLoader.style.display = "none";

    // Show success UI
    statusContainer.classList.add("visible");
    contentContainer.classList.add("status-active");
    progressContainer.style.display = "block";
    statusText.textContent = "Verification complete!";

    // Ensure progress bar is fully filled - use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      progressBar.style.width = "100%";
      progressBar.style.transform = "scaleX(1)";
      progressBar.classList.add("success");
      progressBar.style.animation = "none";
    });

    // Update progress counter to show completion
    if (state.totalClaims > 0) {
      progressCounter.textContent = `${state.totalClaims}/${state.totalClaims}`;
    } else {
      progressCounter.textContent = "100%";
    }

    updateStatusMessage("You will be redirected to the original page shortly.");

    // Show success icon
    const successIcon = popup.querySelector("#reclaim-success-icon");
    const errorIcon = popup.querySelector("#reclaim-error-icon");
    if (successIcon) {
      successIcon.style.display = "flex";
    }
    if (errorIcon) {
      errorIcon.style.display = "none";
    }
  }

  // 显示失败状态：错误图标与错误信息
  function showError(errorMessage) {
    const stepsContainer = popup.querySelector("#reclaim-steps-container");
    const statusContainer = popup.querySelector("#reclaim-status-container");
    const circularLoader = popup.querySelector("#reclaim-circular-loader");
    const progressContainer = popup.querySelector("#reclaim-status-progress");
    const statusText = popup.querySelector("#reclaim-status-text");
    const progressBar = popup.querySelector("#reclaim-progress-bar");
    const contentContainer = popup.querySelector(".reclaim-popup-content");

    // Hide the steps using CSS classes
    if (stepsContainer) {
      stepsContainer.classList.add("hidden");
    }

    // Hide circular loader
    circularLoader.style.display = "none";

    // Show error UI
    statusContainer.classList.add("visible");
    contentContainer.classList.add("status-active");
    progressContainer.style.display = "block";
    statusText.textContent = "Verification failed";
    progressBar.style.transform = "scaleX(1)";
    progressBar.classList.add("error");
    progressBar.style.animation = "none";

    updateStatusMessage(errorMessage, true);

    // Show error icon
    const errorIcon = popup.querySelector("#reclaim-error-icon");
    const successIcon = popup.querySelector("#reclaim-success-icon");
    if (errorIcon) {
      errorIcon.style.display = "flex";
    }
    if (successIcon) {
      successIcon.style.display = "none";
    }
  }

  // 声明总数 +1，用于多声明场景
  function incrementTotalClaims() {
    state.totalClaims += 1;
    updateProgressBar();
  }

  // 已完成声明数 +1，并刷新进度条
  function incrementCompletedClaims() {
    state.completedClaims += 1;
    updateProgressBar();
  }

  // 对外 API：弹窗 DOM、状态方法、以及后台消息对应的处理函数
  return {
    element: popup,
    showLoader,
    updateStatusMessage,
    showSuccess,
    showError,
    incrementTotalClaims,
    incrementCompletedClaims,

    // Handle various status updates from background
    handleClaimCreationRequested: (requestHash) => {
      incrementTotalClaims();
      showLoader("Creating verification claim...");
    },

    handleClaimCreationSuccess: (requestHash) => {
      updateStatusMessage("Claim created successfully. Generating proof...");
    },

    handleClaimCreationFailed: (requestHash) => {
      showError("Failed to create claim. Please try again.");
    },

    handleProofGenerationStarted: (requestHash) => {
      updateStatusMessage("Generating cryptographic proof...");
    },

    handleProofGenerationSuccess: (requestHash) => {
      incrementCompletedClaims();
      updateStatusMessage(`Proof generated (${state.completedClaims}/${state.totalClaims})`);
    },

    handleProofGenerationFailed: (requestHash) => {
      showError("Failed to generate proof. Please try again.");
    },

    handleProofSubmitted: () => {
      state.proofSubmitted = true;
      showSuccess();
    },

    handleProofSubmissionFailed: (error) => {
      showError(`Failed to submit proof: ${error}`);
    },
  };
}
