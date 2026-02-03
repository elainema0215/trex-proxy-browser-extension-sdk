/**
 * @fileoverview Tab Manager - 标签页管理器
 * @description 负责 Background Script 中的标签页生命周期管理。
 * 暂时未使用
 */

export function createProviderTab(ctx, providerUrl, providerId) {
  // Implementation will be filled in after moving logic from background.js
}

export function isManagedTab(ctx, tabId) {
  return ctx.managedTabs.has(tabId);
}

export function removeManagedTab(ctx, tabId) {
  ctx.managedTabs.delete(tabId);
}
