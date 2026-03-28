/** Đồng bộ default/merge với extension-settings-esm.js (popup + SW). */
(function ytdubCoreSettings() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  const DEFAULT_SETTINGS = {
    sourceLang: "auto",
    targetLang: "vi",
    showSubtitleOverlay: true,
    speechVolume: 1,
    /** Giây cắt hẳn ở cuối file TTS + chừa trước `end` cue trên timeline video. */
    ttsEndCutSec: 0.35,
    backgroundVideoVolume: 0.2,
    voiceDuckVideoVolume: 0.3,
    voiceUnduckRampSec: 1
  };

  const SUPPORTED_TARGET_LANGS = [
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

  function normalizeTargetLang(raw) {
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

  function normalizeTtsVoiceGender(raw) {
    return "auto";
  }

  function mergeExtensionSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    merged.sourceLang = "auto";
    delete merged.preferAutoCc;
    delete merged.captionKind;
    delete merged.ttsEngine;
    merged.targetLang = normalizeTargetLang(merged.targetLang);

    merged.ttsEndCutSec = Number(merged.ttsEndCutSec);
    if (!Number.isFinite(merged.ttsEndCutSec)) merged.ttsEndCutSec = DEFAULT_SETTINGS.ttsEndCutSec;
    merged.ttsEndCutSec = Math.min(1.0, Math.max(0, merged.ttsEndCutSec));

    merged.speechVolume = Number(merged.speechVolume);
    if (!Number.isFinite(merged.speechVolume)) merged.speechVolume = DEFAULT_SETTINGS.speechVolume;
    merged.speechVolume = Math.min(2, Math.max(0, merged.speechVolume));

    const subOn = merged.showSubtitleOverlay;
    merged.showSubtitleOverlay =
      subOn === false || subOn === "false" || subOn === 0 || subOn === "0" ? false : true;

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
    return merged;
  }

  core.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  core.SUPPORTED_TARGET_LANGS = SUPPORTED_TARGET_LANGS;
  core.normalizeTargetLang = normalizeTargetLang;
  core.mergeExtensionSettings = mergeExtensionSettings;
})();
