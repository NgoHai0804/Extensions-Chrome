/** Tải phụ đề thô: YouTube, cache session, thư viện transcript. */
(function ytdubSubtitleLoader() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const {
    CORE,
    state,
    env,
    DUBBING_CONFIG,
    MSG_CACHED_TT,
    MSG_FETCH_YT_LIB,
    extOk,
    log
  } = V;
  const NEWBIE_SUBTITLE_GUIDE =
    "Hướng dẫn cho người mới:\n" +
    "1) Vào https://www.youtube.com/account_playback, bật 'Always show captions' và 'Include auto-generated captions'.\n" +
    "2) Bật CC trên video YouTube (nút Phụ đề/CC).\n" +
    "3) Mở Cài đặt (biểu tượng bánh răng) → Phụ đề.\n" +
    "4) Chọn 'Tự động dịch' và chọn ngôn ngữ bạn muốn.\n" +
    "5) Chờ 2-3 giây để YouTube nạp track phụ đề.\n" +
    "6) Quay lại và bấm nút Dịch của extension.";
  /** Ngân sách thời gian lấy sub (theo config). */
  const B1_TOTAL_BUDGET_MS = Number.isFinite(Number(DUBBING_CONFIG?.subtitleLoadTimeoutMs))
    ? Math.max(1500, Number(DUBBING_CONFIG.subtitleLoadTimeoutMs))
    : 10000;
  const TIMEDTEXT_SAME_URL_RETRY_GAP_MS = Number.isFinite(Number(DUBBING_CONFIG?.timedtextSameUrlRetryGapMs))
    ? Math.max(1000, Number(DUBBING_CONFIG.timedtextSameUrlRetryGapMs))
    : 6000;
  const timedtextUrlSeenAt = new Map();

  function leftMs(deadline) {
    return Math.max(0, Number(deadline || 0) - Date.now());
  }

  async function firstSuccess(tasks, timeoutMs) {
    if (!Array.isArray(tasks) || !tasks.length) return null;
    return await new Promise((resolve) => {
      let settled = false;
      let remaining = tasks.length;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, Math.max(200, Number(timeoutMs) || 0));

      for (let i = 0; i < tasks.length; i += 1) {
        Promise.resolve()
          .then(tasks[i])
          .then((v) => {
            if (settled) return;
            if (v && v.cues?.length) {
              settled = true;
              clearTimeout(timer);
              resolve(v);
              return;
            }
            remaining -= 1;
            if (remaining <= 0 && !settled) {
              settled = true;
              clearTimeout(timer);
              resolve(null);
            }
          })
          .catch(() => {
            if (settled) return;
            remaining -= 1;
            if (remaining <= 0) {
              settled = true;
              clearTimeout(timer);
              resolve(null);
            }
          });
      }
    });
  }

  function logSubtitleOk(method, videoId, cues, lang) {
    if (CORE.logSubtitleOk) {
      CORE.logSubtitleOk(log, method, videoId, cues, lang);
      return;
    }
    const n = cues.length;
    if (!n) return;
    log("SUB_OK | method=" + method, "| videoId=" + videoId, "| cues=" + n);
  }

  function returnIfCues(method, videoId, cues, lang) {
    if (!cues?.length) return null;
    logSubtitleOk(method, videoId, cues, lang || "");
    return { cues, lang: lang || "" };
  }

  async function getCachedTimedtextUrl(videoId, msgTimeoutMs) {
    if (!extOk() || !videoId) return "";
    const wait = Math.max(500, Math.min(4000, Number(msgTimeoutMs) || 1600));
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve("");
      }, wait);
      try {
        chrome.runtime.sendMessage({ type: MSG_CACHED_TT, videoId }, (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve("");
            return;
          }
          resolve(res?.ok && res.url ? String(res.url) : "");
        });
      } catch {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve("");
      }
    });
  }

  async function loadCuesFromYoutubeTranscriptLib(videoId) {
    if (!extOk() || !videoId) return null;
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        log("youtube-transcript: timeout");
        resolve(null);
      }, 16000);
      try {
        chrome.runtime.sendMessage(
          { type: MSG_FETCH_YT_LIB, payload: { videoId, lang: undefined } },
          (res) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              log("youtube-transcript:", chrome.runtime.lastError.message);
              resolve(null);
              return;
            }
            if (res?.ok && Array.isArray(res.cues) && res.cues.length) {
              logSubtitleOk("youtube-transcript (npm → service worker)", videoId, res.cues, String(res.lang || ""));
              resolve({ cues: res.cues, lang: String(res.lang || "") });
              return;
            }
            if (res?.error === "empty_transcript") {
              log("B1 | youtube-transcript (service worker) rỗng — bình thường, sẽ dùng CC trên trang / timedtext");
            } else if (res?.error) {
              log("youtube-transcript:", res.error);
            }
            resolve(null);
          }
        );
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        log("youtube-transcript:", e);
        resolve(null);
      }
    });
  }

  async function loadTextTracksWithRetries(delaysMs, tag, videoIdForLog) {
    const delays = Array.isArray(delaysMs) && delaysMs.length ? delaysMs : [900];
    for (let i = 0; i < delays.length; i += 1) {
      const waitMs = Number(delays[i]) || 900;
      const cues = await loadCuesFromTextTracksOnly(waitMs);
      const out = returnIfCues(`${tag} (${i + 1}/${delays.length})`, videoIdForLog || "—", cues, "");
      if (out) return out;
    }
    return null;
  }

  function pickTrack(tracks, sourceLang, targetLang) {
    const target = String(targetLang || "vi").toLowerCase().split("-")[0];
    const manual = String(sourceLang || "auto").toLowerCase();
    const list = tracks.filter((x) => x?.baseUrl);
    if (!list.length) return null;
    if (manual !== "auto") {
      const pref = manual.split("-")[0];
      return (
        list.find((t) => String(t.languageCode || "").toLowerCase() === manual) ||
        list.find((t) => String(t.languageCode || "").toLowerCase().startsWith(pref)) ||
        list[0]
      );
    }
    return (
      list.find((t) => {
        const c = String(t.languageCode || "").toLowerCase();
        return c === target || c.startsWith(`${target}-`);
      }) ||
      list.find((t) => {
        const c = String(t.languageCode || "").toLowerCase();
        return Boolean(c);
      }) ||
      list[0]
    );
  }

  function orderCaptionTracks(tracks) {
    const list = tracks.filter((t) => t?.baseUrl);
    if (!list.length) return [];
    const preferred = pickTrack(list, "auto", state.settings.targetLang);
    const seen = new Set();
    const out = [];
    for (const t of [preferred, ...list]) {
      if (!t?.baseUrl || seen.has(t.baseUrl)) continue;
      seen.add(t.baseUrl);
      out.push(t);
    }
    return out;
  }

  const subtitleUtils = CORE.createSubtitleUtils
    ? CORE.createSubtitleUtils({
        decodeHtml: env?.decodeHtml || ((x) => String(x || "")),
        getVideo: V.getVideo,
        sleep: V.sleep,
        orderCaptionTracks,
        getTargetLang: () => state.settings?.targetLang || "vi",
        log
      })
    : null;
  const fetchTimedtextCues =
    subtitleUtils?.fetchTimedtextCues ||
    (async function fallbackFetchTimedtextCues() {
      return [];
    });
  const loadCuesFromTextTracksOnly =
    subtitleUtils?.loadCuesFromTextTracksOnly ||
    (async function fallbackLoadCuesFromTextTracksOnly() {
      return [];
    });
  const loadCuesFromCaptionTracks =
    subtitleUtils?.loadCuesFromCaptionTracks ||
    (async function fallbackLoadCuesFromCaptionTracks() {
      return null;
    });

  /** Hỏi URL timedtext từ cache session; dừng khi `Date.now() >= endAt` (ms). */
  async function tryTimedtextFromSessionCacheLoop(videoId, methodPrefix, endAt) {
    if (!videoId) return null;
    let n = 0;
    while (Date.now() < endAt) {
      const slice = Math.min(1500, Math.max(400, endAt - Date.now()));
      if (slice < 200) break;
      n += 1;
      const cached = await getCachedTimedtextUrl(videoId, slice);
      if (cached) {
        const lastAt = Number(timedtextUrlSeenAt.get(cached) || 0);
        const now = Date.now();
        if (now - lastAt < TIMEDTEXT_SAME_URL_RETRY_GAP_MS) {
          await V.sleep(500);
          continue;
        }
        timedtextUrlSeenAt.set(cached, now);
        const c = await fetchTimedtextCues(cached);
        const out = returnIfCues(`${methodPrefix} #${n}`, videoId, c, "");
        if (out) return out;
        await V.sleep(320);
      } else {
        await V.sleep(450);
      }
    }
    return null;
  }

  function captionTracksFromPr(pr) {
    return pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  }

  /** Video đã có ít nhất một textTrack có cues. */
  function videoTextTracksHaveCues() {
    const video = V.getVideo();
    if (!video?.textTracks?.length) return false;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const tr = video.textTracks[i];
      if (tr.kind !== "subtitles" && tr.kind !== "captions") continue;
      try {
        const n = tr.cues && tr.cues.length;
        if (typeof n === "number" && n > 0) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  /** Chờ đến khi có cues trên player hoặc có URL timedtext trong cache (tối đa maxWaitMs). */
  async function waitUntilSubtitlesReadyAfterCc(videoId, maxWaitMs) {
    const max = Math.max(4000, Math.min(120000, Number(maxWaitMs) || 60000));
    const t0 = Date.now();
    log("PIPELINE | B0.5 — chờ chọn phụ đề + ngôn ngữ (cues trên video hoặc timedtext trong cache)…");
    await V.sleep(500);
    while (Date.now() - t0 < max) {
      if (videoTextTracksHaveCues()) {
        log("PIPELINE | B0.5 OK — textTracks đã có cues");
        await V.sleep(250);
        return;
      }
      if (videoId) {
        const url = await getCachedTimedtextUrl(videoId, 1200);
        if (url) {
          log("PIPELINE | B0.5 OK — đã có URL timedtext (session)");
          await V.sleep(250);
          return;
        }
      }
      await V.sleep(420);
    }
    log("PIPELINE | B0.5 — hết thời gian chờ, vẫn chạy B1");
  }

  async function loadSubtitleCues() {
    const deadline = Date.now() + B1_TOTAL_BUDGET_MS;
    const earlyId = V.videoIdFromUrlOnly();

    if (earlyId && leftMs(deadline) > 800) {
      const earlyEnd = Math.min(deadline, Date.now() + 12000);
      const hit = await tryTimedtextFromSessionCacheLoop(earlyId, "webRequest-cache (đầu)", earlyEnd);
      if (hit) return hit;
    }

    if (leftMs(deadline) > 400) {
      const out = await loadTextTracksWithRetries(
        [550, 1100, 1900, 3000, 4800],
        "HTMLVideoElement.textTracks",
        earlyId || state.snapshot?.videoId || "—"
      );
      if (out) return out;
    }

    const snapWait = Math.min(9500, leftMs(deadline));
    const snapOk = snapWait > 120 ? await V.waitSnapshot(snapWait) : false;
    let pr = state.snapshot?.playerResponse;
    const videoId = V.resolveVideoId(pr) || earlyId;
    if (!videoId) {
      throw new Error("Không xác định được video ID — F5 hoặc mở đúng link watch/shorts.");
    }
    if (!snapOk) {
      log("B1 | playerResponse chậm/timeout — vẫn thử fallback, videoId=", videoId);
    }

    let tracks = captionTracksFromPr(pr);

    const cachePollUntil = Math.min(deadline, Date.now() + 16000);
    const phase1Timeout = Math.min(24000, leftMs(deadline));
    const phase1 = await firstSuccess(
      [
        async () => tryTimedtextFromSessionCacheLoop(videoId, "webRequest-cache (p1)", cachePollUntil),
        async () => {
          if (!tracks.length) return null;
          const rCap = await loadCuesFromCaptionTracks(tracks);
          return rCap?.cues?.length ? rCap : null;
        },
        async () =>
          loadTextTracksWithRetries([800, 1600, 2800, 4500, 7000], "HTMLVideoElement.textTracks (p1)", videoId),
        async () => {
          const byLib = await loadCuesFromYoutubeTranscriptLib(videoId);
          return byLib?.cues?.length ? byLib : null;
        }
      ],
      Math.max(600, phase1Timeout)
    );
    if (phase1) return phase1;

    if (leftMs(deadline) > 700) {
      log("B1 | làn 2 — chờ snapshot / thử lại…");
      const w2 = Math.min(5500, leftMs(deadline));
      if (w2 > 200) await V.waitSnapshot(w2);
      pr = state.snapshot?.playerResponse;
      tracks = captionTracksFromPr(pr);
    }

    if (leftMs(deadline) > 500) {
      const cacheEnd2 = Math.min(deadline, Date.now() + 14000);
      const phase2Timeout = Math.min(32000, leftMs(deadline));
      const phase2 = await firstSuccess(
        [
          async () => tryTimedtextFromSessionCacheLoop(videoId, "webRequest-cache (L2)", cacheEnd2),
          async () => {
            if (!tracks.length) return null;
            const rCap = await loadCuesFromCaptionTracks(tracks);
            return rCap?.cues?.length ? rCap : null;
          },
          async () =>
            loadTextTracksWithRetries([3500, 6500, 10000], "HTMLVideoElement.textTracks (L2)", videoId),
          async () => {
            const byLib = await loadCuesFromYoutubeTranscriptLib(videoId);
            return byLib?.cues?.length ? byLib : null;
          }
        ],
        Math.max(600, phase2Timeout)
      );
      if (phase2) return phase2;
    }

    if (leftMs(deadline) > 400) {
      const out = await loadTextTracksWithRetries(
        [2800, 6000, 9500],
        "HTMLVideoElement.textTracks (cuối)",
        videoId
      );
      if (out) return out;
    }

    if (leftMs(deadline) > 400) {
      const lastEnd = Math.min(deadline, Date.now() + 11000);
      const last = await tryTimedtextFromSessionCacheLoop(videoId, "webRequest-cache (L3)", lastEnd);
      if (last) return last;
    }

    if (!tracks.length) {
      throw new Error(
        "Player không có danh sách phụ đề.\n\n" +
          NEWBIE_SUBTITLE_GUIDE +
          "\n\nSau đó F5 và bấm Dịch lại."
      );
    }
      throw new Error("Lấy phụ đề quá 10 giây hoặc thất bại.\n\n" + NEWBIE_SUBTITLE_GUIDE + "\n\nSau đó F5 rồi bấm Dịch lại.");
  }

  Object.assign(V, {
    logSubtitleOk,
    returnIfCues,
    pickTrack,
    orderCaptionTracks,
    loadSubtitleCues,
    waitUntilSubtitlesReadyAfterCc,
    videoTextTracksHaveCues
  });
})();
