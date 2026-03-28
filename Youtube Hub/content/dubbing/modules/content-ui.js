(function ytdubContentUi() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  core.createContentUi = function createContentUi() {
    const ui = { btn: null, sub: null, loader: null, msgOverlay: null, mountObserver: null };

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

    function ensureLoaderHost() {
      if (!ui.loader || ui.loader.hasAttribute("hidden")) return;
      const movie = document.querySelector("#movie_player");
      if (movie && ui.loader.parentElement !== movie) {
        const pos = window.getComputedStyle(movie).position;
        if (!pos || pos === "static") movie.style.position = "relative";
        movie.appendChild(ui.loader);
      }
    }

    function ensureMsgOverlayHost() {
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
        if (ui.msgOverlay.parentElement !== document.body) document.body.appendChild(ui.msgOverlay);
        ui.msgOverlay.classList.add("ytdub2-msg-fallback-host");
      }
    }

    function hideVideoMessage() {
      if (!ui.msgOverlay) return;
      ui.msgOverlay.setAttribute("hidden", "");
    }

    function showVideoMessage(title, body) {
      if (!ui.msgOverlay) return;
      const tEl = ui.msgOverlay.querySelector(".ytdub2-msg-title");
      const bEl = ui.msgOverlay.querySelector(".ytdub2-msg-body");
      const okBtn = ui.msgOverlay.querySelector(".ytdub2-msg-ok");
      const toMultilineHtml = (text) =>
        String(text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\r\n?/g, "\n")
          .replace(/\n/g, "<br>");
      if (tEl) tEl.textContent = String(title || "Thông báo");
      if (bEl) bEl.innerHTML = toMultilineHtml(body);
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

    function startBtnMountObserver() {
      if (ui.mountObserver) return;
      ui.mountObserver = new MutationObserver(() => {
        mountOrFallbackBtn();
        ensureLoaderHost();
        ensureMsgOverlayHost();
      });
      ui.mountObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function mountOrFallbackBtn() {
      if (!ui.btn) return;
      const host = findYtpRightControls();
      if (host) {
        host.prepend(ui.btn);
        ui.btn.classList.remove("ytdub2-fallback");
        if (ui.mountObserver) {
          ui.mountObserver.disconnect();
          ui.mountObserver = null;
        }
      } else {
        if (!document.body.contains(ui.btn)) document.body.appendChild(ui.btn);
        ui.btn.classList.add("ytdub2-fallback");
        startBtnMountObserver();
      }
    }

    function setLoadingOverlay(visible) {
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

    function buildUi(onBtnClick) {
      ui.btn = document.createElement("button");
      ui.btn.className = "ytdub2-btn ytdub2-fallback";
      ui.btn.type = "button";
      ui.btn.dataset.phase = "idle";
      ui.btn.innerHTML =
        '<span class="ytdub2-btn-icon" aria-hidden="true">' +
        '<svg class="ytdub2-btn-icon-svg" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">' +
        '<path fill="currentColor" fill-opacity="0.95" d="M4.2 3.75v12.5L11.85 10 4.2 3.75z"/>' +
        '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M13.15 6.15q2.95 3.85 0 7.7M15.35 3.95q4.25 6.05 0 12.1"/>' +
        '</svg></span><span class="ytdub2-btn-label">Dịch</span>';
      ui.btn.setAttribute("aria-label", "Dịch phụ đề và đọc theo video");
      ui.btn.addEventListener("click", onBtnClick);
      document.body.appendChild(ui.btn);
      mountOrFallbackBtn();
      if (ui.btn.classList.contains("ytdub2-fallback")) startBtnMountObserver();

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
      ui.msgOverlay.querySelector(".ytdub2-msg-ok")?.addEventListener("click", hideVideoMessage);
      document.body.appendChild(ui.msgOverlay);
    }

    return {
      ui,
      buildUi,
      mountOrFallbackBtn,
      startBtnMountObserver,
      ensureLoaderHost,
      ensureMsgOverlayHost,
      showVideoMessage,
      hideVideoMessage,
      setLoadingOverlay
    };
  };
})();
