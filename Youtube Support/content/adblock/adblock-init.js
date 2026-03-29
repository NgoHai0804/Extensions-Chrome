/**
 * Chặn quảng cáo — CSS + skip nút; bật/tắt theo storage (cùng popup / bootstrap / DNR).
 * Mặc định: bật (không tắt rõ ràng trong object → coi như bật).
 */
(function ythubAdblockInit() {
  const w = window;
  /** Khớp shared/settings.js → STORAGE_KEY */
  const STORAGE_KEY = "ytdub_settings_v3";

  w.__YTHUB_ADBLOCK = w.__YTHUB_ADBLOCK || {};

  function adblockOnFromRaw(raw) {
    const m = raw && typeof raw === "object" ? raw : {};
    const ad = m.adblockEnabled;
    return !(ad === false || ad === "false" || ad === 0 || ad === "0");
  }

  function applyFromSettings(raw) {
    const on = adblockOnFromRaw(raw);
    document.documentElement.classList.toggle("ythub-adblock-on", on);
    document.documentElement.classList.toggle("ythub-adblock-off", !on);
  }

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

  let skipObserver = null;

  function tryClickSkipAd() {
    const btn =
      document.querySelector(".ytp-ad-skip-button") ||
      document.querySelector(".ytp-ad-skip-button-modern") ||
      document.querySelector("button.ytp-ad-skip-button");
    if (btn && btn.offsetParent !== null) {
      try {
        btn.click();
      } catch {
        /* ignore */
      }
    }
  }

  function startSkipWatcher() {
    if (skipObserver) return;
    skipObserver = new MutationObserver(() => {
      tryClickSkipAd();
    });
    const root = document.body || document.documentElement;
    if (root) {
      skipObserver.observe(root, { childList: true, subtree: true });
    }
    tryClickSkipAd();
  }

  function stopSkipWatcher() {
    if (skipObserver) {
      skipObserver.disconnect();
      skipObserver = null;
    }
  }

  async function init() {
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      const raw = r[STORAGE_KEY];
      injectMainWorldPreference(adblockOnFromRaw(raw));
      applyFromSettings(raw);
    } catch {
      injectMainWorldPreference(adblockOnFromRaw({}));
      applyFromSettings({});
    }

    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        /** Cùng key với popup: phụ đề overlay / ngôn ngữ / volume — không đụng DOM adblock (tránh reflow, nháy nút Dịch). */
        const adOld = adblockOnFromRaw(changes[STORAGE_KEY].oldValue);
        const adNew = adblockOnFromRaw(changes[STORAGE_KEY].newValue);
        if (adOld === adNew) return;
        injectMainWorldPreference(adNew);
        applyFromSettings(changes[STORAGE_KEY].newValue);
        if (adNew) startSkipWatcher();
        else stopSkipWatcher();
      });
    } catch {
      /* Một số ngữ cảnh / trình duyệt không expose storage trong content script */
    }

    const on = document.documentElement.classList.contains("ythub-adblock-on");
    if (on) startSkipWatcher();
  }

  w.__YTHUB_ADBLOCK.init = init;
})();
