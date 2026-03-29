/**
 * Phần chung extension (không thuộc riêng dubbing).
 * Merge + default: extension-settings-esm.js — `chrome.storage.local` chỉ ghi adblockEnabled, showSubtitleOverlay, targetLang.
 */

export const STORAGE_KEY = "ytdub_settings_v3";

export const AD_BLOCK_DEFAULT = {
  adblockEnabled: true
};
