/** Cài đặt popup (chrome.storage.local) */
export const STORAGE_KEY = "ytdub_settings_v3";

export const DEFAULT_SETTINGS = {
  sourceLang: "auto",
  targetLang: "vi",
  /** Hiện dòng phụ đề dịch (overlay) trên video khi đang lồng tiếng */
  showSubtitleOverlay: true,
  speechVolume: 1,
  /** Trùng default với content/core/settings.js — chỉ dùng khi storage chưa có key. */
  ttsEndCutSec: 0.35,
  backgroundVideoVolume: 0.12,
  voiceDuckVideoVolume: 0.2,
  /** Thời gian (giây) tăng dần volume video về mức gốc sau khi TTS xong */
  voiceUnduckRampSec: 1
};

/** Mã `tl` hợp lệ cho Google Translate + khớp `<option value>` trong popup */
export const SUPPORTED_TARGET_LANGS = ["vi", "en", "ja", "ko", "zh-CN", "fr", "de", "es", "tr"];

/**
 * Chuẩn hóa mã ngôn ngữ đích (tránh storage cũ / nhập sai → tl=en hoặc tl rỗng).
 */
export function normalizeTargetLang(raw) {
  const fallback = DEFAULT_SETTINGS.targetLang;
  if (raw == null) return fallback;
  let s = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if (!s) return fallback;

  const aliases = {
    vn: "vi",
    vie: "vi",
    "vi-vn": "vi",
    vietnamese: "vi",
    "tiếng việt": "vi",
    "tieng viet": "vi",
    eng: "en",
    english: "en",
    "en-us": "en",
    "en-gb": "en",
    ja: "ja",
    japanese: "ja",
    jp: "ja",
    ko: "ko",
    korean: "ko",
    fr: "fr",
    french: "fr",
    de: "de",
    german: "de",
    es: "es",
    spanish: "es",
    español: "es",
    espanol: "es",
    tr: "tr",
    turkish: "tr",
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    zhcn: "zh-CN",
    "zh-hans": "zh-CN",
    "zh-sg": "zh-CN",
    cn: "zh-CN",
    chinese: "zh-CN",
    mandarin: "zh-CN"
  };
  if (aliases[s]) return aliases[s];

  const byLower = new Map(SUPPORTED_TARGET_LANGS.map((code) => [code.toLowerCase(), code]));
  if (byLower.has(s)) return byLower.get(s);

  return fallback;
}

export function normalizeTtsVoiceGender(raw) {
  return "auto";
}

/**
 * Gộp object từ storage với default, ép sourceLang = auto, chuẩn hóa targetLang & số.
 */
export function mergeExtensionSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
  merged.sourceLang = "auto";
  delete merged.preferAutoCc;
  delete merged.captionKind;
  merged.targetLang = normalizeTargetLang(merged.targetLang);

  merged.speechVolume = Number(merged.speechVolume);
  if (!Number.isFinite(merged.speechVolume)) merged.speechVolume = DEFAULT_SETTINGS.speechVolume;

  const subOn = merged.showSubtitleOverlay;
  merged.showSubtitleOverlay =
    subOn === false || subOn === "false" || subOn === 0 || subOn === "0" ? false : true;

  merged.ttsEndCutSec = Number(merged.ttsEndCutSec);
  if (!Number.isFinite(merged.ttsEndCutSec)) merged.ttsEndCutSec = DEFAULT_SETTINGS.ttsEndCutSec;
  merged.ttsEndCutSec = Math.min(1.0, Math.max(0, merged.ttsEndCutSec));

  merged.backgroundVideoVolume = Number(merged.backgroundVideoVolume);
  if (!Number.isFinite(merged.backgroundVideoVolume)) {
    merged.backgroundVideoVolume = DEFAULT_SETTINGS.backgroundVideoVolume;
  }
  merged.backgroundVideoVolume = Math.min(1, Math.max(0, merged.backgroundVideoVolume));

  merged.voiceDuckVideoVolume = Number(merged.voiceDuckVideoVolume);
  if (!Number.isFinite(merged.voiceDuckVideoVolume)) {
    merged.voiceDuckVideoVolume = DEFAULT_SETTINGS.voiceDuckVideoVolume;
  }
  merged.voiceDuckVideoVolume = Math.min(1, Math.max(0, merged.voiceDuckVideoVolume));

  merged.voiceUnduckRampSec = Number(merged.voiceUnduckRampSec);
  if (!Number.isFinite(merged.voiceUnduckRampSec)) {
    merged.voiceUnduckRampSec = DEFAULT_SETTINGS.voiceUnduckRampSec;
  }
  merged.voiceUnduckRampSec = Math.min(5, Math.max(0, merged.voiceUnduckRampSec));

  delete merged.speechPitch;
  delete merged.ttsVoiceGender;
  delete merged.ttsEngine;

  return merged;
}

/** chrome.storage.session: map videoId → { url, ts } */
export const TIMEDTEXT_SESSION_KEY = "ytdubTimedtextByVideo";

export const MESSAGE_TYPES = {
  translateTexts: "TRANSLATE_TEXTS",
  getCachedTimedtext: "GET_CACHED_TIMEDTEXT",
  /** npm `youtube-transcript` — chạy trong service worker */
  fetchYoutubeTranscript: "FETCH_YT_TRANSCRIPT_LIB",
  /** TTS: `translate.google.com/translate_tts` (giới hạn ~200 ký tự/lần; content script chia đoạn) */
  ttsGoogleGtx: "TTS_GOOGLE_GTTS"
};
