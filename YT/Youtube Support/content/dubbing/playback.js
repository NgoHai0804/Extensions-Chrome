/** Pipeline lồng tiếng: tải sub, tick đồng bộ, nút bấm. */
(function ytdubPlayback() {
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
    translatePromises,
    log,
    extOk,
    CORE
  } = V;

  /** Reload extension / reinject content script: DOM cũ vẫn còn → nhiều nút "Dịch". */
  function domMountRoot() {
    return document.body || document.documentElement;
  }

  function teardownPriorYtdubUi() {
    try {
      if (ui.mountObserver) {
        try {
          ui.mountObserver.disconnect();
        } catch {
          /* ignore */
        }
        ui.mountObserver = null;
      }
      if (uiModule?.ui?.mountObserver) {
        try {
          uiModule.ui.mountObserver.disconnect();
        } catch {
          /* ignore */
        }
        uiModule.ui.mountObserver = null;
      }
    } catch {
      /* ignore */
    }
    try {
      window.__YTDUB_CORE?.sweepYtdubTranslateButtons?.(null);
      document.querySelectorAll(".ytdub2-loader-overlay").forEach((n) => n.remove());
      document.querySelectorAll(".ytdub2-msg-overlay").forEach((n) => n.remove());
      document.querySelectorAll(".ytdub2-sub").forEach((n) => n.remove());
    } catch {
      /* ignore */
    }
    ui.btn = null;
    ui.sub = null;
    ui.loader = null;
    ui.msgOverlay = null;
    navStickySubtitlesOk = false;
    playbackNavVideoIdCache = "";
  }

  let tabHiddenSyncTimer = null;
  /** Khi /watch tạm mất ?v= (SPA), giữ id để không reset pipeline nhầm. */
  let playbackNavVideoIdCache = "";
  /** Một lần thấy tín hiệu phụ đề trong phiên (đổi URL là reset) — không phụ thuộc videoId/snapshot nhấp nháy. */
  let navStickySubtitlesOk = false;
  let snapshotRefreshTimer = null;
  /** Hai lần poll 800ms liên tiếp cùng navKey ≠ state.url mới reset — tránh dao động URL → stopPlayback → nhấp nháy Dịch/Tắt. */
  let navKeyPendingConfirm = null;

  const MSG_NO_SUBTITLE_SUPPORT_TITLE =
    "Video này không có phụ đề (hoặc YouTube chưa cung cấp). Extension chỉ lồng tiếng khi video có phụ đề/CC.";
  const MSG_NO_SUBTITLE_SUPPORT_HINT =
    " Thử video khác, hoặc bật “Luôn hiện phụ đề” + “Gồm phụ đề tự tạo” tại youtube.com/account_playback và bật CC trên player.";

  /** Tránh nhấp nháy: hasSubtitlesSignal + snapshot dao động; một khi đã true thì giữ đến khi đổi URL/teardown. */
  function subtitlesEffectiveOk() {
    if (typeof V.hasSubtitlesSignal !== "function") return false;
    if (typeof V.captionUiExplicitlyUnsupported === "function" && V.captionUiExplicitlyUnsupported()) {
      return false;
    }
    if (navStickySubtitlesOk) return true;
    const live = V.hasSubtitlesSignal();
    if (live) {
      navStickySubtitlesOk = true;
      return true;
    }
    return false;
  }

  /** Chỉ cho bấm Dịch khi đã có tín hiệu phụ đề (textTracks / nút CC + aria-pressed / playerResponse), có latch chống dao động. */
  function refreshTranslateButtonAvailability() {
    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    if (!ui.btn) return;
    if (state.phase === "loading") {
      ui.btn.removeAttribute("data-cc-pressed-mirror");
      return;
    }
    if (state.phase === "playing") {
      ui.btn.removeAttribute("data-cc-pressed-mirror");
      if (ui.btn.disabled) ui.btn.disabled = false;
      if (ui.btn.hasAttribute("aria-label")) ui.btn.removeAttribute("aria-label");
      return;
    }
    if (state.phase === "error") {
      if (ui.btn.disabled) ui.btn.disabled = false;
      if (ui.btn.hasAttribute("aria-label")) ui.btn.removeAttribute("aria-label");
      const errTitle = "Lỗi — bấm để thử lại (video cần có phụ đề/CC).";
      if (ui.btn.title !== errTitle) ui.btn.title = errTitle;
      V.applyTranslateButtonCcMirror?.(ui.btn);
      return;
    }
    const ok = subtitlesEffectiveOk();
    const nextDisabled = !ok;
    if (ui.btn.disabled !== nextDisabled) ui.btn.disabled = nextDisabled;
    const nextDs = ok ? "1" : "0";
    if ((ui.btn.dataset.subtitlesReady || "") !== nextDs) ui.btn.dataset.subtitlesReady = nextDs;
    const okTitle = "Tạm dừng video → tải phụ đề & dịch → phát lại đồng bộ";
    const badTitle = MSG_NO_SUBTITLE_SUPPORT_TITLE + MSG_NO_SUBTITLE_SUPPORT_HINT;
    const nextTitle = ok ? okTitle : badTitle;
    if (ui.btn.title !== nextTitle) ui.btn.title = nextTitle;
    if (ok) {
      if (ui.btn.hasAttribute("aria-label")) ui.btn.removeAttribute("aria-label");
    } else {
      const aria =
        "Dịch — tạm không bấm được: " + MSG_NO_SUBTITLE_SUPPORT_TITLE + MSG_NO_SUBTITLE_SUPPORT_HINT;
      if (ui.btn.getAttribute("aria-label") !== aria) ui.btn.setAttribute("aria-label", aria);
    }
    V.applyTranslateButtonCcMirror?.(ui.btn);
  }

  /**
   * Khóa “cùng một video” — không dùng full location.href (YouTube thêm/bớt t=, si=, pp= khi đang xem
   * → trước đây mỗi 800ms bị coi là đổi trang → stopPlayback → nhấp nháy Dịch/Tắt).
   */
  function playbackNavIdentityKey() {
    try {
      const u = new URL(location.href);
      const path = u.pathname || "";
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        playbackNavVideoIdCache = v;
        return v;
      }
      const shorts = path.match(/\/shorts\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
      if (shorts) {
        playbackNavVideoIdCache = shorts[1];
        return shorts[1];
      }
      const embed = path.match(/\/embed\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
      if (embed) {
        playbackNavVideoIdCache = embed[1];
        return embed[1];
      }
      const h = u.hostname.toLowerCase();
      if (h === "youtu.be" || h.endsWith(".youtu.be")) {
        const m = path.match(/\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (m) {
          playbackNavVideoIdCache = m[1];
          return m[1];
        }
      }
      const watchLike = path === "/watch" || path.endsWith("/watch");
      if (watchLike && playbackNavVideoIdCache) {
        return playbackNavVideoIdCache;
      }
      playbackNavVideoIdCache = "";
      return path || "/";
    } catch {
      return location.href;
    }
  }

  function tabHiddenTickMs() {
    const n = Number(V.DUBBING_CONFIG?.tabHiddenSyncIntervalMs);
    return Number.isFinite(n) ? Math.max(100, Math.min(2000, Math.floor(n))) : 250;
  }

  function clearTabHiddenFallback() {
    if (tabHiddenSyncTimer != null) {
      clearInterval(tabHiddenSyncTimer);
      tabHiddenSyncTimer = null;
    }
  }

  /** Một bước đồng bộ video ↔ cue ↔ TTS. Trả về "stop" khi không còn chế độ phát. */
  function runSyncTickOnce() {
    if (state.phase !== "playing" || !state.cues.length) return "stop";
    const video = V.getVideo();
    if (!video) return "continue";
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
    return "continue";
  }

  /**
   * Tab nền: rAF gần như dừng → dùng setInterval.
   * Tab hiện: bỏ interval, chạy một tick bắt kịp rồi rAF.
   */
  function ensurePlaybackSyncLoop() {
    if (state.phase !== "playing" || !state.cues.length) {
      clearTabHiddenFallback();
      if (state.raf != null) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
      return;
    }
    if (document.visibilityState === "hidden") {
      if (state.raf != null) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
      if (tabHiddenSyncTimer == null) {
        tabHiddenSyncTimer = setInterval(() => {
          const r = runSyncTickOnce();
          if (r === "stop") clearTabHiddenFallback();
        }, tabHiddenTickMs());
      }
    } else {
      clearTabHiddenFallback();
      runSyncTickOnce();
      if (state.phase === "playing" && state.cues.length && state.raf == null) {
        state.raf = requestAnimationFrame(tickSync);
      }
    }
  }

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

  function stopPlayback(reason) {
    V.traceYtdub(
      "STOP_PLAYBACK | reason=" + String(reason || "?"),
      "| phase=" + state.phase,
      "| urlKey=" + state.url,
      "| href=" + String(location.href || "").slice(0, 120)
    );
    state.resumeVideoAfterLoad = false;
    translatePromises.clear();
    V.translateMutex = Promise.resolve();
    V.detachDubMediaListeners();
    V.setLoadingOverlay(false);
    clearTabHiddenFallback();
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
    refreshTranslateButtonAvailability();
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
    const r = runSyncTickOnce();
    if (r === "stop") {
      state.raf = null;
      return;
    }
    state.raf = requestAnimationFrame(tickSync);
  }

  async function startPipeline() {
    await V.loadSettings();
    const video = V.getVideo();
    if (!video) {
      V.showPipelineErrorInVideo(new Error("Không thấy video — mở trang xem video hợp lệ rồi thử lại."));
      refreshTranslateButtonAvailability();
      return;
    }
    if (!subtitlesEffectiveOk()) {
      V.showPipelineErrorInVideo(
        new Error("Video chưa có phụ đề — bật CC, chọn ngôn ngữ phụ đề, chờ vài giây rồi thử lại.")
      );
      refreshTranslateButtonAvailability();
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
    if (typeof CORE?.clearSubtitleLoadTrace === "function") CORE.clearSubtitleLoadTrace();
    state.subtitleTrackLang = "";
    V.setPhase("loading");
    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    if (!ui.btn) return;
    ui.btn.disabled = true;
    try {
      if (typeof CORE?.logSubtitlePipelineStep === "function") {
        CORE.logSubtitlePipelineStep("PIPELINE | B0 — prepareYoutubeCcBeforeSubtitles (UI CC / overlay)");
      }
      await V.prepareYoutubeCcBeforeSubtitles();
      if (typeof V.waitUntilSubtitlesReadyAfterCc === "function") {
        const vidWait =
          V.videoIdFromUrlOnly() || V.resolveVideoId(state.snapshot?.playerResponse) || "";
        const readyTimeoutMs = Number.isFinite(Number(V.DUBBING_CONFIG?.subtitleReadyTimeoutMs))
          ? Number(V.DUBBING_CONFIG.subtitleReadyTimeoutMs)
          : 10000;
        await V.waitUntilSubtitlesReadyAfterCc(vidWait, readyTimeoutMs);
      }
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
      state.raf = null;
      ensurePlaybackSyncLoop();
      void V.prefetchRemainingTtsInBackground();
    } catch (e) {
      log(e);
      try {
        const trace = typeof CORE?.getSubtitleLoadTrace === "function" ? CORE.getSubtitleLoadTrace() : [];
        if (trace.length) {
          console.warn(
            "[YTDUB-v3][SUB] Nhật ký các bước tải phụ đề (xem chi tiết console khi bật localStorage ytdub_sub_trace=1):\n" +
              trace.join("\n")
          );
        }
      } catch {
        /* ignore */
      }
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
      refreshTranslateButtonAvailability();
    }
  }

  function onBtnClick() {
    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    if (!ui.btn || ui.btn.disabled) return;
    if (typeof V.captionUiExplicitlyUnsupported === "function" && V.captionUiExplicitlyUnsupported()) {
      V.showPipelineErrorInVideo(
        new Error(
          "Video không hỗ trợ phụ đề/CC — YouTube đã vô hiệu nút phụ đề cho video này.\n\n" +
            MSG_NO_SUBTITLE_SUPPORT_TITLE +
            MSG_NO_SUBTITLE_SUPPORT_HINT
        )
      );
      refreshTranslateButtonAvailability();
      return;
    }
    if (state.phase === "playing") {
      stopPlayback("user_click_tat");
      return;
    }
    if (state.phase === "loading") return;
    void startPipeline();
  }

  function buildUi() {
    teardownPriorYtdubUi();
    const mount = domMountRoot();
    if (!mount) {
      requestAnimationFrame(() => buildUi());
      return;
    }
    if (uiModule?.buildUi) {
      uiModule.buildUi(onBtnClick);
      window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
      refreshTranslateButtonAvailability();
      return;
    }
    ui.btn = document.createElement("button");
    ui.btn.className = "ytdub2-btn ytdub2-fallback";
    ui.btn.type = "button";
    ui.btn.dataset.phase = "idle";
    window.__YTDUB_CORE?.buildTranslateButtonContents?.(ui.btn);
    if (!ui.btn.querySelector(".ytdub2-btn-label")) ui.btn.textContent = "Dịch";
    ui.btn.setAttribute("aria-label", "Dịch phụ đề và đọc theo video");
    ui.btn.addEventListener("click", onBtnClick);
    mount.appendChild(ui.btn);
    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    V.mountOrFallbackBtn();
    if (ui.btn.classList.contains("ytdub2-fallback")) V.startBtnMountObserver();
    ui.sub = document.createElement("div");
    ui.sub.className = "ytdub2-sub";
    ui.sub.style.display = "none";
    mount.appendChild(ui.sub);

    ui.loader = document.createElement("div");
    ui.loader.className = "ytdub2-loader-overlay";
    ui.loader.setAttribute("hidden", "");
    ui.loader.setAttribute("aria-live", "polite");
    ui.loader.setAttribute("aria-busy", "false");
    window.__YTDUB_CORE?.buildLoaderOverlayContents?.(ui.loader);
    mount.appendChild(ui.loader);

    ui.msgOverlay = document.createElement("div");
    ui.msgOverlay.className = "ytdub2-msg-overlay";
    ui.msgOverlay.setAttribute("hidden", "");
    ui.msgOverlay.setAttribute("role", "dialog");
    ui.msgOverlay.setAttribute("aria-modal", "true");
    window.__YTDUB_CORE?.buildMsgOverlayContents?.(ui.msgOverlay, () => {
      ui.msgOverlay.setAttribute("hidden", "");
    });
    mount.appendChild(ui.msgOverlay);
    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    refreshTranslateButtonAvailability();
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.type !== SNAPSHOT_MSG) return;
    state.snapshot = ev.data.payload || null;
    if (snapshotRefreshTimer != null) clearTimeout(snapshotRefreshTimer);
    snapshotRefreshTimer = setTimeout(() => {
      snapshotRefreshTimer = null;
      refreshTranslateButtonAvailability();
    }, 320);
  });

  /** Khi chưa “dính” tín hiệu phụ đề, thỉnh thoảng thử lại (textTracks không cần snapshot). */
  setInterval(() => {
    if (!navStickySubtitlesOk) refreshTranslateButtonAvailability();
  }, 2400);

  document.addEventListener("visibilitychange", () => {
    ensurePlaybackSyncLoop();
    if (document.visibilityState === "visible" && state.phase === "playing") {
      try {
        if (V.remoteTtsAudio && typeof V.resumeTtsAudioContext === "function") {
          void V.resumeTtsAudioContext(V.remoteTtsAudio);
        }
      } catch {
        /* ignore */
      }
    }
  });

  state.url = playbackNavIdentityKey();

  setInterval(() => {
    const navKey = playbackNavIdentityKey();
    if (
      navKey !== state.url ||
      navKeyPendingConfirm != null ||
      state.phase === "playing"
    ) {
      V.traceYtdub(
        "NAV_POLL | navKey=" + navKey,
        "| state.url=" + state.url,
        "| pending=" + (navKeyPendingConfirm == null ? "—" : navKeyPendingConfirm),
        "| phase=" + state.phase
      );
    }
    if (navKey === state.url) {
      navKeyPendingConfirm = null;
    } else if (navKeyPendingConfirm === null) {
      navKeyPendingConfirm = navKey;
      V.traceYtdub("NAV_PENDING | first sample | want=", navKey, "| was=", state.url);
    } else if (navKeyPendingConfirm === navKey) {
      state.url = navKey;
      navKeyPendingConfirm = null;
      navStickySubtitlesOk = false;
      stopPlayback("nav_change_confirmed");
      state.cues = [];
      state.snapshot = null;
      if (ui.mountObserver) {
        ui.mountObserver.disconnect();
        ui.mountObserver = null;
      }
      V.hideVideoMessageSafe();
      log("URL đổi — reset");
      V.startBtnMountObserver();
      refreshTranslateButtonAvailability();
    } else {
      V.traceYtdub("NAV_PENDING | reset (unstable) | wasPending=", navKeyPendingConfirm, "| now=", navKey);
      navKeyPendingConfirm = navKey;
    }
    V.mountOrFallbackBtn();
    if (ui.loader && !ui.loader.hasAttribute("hidden")) V.ensureLoaderHost();
    if (ui.msgOverlay && !ui.msgOverlay.hasAttribute("hidden")) V.ensureMsgOverlayHost();
    if (ui.btn && state.phase !== "loading" && state.phase !== "playing") {
      refreshTranslateButtonAvailability();
    }
  }, 800);

  if (extOk()) {
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        const oldM = mergeExtensionSettings(changes[STORAGE_KEY].oldValue || {});
        const newM = mergeExtensionSettings(changes[STORAGE_KEY].newValue || {});
        state.settings = newM;
        /** Chỉ khi đổi ngôn ngữ đích — gán lại data-yt-ext-cc-lang kích hoạt MAIN world apply() và làm player/DOM nhảy (nhấp nháy Dịch/Tắt nếu gọi mọi lần storage đổi). */
        if (oldM.targetLang !== newM.targetLang) {
          try {
            window.__YTDUB_CC?.syncCcLangAttrFromSettings?.(newM);
          } catch {
            /* ignore */
          }
        }
        if (oldM.showSubtitleOverlay !== newM.showSubtitleOverlay) {
          V.refreshSubtitleOverlayVisibility();
        }
        if (oldM.youtubeAriaFocusFix !== newM.youtubeAriaFocusFix) {
          try {
            window.__YTHUB_SET_ARIA_FOCUS_FIX?.(Boolean(newM.youtubeAriaFocusFix));
          } catch {
            /* ignore */
          }
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
    } catch {
      /* ignore */
    }
  }

  Object.assign(V, {
    applyCueAudioAndSub,
    findCueIndex,
    stopPlayback,
    tickSync,
    startPipeline,
    onBtnClick,
    buildUi,
    refreshTranslateButtonAvailability,
    syncTranslateButtonFromDom: () => window.__YTDUB_CORE?.syncUiTranslateButtonRef?.()
  });
})();
