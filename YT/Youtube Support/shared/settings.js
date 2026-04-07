/**
 * Phần chung extension (không thuộc riêng dubbing).
 * Merge + default: extension-settings-esm.js — `chrome.storage.local` ghi adblockEnabled, showSubtitleOverlay, targetLang, speechVolume, youtubeAriaFocusFix.
 */

export const STORAGE_KEY = "ytdub_settings_v3";

/** GET …/api/v1/keys — tham số extension, key, clientVersion */
export const KEY_CHECK_API_BASE = "https://serverextension.ngongochai0804.workers.dev/api/v1/keys";

/** Slug extension trên server (tham số `extension`) */
export const EXTENSION_SLUG = "youtube";

/**
 * Chu kỳ gọi lại API kiểm tra key (content: setInterval; SW: chrome.alarms).
 * Không lưu kết quả vào `chrome.storage.local`.
 */
export const LICENSE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** `chrome.tabs.sendMessage` / `runtime.onMessage` — SW → content kiểm tra lại key */
export const LICENSE_RECHECK_MESSAGE_TYPE = "YTDUB_LICENSE_RECHECK";

export const AD_BLOCK_DEFAULT = {
  adblockEnabled: true
};
