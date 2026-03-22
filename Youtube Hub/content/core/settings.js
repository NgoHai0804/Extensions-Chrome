(function ytdubCoreSettings() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  const DEFAULT_SETTINGS = {
    sourceLang: "auto",
    targetLang: "vi",
    showSubtitleOverlay: true,
    speechVolume: 1,
    /** Giây cắt hẳn ở cuối file TTS + chừa trước `end` cue trên timeline video. */
    ttsEndCutSec: 0.35,
    backgroundVideoVolume: 0.12,
    voiceDuckVideoVolume: 0.2,
    voiceUnduckRampSec: 1
  };

  const SUPPORTED_TARGET_LANGS = ["vi", "en", "ja", "ko", "zh-CN", "fr", "de", "es", "tr"];

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
