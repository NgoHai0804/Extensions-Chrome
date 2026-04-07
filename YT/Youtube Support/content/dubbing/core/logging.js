(function ytdubCoreLogging() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  /** Đọc mỗi lần — có thể bật trong DevTools rồi chờ tick tiếp theo (không cần F5 trước khi inject). */
  core.isYtdubDebugEnabled = function isYtdubDebugEnabled() {
    try {
      return window.__YTDUB_DEBUG__ === true || localStorage.getItem("ytdub_debug") === "1";
    } catch {
      return false;
    }
  };

  core.traceYtdub = function traceYtdub() {
    if (!core.isYtdubDebugEnabled()) return;
    const a = Array.prototype.slice.call(arguments);
    console.log.apply(console, ["[YTDUB-v3]", "[trace]"].concat(a));
  };

  core.createLogger = function createLogger(prefix) {
    // Mặc định chạy im lặng; chỉ log khi bật debug thủ công.
    const enabled = core.isYtdubDebugEnabled();
    if (!enabled) return () => {};
    return (...a) => console.log(prefix, ...a);
  };

  core.logSubtitleOk = function logSubtitleOk(log, method, videoId, cues, lang) {
    const n = cues.length;
    if (!n) return;
    const spanStart = Number(cues[0]?.start ?? 0).toFixed(2);
    const spanEnd = Number(cues[n - 1]?.end ?? 0).toFixed(2);
    const sample = String(cues[0]?.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    log(
      "SUB_OK | method=" + method,
      "| videoId=" + videoId,
      "| cues=" + n,
      "| timeline_s=" + spanStart + "→" + spanEnd,
      "| lang=" + (lang || "(n/a)"),
      '| sample="' + sample + '"'
    );
  };

  const SUB_TRACE_MAX = 64;
  /** @type {string[]} */
  let subtitleLoadTrace = [];

  /** Bật log chi tiết ra console: `localStorage.setItem("ytdub_sub_trace", "1")` hoặc `ytdub_debug`. */
  core.isSubtitlePipelineTraceToConsole = function isSubtitlePipelineTraceToConsole() {
    try {
      return core.isYtdubDebugEnabled() || localStorage.getItem("ytdub_sub_trace") === "1";
    } catch {
      return core.isYtdubDebugEnabled();
    }
  };

  core.clearSubtitleLoadTrace = function clearSubtitleLoadTrace() {
    subtitleLoadTrace = [];
  };

  core.getSubtitleLoadTrace = function getSubtitleLoadTrace() {
    return subtitleLoadTrace.slice();
  };

  /**
   * Ghi từng bước pipeline tải phụ đề (luôn lưu buffer để in khi lỗi).
   * @param {...unknown} parts
   */
  core.logSubtitlePipelineStep = function logSubtitlePipelineStep() {
    const parts = Array.prototype.slice.call(arguments);
    const line = parts
      .map((p) => {
        if (p == null) return "";
        if (typeof p === "string") return p;
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .filter(Boolean)
      .join(" ");
    const stamp = new Date().toISOString().slice(11, 23);
    const entry = "[" + stamp + "] " + line;
    subtitleLoadTrace.push(entry);
    if (subtitleLoadTrace.length > SUB_TRACE_MAX) subtitleLoadTrace.shift();
    if (core.isSubtitlePipelineTraceToConsole()) {
      console.log("[YTDUB-v3][SUB]", entry);
    }
  };
})();
