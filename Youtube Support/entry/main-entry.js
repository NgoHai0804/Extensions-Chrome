/**
 * Một file đầu ra `main.js`: phân nhánh theo ngữ cảnh (SW / popup / content / MAIN world).
 * Không dùng import tĩnh ở top-level — chỉ require() trong nhánh để esbuild không gộp chạy nhầm.
 */
function ytdubDetectEntry() {
  /** Không dùng identifier `window` — trong SW có thể ReferenceError. */
  try {
    if (!globalThis.window) return "service-worker";
  } catch (_) {
    return "service-worker";
  }
  try {
    const cs = globalThis.document?.currentScript;
    const tag = cs && typeof cs.getAttribute === "function" ? cs.getAttribute("data-ytdub-entry") : null;
    if (tag === "page-bridge") return "page-bridge";
    if (tag === "cc-main") return "cc-main";
  } catch (_) {
    /* ignore */
  }
  try {
    const pending = globalThis.__YTDUB_MAIN_WORLD_ENTRY;
    if (pending) {
      delete globalThis.__YTDUB_MAIN_WORLD_ENTRY;
      return String(pending);
    }
  } catch (_) {
    /* ignore */
  }
  try {
    if (globalThis.location?.protocol === "chrome-extension:") {
      const p = String(globalThis.location.pathname || "");
      if (/popup\.html$/i.test(p)) return "popup";
    }
  } catch (_) {
    /* ignore */
  }
  return "content";
}

var ytdubEntry = ytdubDetectEntry();
if (ytdubEntry === "service-worker") {
  require("./packs/sw-pack.js");
} else if (ytdubEntry === "popup") {
  require("./packs/popup-pack.js");
} else if (ytdubEntry === "content") {
  require("./packs/content-pack.js");
} else if (ytdubEntry === "page-bridge") {
  require("./packs/page-bridge-pack.js");
} else if (ytdubEntry === "cc-main") {
  require("./packs/cc-main-pack.js");
} else if (ytdubEntry === "adblock-patch") {
  require("./packs/adblock-patch-pack.js");
}
