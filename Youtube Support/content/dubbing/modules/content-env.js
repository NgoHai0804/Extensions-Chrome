(function ytdubContentEnv() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  core.createContentEnv = function createContentEnv(state) {
    function extOk() {
      try {
        return Boolean(chrome?.runtime?.id);
      } catch {
        return false;
      }
    }

    function hostOk() {
      const h = location.hostname.toLowerCase();
      return h.includes("youtube.com") || h === "youtu.be" || h.includes("youtube-nocookie.com");
    }

    function getVideo() {
      return document.querySelector("video.html5-main-video") || document.querySelector("video");
    }

    function decodeHtml(str) {
      return typeof core.decodeHtmlEntities === "function" ? core.decodeHtmlEntities(str) : String(str ?? "");
    }

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function videoIdFromUrlOnly() {
      try {
        const u = new URL(location.href);
        const h = u.hostname.toLowerCase();
        if (h === "youtu.be" || h.endsWith(".youtu.be")) {
          const y = u.pathname.match(/\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
          if (y) return y[1];
        }
        const v = u.searchParams.get("v");
        if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
        const shorts = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (shorts) return shorts[1];
        const embed = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (embed) return embed[1];
      } catch {
        /* ignore */
      }
      return "";
    }

    function resolveVideoId(pr) {
      return state.snapshot?.videoId || pr?.videoDetails?.videoId || videoIdFromUrlOnly() || "";
    }

    function waitSnapshot(ms) {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const id = setInterval(() => {
          if (state.snapshot?.playerResponse) {
            clearInterval(id);
            resolve(true);
          } else if (Date.now() - t0 > ms) {
            clearInterval(id);
            resolve(false);
          }
        }, 120);
      });
    }

    function findCueIndex(cues, t) {
      const L = Math.max(0, Math.min(0.5, Number(state.cueSyncLeadSec) || 0));
      for (let i = cues.length - 1; i >= 0; i -= 1) {
        const c = cues[i];
        const start = Number(c.start) || 0;
        const end = Number(c.end) || 0;
        if (t >= start - L && t < end) return i;
      }
      return -1;
    }

    return {
      extOk,
      hostOk,
      getVideo,
      decodeHtml,
      sleep,
      videoIdFromUrlOnly,
      resolveVideoId,
      waitSnapshot,
      findCueIndex
    };
  };
})();
