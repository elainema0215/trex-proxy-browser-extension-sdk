// Import polyfills
import "../polyfills";

import { MESSAGE_ACTIONS, MESSAGE_SOURCES } from "../constants/index";
import { ensureOffscreenDocument } from "../offscreen-manager";
import { EVENT_TYPES, LOG_LEVEL, LOG_TYPES } from "../logger/constants";

/**
 * 在 Background 中调用：确保 offscreen 文档就绪后，将 claimData 通过消息发给 offscreen，
 * 由 offscreen 内的 createClaimOnAttestor 连 attestor 做证明生成。本函数等待 offscreen
 * 回传 GENERATE_PROOF_RESPONSE（成功则 resolve(response)，失败则 resolve({ success: false, error })），
 * 或 60 秒超时 / 发送失败时 reject。
 */
export const generateProof = async (claimData, bgLogger) => {
  const proofLogger = bgLogger;

  try {
    proofLogger.setContext({
      sessionId: claimData.sessionId || "unknown",
      providerId: claimData.providerId || "unknown",
      appId: claimData.applicationId || "unknown",
    });

    if (!claimData) {
      proofLogger.error({
        message: "[PROOF-GENERATOR] No claim data provided for proof generation",
        logLevel: LOG_LEVEL.INFO,
        type: LOG_TYPES.PROOF,
      });
      throw new Error("No claim data provided for proof generation");
    }
    // 确保 offscreen 文档已创建并处于可接收消息状态
    await ensureOffscreenDocument(proofLogger);

    // 注册一次性的 GENERATE_PROOF_RESPONSE 监听，向 offscreen 发送 GENERATE_PROOF + claimData，超时或发送失败则 reject
    return new Promise((resolve, reject) => {
      const messageTimeout = setTimeout(() => {
        proofLogger.error({
          message: "[PROOF-GENERATOR] Timeout waiting for offscreen document to generate proof",
          logLevel: LOG_LEVEL.ERROR,
          type: LOG_TYPES.PROOF,
        });
        reject({
          success: false,
          error: "Timeout waiting for offscreen document to generate proof",
        });
      }, 60000); // 60 second timeout

      // Create a message listener for the offscreen response
      const messageListener = (response) => {
        if (
          response.action === MESSAGE_ACTIONS.GENERATE_PROOF_RESPONSE &&
          response.source === MESSAGE_SOURCES.OFFSCREEN &&
          response.target === MESSAGE_SOURCES.BACKGROUND
        ) {
          // Clear timeout and remove listener
          clearTimeout(messageTimeout);
          chrome.runtime.onMessage.removeListener(messageListener);

          proofLogger.all({
            message: "[PROOF-GENERATOR] Offscreen response: " + JSON.stringify(response),
            logLevel: LOG_LEVEL.ALL,
            type: LOG_TYPES.PROOF,
            meta: { response },
          });

          // Check if the proof generation was successful
          if (!response.success) {
            proofLogger.error({
              message: "[PROOF-GENERATOR] Proof generation failed:",
              logLevel: LOG_LEVEL.ERROR,
              type: LOG_TYPES.PROOF,
              meta: { error: response.error },
            });
            resolve({
              success: false,
              error: response.error || "Unknown error in proof generation",
            });
            return;
          }

          // Edge case: success=true but proof contains an error
          const embeddedErr =
            response?.proof?.error?.message ||
            (typeof response?.proof?.error === "string" ? response.proof.error : null);
          if (embeddedErr) {
            proofLogger.error({
              message: "[PROOF-GENERATOR] Proof contains embedded error: " + embeddedErr,
              logLevel: LOG_LEVEL.ERROR,
              type: LOG_TYPES.PROOF,
              meta: { error: embeddedErr },
            });
            resolve({ success: false, error: embeddedErr });
            return;
          }
          // Return the successful response
          proofLogger.info({
            message: "[PROOF-GENERATOR] Proof generation successful",
            logLevel: LOG_LEVEL.INFO,
            type: LOG_TYPES.PROOF,
          });
          resolve(response);
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);

      // 把 claimData 发给 offscreen；offscreen 内会调用 createClaimOnAttestor(claimData) 连 attestor 生成 proof，再回传 GENERATE_PROOF_RESPONSE
      chrome.runtime.sendMessage(
        {
          action: MESSAGE_ACTIONS.GENERATE_PROOF,
          source: MESSAGE_SOURCES.BACKGROUND,
          target: MESSAGE_SOURCES.OFFSCREEN,
          data: claimData,
        },
        () => {
          if (chrome.runtime.lastError) {
            clearTimeout(messageTimeout);
            chrome.runtime.onMessage.removeListener(messageListener);
            proofLogger.error({
              message:
                "[PROOF-GENERATOR] Error sending message to offscreen document " +
                chrome.runtime.lastError.message,
              logLevel: LOG_LEVEL.ERROR,
              type: LOG_TYPES.PROOF,
              meta: { error: chrome.runtime.lastError.message },
            });
            reject({
              success: false,
              error:
                chrome.runtime.lastError.message || "Error communicating with offscreen document",
            });
          }
        },
      );
    });
  } catch (error) {
    proofLogger.error({
      message: "[PROOF-GENERATOR] Error in proof generation process: " + error.message,
      logLevel: LOG_LEVEL.ERROR,
      type: LOG_TYPES.PROOF,
      meta: { error },
    });
    return {
      success: false,
      error: error.message || "Unknown error in proof generation process",
    };
  }
};
