/** State, UI shell, hằng số — các script sau gắn lên __YTDUB_V3. */
(function ytdubRuntime() {
  const w = window;
  const CORE = (w.__YTDUB_CORE = w.__YTDUB_CORE || {});
  const DUBBING_CONFIG = CORE.DUBBING_CONFIG || {};

  const STORAGE_KEY = "ytdub_settings_v3";
  const DEFAULT_SETTINGS = CORE.DEFAULT_SETTINGS || {
    sourceLang: "auto",
    targetLang: "vi",
    showSubtitleOverlay: true,
    speechVolume: 1,
    ttsEndCutSec: 0.35,
    backgroundVideoVolume: 0.12,
    voiceDuckVideoVolume: 0.2,
    voiceUnduckRampSec: 1
  };
  const mergeExtensionSettings =
    CORE.mergeExtensionSettings ||
    function mergeExtensionSettings(raw) {
      return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    };

  const SNAPSHOT_MSG = CORE.SNAPSHOT_MSG || "YTDUB_V2_SNAPSHOT";
  const MSG_TRANSLATE = CORE.MSG_TRANSLATE || "TRANSLATE_TEXTS";
  const MSG_CACHED_TT = CORE.MSG_CACHED_TT || "GET_CACHED_TIMEDTEXT";
  const MSG_FETCH_YT_LIB = CORE.MSG_FETCH_YT_LIB || "FETCH_YT_TRANSCRIPT_LIB";
  const MSG_FETCH_TIMEDTEXT_BODY = CORE.MSG_FETCH_TIMEDTEXT_BODY || "FETCH_TIMEDTEXT_BODY";
  const MSG_TTS_GOOGLE_GTTS = CORE.MSG_TTS_GOOGLE_GTTS || "TTS_GOOGLE_GTTS";
  const TARGET_LANG_TO_GOOGLE_TTS = CORE.TARGET_LANG_TO_GOOGLE_TTS || {
    ar: "ar",
    bn: "bn",
    cs: "cs",
    da: "da",
    de: "de",
    el: "el",
    en: "en",
    es: "es",
    fa: "fa",
    fi: "fi",
    fr: "fr",
    he: "he",
    hi: "hi",
    hu: "hu",
    id: "id",
    it: "it",
    ja: "ja",
    ko: "ko",
    ms: "ms",
    nl: "nl",
    no: "no",
    pl: "pl",
    pt: "pt",
    ro: "ro",
    ru: "ru",
    sv: "sv",
    th: "th",
    tl: "tl",
    tr: "tr",
    uk: "uk",
    vi: "vi",
    "zh-CN": "zh-cn",
    "zh-TW": "zh-tw"
  };
  const chunkForGoogleTts =
    CORE.chunkForGoogleTts ||
    function chunkForGoogleTts(text, maxLen) {
      const cap = typeof maxLen === "number" ? maxLen : 180;
      const t = String(text).replace(/\s+/g, " ").trim();
      if (!t) return [];
      const out = [];
      let i = 0;
      while (i < t.length) {
        let end = Math.min(i + cap, t.length);
        if (end < t.length) {
          const chunk = t.slice(i, end);
          const sp = chunk.lastIndexOf(" ");
          if (sp > Math.floor(cap * 0.45)) end = i + sp;
        }
        let piece = t.slice(i, end).trim();
        if (piece.length > cap) piece = piece.slice(0, cap);
        if (piece) out.push(piece);
        i = end;
        while (i < t.length && t[i] === " ") i += 1;
      }
      return out;
    };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    snapshot: null,
    phase: "idle",
    cues: [],
    /** Bù start để khớp đổi dòng CC trên player. */
    cueSyncLeadSec: Number.isFinite(Number(DUBBING_CONFIG.cueSyncLeadSec))
      ? Number(DUBBING_CONFIG.cueSyncLeadSec)
      : 0.22,
    subtitleTrackLang: "",
    lastCue: -1,
    lastSpokenCue: -1,
    lastSpokenAt: -1,
    raf: null,
    /** playback.js ghi đè: khóa video (id) hoặc pathname — không phải full href. */
    url: "",
    resumeVideoAfterLoad: false
  };

  const env = CORE.createContentEnv ? CORE.createContentEnv(state) : null;
  const translatePromises = new Map();
  const PREFETCH_AHEAD = Number.isFinite(Number(DUBBING_CONFIG.subtitlePrefetchAhead))
    ? Math.max(1, Math.floor(Number(DUBBING_CONFIG.subtitlePrefetchAhead)))
    : 3;

  const uiModule = CORE.createContentUi ? CORE.createContentUi() : null;
  /** Cùng một object với `uiModule.ui` khi có module — tránh `V.ui.btn` lệch `uiModule.ui.btn`. */
  const ui =
    uiModule?.ui ?? { btn: null, sub: null, loader: null, msgOverlay: null, mountObserver: null };

  const log = CORE.createLogger ? CORE.createLogger("[YTDUB-v3]") : () => {};
  const traceYtdub = typeof CORE.traceYtdub === "function" ? CORE.traceYtdub.bind(CORE) : () => {};

  function extOk() {
    try {
      if (!chrome?.runtime?.id) return false;
      /** `licenseGateOk === false` khi key hết hạn / sai / cần cập nhật bản (license-gate.js). */
      if (w.__YTDUB_V3?.licenseGateOk === false) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Chỉ kiểm tra extension còn gắn (chrome.runtime.id) — không khóa license. Dùng cho SW: cache timedtext, fetch timedtext, transcript lib. */
  function chromeRuntimeOk() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  w.__YTDUB_V3 = {
    /** @type {boolean | undefined} undefined = chưa kết luận; false = chặn tính năng */
    licenseGateOk: undefined,
    /** @type {string | undefined} */
    licenseCheckReason: undefined,
    CORE,
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    mergeExtensionSettings,
    SNAPSHOT_MSG,
    MSG_TRANSLATE,
    MSG_CACHED_TT,
    MSG_FETCH_YT_LIB,
    MSG_FETCH_TIMEDTEXT_BODY,
    MSG_TTS_GOOGLE_GTTS,
    TARGET_LANG_TO_GOOGLE_TTS,
    DUBBING_CONFIG,
    chunkForGoogleTts,
    state,
    env,
    ui,
    uiModule,
    translatePromises,
    translateMutex: Promise.resolve(),
    PREFETCH_AHEAD,
    log,
    traceYtdub,
    extOk,
    chromeRuntimeOk,

    dubMediaVideoEl: null,
    dubMediaHandlers: { play: null, pause: null },
    preDubVideoState: { hasSnapshot: false, muted: false, volume: 1 },
    videoDuckedForTts: false,
    videoVolumeRampRaf: null,

    remoteTtsAbortGen: 0,
    remoteTtsAudio: null,
    remoteTtsBlobUrl: null,
    ttsLastStopReason: "init",
    ttsGoogleFailLogged: false,
    ttsQueue: [],
    ttsQueueRunning: false,
    ttsNowCueIdx: -1,
    ttsNowCueEnd: -1,
    ttsPreloadBackgroundRunning: false,
    ttsBlobCache: new Map(),
    ttsPrefetchPromises: new Map(),

    TTS_QUEUE_MAX: 2,
    TTS_STALE_GRACE_SEC: 0.18,
    TTS_JOIN_GAP_SEC: 0.22,
    TTS_JOIN_MAX_CHARS: 240,
    TTS_RATE_MIN: 0.95,
    /** Tốc độ tối đa khi thoại dài hơn khung cue. */
    TTS_RATE_MAX: 2.5,
    TTS_PREFETCH_AHEAD: 2,
    TTS_CACHE_MAX: 10,
    TTS_BOOTSTRAP_MIN: 2
  };
})();
