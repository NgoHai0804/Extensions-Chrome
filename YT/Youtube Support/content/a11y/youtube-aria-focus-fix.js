/**
 * Tùy chọn: gỡ aria-hidden="true" trên chuỗi focus (composedPath) khi YouTube đặt nhầm
 * (vd. link focus nhưng vẫn aria-hidden → cảnh báo WAI-ARIA trong DevTools).
 * Chỉ chạy khi người dùng bật trong popup (listener gỡ khi tắt + guard trong handler).
 */
const HANDLER_KEY = "__ythubAriaHiddenFocusFixHandler";
const GUARD_KEY = "__ythubAriaHiddenFocusFixActive";

export function setYoutubeAriaFocusFixEnabled(enabled) {
  if (typeof document === "undefined") return;
  const w = typeof window !== "undefined" ? window : null;
  const on = Boolean(enabled);
  if (w) w[GUARD_KEY] = on;

  if (!on) {
    const prev = w?.[HANDLER_KEY];
    if (typeof prev === "function") {
      try {
        document.removeEventListener("focusin", prev, true);
      } catch {
        /* ignore */
      }
    }
    if (w) delete w[HANDLER_KEY];
    return;
  }
  if (w && typeof w[HANDLER_KEY] === "function") return;

  function onFocusIn(e) {
    if (!w?.[GUARD_KEY]) return;
    let path;
    try {
      path = typeof e.composedPath === "function" ? e.composedPath() : [];
    } catch {
      path = [];
    }
    if (path.length) {
      for (let i = 0; i < path.length; i += 1) {
        const n = path[i];
        if (!n || n.nodeType !== Node.ELEMENT_NODE) continue;
        try {
          if (n.getAttribute?.("aria-hidden") === "true") n.removeAttribute("aria-hidden");
        } catch {
          /* ignore */
        }
      }
      return;
    }
    for (let el = e.target; el && el.nodeType === Node.ELEMENT_NODE; el = el.parentElement) {
      try {
        if (el.getAttribute("aria-hidden") === "true") el.removeAttribute("aria-hidden");
      } catch {
        /* ignore */
      }
    }
  }

  if (w) w[HANDLER_KEY] = onFocusIn;
  document.addEventListener("focusin", onFocusIn, true);
}
