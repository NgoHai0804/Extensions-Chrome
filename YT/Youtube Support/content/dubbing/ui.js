/** Nút, loader, overlay lỗi (dùng content-ui hoặc fallback). */
(function ytdubUi() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const { ui, uiModule, state } = V;
  const core = window.__YTDUB_CORE;

  function findYtpRightControls() {
    const selectors = [
      "#movie_player .ytp-right-controls",
      ".html5-video-player .ytp-right-controls",
      "ytd-watch-flexy #movie_player .ytp-right-controls",
      "ytd-shorts #movie_player .ytp-right-controls"
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      const el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function mountOrFallbackBtn() {
    window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
    if (uiModule?.mountOrFallbackBtn) {
      uiModule.mountOrFallbackBtn();
      return;
    }
    if (!ui.btn) return;
    const host = findYtpRightControls();
    if (host) {
      try {
        host.querySelectorAll("button.ytdub2-btn").forEach((n) => {
          if (n !== ui.btn) n.remove();
        });
      } catch {
        /* ignore */
      }
      const needsPrepend =
        ui.btn.parentElement !== host || host.firstElementChild !== ui.btn;
      if (needsPrepend) host.prepend(ui.btn);
      ui.btn.classList.remove("ytdub2-fallback");
      if (ui.mountObserver) {
        ui.mountObserver.disconnect();
        ui.mountObserver = null;
      }
    } else {
      const b = document.body || document.documentElement;
      if (b) {
        try {
          b.querySelectorAll("button.ytdub2-btn").forEach((n) => {
            if (n !== ui.btn) n.remove();
          });
        } catch {
          /* ignore */
        }
        if (!b.contains(ui.btn)) b.appendChild(ui.btn);
      }
      ui.btn.classList.add("ytdub2-fallback");
      V.startBtnMountObserver();
    }
  }

  function startBtnMountObserver() {
    if (uiModule?.startBtnMountObserver) {
      uiModule.startBtnMountObserver();
      return;
    }
    if (ui.mountObserver) return;
    let obsMountT = null;
    ui.mountObserver = new MutationObserver(() => {
      if (obsMountT != null) clearTimeout(obsMountT);
      obsMountT = setTimeout(() => {
        obsMountT = null;
        mountOrFallbackBtn();
        V.ensureLoaderHost();
        V.ensureMsgOverlayHost();
      }, 100);
    });
    ui.mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function ensureLoaderHost() {
    if (uiModule?.ensureLoaderHost) {
      uiModule.ensureLoaderHost();
      return;
    }
    if (!ui.loader || ui.loader.hasAttribute("hidden")) return;
    const movie = document.querySelector("#movie_player");
    if (movie && ui.loader.parentElement !== movie) {
      const pos = window.getComputedStyle(movie).position;
      if (!pos || pos === "static") movie.style.position = "relative";
      movie.appendChild(ui.loader);
    }
  }

  function ensureMsgOverlayHost() {
    if (uiModule?.ensureMsgOverlayHost) {
      uiModule.ensureMsgOverlayHost();
      return;
    }
    if (!ui.msgOverlay || ui.msgOverlay.hasAttribute("hidden")) return;
    const movie = document.querySelector("#movie_player");
    if (movie) {
      if (ui.msgOverlay.parentElement !== movie) {
        const pos = window.getComputedStyle(movie).position;
        if (!pos || pos === "static") movie.style.position = "relative";
        movie.appendChild(ui.msgOverlay);
      }
      ui.msgOverlay.classList.remove("ytdub2-msg-fallback-host");
    } else {
      const b = document.body || document.documentElement;
      if (b && ui.msgOverlay.parentElement !== b) b.appendChild(ui.msgOverlay);
      ui.msgOverlay.classList.add("ytdub2-msg-fallback-host");
    }
  }

  function showPipelineErrorInVideo(err) {
    let body = String(err?.message || err || "Lỗi không xác định");
    let title = "Không thể tải phụ đề";
    if (/Player không có danh sách|Hết cách lấy phụ đề/i.test(body)) {
      title = "Không tìm thấy phụ đề";
    } else if (/Không thấy video/i.test(body)) {
      title = "Không thấy video";
    } else if (/Extension không hợp lệ/i.test(body)) {
      title = "Extension";
    } else if (/vô hiệu nút phụ đề|không hỗ trợ phụ đề\/CC — YouTube/i.test(body)) {
      title = "Không hỗ trợ phụ đề";
    }
    const isSubtitleIssue = /phụ đề|timedtext|caption|transcript|playerresponse|video id/i.test(body);
    const hasPlaybackLink = /youtube\.com\/account_playback/i.test(body);
    if (isSubtitleIssue && !hasPlaybackLink) {
      body +=
        "\n\nThiết lập trước khi thử lại:\n" +
        "1) Vào https://www.youtube.com/account_playback, bật 'Always show captions' và 'Include auto-generated captions'.\n" +
        "2) Trên video: bật CC → Cài đặt → Phụ đề → Tự động dịch → chọn ngôn ngữ.\n" +
        "3) Chờ 2-3 giây rồi bấm Dịch lại.";
    }
    if (uiModule?.showVideoMessage) {
      uiModule.showVideoMessage(title, body);
      return;
    }
    if (!ui.msgOverlay) {
      alert(body);
      return;
    }
    const tEl = ui.msgOverlay.querySelector(".ytdub2-msg-title");
    const bEl = ui.msgOverlay.querySelector(".ytdub2-msg-body");
    const okBtn = ui.msgOverlay.querySelector(".ytdub2-msg-ok");
    if (tEl) tEl.textContent = title;
    if (bEl) {
      if (core?.fillElementMultilinePlain) core.fillElementMultilinePlain(bEl, body);
      else bEl.textContent = body;
    }
    ui.msgOverlay.removeAttribute("hidden");
    ensureMsgOverlayHost();
    if (okBtn) {
      try {
        okBtn.focus();
      } catch {
        /* ignore */
      }
    }
  }

  function hideVideoMessageSafe() {
    if (uiModule?.hideVideoMessage) uiModule.hideVideoMessage();
    else if (ui.msgOverlay) ui.msgOverlay.setAttribute("hidden", "");
  }

  function setLoadingOverlay(visible) {
    if (uiModule?.setLoadingOverlay) {
      uiModule.setLoadingOverlay(visible);
      return;
    }
    if (!ui.loader) return;
    if (visible) {
      ui.loader.removeAttribute("hidden");
      ui.loader.setAttribute("aria-busy", "true");
      ensureLoaderHost();
    } else {
      ui.loader.setAttribute("hidden", "");
      ui.loader.setAttribute("aria-busy", "false");
    }
  }

  function subtitlesOverlayEnabled() {
    return state.settings?.showSubtitleOverlay !== false;
  }

  function refreshSubtitleOverlayVisibility() {
    if (!ui.sub) return;
    if (!subtitlesOverlayEnabled()) {
      ui.sub.style.display = "none";
      ui.sub.textContent = "";
    }
  }

  Object.assign(V, {
    findYtpRightControls,
    mountOrFallbackBtn,
    startBtnMountObserver,
    ensureLoaderHost,
    ensureMsgOverlayHost,
    showPipelineErrorInVideo,
    hideVideoMessageSafe,
    setLoadingOverlay,
    subtitlesOverlayEnabled,
    refreshSubtitleOverlayVisibility
  });
})();
