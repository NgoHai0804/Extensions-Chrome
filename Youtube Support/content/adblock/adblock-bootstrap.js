/**
 * Chạy sớm (manifest document_start): ghi cờ trên documentElement (MAIN world đọc cùng DOM),
 * nạp patch fetch/XHR bằng <script src=main.js> + data-ytdub-entry=adblock-patch. Mặc định bật chặn.
 */
export function runYthubAdblockBootstrap() {
  const STORAGE_KEY = "ytdub_settings_v3";
  /** Khớp main-world-patch.js + adblock-init.js */
  const ADBLOCK_WANT_ATTR = "data-ytdub-adblock-want";

  /** true = bật chặn (mặc định nếu không ghi tắt rõ ràng). */
  function adblockOnFromRaw(raw) {
    const m = raw && typeof raw === "object" ? raw : {};
    const ad = m.adblockEnabled;
    return !(ad === false || ad === "false" || ad === 0 || ad === "0");
  }

  function setDocumentAdblockWant(on) {
    try {
      const root = document.documentElement;
      if (root) root.setAttribute(ADBLOCK_WANT_ATTR, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function requestMainPatchInject() {
    if (window.__ythubAdblockBootstrapPending) return;
    window.__ythubAdblockBootstrapPending = true;
    try {
      let src;
      try {
        src = chrome.runtime.getURL("main.js");
      } catch {
        window.__ythubAdblockBootstrapPending = false;
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.setAttribute("data-ytdub-entry", "adblock-patch");
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
      else window.__ythubAdblockBootstrapPending = false;
    } catch {
      window.__ythubAdblockBootstrapPending = false;
    }
  }

  function scheduleIfEnabled(raw) {
    const on = adblockOnFromRaw(raw);
    setDocumentAdblockWant(on);
    if (!on) return;
    requestMainPatchInject();
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
      setDocumentAdblockWant(on);
      if (on) requestMainPatchInject();
    });
  } catch {
    /* ignore */
  }
}
