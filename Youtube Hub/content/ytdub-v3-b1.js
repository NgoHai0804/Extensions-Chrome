/** B1 — chỉ tải phụ đề raw từ YouTube / cache / transcript lib. */
(function ytdubV3B1() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const {
    CORE,
    state,
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
  const B1_TOTAL_BUDGET_MS = 9000;

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

  async function getCachedTimedtextUrl(videoId) {
    if (!extOk() || !videoId) return "";
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve("");
      }, 1800);
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
      }, 5500);
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
        decodeHtml: V.decodeHtml,
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

  async function loadSubtitleCues() {
    const deadline = Date.now() + B1_TOTAL_BUDGET_MS;
    const earlyId = V.videoIdFromUrlOnly();

    if (earlyId) {
      const cached = await getCachedTimedtextUrl(earlyId);
      if (cached) {
        const c = await fetchTimedtextCues(cached);
        const out = returnIfCues("webRequest-cache + fetch /api/timedtext", earlyId, c, "");
        if (out) return out;
      }
    }

    let out = await loadTextTracksWithRetries(
      [420, 760],
      "HTMLVideoElement.textTracks (nhanh)",
      earlyId || state.snapshot?.videoId || "—"
    );
    if (out) return out;

    const snapWait = Math.min(4800, leftMs(deadline));
    const snapOk = snapWait > 120 ? await V.waitSnapshot(snapWait) : false;
    const pr = state.snapshot?.playerResponse;
    const videoId = V.resolveVideoId(pr) || earlyId;
    if (!videoId) {
      throw new Error("Không xác định được video ID — F5 hoặc mở đúng link watch/shorts.");
    }
    if (!snapOk) {
      log("B1 | playerResponse chậm/timeout — vẫn thử fallback, videoId=", videoId);
    }

    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    // Chạy song song các nguồn còn lại để giảm thời gian chờ loader.
    const phase1 = await firstSuccess(
      [
        async () => {
          if (!tracks.length) return null;
          const rCap = await loadCuesFromCaptionTracks(tracks);
          return rCap?.cues?.length ? rCap : null;
        },
        async () => {
          const cached = await getCachedTimedtextUrl(videoId);
          if (!cached) return null;
          const c = await fetchTimedtextCues(cached);
          return returnIfCues("webRequest-cache (song song)", videoId, c, "");
        },
        async () => loadTextTracksWithRetries([700, 1100], "HTMLVideoElement.textTracks (retry)", videoId),
        async () => {
          const byLib = await loadCuesFromYoutubeTranscriptLib(videoId);
          return byLib?.cues?.length ? byLib : null;
        }
      ],
      Math.min(4200, leftMs(deadline))
    );
    if (phase1) return phase1;

    if (leftMs(deadline) > 300) {
      out = await loadTextTracksWithRetries([900], "HTMLVideoElement.textTracks (lần cuối)", videoId);
      if (out) return out;
    }

    if (!tracks.length) {
      throw new Error(
        "Player không có danh sách phụ đề.\n\n" +
          NEWBIE_SUBTITLE_GUIDE +
          "\n\nSau đó F5 và bấm Dịch lại."
      );
    }
    throw new Error("Lấy phụ đề thất bại.\n\n" + NEWBIE_SUBTITLE_GUIDE + "\n\nSau đó F5 rồi bấm Dịch lại.");
  }

  Object.assign(V, {
    logSubtitleOk,
    returnIfCues,
    pickTrack,
    orderCaptionTracks,
    loadSubtitleCues
  });
})();
