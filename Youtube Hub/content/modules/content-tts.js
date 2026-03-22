(function ytdubContentTts() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  core.createTtsEngine = function createTtsEngine(deps) {
    const { state, log, getVideo, extOk, chunkForGoogleTts, targetLangToGoogleTts, msgTtsGoogle } = deps;
    let remoteTtsAbortGen = 0;
    let remoteTtsAudio = null;
    let remoteTtsBlobUrl = null;
    let ttsLastStopReason = "init";
    let ttsGoogleFailLogged = false;
    const ttsQueue = [];
    let ttsQueueRunning = false;
    const TTS_QUEUE_MAX = 1;
    const TTS_STALE_GRACE_SEC = 0.08;
    const TTS_PREFETCH_AHEAD = 2;
    const TTS_CACHE_MAX = 10;
    const TTS_BOOTSTRAP_MIN = 2;
    const ttsBlobCache = new Map();
    const ttsPrefetchPromises = new Map();
    let ttsPreloadBackgroundRunning = false;
    let ttsNowCueIdx = -1;
    let ttsNowCueEnd = -1;

    function logTtsState(tag, reason) {
      const v = getVideo();
      log(
        "TTS_STATE |",
        tag,
        "| reason=" + String(reason || "-"),
        "| cueNow=" + ttsNowCueIdx,
        "| queue=" + ttsQueue.length,
        "| t=" + Number(v?.currentTime || 0).toFixed(2)
      );
    }

    function revokeRemoteTtsBlob() {
      if (!remoteTtsBlobUrl) return;
      try {
        URL.revokeObjectURL(remoteTtsBlobUrl);
      } catch {
        /* ignore */
      }
      remoteTtsBlobUrl = null;
    }

    function stopTtsOutput(reason) {
      ttsLastStopReason = String(reason || "unspecified");
      logTtsState("stop", ttsLastStopReason);
      remoteTtsAbortGen += 1;
      ttsQueue.length = 0;
      ttsNowCueIdx = -1;
      ttsNowCueEnd = -1;
      revokeRemoteTtsBlob();
      if (remoteTtsAudio) {
        try {
          remoteTtsAudio.pause();
          remoteTtsAudio.removeAttribute("src");
        } catch {
          /* ignore */
        }
      }
    }

    function sendSwMessage(message) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(message, (res) => {
            const err = chrome.runtime.lastError;
            if (err) {
              resolve({ ok: false, error: err.message });
              return;
            }
            resolve(res && typeof res === "object" ? res : { ok: false });
          });
        } catch (e) {
          resolve({ ok: false, error: String(e) });
        }
      });
    }

    function userBasePlaybackRate() {
      return 1;
    }

    function getTtsEndCutSec() {
      const v = Number(state.settings?.ttsEndCutSec);
      if (!Number.isFinite(v)) return 0.02;
      return Math.min(1.0, Math.max(0, v));
    }

    async function waitAudioDurationSec(audioEl) {
      if (!audioEl) return null;
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) return Number(audioEl.duration);
      return await new Promise((resolve) => {
        let done = false;
        let timer = null;
        const finish = (value) => {
          if (done) return;
          done = true;
          if (timer != null) clearTimeout(timer);
          audioEl.removeEventListener("loadedmetadata", onMeta);
          audioEl.removeEventListener("durationchange", onMeta);
          audioEl.removeEventListener("error", onFail);
          resolve(value);
        };
        const onMeta = () => {
          const d = Number(audioEl.duration);
          if (Number.isFinite(d) && d > 0) finish(d);
        };
        const onFail = () => finish(null);
        audioEl.addEventListener("loadedmetadata", onMeta);
        audioEl.addEventListener("durationchange", onMeta);
        audioEl.addEventListener("error", onFail);
        timer = setTimeout(() => finish(null), 1200);
        onMeta();
      });
    }

    function googleTtsTl() {
      const id = String(state.settings.targetLang || "vi").trim();
      return targetLangToGoogleTts[id] || "vi";
    }

    function ttsCacheKey(text) {
      return `${googleTtsTl()}::${String(text || "").trim()}`;
    }

    function rememberTtsCache(key, text, blobs) {
      if (!Array.isArray(blobs) || !blobs.length) return;
      ttsBlobCache.set(key, { text, blobs, ts: Date.now() });
      if (ttsBlobCache.size > TTS_CACHE_MAX) {
        const entries = [...ttsBlobCache.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        const drop = ttsBlobCache.size - TTS_CACHE_MAX;
        for (let i = 0; i < drop; i += 1) ttsBlobCache.delete(entries[i][0]);
      }
    }

    async function buildTtsBlobs(text, gen) {
      if (!extOk()) return null;
      const tl = googleTtsTl();
      const parts = chunkForGoogleTts(text, 180);
      if (!parts.length) return null;
      const blobs = [];
      for (let p = 0; p < parts.length; p += 1) {
        if (gen !== remoteTtsAbortGen) return null;
        const res = await sendSwMessage({ type: msgTtsGoogle, payload: { text: parts[p], tl } });
        if (!res.ok || !res.base64) return null;
        if (gen !== remoteTtsAbortGen) return null;
        let bytes;
        try {
          const bin = atob(res.base64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        } catch {
          return null;
        }
        blobs.push(new Blob([bytes], { type: "audio/mpeg" }));
      }
      return blobs;
    }

    async function ensureTtsCachedText(text, gen) {
      const line = String(text || "").trim();
      if (!line) return null;
      const key = ttsCacheKey(line);
      const hit = ttsBlobCache.get(key);
      if (hit?.blobs?.length) {
        hit.ts = Date.now();
        return hit;
      }
      if (ttsPrefetchPromises.has(key)) return ttsPrefetchPromises.get(key);
      const p = (async () => {
        const blobs = await buildTtsBlobs(line, gen);
        if (!blobs?.length) return null;
        rememberTtsCache(key, line, blobs);
        return ttsBlobCache.get(key) || null;
      })();
      ttsPrefetchPromises.set(key, p);
      try {
        return await p;
      } finally {
        ttsPrefetchPromises.delete(key);
      }
    }

    async function speakLineGoogleTts(text, maxLeadSeconds) {
      if (!extOk()) return false;
      if (!remoteTtsAudio) {
        remoteTtsAudio = new Audio();
        remoteTtsAudio.addEventListener("play", () => logTtsState("audio_play", ttsLastStopReason));
        remoteTtsAudio.addEventListener("ended", () => logTtsState("audio_ended", "-"));
        remoteTtsAudio.addEventListener("pause", () => logTtsState("audio_pause", ttsLastStopReason));
        remoteTtsAudio.addEventListener("error", () => logTtsState("audio_error", ttsLastStopReason));
        remoteTtsAudio.addEventListener("abort", () => logTtsState("audio_abort", ttsLastStopReason));
      }
      const vol = state.settings.speechVolume;
      remoteTtsAudio.volume = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 1;
      const gen = remoteTtsAbortGen;
      const cached = await ensureTtsCachedText(text, gen);
      if (gen !== remoteTtsAbortGen) return false;
      const blobs = cached?.blobs;
      if (!blobs?.length) return false;
      let playRate = userBasePlaybackRate();
      let shouldCapByTime = false;

      for (let p = 0; p < blobs.length; p += 1) {
        if (gen !== remoteTtsAbortGen) return false;
        revokeRemoteTtsBlob();
        remoteTtsBlobUrl = URL.createObjectURL(blobs[p]);
        remoteTtsAudio.src = remoteTtsBlobUrl;
        if (Number.isFinite(maxLeadSeconds) && Number(maxLeadSeconds) > 0) {
          const dur = await waitAudioDurationSec(remoteTtsAudio);
          if (gen !== remoteTtsAbortGen) return false;
          if (Number.isFinite(dur) && dur > 0) {
            const lead = Math.max(0.04, Number(maxLeadSeconds));
            const fitRate = dur / lead;
            playRate = Math.min(2, Math.max(0.5, Math.max(playRate, fitRate)));
            shouldCapByTime = dur / playRate > lead + 0.06;
          } else {
            shouldCapByTime = true;
          }
        }
        remoteTtsAudio.playbackRate = playRate;
        try {
          await new Promise((resolve, reject) => {
            const capSec =
              shouldCapByTime && Number.isFinite(maxLeadSeconds) && Number(maxLeadSeconds) > 0
                ? Math.max(0.04, Number(maxLeadSeconds))
                : null;
            let capTimer = null;
            const onEnd = () => {
              cleanup();
              resolve();
            };
            const onErr = () => {
              cleanup();
              reject(new Error("audio"));
            };
            const onCap = () => {
              try {
                remoteTtsAudio.pause();
              } catch {
                /* ignore */
              }
              cleanup();
              resolve();
            };
            function cleanup() {
              remoteTtsAudio.removeEventListener("ended", onEnd);
              remoteTtsAudio.removeEventListener("error", onErr);
              if (capTimer != null) {
                clearTimeout(capTimer);
                capTimer = null;
              }
            }
            remoteTtsAudio.addEventListener("ended", onEnd);
            remoteTtsAudio.addEventListener("error", onErr);
            if (capSec != null) {
              capTimer = setTimeout(onCap, Math.max(1, Math.floor(capSec * 1000)));
            }
            remoteTtsAudio.play().catch(reject);
          });
        } catch {
          return false;
        }
      }
      return true;
    }

    async function runTtsQueue(gen) {
      if (ttsQueueRunning) return;
      ttsQueueRunning = true;
      try {
        while (state.phase === "playing" && gen === remoteTtsAbortGen && ttsQueue.length) {
          const item = ttsQueue.shift();
          const now = Number(getVideo()?.currentTime || 0);
          if (item && Number.isFinite(item.end) && now > item.end + TTS_STALE_GRACE_SEC) continue;
          ttsNowCueIdx = Number(item?.idx);
          ttsNowCueEnd = Number(item?.end);
          let maxLead = null;
          if (item && Number.isFinite(item.end)) {
            maxLead = Math.max(0.04, Number(item.end) - now - getTtsEndCutSec());
          }
          const ok = await speakLineGoogleTts(item?.text || "", maxLead);
          ttsNowCueIdx = -1;
          ttsNowCueEnd = -1;
          if (gen !== remoteTtsAbortGen) return;
          if (!ok && !ttsGoogleFailLogged) {
            ttsGoogleFailLogged = true;
            log(
              "TTS (Google translate_tts): không lấy được audio — đã thử translate.google.com / translate.googleapis.com / clients5.google.com."
            );
          }
        }
      } finally {
        ttsQueueRunning = false;
        if (state.phase === "playing" && ttsQueue.length) void runTtsQueue(remoteTtsAbortGen);
      }
    }

    function prefetchTtsWindow(centerIdx) {
      if (state.phase !== "playing") return;
      for (let j = centerIdx; j <= Math.min(state.cues.length - 1, centerIdx + TTS_PREFETCH_AHEAD); j += 1) {
        const c = state.cues[j];
        if (!c) continue;
        const line = String(c.txt || c.src || "").trim();
        if (!line) continue;
        void ensureTtsCachedText(line, remoteTtsAbortGen);
      }
    }

    function enqueueCueTts(text, idx, start, end) {
      const line = String(text || "").trim();
      if (!line || state.phase !== "playing") return;
      const now = Number(getVideo()?.currentTime || 0);
      if (Number.isFinite(end) && now > end + TTS_STALE_GRACE_SEC) return;
      if (ttsQueue.length >= TTS_QUEUE_MAX) ttsQueue.splice(0, ttsQueue.length - (TTS_QUEUE_MAX - 1));
      if (ttsQueue.some((x) => x && Number.isFinite(idx) && x.idx === idx)) return;
      if (Number.isFinite(idx) && ttsNowCueIdx === idx) return;
      ttsQueue.push({ text: line, idx: Number(idx), start: Number(start), end: Number(end) });
      prefetchTtsWindow(Number.isFinite(idx) ? idx : 0);
      void runTtsQueue(remoteTtsAbortGen);
    }

    function collectUniqueCueLines() {
      const uniq = [];
      const seen = new Set();
      for (let i = 0; i < state.cues.length; i += 1) {
        const c = state.cues[i];
        const line = String(c?.txt || c?.src || "").trim();
        if (!line) continue;
        const key = ttsCacheKey(line);
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(line);
      }
      return uniq;
    }

    async function prefetchBootstrapTts(minCount) {
      if (!state.cues.length) return;
      const gen = remoteTtsAbortGen;
      const uniq = collectUniqueCueLines();
      const target = Math.min(Math.max(0, Number(minCount) || 0), uniq.length);
      log("TTS preload bootstrap:", target + "/" + uniq.length, "(chờ trước khi phát)");
      let okCount = 0;
      for (let i = 0; i < uniq.length && okCount < target; i += 1) {
        if (gen !== remoteTtsAbortGen) return;
        const r = await ensureTtsCachedText(uniq[i], gen);
        if (r?.blobs?.length) okCount += 1;
      }
    }

    async function prefetchRemainingTtsInBackground() {
      if (ttsPreloadBackgroundRunning || !state.cues.length) return;
      ttsPreloadBackgroundRunning = true;
      const gen = remoteTtsAbortGen;
      try {
        const uniq = collectUniqueCueLines();
        for (let i = 0; i < uniq.length; i += 1) {
          if (gen !== remoteTtsAbortGen || state.phase !== "playing") return;
          await ensureTtsCachedText(uniq[i], gen);
        }
      } finally {
        ttsPreloadBackgroundRunning = false;
      }
    }

    function clearTtsCaches() {
      ttsBlobCache.clear();
      ttsPrefetchPromises.clear();
      ttsGoogleFailLogged = false;
    }

    function getNowCueInfo() {
      return { idx: ttsNowCueIdx, end: ttsNowCueEnd, staleGrace: TTS_STALE_GRACE_SEC };
    }

    function getBootstrapMin() {
      return TTS_BOOTSTRAP_MIN;
    }

    return {
      stopTtsOutput,
      enqueueCueTts,
      prefetchBootstrapTts,
      prefetchRemainingTtsInBackground,
      clearTtsCaches,
      getNowCueInfo,
      getBootstrapMin
    };
  };
})();
