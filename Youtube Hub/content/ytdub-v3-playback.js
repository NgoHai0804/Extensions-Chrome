/** Đồng bộ timeline, pipeline, UI entry, listeners. */
(function ytdubV3Playback() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const {
    state,
    env,
    ui,
    uiModule,
    STORAGE_KEY,
    mergeExtensionSettings,
    SNAPSHOT_MSG,
    YTDUB_BTN_MARKUP_PREFIX,
    YTDUB_BTN_MARKUP_SUFFIX,
    translatePromises,
    log,
    extOk
  } = V;

  async function applyCueAudioAndSub(idx, opts) {
    const forceSpeak = Boolean(opts && opts.forceSpeak);
    if (state.phase !== "playing" || idx < 0 || idx >= state.cues.length) return;
    const video = V.getVideo();
    if (!video) return;

    const c = state.cues[idx];

    await V.ensureCueTranslated(idx);

    if (state.phase !== "playing") return;
    const vTime = Number(video.currentTime || 0);
    const timelineIdx = findCueIndex(vTime);
    if (Number.isFinite(c.end) && vTime > c.end + V.TTS_STALE_GRACE_SEC) return;
    if (timelineIdx > idx) return;

    const line = c.txt || c.src;
    if (ui.sub && V.subtitlesOverlayEnabled()) {
      const subLine = String(line || "").replace(/\s+/g, " ").trim();
      if (subLine) {
        ui.sub.style.display = "block";
        ui.sub.textContent = subLine;
      }
    }
    const now = Number(video.currentTime || 0);
    if (!forceSpeak && state.lastSpokenCue === idx && state.lastSpokenAt >= 0 && now - state.lastSpokenAt < 0.35) {
      return;
    }
    state.lastSpokenCue = idx;
    state.lastSpokenAt = now;
    log(
      "SUB_LINE | idx=" + idx,
      "| t=" + now.toFixed(2),
      "| span=" + Number(c.start || 0).toFixed(2) + "→" + Number(c.end || 0).toFixed(2),
      '| text="' + String(line).replace(/\s+/g, " ").trim().slice(0, 160) + '"'
    );
    if (!video.paused) V.enqueueCueTts(line, idx, c.start, c.end);
  }

  function findCueIndex(t) {
    if (env?.findCueIndex) return env.findCueIndex(state.cues, t);
    const L = Math.max(0, Math.min(0.5, Number(state.cueSyncLeadSec) || 0));
    for (let i = state.cues.length - 1; i >= 0; i -= 1) {
      const c = state.cues[i];
      const start = Number(c.start) || 0;
      const end = Number(c.end) || 0;
      if (t >= start - L && t < end) return i;
    }
    return -1;
  }

  function stopPlayback() {
    state.resumeVideoAfterLoad = false;
    translatePromises.clear();
    V.translateMutex = Promise.resolve();
    V.detachDubMediaListeners();
    V.setLoadingOverlay(false);
    if (state.raf != null) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    V.stopTtsOutput("stop_playback");
    const v = V.getVideo();
    if (v) {
      V.restoreVideoAudioState(v);
    }
    if (ui.sub) {
      ui.sub.style.display = "none";
      ui.sub.textContent = "";
    }
    state.lastCue = -1;
    state.lastSpokenCue = -1;
    state.lastSpokenAt = -1;
    V.setPhase("idle");
  }

  function tickSync() {
    if (state.phase !== "playing" || !state.cues.length) {
      state.raf = null;
      return;
    }
    const video = V.getVideo();
    if (!video) {
      state.raf = requestAnimationFrame(tickSync);
      return;
    }
    const t = video.currentTime;
    const idx = findCueIndex(t);
    if (idx >= 0 && V.ttsNowCueIdx >= 0 && idx !== V.ttsNowCueIdx) {
      const pastSpokenCue =
        Number.isFinite(V.ttsNowCueEnd) && t > V.ttsNowCueEnd + V.TTS_STALE_GRACE_SEC;
      const videoAhead = idx > V.ttsNowCueIdx;
      if (pastSpokenCue) {
        V.stopTtsOutput("lag_to_current_cue");
        const cNow = state.cues[idx];
        if (cNow) V.enqueueCueTts(cNow.txt || cNow.src, idx, cNow.start, cNow.end);
      } else if (videoAhead) {
        V.boostTtsPlaybackIfBehind(t);
      }
    }
    if (idx !== state.lastCue) {
      if (state.lastCue >= 0 && idx >= 0 && Math.abs(idx - state.lastCue) > 1) {
        V.ttsQueue.length = 0;
        V.stopTtsOutput("seek_jump");
      }
      state.lastCue = idx;
      if (idx < 0) {
        if (ui.sub) ui.sub.style.display = "none";
      } else {
        V.prefetchCueWindow(idx);
        void applyCueAudioAndSub(idx);
      }
    }
    state.raf = requestAnimationFrame(tickSync);
  }

  async function startPipeline() {
    await V.loadSettings();
    const video = V.getVideo();
    if (!video) {
      V.showPipelineErrorInVideo(new Error("Không thấy video — mở trang xem video hợp lệ rồi thử lại."));
      return;
    }

    const wasPlaying = !video.paused;
    state.resumeVideoAfterLoad = wasPlaying;
    if (wasPlaying) {
      video.pause();
      log("Đã tạm dừng video để tải phụ đề / dịch");
    }

    translatePromises.clear();
    V.translateMutex = Promise.resolve();
    V.clearTtsCaches();
    state.subtitleTrackLang = "";
    V.setPhase("loading");
    ui.btn.disabled = true;
    try {
      log("PIPELINE | B1 — tải phụ đề (raw)…");
      const { cues: rawCues, lang } = await V.loadSubtitleCues();
      log("PIPELINE | B1 OK |", rawCues.length, "dòng | lang track:", lang || "—");

      const cues = V.splitSubtitleCuesBySentences(rawCues);
      log(
        "PIPELINE | tách câu (dấu .?!…) + nội suy thời gian |",
        rawCues.length,
        "SUB →",
        cues.length,
        "câu"
      );

      state.subtitleTrackLang = String(lang || "").trim();
      const b2On = V.needsTranslation();
      log(
        "PIPELINE | B2 —",
        b2On ? "dịch máy → targetLang" : "bỏ qua (track trùng targetLang)",
        "| target:",
        state.settings?.targetLang,
        "| track:",
        state.subtitleTrackLang || "?"
      );
      state.cues = V.initCuesFromSubtitleRows(cues);
      V.normalizeCueTimeline(state.cues);
      if (V.needsTranslation()) V.prefetchCueWindow(0);

      log("PIPELINE | B3 — đọc: Google translate_tts (service worker)");
      await V.prefetchBootstrapTts(V.TTS_BOOTSTRAP_MIN);

      const v = V.getVideo();
      if (!v) throw new Error("Không thấy video");
      V.snapshotVideoAudioState(v);
      V.applyBaseVideoAudioState(v);

      if (state.resumeVideoAfterLoad) {
        try {
          await v.play();
          log("Phát lại video (đồng bộ currentTime =", v.currentTime.toFixed(2), "s)");
        } catch (err) {
          log("play() sau tải:", err);
        }
      }
      state.resumeVideoAfterLoad = false;

      V.setPhase("playing");
      V.attachDubMediaListeners();
      state.lastCue = -1;
      if (state.raf != null) cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(tickSync);
      void V.prefetchRemainingTtsInBackground();
    } catch (e) {
      log(e);
      state.cues = [];
      V.setPhase("error");
      const v = V.getVideo();
      if (v) {
        V.restoreVideoAudioState(v);
        if (state.resumeVideoAfterLoad) {
          v.play().catch(() => {});
          log("Lỗi pipeline — phát lại video như trước khi bấm Dịch");
        }
      }
      state.resumeVideoAfterLoad = false;
      V.setLoadingOverlay(false);
      V.showPipelineErrorInVideo(e);
      V.setPhase("idle");
    } finally {
      V.setLoadingOverlay(false);
      ui.btn.disabled = false;
    }
  }

  function onBtnClick() {
    if (state.phase === "playing") {
      stopPlayback();
      return;
    }
    if (state.phase === "loading") return;
    void startPipeline();
  }

  function buildUi() {
    if (uiModule?.buildUi) {
      uiModule.buildUi(onBtnClick);
      if (uiModule.ui) Object.assign(ui, uiModule.ui);
      return;
    }
    ui.btn = document.createElement("button");
    ui.btn.className = "ytdub2-btn ytdub2-fallback";
    ui.btn.type = "button";
    ui.btn.dataset.phase = "idle";
    ui.btn.innerHTML = YTDUB_BTN_MARKUP_PREFIX + "Dịch" + YTDUB_BTN_MARKUP_SUFFIX;
    ui.btn.setAttribute("aria-label", "Dịch phụ đề và đọc theo video");
    ui.btn.addEventListener("click", onBtnClick);
    document.body.appendChild(ui.btn);
    V.mountOrFallbackBtn();
    if (ui.btn.classList.contains("ytdub2-fallback")) V.startBtnMountObserver();
    ui.sub = document.createElement("div");
    ui.sub.className = "ytdub2-sub";
    ui.sub.style.display = "none";
    document.body.appendChild(ui.sub);

    ui.loader = document.createElement("div");
    ui.loader.className = "ytdub2-loader-overlay";
    ui.loader.setAttribute("hidden", "");
    ui.loader.setAttribute("aria-live", "polite");
    ui.loader.setAttribute("aria-busy", "false");
    ui.loader.innerHTML =
      '<div class="ytdub2-loader-card">' +
      '<div class="ytdub2-loader-spinwrap" aria-hidden="true"><div class="ytdub2-loader-spin"></div></div>' +
      '<p class="ytdub2-loader-text">Đang tải phụ đề…</p>' +
      "</div>";
    document.body.appendChild(ui.loader);

    ui.msgOverlay = document.createElement("div");
    ui.msgOverlay.className = "ytdub2-msg-overlay";
    ui.msgOverlay.setAttribute("hidden", "");
    ui.msgOverlay.setAttribute("role", "dialog");
    ui.msgOverlay.setAttribute("aria-modal", "true");
    ui.msgOverlay.innerHTML =
      '<div class="ytdub2-msg-panel">' +
      '<div class="ytdub2-msg-accent" aria-hidden="true"></div>' +
      '<div class="ytdub2-msg-main">' +
      '<p class="ytdub2-msg-title"></p>' +
      '<p class="ytdub2-msg-body"></p>' +
      '<button type="button" class="ytdub2-msg-ok">OK</button>' +
      "</div></div>";
    ui.msgOverlay.querySelector(".ytdub2-msg-ok")?.addEventListener("click", () => {
      ui.msgOverlay.setAttribute("hidden", "");
    });
    document.body.appendChild(ui.msgOverlay);
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.type !== SNAPSHOT_MSG) return;
    state.snapshot = ev.data.payload || null;
  });

  setInterval(() => {
    if (location.href !== state.url) {
      state.url = location.href;
      stopPlayback();
      state.cues = [];
      state.snapshot = null;
      if (ui.mountObserver) {
        ui.mountObserver.disconnect();
        ui.mountObserver = null;
      }
      V.hideVideoMessageSafe();
      log("URL đổi — reset");
      V.startBtnMountObserver();
    }
    V.mountOrFallbackBtn();
    if (ui.loader && !ui.loader.hasAttribute("hidden")) V.ensureLoaderHost();
    if (ui.msgOverlay && !ui.msgOverlay.hasAttribute("hidden")) V.ensureMsgOverlayHost();
  }, 800);

  if (extOk()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      const oldM = mergeExtensionSettings(changes[STORAGE_KEY].oldValue || {});
      const newM = mergeExtensionSettings(changes[STORAGE_KEY].newValue || {});
      state.settings = newM;
      if (oldM.showSubtitleOverlay !== newM.showSubtitleOverlay) {
        V.refreshSubtitleOverlayVisibility();
      }
      if (oldM.targetLang !== newM.targetLang) {
        V.invalidateTtsLogState();
        V.clearTtsCaches();
      }
      if (state.phase === "playing" && oldM.targetLang !== newM.targetLang && state.cues.length) {
        for (let i = 0; i < state.cues.length; i += 1) {
          state.cues[i].txt = null;
        }
        translatePromises.clear();
        V.translateMutex = Promise.resolve();
        log("Đổi ngôn ngữ đích — xóa cache dịch, dịch lại theo", newM.targetLang);
      }
    });
  }

  Object.assign(V, {
    applyCueAudioAndSub,
    findCueIndex,
    stopPlayback,
    tickSync,
    startPipeline,
    onBtnClick,
    buildUi
  });
})();
