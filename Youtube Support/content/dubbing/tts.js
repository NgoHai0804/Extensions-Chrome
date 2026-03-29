/** TTS Google qua service worker: hàng đợi, preload, setPhase. */
(function ytdubTts() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const {
    state,
    ui,
    MSG_TTS_GOOGLE_GTTS,
    TARGET_LANG_TO_GOOGLE_TTS,
    chunkForGoogleTts,
    extOk,
    log
  } = V;

  function logTtsState(tag, reason) {
    const vid = V.getVideo();
    log(
      "TTS_STATE |",
      tag,
      "| reason=" + String(reason || "-"),
      "| cueNow=" + V.ttsNowCueIdx,
      "| queue=" + V.ttsQueue.length,
      "| t=" + Number(vid?.currentTime || 0).toFixed(2)
    );
  }

  function revokeRemoteTtsBlob() {
    if (!V.remoteTtsBlobUrl) return;
    try {
      URL.revokeObjectURL(V.remoteTtsBlobUrl);
    } catch {
      /* ignore */
    }
    V.remoteTtsBlobUrl = null;
  }

  /** >100% cần GainNode (thuộc tính volume của Audio tối đa 1). */
  function attachTtsGainChain(audioEl) {
    if (audioEl.__ythubTtsChain) return audioEl.__ythubTtsChain;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(audioEl);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain);
      gain.connect(ctx.destination);
      audioEl.volume = 1;
      audioEl.__ythubTtsChain = { ctx, gain };
      return audioEl.__ythubTtsChain;
    } catch {
      return null;
    }
  }

  function applySpeechVolumeToAudio(audioEl, rawVol) {
    const v = Number(rawVol);
    const vol = Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1;
    const chain = attachTtsGainChain(audioEl);
    if (chain?.gain) {
      audioEl.volume = 1;
      chain.gain.gain.value = vol;
    } else {
      audioEl.volume = Math.min(1, vol);
    }
  }

  async function resumeTtsAudioContext(audioEl) {
    const ch = audioEl?.__ythubTtsChain;
    if (ch?.ctx?.state === "suspended") {
      try {
        await ch.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  function stopTtsOutput(reason) {
    V.ttsLastStopReason = String(reason || "unspecified");
    logTtsState("stop", V.ttsLastStopReason);
    V.remoteTtsAbortGen += 1;
    V.ttsQueue.length = 0;
    V.ttsNowCueIdx = -1;
    V.ttsNowCueEnd = -1;
    revokeRemoteTtsBlob();
    V.setVideoDucking(false);
    if (V.remoteTtsAudio) {
      try {
        V.remoteTtsAudio.pause();
        V.remoteTtsAudio.removeAttribute("src");
      } catch {
        /* ignore */
      }
    }
  }

  /** Gắn nhãn/title nút theo phase (dùng lại sau sync DOM — tránh nút hiện «Dịch» khi vẫn đang đọc). */
  function applyTranslateButtonVisualForPhase(p) {
    if (!ui.btn?.isConnected) return;
    ui.btn.dataset.phase = p;
    const labels = {
      idle: "Dịch",
      loading: "…",
      translating: "Dịch…",
      playing: "Tắt",
      error: "Lỗi"
    };
    const lab = ui.btn.querySelector(".ytdub2-btn-label");
    if (lab) lab.textContent = labels[p] || "Dịch";
    else ui.btn.textContent = labels[p] || "Dịch";
    ui.btn.title =
      p === "playing"
        ? "Tắt đọc phụ đề / bỏ tắt tiếng video"
        : "Tạm dừng video → tải phụ đề & dịch → phát lại đồng bộ";
  }

  /** Chỉ các phase «đang chạy pipeline» — không đè title idle/error do refreshTranslateButtonAvailability đặt. */
  function repaintTranslateButtonFace() {
    const p = state.phase;
    if (p !== "playing" && p !== "loading" && p !== "translating") return;
    applyTranslateButtonVisualForPhase(p);
  }

  function setPhase(p) {
    const prev = state.phase;
    if (prev === p) return;
    V.traceYtdub("PHASE |", prev, "→", p, "| href=" + String(location.href || "").slice(0, 100));
    state.phase = p;
    if (p === "loading") V.setLoadingOverlay(true);
    else V.setLoadingOverlay(false);

    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    applyTranslateButtonVisualForPhase(p);
    if (typeof V.refreshTranslateButtonAvailability === "function") {
      V.refreshTranslateButtonAvailability();
    }
  }

  function googleTtsTl() {
    const id = String(state.settings.targetLang || "vi").trim();
    return TARGET_LANG_TO_GOOGLE_TTS[id] || "vi";
  }

  function invalidateTtsLogState() {
    V.ttsGoogleFailLogged = false;
  }

  function clearTtsCaches() {
    V.ttsBlobCache.clear();
    V.ttsPrefetchPromises.clear();
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

  function clampRate(x) {
    if (!Number.isFinite(x)) return 1;
    return Math.min(V.TTS_RATE_MAX, Math.max(V.TTS_RATE_MIN, x));
  }

  function estimateSpeechSecondsAt1x(text) {
    const line = String(text || "").replace(/\s+/g, " ").trim();
    if (!line) return 0.35;
    const chars = line.length;
    const words = line.split(" ").filter(Boolean).length;
    return Math.max(0.35, words / 2.6, chars / 15);
  }

  function getTtsEndCutSec() {
    const v = Number(state.settings?.ttsEndCutSec);
    const fallback = Number(V.DEFAULT_SETTINGS?.ttsEndCutSec);
    if (!Number.isFinite(v)) return Number.isFinite(fallback) ? Math.min(1.0, Math.max(0, fallback)) : 0.02;
    return Math.min(1.0, Math.max(0, v));
  }

  /** Điểm dừng trên timeline file (giây): cắt hẳn `cut` giây cuối. `null` = phát tới `ended` (cut ≈ 0). */
  function getTtsAudioStopTimelineSec(fullDurationSec) {
    const d = Number(fullDurationSec);
    if (!Number.isFinite(d) || d <= 0) return null;
    const cut = getTtsEndCutSec();
    if (cut <= 0.001) return null;
    const stopAt = d - cut;
    if (stopAt <= 0.02) return 0.02;
    return stopAt;
  }

  /** Tăng playbackRate trong khung cue còn lại — tránh cắt cứng giữa câu. */
  function boostTtsPlaybackIfBehind(videoTime) {
    const el = V.remoteTtsAudio;
    const end = Number(V.ttsNowCueEnd);
    const t = Number(videoTime);
    if (!el || el.paused || V.ttsNowCueIdx < 0 || !Number.isFinite(end) || !Number.isFinite(t)) return;
    const wallLeft = end - t - getTtsEndCutSec();
    if (wallLeft <= 0.03) return;
    const d = Number(el.duration);
    const ct = Number(el.currentTime);
    if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(ct)) return;
    const stopAt = getTtsAudioStopTimelineSec(d);
    const rate = Math.max(0.001, el.playbackRate);
    const tailLeft = stopAt == null ? d - ct : Math.max(0, stopAt - ct);
    const audioLeft = tailLeft / rate;
    if (audioLeft <= wallLeft + 0.07) return;
    const needRate = tailLeft / wallLeft;
    el.playbackRate = clampRate(Math.max(rate, needRate));
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

  function adaptiveCuePlaybackRate(item) {
    if (!item || !Number.isFinite(item.end)) return clampRate(userBasePlaybackRate());
    const base = userBasePlaybackRate();
    const cueStart = Number.isFinite(item.start) ? item.start : 0;
    const cueDuration = Math.max(0.28, item.end - cueStart);
    const voiceDuration = Math.max(0.2, estimateSpeechSecondsAt1x(item.text));
    // Thời lượng đọc ước lượng @1x cần ≤ khung cue → rate ≥ voiceDuration / cueDuration
    const neededRate = base * (voiceDuration / cueDuration);
    return clampRate(neededRate);
  }

  async function buildTtsBlobs(text, gen) {
    if (!extOk()) return null;
    const tl = googleTtsTl();
    const parts = chunkForGoogleTts(text, 180);
    if (!parts.length) return null;

    const blobs = [];
    for (let p = 0; p < parts.length; p += 1) {
      if (gen !== V.remoteTtsAbortGen) return null;
      const res = await sendSwMessage({
        type: MSG_TTS_GOOGLE_GTTS,
        payload: { text: parts[p], tl }
      });
      if (!res.ok || !res.base64) return null;
      if (gen !== V.remoteTtsAbortGen) return null;

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

  function ttsCacheKey(text) {
    return `${googleTtsTl()}::${String(text || "").trim()}`;
  }

  function rememberTtsCache(key, text, blobs) {
    if (!Array.isArray(blobs) || !blobs.length) return;
    V.ttsBlobCache.set(key, { text, blobs, ts: Date.now() });
    if (V.ttsBlobCache.size > V.TTS_CACHE_MAX) {
      const entries = [...V.ttsBlobCache.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
      const drop = V.ttsBlobCache.size - V.TTS_CACHE_MAX;
      for (let i = 0; i < drop; i += 1) V.ttsBlobCache.delete(entries[i][0]);
    }
  }

  async function ensureTtsCachedText(text, gen) {
    const line = String(text || "").trim();
    if (!line) return null;
    const key = ttsCacheKey(line);
    const hit = V.ttsBlobCache.get(key);
    if (hit?.blobs?.length) {
      hit.ts = Date.now();
      return hit;
    }
    if (V.ttsPrefetchPromises.has(key)) {
      return V.ttsPrefetchPromises.get(key);
    }
    const p = (async () => {
      const blobs = await buildTtsBlobs(line, gen);
      if (!blobs?.length) return null;
      rememberTtsCache(key, line, blobs);
      return V.ttsBlobCache.get(key) || null;
    })();
    V.ttsPrefetchPromises.set(key, p);
    try {
      return await p;
    } finally {
      V.ttsPrefetchPromises.delete(key);
    }
  }

  function prefetchTtsWindow(centerIdx) {
    if (state.phase !== "playing") return;
    const gen = V.remoteTtsAbortGen;
    for (
      let j = centerIdx;
      j <= Math.min(state.cues.length - 1, centerIdx + V.TTS_PREFETCH_AHEAD);
      j += 1
    ) {
      const c = state.cues[j];
      if (!c) continue;
      void (async () => {
        if (V.needsTranslation()) await V.ensureCueTranslated(j);
        if (state.phase !== "playing" || gen !== V.remoteTtsAbortGen) return;
        const cc = state.cues[j];
        if (!cc) return;
        const line = String(cc.txt || cc.src || "").trim();
        if (!line) return;
        void ensureTtsCachedText(line, gen);
      })();
    }
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
    const gen = V.remoteTtsAbortGen;
    const want = Math.max(0, Number(minCount) || 0);
    if (V.needsTranslation()) {
      let okCount = 0;
      log("TTS preload bootstrap (sau dịch):", want, "câu đầu /", state.cues.length, "dòng");
      for (let i = 0; i < state.cues.length && okCount < want; i += 1) {
        if (gen !== V.remoteTtsAbortGen) return;
        await V.ensureCueTranslated(i);
        const line = String(state.cues[i].txt || state.cues[i].src || "").trim();
        if (!line) continue;
        const r = await ensureTtsCachedText(line, gen);
        if (r?.blobs?.length) okCount += 1;
        if ((i + 1) % 10 === 0 || okCount >= want) {
          log("TTS preload bootstrap:", i + 1 + "/" + state.cues.length, "| ok:", okCount);
        }
      }
      return;
    }
    const uniq = collectUniqueCueLines();
    const target = Math.min(want, uniq.length);
    log("TTS preload bootstrap:", target + "/" + uniq.length, "(chờ trước khi phát)");
    let okCount = 0;
    for (let i = 0; i < uniq.length && okCount < target; i += 1) {
      if (gen !== V.remoteTtsAbortGen) return;
      const r = await ensureTtsCachedText(uniq[i], gen);
      if (r?.blobs?.length) okCount += 1;
      if ((i + 1) % 10 === 0 || okCount >= target) {
        log("TTS preload bootstrap:", i + 1 + "/" + uniq.length, "| ok:", okCount);
      }
    }
  }

  async function prefetchRemainingTtsInBackground() {
    if (V.ttsPreloadBackgroundRunning || !state.cues.length) return;
    V.ttsPreloadBackgroundRunning = true;
    const gen = V.remoteTtsAbortGen;
    try {
      if (V.needsTranslation()) {
        const seen = new Set();
        let okCount = 0;
        for (let i = 0; i < state.cues.length; i += 1) {
          if (gen !== V.remoteTtsAbortGen || state.phase !== "playing") return;
          await V.ensureCueTranslated(i);
          const line = String(state.cues[i].txt || state.cues[i].src || "").trim();
          if (!line) continue;
          const key = ttsCacheKey(line);
          if (seen.has(key)) continue;
          seen.add(key);
          const r = await ensureTtsCachedText(line, gen);
          if (r?.blobs?.length) okCount += 1;
          if ((i + 1) % 25 === 0 || i + 1 === state.cues.length) {
            log("TTS preload nền:", i + 1 + "/" + state.cues.length, "| ok:", okCount);
          }
        }
        return;
      }
      const uniq = collectUniqueCueLines();
      let okCount = 0;
      for (let i = 0; i < uniq.length; i += 1) {
        if (gen !== V.remoteTtsAbortGen || state.phase !== "playing") return;
        const r = await ensureTtsCachedText(uniq[i], gen);
        if (r?.blobs?.length) okCount += 1;
        if ((i + 1) % 25 === 0 || i + 1 === uniq.length) {
          log("TTS preload nền:", i + 1 + "/" + uniq.length, "| ok:", okCount);
        }
      }
    } finally {
      V.ttsPreloadBackgroundRunning = false;
    }
  }

  async function speakLineGoogleTts(text, rateOverride, maxLeadSeconds) {
    if (!extOk()) return false;
    if (!V.remoteTtsAudio) {
      V.remoteTtsAudio = new Audio();
      V.remoteTtsAudio.addEventListener("play", () => logTtsState("audio_play", V.ttsLastStopReason));
      V.remoteTtsAudio.addEventListener("ended", () => logTtsState("audio_ended", "-"));
      V.remoteTtsAudio.addEventListener("pause", () => logTtsState("audio_pause", V.ttsLastStopReason));
      V.remoteTtsAudio.addEventListener("error", () => logTtsState("audio_error", V.ttsLastStopReason));
      V.remoteTtsAudio.addEventListener("abort", () => logTtsState("audio_abort", V.ttsLastStopReason));
    }
    applySpeechVolumeToAudio(V.remoteTtsAudio, state.settings.speechVolume);
    const gen = V.remoteTtsAbortGen;
    const cached = await ensureTtsCachedText(text, gen);
    if (gen !== V.remoteTtsAbortGen) return false;
    const blobs = cached?.blobs;
    if (!blobs?.length) return false;
    let playRate = clampRate(Number.isFinite(rateOverride) ? rateOverride : userBasePlaybackRate());

    if (gen !== V.remoteTtsAbortGen) return false;
    const mergedBlob = blobs.length === 1 ? blobs[0] : new Blob(blobs, { type: "audio/mpeg" });
    revokeRemoteTtsBlob();
    V.remoteTtsBlobUrl = URL.createObjectURL(mergedBlob);
    V.remoteTtsAudio.src = V.remoteTtsBlobUrl;
    let audioStopAt = null;
    if (Number.isFinite(maxLeadSeconds) && Number(maxLeadSeconds) > 0) {
      const dur = await waitAudioDurationSec(V.remoteTtsAudio);
      if (gen !== V.remoteTtsAbortGen) return false;
      if (Number.isFinite(dur) && dur > 0) {
        audioStopAt = getTtsAudioStopTimelineSec(dur);
        const effDur = audioStopAt != null ? Math.max(0.04, audioStopAt) : Math.max(0.04, dur);
        const lead = Math.max(0.04, Number(maxLeadSeconds));
        const fitRate = effDur / lead;
        playRate = clampRate(Math.max(playRate, fitRate));
      }
    } else {
      const dur = await waitAudioDurationSec(V.remoteTtsAudio);
      if (gen !== V.remoteTtsAbortGen) return false;
      if (Number.isFinite(dur) && dur > 0) audioStopAt = getTtsAudioStopTimelineSec(dur);
    }
    V.remoteTtsAudio.playbackRate = playRate;
    await resumeTtsAudioContext(V.remoteTtsAudio);

    try {
      await new Promise((resolve, reject) => {
        const finishOk = () => {
          V.setVideoDucking(false);
          cleanup();
          resolve();
        };
        const onEnd = () => {
          finishOk();
        };
        const onErr = () => {
          V.setVideoDucking(false);
          cleanup();
          reject(new Error("audio"));
        };
        const onPauseOrAbort = () => {
          if (gen !== V.remoteTtsAbortGen) {
            V.setVideoDucking(false);
            cleanup();
            resolve();
          }
        };
        let trimRaf = null;
        /** timeupdate quá thưa — với playbackRate cao currentTime nhảy qua mốc cắt; rAF bắt đúng phần cuối. */
        const playbackTick = () => {
          if (gen !== V.remoteTtsAbortGen) {
            trimRaf = null;
            return;
          }
          const el = V.remoteTtsAudio;
          if (!el) {
            trimRaf = null;
            return;
          }
          if (el.ended || el.paused) {
            trimRaf = null;
            return;
          }
          const ct = Number(el.currentTime);
          const d = Number(el.duration);
          const liveStop =
            getTtsEndCutSec() > 0.001 && Number.isFinite(d) && d > 0 ? getTtsAudioStopTimelineSec(d) : null;
          if (liveStop != null && Number.isFinite(ct) && ct + 1e-4 >= liveStop) {
            trimRaf = null;
            try {
              el.pause();
            } catch {
              /* ignore */
            }
            finishOk();
            return;
          }
          const vid = V.getVideo();
          boostTtsPlaybackIfBehind(Number(vid?.currentTime || 0));
          trimRaf = requestAnimationFrame(playbackTick);
        };
        function cleanup() {
          if (trimRaf != null) {
            cancelAnimationFrame(trimRaf);
            trimRaf = null;
          }
          V.remoteTtsAudio.removeEventListener("ended", onEnd);
          V.remoteTtsAudio.removeEventListener("error", onErr);
          V.remoteTtsAudio.removeEventListener("pause", onPauseOrAbort);
          V.remoteTtsAudio.removeEventListener("abort", onPauseOrAbort);
        }
        V.remoteTtsAudio.addEventListener("ended", onEnd);
        V.remoteTtsAudio.addEventListener("error", onErr);
        V.remoteTtsAudio.addEventListener("pause", onPauseOrAbort);
        V.remoteTtsAudio.addEventListener("abort", onPauseOrAbort);
        const subLine = String(text || "").replace(/\s+/g, " ").trim();
        if (ui.sub) {
          if (V.subtitlesOverlayEnabled()) {
            if (subLine) {
              ui.sub.style.display = "block";
              ui.sub.textContent = subLine;
            } else {
              ui.sub.style.display = "none";
              ui.sub.textContent = "";
            }
          } else {
            ui.sub.style.display = "none";
            ui.sub.textContent = "";
          }
        }
        V.setVideoDucking(true);
        V.remoteTtsAudio
          .play()
          .then(() => {
            if (gen !== V.remoteTtsAbortGen) return;
            trimRaf = requestAnimationFrame(playbackTick);
          })
          .catch((playErr) => {
            V.setVideoDucking(false);
            cleanup();
            reject(playErr);
          });
      });
    } catch {
      V.setVideoDucking(false);
      return false;
    }
    return true;
  }

  async function runTtsQueue(gen) {
    if (V.ttsQueueRunning) return;
    V.ttsQueueRunning = true;
    try {
      while (state.phase === "playing" && gen === V.remoteTtsAbortGen && V.ttsQueue.length) {
        const item = V.ttsQueue.shift();
        const video = V.getVideo();
        const now = Number(video?.currentTime || 0);
        if (item && Number.isFinite(item.end) && now > item.end + V.TTS_STALE_GRACE_SEC) {
          continue;
        }
        V.ttsNowCueIdx = Number(item?.idx);
        V.ttsNowCueEnd = Number(item?.end);
        const adaptiveRate = adaptiveCuePlaybackRate(item);
        const nowVideo = Number(video?.currentTime || 0);
        let maxLead = null;
        if (item && Number.isFinite(item.end)) {
          maxLead = Math.max(0.04, Number(item.end) - nowVideo - getTtsEndCutSec());
        }
        const ok = await speakLineGoogleTts(item?.text || "", adaptiveRate, maxLead);
        V.ttsNowCueIdx = -1;
        V.ttsNowCueEnd = -1;
        if (gen !== V.remoteTtsAbortGen) return;
        if (!ok && !V.ttsGoogleFailLogged) {
          V.ttsGoogleFailLogged = true;
          log("TTS (Google translate_tts): không lấy được audio — đã thử translate.googleapis.com / clients5.google.com.");
        }
      }
    } finally {
      V.ttsQueueRunning = false;
      if (state.phase === "playing" && V.ttsQueue.length) {
        void runTtsQueue(V.remoteTtsAbortGen);
      }
    }
  }

  function enqueueCueTts(text, idx, start, end) {
    const line = String(text || "").trim();
    if (!line || state.phase !== "playing") return;

    const video = V.getVideo();
    const now = Number(video?.currentTime || 0);

    if (Number.isFinite(end) && now > end + V.TTS_STALE_GRACE_SEC) return;

    if (V.ttsQueue.length >= V.TTS_QUEUE_MAX) {
      V.ttsQueue.splice(0, V.ttsQueue.length - (V.TTS_QUEUE_MAX - 1));
    }

    if (V.ttsQueue.some((x) => x && Number.isFinite(idx) && x.idx === idx)) return;
    if (Number.isFinite(idx) && V.ttsNowCueIdx === idx) return;

    const startNum = Number(start);
    const endNum = Number(end);
    const newItem = { text: line, idx: Number(idx), start: startNum, end: endNum };

    const prev = V.ttsQueue.length ? V.ttsQueue[V.ttsQueue.length - 1] : null;
    if (
      prev &&
      Number.isFinite(prev.end) &&
      Number.isFinite(startNum) &&
      Number.isFinite(endNum) &&
      startNum >= prev.start &&
      startNum - prev.end <= V.TTS_JOIN_GAP_SEC &&
      prev.text.length + 1 + line.length <= V.TTS_JOIN_MAX_CHARS
    ) {
      prev.text = `${prev.text} ${line}`.replace(/\s+/g, " ").trim();
      prev.end = endNum;
      prev.idx = Number(idx);
      prefetchTtsWindow(Number.isFinite(idx) ? idx : 0);
      return;
    }

    V.ttsQueue.push(newItem);
    prefetchTtsWindow(Number.isFinite(idx) ? idx : 0);
    void runTtsQueue(V.remoteTtsAbortGen);
  }

  Object.assign(V, {
    logTtsState,
    revokeRemoteTtsBlob,
    resumeTtsAudioContext,
    stopTtsOutput,
    setPhase,
    applyTranslateButtonVisualForPhase,
    repaintTranslateButtonFace,
    googleTtsTl,
    invalidateTtsLogState,
    clearTtsCaches,
    sendSwMessage,
    userBasePlaybackRate,
    clampRate,
    estimateSpeechSecondsAt1x,
    getTtsEndCutSec,
    boostTtsPlaybackIfBehind,
    waitAudioDurationSec,
    adaptiveCuePlaybackRate,
    buildTtsBlobs,
    ttsCacheKey,
    rememberTtsCache,
    ensureTtsCachedText,
    prefetchTtsWindow,
    collectUniqueCueLines,
    prefetchBootstrapTts,
    prefetchRemainingTtsInBackground,
    speakLineGoogleTts,
    runTtsQueue,
    enqueueCueTts
  });
})();
