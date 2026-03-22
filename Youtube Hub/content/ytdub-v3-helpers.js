/** Video, snapshot, storage, ducking, bridge, media listeners. */
(function ytdubV3Helpers() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const { state, env, STORAGE_KEY, mergeExtensionSettings, log, extOk, ui } = V;

  function getVideo() {
    if (env?.getVideo) return env.getVideo();
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function decodeHtml(str) {
    if (env?.decodeHtml) return env.decodeHtml(str);
    const t = document.createElement("textarea");
    t.innerHTML = str;
    return t.value;
  }

  function sleep(ms) {
    if (env?.sleep) return env.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  function videoIdFromUrlOnly() {
    if (env?.videoIdFromUrlOnly) return env.videoIdFromUrlOnly();
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
    if (env?.resolveVideoId) return env.resolveVideoId(pr);
    return state.snapshot?.videoId || pr?.videoDetails?.videoId || videoIdFromUrlOnly() || "";
  }

  function waitSnapshot(ms) {
    if (env?.waitSnapshot) return env.waitSnapshot(ms);
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

  function injectBridge() {
    if (!extOk()) return;
    let src;
    try {
      src = chrome.runtime.getURL("content/page-bridge.js");
    } catch {
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  }

  async function loadSettings() {
    if (!extOk()) {
      state.settings = mergeExtensionSettings({});
      V.refreshSubtitleOverlayVisibility();
      return;
    }
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      state.settings = mergeExtensionSettings(r[STORAGE_KEY]);
    } catch {
      state.settings = mergeExtensionSettings({});
    }
    V.refreshSubtitleOverlayVisibility();
  }

  function getBackgroundVideoVolume() {
    const v = Number(state.settings?.backgroundVideoVolume);
    if (!Number.isFinite(v)) return 0.12;
    return Math.min(1, Math.max(0, v));
  }

  function getVoiceDuckVolume() {
    const raw = Number(state.settings?.voiceDuckVideoVolume);
    if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
    return getBackgroundVideoVolume();
  }

  function getVoiceUnduckRampMs() {
    const raw = Number(state.settings?.voiceUnduckRampSec);
    if (Number.isFinite(raw)) return Math.min(5000, Math.max(0, raw * 1000));
    return 1000;
  }

  function cancelVideoVolumeRamp() {
    if (V.videoVolumeRampRaf != null) {
      cancelAnimationFrame(V.videoVolumeRampRaf);
      V.videoVolumeRampRaf = null;
    }
  }

  function rampVideoVolumeToBase() {
    cancelVideoVolumeRamp();
    const v = getVideo();
    if (!v || !V.preDubVideoState.hasSnapshot) return;
    if (V.preDubVideoState.muted) {
      v.muted = true;
      v.volume = V.preDubVideoState.volume;
      return;
    }
    const targetVol = Math.min(1, Math.max(0, V.preDubVideoState.volume));
    v.muted = false;
    const startVol = Math.min(1, Math.max(0, v.volume));
    const durationMs = getVoiceUnduckRampMs();
    if (durationMs <= 0 || Math.abs(targetVol - startVol) < 0.001) {
      v.volume = targetVol;
      return;
    }
    const t0 = performance.now();
    function step(now) {
      const el = getVideo();
      if (!el || !V.preDubVideoState.hasSnapshot) {
        V.videoVolumeRampRaf = null;
        return;
      }
      const u = Math.min(1, (now - t0) / durationMs);
      el.volume = startVol + (targetVol - startVol) * u;
      if (u < 1) {
        V.videoVolumeRampRaf = requestAnimationFrame(step);
      } else {
        el.volume = targetVol;
        V.videoVolumeRampRaf = null;
      }
    }
    V.videoVolumeRampRaf = requestAnimationFrame(step);
  }

  function snapshotVideoAudioState(video) {
    if (!video || V.preDubVideoState.hasSnapshot) return;
    V.preDubVideoState.hasSnapshot = true;
    V.preDubVideoState.muted = Boolean(video.muted);
    V.preDubVideoState.volume = Number.isFinite(video.volume) ? video.volume : 1;
  }

  function applyBaseVideoAudioState(video) {
    if (!video || !V.preDubVideoState.hasSnapshot) return;
    video.muted = V.preDubVideoState.muted;
    video.volume = V.preDubVideoState.volume;
  }

  function restoreVideoAudioState(video) {
    if (!video || !V.preDubVideoState.hasSnapshot) return;
    cancelVideoVolumeRamp();
    applyBaseVideoAudioState(video);
    V.videoDuckedForTts = false;
    V.preDubVideoState.hasSnapshot = false;
  }

  function setVideoDucking(active) {
    const v = getVideo();
    if (!v || !V.preDubVideoState.hasSnapshot) return;
    if (active) {
      cancelVideoVolumeRamp();
      if (V.videoDuckedForTts) return;
      V.videoDuckedForTts = true;
      v.muted = false;
      v.volume = getVoiceDuckVolume();
      return;
    }
    if (!V.videoDuckedForTts) return;
    V.videoDuckedForTts = false;
    rampVideoVolumeToBase();
  }

  function detachDubMediaListeners() {
    if (V.dubMediaVideoEl && V.dubMediaHandlers.play) {
      V.dubMediaVideoEl.removeEventListener("play", V.dubMediaHandlers.play);
      V.dubMediaVideoEl.removeEventListener("pause", V.dubMediaHandlers.pause);
    }
    V.dubMediaVideoEl = null;
    V.dubMediaHandlers.play = null;
    V.dubMediaHandlers.pause = null;
  }

  function attachDubMediaListeners() {
    const v = getVideo();
    if (!v) return;
    detachDubMediaListeners();
    V.dubMediaVideoEl = v;

    V.dubMediaHandlers.pause = () => {
      if (state.phase !== "playing") return;
      V.stopTtsOutput("video_pause");
      state.lastSpokenCue = -1;
      state.lastSpokenAt = -1;
    };

    V.dubMediaHandlers.play = () => {
      if (state.phase !== "playing" || !state.cues.length) return;
      const vid = getVideo();
      if (!vid || vid.paused) return;
      const idx = V.findCueIndex(vid.currentTime);
      if (idx < 0) {
        if (ui.sub) ui.sub.style.display = "none";
        state.lastCue = -1;
        return;
      }
      V.prefetchCueWindow(idx);
      state.lastCue = idx;
      void V.applyCueAudioAndSub(idx, { forceSpeak: true });
    };

    v.addEventListener("play", V.dubMediaHandlers.play);
    v.addEventListener("pause", V.dubMediaHandlers.pause);
  }

  Object.assign(V, {
    getVideo,
    decodeHtml,
    sleep,
    videoIdFromUrlOnly,
    resolveVideoId,
    waitSnapshot,
    injectBridge,
    loadSettings,
    getBackgroundVideoVolume,
    getVoiceDuckVolume,
    getVoiceUnduckRampMs,
    cancelVideoVolumeRamp,
    rampVideoVolumeToBase,
    snapshotVideoAudioState,
    applyBaseVideoAudioState,
    restoreVideoAudioState,
    setVideoDucking,
    detachDubMediaListeners,
    attachDubMediaListeners
  });
})();
