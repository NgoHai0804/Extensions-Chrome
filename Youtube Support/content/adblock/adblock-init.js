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

  const ADBLOCK_WANT_ATTR = "data-ytdub-adblock-want";

  function applyFromSettings(raw) {
    const on = adblockOnFromRaw(raw);
    document.documentElement.classList.toggle("ythub-adblock-on", on);
    document.documentElement.classList.toggle("ythub-adblock-off", !on);
  }

  function setDocumentAdblockWant(on) {
    try {
      const root = document.documentElement;
      if (root) root.setAttribute(ADBLOCK_WANT_ATTR, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  let skipObserver = null;
  let enforcementDismissLastAt = 0;

  /**
   * Hộp thoại "Ad blockers are not allowed on YouTube" — đóng bằng nút Close (COUNTDOWN_TO_CLOSE),
   * không bấm "Allow YouTube Ads". Đi xuyên shadow DOM.
   */
  function queryDeepFirst(root, test) {
    if (!root) return null;
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (cur.nodeType === Node.ELEMENT_NODE) {
        try {
          if (test(cur)) return cur;
        } catch {
          /* ignore */
        }
        if (cur.shadowRoot) stack.push(cur.shadowRoot);
        const kids = cur.children;
        for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
      } else if (cur.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        const kids = cur.children;
        for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
      }
    }
    return null;
  }

  function tryDismissEnforcementDialog() {
    const now = Date.now();
    if (now - enforcementDismissLastAt < 200) return;
    const host = document.querySelector("ytd-enforcement-message-view-model");
    if (!host || !host.isConnected) return;
    let btn = null;
    try {
      const dismissRoot = host.querySelector("#dismiss-button");
      if (dismissRoot) btn = queryDeepFirst(dismissRoot, (el) => el.tagName === "BUTTON");
    } catch {
      /* ignore */
    }
    if (!btn) {
      btn = queryDeepFirst(host, (el) => {
        if (el.tagName !== "BUTTON") return false;
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        return label === "close" || label === "đóng" || /\bclose\b/i.test(label);
      });
    }
    if (!btn || typeof btn.click !== "function") return;
    try {
      if (btn.getAttribute("aria-disabled") === "true") return;
      enforcementDismissLastAt = now;
      btn.click();
    } catch {
      /* ignore */
    }
  }

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
      tryDismissEnforcementDialog();
    });
    const root = document.body || document.documentElement;
    if (root) {
      skipObserver.observe(root, { childList: true, subtree: true });
    }
    tryClickSkipAd();
    tryDismissEnforcementDialog();
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
      setDocumentAdblockWant(adblockOnFromRaw(raw));
      applyFromSettings(raw);
    } catch {
      setDocumentAdblockWant(adblockOnFromRaw({}));
      applyFromSettings({});
    }

    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        /** Cùng key với popup: phụ đề overlay / ngôn ngữ / volume — không đụng DOM adblock (tránh reflow, nháy nút Dịch). */
        const adOld = adblockOnFromRaw(changes[STORAGE_KEY].oldValue);
        const adNew = adblockOnFromRaw(changes[STORAGE_KEY].newValue);
        if (adOld === adNew) return;
        setDocumentAdblockWant(adNew);
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
