/**
 * @fileoverview 证明生成队列模块（Background 层）
 *
 * 主要功能：
 * - 将验证流程中收集到的 claim 数据按请求入队，串行执行证明生成，避免并发冲突。
 * - 队列为空时根据 provider 的 requestData 模板判断是否已收集齐所有所需证明，满足则触发提交或恢复会话计时器。
 *
 * 逻辑与流程：
 * 1. 入队：addToProofGenerationQueue 将 { claimData, requestHash } 推入 ctx.proofGenerationQueue；
 *    若当前未在处理队列，则暂停会话计时器并启动 processNextQueueItem。
 * 2. 出队与执行：processNextQueueItem 在未 aborted 且队列非空时，设置 isProcessingQueue，
 *    取队首任务，向 content script 发送 PROOF_GENERATION_STARTED，调用 ctx.generateProof 生成证明。
 * 3. 结果处理：成功则写入 ctx.generatedProofs、发送 PROOF_GENERATION_SUCCESS、重置会话计时器；
 *    失败则调用 ctx.failSession 并返回。finally 中置 isProcessingQueue = false。
 * 4. 队列清空时：若有 requestData 模板，则比较已生成证明数量与模板数量，全部完成则 clearAllTimers 并
 *    setTimeout(submitProofs)；否则 resumeSessionTimer。无模板（手动模式）则直接 clearAllTimers 并 submitProofs。
 * 5. 全程受 ctx.aborted 控制，aborted 时不再处理新任务并提前返回。
 *
 * @module background/proofQueue
 */

import { LOG_TYPES, LOG_LEVEL, EVENT_TYPES } from "../utils/logger";

/**
 * 将一条证明生成任务加入队列；若当前未在处理队列则暂停会话计时器并开始处理队首。
 * @param {object} ctx - 背景脚本上下文（含 proofGenerationQueue、isProcessingQueue、sessionTimerManager 等）
 * @param {object} claimData - 用于生成证明的 claim 数据
 * @param {string} requestHash - 请求哈希，用于标识模板/请求
 */
export function addToProofGenerationQueue(ctx, claimData, requestHash) {
  ctx.proofGenerationQueue.push({
    claimData,
    requestHash,
  });

  if (!ctx.isProcessingQueue) {
    ctx.sessionTimerManager.pauseSessionTimer();
    processNextQueueItem(ctx);
  }
}

/**
 * 处理队列中的下一个证明生成任务：取队首、通知 content script、调用 generateProof、写回结果或 failSession；
 * 队列清空时根据模板完成情况决定提交证明或恢复会话计时器。
 * @param {object} ctx - 背景脚本上下文
 * @returns {Promise<void>}
 */
export async function processNextQueueItem(ctx) {
  const bgLogger = ctx.bgLogger;
  bgLogger.setContext({
    sessionId: ctx.sessionId || "unknown",
    providerId: ctx.providerId || "unknown",
    appId: ctx.appId || "unknown",
    type: LOG_TYPES.BACKGROUND,
  });

  if (ctx.aborted) {
    bgLogger.info({
      message: "[BACKGROUND] Proof generation queue aborted",
      logLevel: LOG_LEVEL.INFO,
      type: LOG_TYPES.BACKGROUND,
      eventType: EVENT_TYPES.RECLAIM_VERIFICATION_DISMISSED,
    });
    return;
  }

  if (ctx.isProcessingQueue || ctx.proofGenerationQueue.length === 0) {
    if (ctx.proofGenerationQueue.length === 0) {
      const templateCount = Array.isArray(ctx.providerData?.requestData)
        ? ctx.providerData.requestData.length
        : 0;

      if (templateCount > 0) {
        const completedTemplate = ctx.providerData.requestData.filter((rd) =>
          ctx.generatedProofs.has(rd.requestHash),
        ).length;

        if (completedTemplate === templateCount) {
          ctx.sessionTimerManager.clearAllTimers();
          if (!ctx.expectManyClaims) setTimeout(() => ctx.submitProofs(), 0);
        } else {
          ctx.sessionTimerManager.resumeSessionTimer();
        }
      } else {
        // Manual mode: queue is empty → submit whatever we have
        ctx.sessionTimerManager.clearAllTimers();
        if (!ctx.expectManyClaims) setTimeout(() => ctx.submitProofs(), 0);
      }
      return;
    }
    ctx.sessionTimerManager.resumeSessionTimer();
  }

  ctx.isProcessingQueue = true;

  const task = ctx.proofGenerationQueue.shift();

  try {
    if (ctx.aborted) {
      bgLogger.info({
        message: "[BACKGROUND] Proof generation aborted",
        logLevel: LOG_LEVEL.INFO,
        type: LOG_TYPES.BACKGROUND,
        eventType: EVENT_TYPES.PROOF_GENERATION_ABORTED,
      });
      return;
    }

    chrome.tabs.sendMessage(ctx.activeTabId, {
      action: ctx.MESSAGE_ACTIONS.PROOF_GENERATION_STARTED,
      source: ctx.MESSAGE_SOURCES.BACKGROUND,
      target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
      data: { requestHash: task.requestHash },
    });

    bgLogger.info({
      message: "[BACKGROUND] Proof generation started for request hash: " + task.requestHash,
      logLevel: LOG_LEVEL.INFO,
      type: LOG_TYPES.BACKGROUND,
    });

    const proofResponseObject = await ctx.generateProof(
      {
        ...task.claimData,
        publicData: ctx.publicData ?? null,
      },
      bgLogger,
    );

    if (ctx.aborted) {
      bgLogger.info({
        message: "[BACKGROUND] Proof generation aborted",
        logLevel: LOG_LEVEL.INFO,
        type: LOG_TYPES.BACKGROUND,
        eventType: EVENT_TYPES.PROOF_GENERATION_ABORTED,
      });
      return;
    }

    if (!proofResponseObject.success) {
      bgLogger.error({
        message:
          "[BACKGROUND] Proof generation failed for request hash: " +
          task.requestHash +
          ": " +
          proofResponseObject.error,
        logLevel: LOG_LEVEL.INFO,
        type: LOG_TYPES.BACKGROUND,
      });
      ctx.failSession("Proof generation failed: " + proofResponseObject.error, task.requestHash);
      return;
    }

    const proof = proofResponseObject.proof;

    if (proof) {
      if (!ctx.generatedProofs.has(task.requestHash)) {
        ctx.generatedProofs.set(task.requestHash, proof);
      }

      bgLogger.info({
        message: "[BACKGROUND] Proof generation successful for request hash: " + task.requestHash,
        logLevel: LOG_LEVEL.INFO,
        type: LOG_TYPES.BACKGROUND,
      });

      chrome.tabs.sendMessage(ctx.activeTabId, {
        action: ctx.MESSAGE_ACTIONS.PROOF_GENERATION_SUCCESS,
        source: ctx.MESSAGE_SOURCES.BACKGROUND,
        target: ctx.MESSAGE_SOURCES.CONTENT_SCRIPT,
        data: { requestHash: task.requestHash },
      });

      ctx.sessionTimerManager.resetSessionTimer();
    }
  } catch (error) {
    bgLogger.error({
      message:
        "[BACKGROUND] Proof generation failed for request hash: " +
        task.requestHash +
        ": " +
        error?.message,
      logLevel: LOG_LEVEL.INFO,
      type: LOG_TYPES.BACKGROUND,
    });

    ctx.failSession("Proof generation failed: " + error.message, task.requestHash);
    return;
  } finally {
    ctx.isProcessingQueue = false;

    if (ctx.aborted) return;

    if (ctx.proofGenerationQueue.length > 0) {
      processNextQueueItem(ctx);
    } else {
      const templateCount = Array.isArray(ctx.providerData?.requestData)
        ? ctx.providerData.requestData.length
        : 0;

      if (templateCount > 0) {
        const completedTemplate = ctx.providerData.requestData.filter((rd) =>
          ctx.generatedProofs.has(rd.requestHash),
        ).length;

        ctx.sessionTimerManager.clearAllTimers();
        if (completedTemplate === templateCount) {
          if (!ctx.expectManyClaims) setTimeout(() => ctx.submitProofs(), 0);
        } else {
          ctx.sessionTimerManager.resumeSessionTimer();
        }
      } else {
        // Manual mode: queue is empty → submit whatever we have
        ctx.sessionTimerManager.clearAllTimers();
        if (!ctx.expectManyClaims) setTimeout(() => ctx.submitProofs(), 0);
      }
    }
  }
}
