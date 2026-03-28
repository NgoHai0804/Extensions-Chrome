/**
 * Chặn quảng cáo — bật/tắt theo chrome.storage (cùng key với popup).
 */
(function ythubAdblockInit() {
  const w = window;
  /** Khớp shared/settings.js → STORAGE_KEY */
  const STORAGE_KEY = "ytdub_settings_v3";

  w.__YTHUB_ADBLOCK = w.__YTHUB_ADBLOCK || {};

  function applyFromSettings(raw) {
    const merged = raw && typeof raw === "object" ? raw : {};
    const on = merged.adblockEnabled !== false;
    document.documentElement.classList.toggle("ythub-adblock-on", on);
    document.documentElement.classList.toggle("ythub-adblock-off", !on);
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
      applyFromSettings(r[STORAGE_KEY]);
    } catch {
      applyFromSettings({});
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      applyFromSettings(changes[STORAGE_KEY].newValue);
      const on = !changes[STORAGE_KEY].newValue || changes[STORAGE_KEY].newValue.adblockEnabled !== false;
      if (on) startSkipWatcher();
      else stopSkipWatcher();
    });

    const on = document.documentElement.classList.contains("ythub-adblock-on");
    if (on) startSkipWatcher();
  }

  w.__YTHUB_ADBLOCK.init = init;
})();
