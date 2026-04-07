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
        const b = document.body || document.documentElement;
        if (b && ui.msgOverlay.parentElement !== b) b.appendChild(ui.msgOverlay);
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
      if (tEl) tEl.textContent = String(title || "Thông báo");
      if (bEl) core.fillElementMultilinePlain(bEl, body);
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
      let obsMountT = null;
      ui.mountObserver = new MutationObserver(() => {
        if (obsMountT != null) clearTimeout(obsMountT);
        obsMountT = setTimeout(() => {
          obsMountT = null;
          mountOrFallbackBtn();
          ensureLoaderHost();
          ensureMsgOverlayHost();
        }, 100);
      });
      ui.mountObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function mountOrFallbackBtn() {
      window.__YTDUB_CORE?.syncUiTranslateButtonRef?.();
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
      const mount = document.body || document.documentElement;
      if (!mount) return;
      ui.btn = document.createElement("button");
      ui.btn.className = "ytdub2-btn ytdub2-fallback";
      ui.btn.type = "button";
      ui.btn.dataset.phase = "idle";
      core.buildTranslateButtonContents(ui.btn);
      if (!ui.btn.querySelector(".ytdub2-btn-label")) ui.btn.textContent = "Dịch";
      ui.btn.setAttribute("aria-label", "Dịch phụ đề và đọc theo video");
      ui.btn.addEventListener("click", onBtnClick);
      mount.appendChild(ui.btn);
      mountOrFallbackBtn();
      if (ui.btn.classList.contains("ytdub2-fallback")) startBtnMountObserver();

      ui.sub = document.createElement("div");
      ui.sub.className = "ytdub2-sub";
      ui.sub.style.display = "none";
      mount.appendChild(ui.sub);

      ui.loader = document.createElement("div");
      ui.loader.className = "ytdub2-loader-overlay";
      ui.loader.setAttribute("hidden", "");
      ui.loader.setAttribute("aria-live", "polite");
      ui.loader.setAttribute("aria-busy", "false");
      core.buildLoaderOverlayContents(ui.loader);
      mount.appendChild(ui.loader);

      ui.msgOverlay = document.createElement("div");
      ui.msgOverlay.className = "ytdub2-msg-overlay";
      ui.msgOverlay.setAttribute("hidden", "");
      ui.msgOverlay.setAttribute("role", "dialog");
      ui.msgOverlay.setAttribute("aria-modal", "true");
      core.buildMsgOverlayContents(ui.msgOverlay, hideVideoMessage);
      mount.appendChild(ui.msgOverlay);
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
