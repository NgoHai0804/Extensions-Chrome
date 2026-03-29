/**
 * Cài đặt lồng tiếng + message SW (ESM — popup & service worker import).
 * Khóa storage và adblock mặc định: shared/settings.js
 */
import { STORAGE_KEY, AD_BLOCK_DEFAULT } from "../../../shared/settings.js";

export { STORAGE_KEY };

const DUBBING_DEFAULTS = {
  sourceLang: "auto",
  targetLang: "vi",
  showSubtitleOverlay: true,
  speechVolume: 1,
  ttsEndCutSec: 0.35,
  backgroundVideoVolume: 0.12,
  voiceDuckVideoVolume: 0.2,
  voiceUnduckRampSec: 1
};

export const DEFAULT_SETTINGS = { ...DUBBING_DEFAULTS, ...AD_BLOCK_DEFAULT };

/** Mã ngôn ngữ đích hợp lệ (Google Translate + popup). */
export const SUPPORTED_TARGET_LANGS = [
  "ar",
  "bn",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fa",
  "fi",
  "fr",
  "he",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sv",
  "th",
  "tl",
  "tr",
  "uk",
  "vi",
  "zh-CN",
  "zh-TW"
];

export function normalizeTargetLang(raw) {
  const fallback = DUBBING_DEFAULTS.targetLang;
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
    "tr-tr": "tr",
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    zhcn: "zh-CN",
    "zh-hans": "zh-CN",
    "zh-sg": "zh-CN",
    cn: "zh-CN",
    chinese: "zh-CN",
    mandarin: "zh-CN",
    "zh-tw": "zh-TW",
    zhtw: "zh-TW",
    "zh-hant": "zh-TW",
    "zh-hk": "zh-TW",
    "zh-mo": "zh-TW",
    tw: "zh-TW",
    it: "it",
    italian: "it",
    italiano: "it",
    pt: "pt",
    "pt-br": "pt",
    "pt-pt": "pt",
    portuguese: "pt",
    português: "pt",
    portugues: "pt",
    ru: "ru",
    russian: "ru",
    ar: "ar",
    arabic: "ar",
    hi: "hi",
    hindi: "hi",
    nl: "nl",
    dutch: "nl",
    nederlands: "nl",
    pl: "pl",
    polish: "pl",
    polski: "pl",
    uk: "uk",
    ukrainian: "uk",
    українська: "uk",
    id: "id",
    indonesian: "id",
    th: "th",
    thai: "th",
    sv: "sv",
    swedish: "sv",
    svenska: "sv",
    da: "da",
    danish: "da",
    dansk: "da",
    fi: "fi",
    finnish: "fi",
    suomi: "fi",
    no: "no",
    nb: "no",
    nn: "no",
    norwegian: "no",
    norsk: "no",
    cs: "cs",
    czech: "cs",
    čeština: "cs",
    el: "el",
    greek: "el",
    ελληνικά: "el",
    hu: "hu",
    hungarian: "hu",
    magyar: "hu",
    ro: "ro",
    romanian: "ro",
    română: "ro",
    he: "he",
    hebrew: "he",
    עברית: "he",
    fa: "fa",
    persian: "fa",
    farsi: "fa",
    فارسی: "fa",
    bn: "bn",
    bengali: "bn",
    বাংলা: "bn",
    tl: "tl",
    fil: "tl",
    filipino: "tl",
    tagalog: "tl",
    ms: "ms",
    malay: "ms",
    melayu: "ms"
  };
  if (aliases[s]) return aliases[s];

  const byLower = new Map(SUPPORTED_TARGET_LANGS.map((code) => [code.toLowerCase(), code]));
  if (byLower.has(s)) return byLower.get(s);

  return fallback;
}

export function normalizeTtsVoiceGender() {
  return "auto";
}

export function mergeExtensionSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
  merged.sourceLang = "auto";
  delete merged.preferAutoCc;
  delete merged.captionKind;
  merged.targetLang = normalizeTargetLang(merged.targetLang);

  merged.speechVolume = Number(merged.speechVolume);
  if (!Number.isFinite(merged.speechVolume)) merged.speechVolume = DEFAULT_SETTINGS.speechVolume;
  merged.speechVolume = Math.min(2, Math.max(0, merged.speechVolume));

  const adOn = merged.adblockEnabled;
  merged.adblockEnabled =
    adOn === false || adOn === "false" || adOn === 0 || adOn === "0" ? false : true;

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

/**
 * Chỉ lưu 3 khóa vào `chrome.storage.local` — còn lại mỗi lần đọc hợp nhất với DEFAULT_SETTINGS.
 */
export function buildPersistedStoragePayload(raw) {
  const m = mergeExtensionSettings(raw && typeof raw === "object" ? raw : {});
  return {
    adblockEnabled: m.adblockEnabled,
    showSubtitleOverlay: m.showSubtitleOverlay,
    targetLang: m.targetLang
  };
}

/** Session: videoId → { url, ts, status } — status = HTTP khi onCompleted (kể cả 429) */
export const TIMEDTEXT_SESSION_KEY = "ytdubTimedtextByVideo";

export const MESSAGE_TYPES = {
  translateTexts: "TRANSLATE_TEXTS",
  getCachedTimedtext: "GET_CACHED_TIMEDTEXT",
  fetchYoutubeTranscript: "FETCH_YT_TRANSCRIPT_LIB",
  ttsGoogleGtx: "TTS_GOOGLE_GTTS"
};
