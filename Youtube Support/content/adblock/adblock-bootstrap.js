/**
 * Luồng độc lập trên trang YT: inject patch MAIN (fetch/XHR) khi user BẬT chặn QC trong cài đặt.
 * Mặc định: bật (không có key / không tắt rõ ràng → inject). Tắt: không inject.
 * Khớp popup + adblock-init + mergeExtensionSettings.
 */
(function ythubAdblockBootstrap() {
  const STORAGE_KEY = "ytdub_settings_v3";

  /** true = bật chặn (mặc định nếu không ghi tắt rõ ràng). */
  function adblockOnFromRaw(raw) {
    const m = raw && typeof raw === "object" ? raw : {};
    const ad = m.adblockEnabled;
    return !(ad === false || ad === "false" || ad === 0 || ad === "0");
  }

  /** MAIN world: không dùng inline script (YouTube CSP chặn) — SW inject qua chrome.scripting. */
  function injectMainWorldPreference(on) {
    try {
      chrome.runtime.sendMessage(
        { type: "YTHUB_SET_MAIN_ADBLOCK_FLAG", enabled: on },
        () => void chrome.runtime.lastError
      );
    } catch {
      /* ignore */
    }
  }

  function appendPatchScript() {
    if (window.__ythubMainAdblockInstalled) return;
    if (window.__ythubAdblockBootstrapPending) return;
    window.__ythubAdblockBootstrapPending = true;
    try {
      const url = chrome.runtime.getURL("content/adblock/adblock-main.js");
      const s = document.createElement("script");
      s.src = url;
      s.async = false;
      s.onload = () => {
        window.__ythubAdblockBootstrapPending = false;
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      };
      s.onerror = () => {
        window.__ythubAdblockBootstrapPending = false;
      };
      const root = document.documentElement || document.head;
      if (root) root.appendChild(s);
    } catch {
      window.__ythubAdblockBootstrapPending = false;
    }
  }

  function scheduleIfEnabled(raw) {
    const on = adblockOnFromRaw(raw);
    injectMainWorldPreference(on);
    if (!on) return;
    appendPatchScript();
  }

  void (async () => {
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      scheduleIfEnabled(r[STORAGE_KEY]);
    } catch {
      scheduleIfEnabled({});
    }
  })();

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      const ov = changes[STORAGE_KEY].oldValue;
      const nv = changes[STORAGE_KEY].newValue;
      const wasOn = adblockOnFromRaw(ov);
      const on = adblockOnFromRaw(nv);
      if (wasOn === on) return;
      injectMainWorldPreference(on);
      if (on) appendPatchScript();
    });
  } catch {
    /* ignore */
  }
})();
