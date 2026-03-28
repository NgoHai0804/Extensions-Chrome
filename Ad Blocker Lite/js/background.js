/**
 * Ad Blocker Lite - YouTube blocking (rebuild)
 * Multi-layer strategy:
 * 1) DNR dynamic rules (network)
 * 2) MAIN world patch for player JSON
 * 3) CSS cosmetic filtering
 */

const RULESET_IDS = [
  "ublock-filters",
  "easylist",
  "easyprivacy",
  "pgl",
  "ublock-badware",
  "urlhaus-full",
];

const STORAGE_KEY = "adblockEnabled";
const BLOCKED_TOTAL_KEY = "blockedTotal";

const YT_RULE_BASE_ID = 990000;
const YT_RULE_COUNT = 12;
const YT_URL_PATTERNS = ["*://*.youtube.com/*", "*://youtube.com/*"];

let isEnabled = true;
let blockedTotal = 0;
let pendingFlush = false;
const lastInjectByTabId = new Map();

function isYoutubeUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /:\/\/([a-z0-9-]+\.)?youtube\.com\//i.test(url);
}

function scheduleFlush() {
  if (pendingFlush) return;
  pendingFlush = true;
  setTimeout(() => {
    pendingFlush = false;
    chrome.storage.local.set({ [BLOCKED_TOTAL_KEY]: blockedTotal });
  }, 1000);
}

async function setRulesetsEnabled(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: RULESET_IDS });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: RULESET_IDS });
    }
  } catch (e) {
    console.error("Ad Blocker Lite ruleset update failed:", e);
  }
}

function getYouTubeDynamicRules() {
  const initiators = ["youtube.com", "www.youtube.com", "m.youtube.com"];
  return [
    {
      id: YT_RULE_BASE_ID + 1,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||youtube.com/pagead/",
        resourceTypes: ["xmlhttprequest", "sub_frame", "script", "image"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 2,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||youtube.com/youtubei/v1/player/ad_break",
        resourceTypes: ["xmlhttprequest"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 3,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||www.youtube.com/get_midroll_",
        resourceTypes: ["xmlhttprequest"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 4,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||m.youtube.com/get_midroll_",
        resourceTypes: ["xmlhttprequest"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 5,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||youtube.com/get_video_info?",
        domainType: "firstParty",
        resourceTypes: ["xmlhttprequest"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 6,
      priority: 1900,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "adunit",
        requestDomains: ["youtube.com", "www.youtube.com", "m.youtube.com"],
        resourceTypes: ["xmlhttprequest"],
      },
    },
    // Tracking / measurement
    {
      id: YT_RULE_BASE_ID + 7,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||youtube.com/api/stats/ads?",
        resourceTypes: ["xmlhttprequest", "ping", "image"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 8,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||youtube.com/pcs/activeview?",
        resourceTypes: ["xmlhttprequest", "ping", "image"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 9,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||ad.doubleclick.net/",
        resourceTypes: ["xmlhttprequest", "ping", "image"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 10,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||googleads.g.doubleclick.net/pagead/",
        resourceTypes: ["xmlhttprequest", "script", "sub_frame", "image", "ping"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 11,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||doubleclick.com/",
        resourceTypes: ["xmlhttprequest", "image", "ping"],
      },
    },
    {
      id: YT_RULE_BASE_ID + 12,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: initiators,
        urlFilter: "||google.com/pagead/",
        resourceTypes: ["xmlhttprequest", "image", "ping"],
      },
    },
  ];
}

async function installYouTubeDynamicRules(enabled) {
  const removeRuleIds = Array.from({ length: YT_RULE_COUNT }, (_, i) => YT_RULE_BASE_ID + i + 1);
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: enabled ? getYouTubeDynamicRules() : [],
    });
  } catch (e) {
    console.error("Ad Blocker Lite DNR update failed:", e);
  }
}

function injectMainWorldPatch() {
  if (window.__ablYtMainPatchInstalled) return;
  window.__ablYtMainPatchInstalled = true;

  const adKeys = new Set(["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"]);

  const stripAdsDeep = (value, seen = new WeakSet()) => {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return value;
    seen.add(value);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) value[i] = stripAdsDeep(value[i], seen);
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
  };

  const patchResponseObject = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    try {
      stripAdsDeep(obj);
      if (obj.playerResponse) stripAdsDeep(obj.playerResponse);
      if (obj.responseContext) stripAdsDeep(obj.responseContext);
    } catch (_) {}
    return obj;
  };

  const targetUrl = (url) =>
    typeof url === "string" &&
    url.includes("youtubei") &&
    (url.includes("/player") || url.includes("/next"));

  const nativeFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const res = await nativeFetch.apply(this, args);
    try {
      const rawUrl = args[0] instanceof Request ? args[0].url : args[0];
      if (!targetUrl(rawUrl)) return res;
      const txt = await res.clone().text();
      const parsed = JSON.parse(txt);
      patchResponseObject(parsed);
      const body = JSON.stringify(parsed);
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch (_) {
      return res;
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
        current = patchResponseObject(v);
      },
    });
    if (current) current = patchResponseObject(current);
  } catch (_) {}

  document.addEventListener(
    "yt-navigate-finish",
    () => {
      try {
        if (window.ytInitialPlayerResponse) {
          patchResponseObject(window.ytInitialPlayerResponse);
        }
      } catch (_) {}
    },
    { passive: true }
  );
}

function getYoutubeCss() {
  const selectors = [
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-video-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "#masthead-ad",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
  ];
  return `${selectors.join(",")} { display: none !important; visibility: hidden !important; }`;
}

async function injectYouTubeLayers(tabId) {
  if (!isEnabled || !Number.isInteger(tabId) || tabId < 0) return;

  const now = Date.now();
  const last = lastInjectByTabId.get(tabId) || 0;
  if (now - last < 1200) return;
  lastInjectByTabId.set(tabId, now);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      injectImmediately: true,
      func: injectMainWorldPatch,
    });
  } catch (_) {}

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: getYoutubeCss(),
      origin: "USER",
    });
  } catch (_) {}
}

async function injectForOpenYouTubeTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: YT_URL_PATTERNS });
    await Promise.all(tabs.map((t) => injectYouTubeLayers(t.id)));
  } catch (e) {
    console.error("Ad Blocker Lite tab injection failed:", e);
  }
}

async function applyEnabledState(enabled) {
  await setRulesetsEnabled(enabled);
  await installYouTubeDynamicRules(enabled);
  if (enabled) await injectForOpenYouTubeTabs();
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([STORAGE_KEY, BLOCKED_TOTAL_KEY]);
  isEnabled = data[STORAGE_KEY] !== false;
  blockedTotal = Number(data[BLOCKED_TOTAL_KEY]) || 0;
  await chrome.storage.local.set({ [STORAGE_KEY]: isEnabled, [BLOCKED_TOTAL_KEY]: blockedTotal });
  await applyEnabledState(isEnabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get([STORAGE_KEY, BLOCKED_TOTAL_KEY]);
  isEnabled = data[STORAGE_KEY] !== false;
  blockedTotal = Number(data[BLOCKED_TOTAL_KEY]) || 0;
  await applyEnabledState(isEnabled);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isYoutubeUrl(details.url)) return;
  void injectYouTubeLayers(details.tabId);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isYoutubeUrl(details.url)) return;
  void injectYouTubeLayers(details.tabId);
});

if (chrome.declarativeNetRequest?.onRuleMatchedDebug?.addListener) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(() => {
    if (!isEnabled) return;
    blockedTotal += 1;
    scheduleFlush();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getEnabled") {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      sendResponse({ enabled: data[STORAGE_KEY] !== false });
    });
    return true;
  }

  if (msg.type === "setEnabled") {
    const enabled = !!msg.enabled;
    chrome.storage.local.set({ [STORAGE_KEY]: enabled }, () => {
      const wasEnabled = isEnabled;
      isEnabled = enabled;
      if (enabled && !wasEnabled) {
        blockedTotal = 0;
        chrome.storage.local.set({ [BLOCKED_TOTAL_KEY]: 0 });
      }
      applyEnabledState(enabled)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
    });
    return true;
  }

  if (msg.type === "getStats") {
    chrome.storage.local.get(BLOCKED_TOTAL_KEY, (data) => {
      sendResponse({ blockedTotal: Number(data[BLOCKED_TOTAL_KEY]) || 0 });
    });
    return true;
  }

  if (msg.type === "resetStats") {
    blockedTotal = 0;
    chrome.storage.local.set({ [BLOCKED_TOTAL_KEY]: 0 }, () => sendResponse({ ok: true }));
    return true;
  }
});

/**
 * yt-adblock-mini parity layer:
 * copy full inject trigger logic from the mini extension.
 */
(function installYtAdblockMiniParity() {
  const YT_RE = /^https?:\/\/([^/]+\.)?youtube\.com\//i;

  function miniIsYoutubeUrl(url) {
    return typeof url === "string" && YT_RE.test(url);
  }

  const miniLastInjectAtByTabId = new Map();
  function miniShouldInjectNow(tabId) {
    const now = Date.now();
    const last = miniLastInjectAtByTabId.get(tabId) || 0;
    if (now - last < 1500) {
      return false;
    }
    miniLastInjectAtByTabId.set(tabId, now);
    return true;
  }

  async function miniInjectIntoTab(tabId) {
    try {
      if (!miniShouldInjectNow(tabId)) {
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["js/yt-adblock-mini-injected.js"],
        world: "MAIN",
        injectImmediately: true
      });

      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["css/yt-adblock-mini-hide-ads.css"],
        origin: "USER"
      });
    } catch (err) {
      void err;
    }
  }

  async function miniProcessOpenYoutubeTabs() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !miniIsYoutubeUrl(tab.url)) {
        continue;
      }
      await miniInjectIntoTab(tab.id);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    miniProcessOpenYoutubeTabs().catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    miniProcessOpenYoutubeTabs().catch(() => {});
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (!details.tabId || !miniIsYoutubeUrl(details.url)) {
      return;
    }
    miniInjectIntoTab(details.tabId).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url;
    if (!miniIsYoutubeUrl(url)) {
      return;
    }
    miniInjectIntoTab(tabId).catch(() => {});
  });

  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      if (!details.tabId || details.tabId < 0) {
        return;
      }
      if (!["main_frame", "sub_frame"].includes(details.type)) {
        return;
      }
      if (!miniIsYoutubeUrl(details.url)) {
        return;
      }
      miniInjectIntoTab(details.tabId).catch(() => {});
    },
    { urls: ["*://*.youtube.com/*", "*://youtube.com/*"] },
    ["responseHeaders", "extraHeaders"]
  );
})();
