(function ytdubCoreConstants() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  core.SNAPSHOT_MSG = "YTDUB_V2_SNAPSHOT";
  core.MSG_TRANSLATE = "TRANSLATE_TEXTS";
  core.MSG_CACHED_TT = "GET_CACHED_TIMEDTEXT";
  core.MSG_FETCH_YT_LIB = "FETCH_YT_TRANSCRIPT_LIB";
  core.MSG_TTS_GOOGLE_GTTS = "TTS_GOOGLE_GTTS";

  core.TARGET_LANG_TO_GOOGLE_TTS = {
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

  core.chunkForGoogleTts = function chunkForGoogleTts(text, maxLen) {
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
})();
