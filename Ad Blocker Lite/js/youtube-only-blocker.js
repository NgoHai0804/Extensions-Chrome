/**
 * YouTube-only ad blocker module (MV3 background service worker context).
 * Strategy:
 * 1) DNR dynamic rules for ad/tracker network calls from YouTube.
 * 2) MAIN world patch to prune ad fields from player responses.
 * 3) CSS cosmetic hiding for ad UI containers.
 */

(function youtubeOnlyBlockerBootstrap() {
  if (globalThis.__ablYoutubeOnlyBootstrapped) return;
  globalThis.__ablYoutubeOnlyBootstrapped = true;

  const YT_HOST_PATTERNS = ["*://*.youtube.com/*", "*://youtube.com/*"];
  const YT_INITIATORS = ["youtube.com", "www.youtube.com", "m.youtube.com"];
  const RULE_ID_START = 991000;
  const RULE_ID_END = 991011;
  const INJECT_COOLDOWN_MS = 1200;

  const lastInjectByTabId = new Map();

  function isYouTubeUrl(url) {
    return typeof url === "string" && /:\/\/([a-z0-9-]+\.)?youtube\.com\//i.test(url);
  }

  function buildYouTubeRules() {
    return [
      {
        id: 991000,
        priority: 2000,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||youtube.com/pagead/",
          resourceTypes: ["xmlhttprequest", "sub_frame", "script", "image"],
        },
      },
      {
        id: 991001,
        priority: 2000,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||youtube.com/youtubei/v1/player/ad_break",
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 991002,
        priority: 2000,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||www.youtube.com/get_midroll_",
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 991003,
        priority: 2000,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||m.youtube.com/get_midroll_",
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 991004,
        priority: 1900,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "adunit",
          requestDomains: ["youtube.com", "www.youtube.com", "m.youtube.com"],
          resourceTypes: ["xmlhttprequest"],
        },
      },
      {
        id: 991005,
        priority: 1800,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||youtube.com/api/stats/ads?",
          resourceTypes: ["xmlhttprequest", "ping", "image"],
        },
      },
      {
        id: 991006,
        priority: 1800,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||youtube.com/pcs/activeview?",
          resourceTypes: ["xmlhttprequest", "ping", "image"],
        },
      },
      {
        id: 991007,
        priority: 1800,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||ad.doubleclick.net/",
          resourceTypes: ["xmlhttprequest", "ping", "image"],
        },
      },
      {
        id: 991008,
        priority: 1800,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||googleads.g.doubleclick.net/pagead/",
          resourceTypes: ["xmlhttprequest", "script", "sub_frame", "image", "ping"],
        },
      },
      {
        id: 991009,
        priority: 1800,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||doubleclick.com/",
          resourceTypes: ["xmlhttprequest", "image", "ping"],
        },
      },
      {
        id: 991010,
        priority: 1800,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          urlFilter: "||google.com/pagead/",
          resourceTypes: ["xmlhttprequest", "image", "ping"],
        },
      },
      {
        id: 991011,
        priority: 1750,
        action: { type: "block" },
        condition: {
          initiatorDomains: YT_INITIATORS,
          regexFilter: "^https?:\\/\\/[^/]*youtube\\.com\\/get_video_info\\?.*([?&])adformat=",
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ];
  }

  async function applyYouTubeRules() {
    const removeRuleIds = [];
    for (let id = RULE_ID_START; id <= RULE_ID_END; id += 1) {
      removeRuleIds.push(id);
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: buildYouTubeRules(),
    });
  }

  function getYouTubeCss() {
    const selectors = [
      "ytd-ad-slot-renderer",
      "ytd-display-ad-renderer",
      "ytd-promoted-video-renderer",
      "ytd-in-feed-ad-layout-renderer",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
      "#masthead-ad",
      ".ytp-ad-module",
      ".ytp-ad-overlay-container",
      ".video-ads",
    ];
    return `${selectors.join(",")} { display: none !important; visibility: hidden !important; }`;
  }

  function injectMainWorldPatch() {
    if (window.__ablYtMainPatched) return;
    window.__ablYtMainPatched = true;

    const adKeys = new Set(["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"]);

    function stripAdsDeep(value, seen = new WeakSet()) {
      if (!value || typeof value !== "object") return value;
      if (seen.has(value)) return value;
      seen.add(value);

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          value[i] = stripAdsDeep(value[i], seen);
        }
        return value;
      }

      for (const key of Object.keys(value)) {
        if (adKeys.has(key)) {
          delete value[key];
        } else {
          value[key] = stripAdsDeep(value[key], seen);
        }
      }
      return value;
    }

    function patchObject(payload) {
      if (!payload || typeof payload !== "object") return payload;
      try {
        stripAdsDeep(payload);
        if (payload.playerResponse) stripAdsDeep(payload.playerResponse);
      } catch (_) {}
      return payload;
    }

    const shouldPatchRequest = (url) =>
      typeof url === "string" &&
      url.includes("youtubei") &&
      (url.includes("/player") || url.includes("/next"));

    const nativeFetch = window.fetch;
    window.fetch = async function patchedFetch(...args) {
      const response = await nativeFetch.apply(this, args);
      try {
        const rawUrl = args[0] instanceof Request ? args[0].url : args[0];
        if (!shouldPatchRequest(rawUrl)) return response;

        const text = await response.clone().text();
        const parsed = JSON.parse(text);
        patchObject(parsed);

        return new Response(JSON.stringify(parsed), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (_) {
        return response;
      }
    };

    try {
      let current = window.ytInitialPlayerResponse;
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        enumerable: true,
        get() {
          return current;
        },
        set(v) {
          current = patchObject(v);
        },
      });
      if (current) current = patchObject(current);
    } catch (_) {}

    document.addEventListener(
      "yt-navigate-finish",
      () => {
        try {
          if (window.ytInitialPlayerResponse) {
            patchObject(window.ytInitialPlayerResponse);
          }
        } catch (_) {}
      },
      { passive: true }
    );
  }

  async function injectYouTubeLayerForTab(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) return;

    const now = Date.now();
    const lastInject = lastInjectByTabId.get(tabId) || 0;
    if (now - lastInject < INJECT_COOLDOWN_MS) return;
    lastInjectByTabId.set(tabId, now);

    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      injectImmediately: true,
      func: injectMainWorldPatch,
    });

    await chrome.scripting.insertCSS({
      target: { tabId },
      origin: "USER",
      css: getYouTubeCss(),
    });
  }

  async function injectAllOpenYouTubeTabs() {
    const tabs = await chrome.tabs.query({ url: YT_HOST_PATTERNS });
    await Promise.all(
      tabs
        .map((tab) => tab.id)
        .filter((tabId) => Number.isInteger(tabId))
        .map((tabId) => injectYouTubeLayerForTab(tabId))
    );
  }

  async function setupYouTubeOnlyBlocker() {
    try {
      await applyYouTubeRules();
      await injectAllOpenYouTubeTabs();
    } catch (e) {
      console.error("[ABL][YT] setup failed:", e);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    void setupYouTubeOnlyBlocker();
  });

  chrome.runtime.onStartup.addListener(() => {
    void setupYouTubeOnlyBlocker();
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!isYouTubeUrl(details.url)) return;
    void injectYouTubeLayerForTab(details.tabId);
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    if (!isYouTubeUrl(details.url)) return;
    void injectYouTubeLayerForTab(details.tabId);
  });
})();
