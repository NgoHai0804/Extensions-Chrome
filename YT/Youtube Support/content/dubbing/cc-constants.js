/**
 * Isolated world: tên thuộc tính DOM phải khớp `cc-main-world.js` (MAIN world).
 * Dùng khi set gợi ý ngôn ngữ CC cho script injected.
 */
(function ytdubCcConstants() {
  const CC = {
    ATTR_LANG: "data-yt-ext-cc-lang",
    ATTR_ACTION: "data-yt-ext-action",
    ACTION_OPEN_CC_SETTINGS: "open-cc-settings"
  };

  function mapTargetLangToCcHint(raw) {
    const s = String(raw || "vi")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    if (s === "zh-cn" || s === "zh-hans") return "zh-hans";
    if (s === "zh-tw" || s === "zh-hant") return "zh-hant";
    return s;
  }

  function syncCcLangAttrFromSettings(settings) {
    try {
      const tl = settings && settings.targetLang != null ? settings.targetLang : "vi";
      const hint = mapTargetLangToCcHint(tl);
      const cur = document.documentElement.getAttribute(CC.ATTR_LANG);
      if (cur === hint) return;
      document.documentElement.setAttribute(CC.ATTR_LANG, hint);
    } catch {
      /* ignore */
    }
  }

  /** Gợi ý mở Settings → Phụ đề → Tự động dịch (MAIN world đọc ACTION_ATTR). */
  function requestOpenCcSettingsAction() {
    try {
      document.documentElement.setAttribute(CC.ATTR_ACTION, CC.ACTION_OPEN_CC_SETTINGS);
    } catch {
      /* ignore */
    }
  }

  window.__YTDUB_CC = Object.assign(CC, {
    syncCcLangAttrFromSettings,
    requestOpenCcSettingsAction,
    mapTargetLangToCcHint
  });
})();
