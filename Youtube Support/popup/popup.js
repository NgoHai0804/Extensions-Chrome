import {
  mergeExtensionSettings,
  STORAGE_KEY,
  buildPersistedStoragePayload
} from "../content/dubbing/core/extension-settings-esm.js";

const $ = (id) => document.getElementById(id);

function buildLangListbox() {
  const sel = $("targetLang");
  const list = $("targetLangListbox");
  if (!sel || !list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  for (let i = 0; i < sel.options.length; i += 1) {
    const opt = sel.options[i];
    const li = document.createElement("li");
    li.className = "lang-select-option";
    li.setAttribute("role", "option");
    li.dataset.value = opt.value;
    li.textContent = opt.textContent;
    li.setAttribute("tabindex", "-1");
    li.addEventListener("click", (e) => {
      e.preventDefault();
      void chooseTargetLang(opt.value);
    });
    list.appendChild(li);
  }
  syncLangListSelection();
}

function syncLangListSelection() {
  const sel = $("targetLang");
  const list = $("targetLangListbox");
  if (!sel || !list) return;
  const v = sel.value;
  list.querySelectorAll(".lang-select-option").forEach((el) => {
    el.setAttribute("aria-selected", el.dataset.value === v ? "true" : "false");
  });
}

function syncLangTriggerLabel() {
  const sel = $("targetLang");
  const label = $("targetLangValue");
  if (!sel || !label) return;
  const opt = sel.options[sel.selectedIndex];
  label.textContent = opt ? opt.textContent : "";
}

function scrollLangListToSelected() {
  const list = $("targetLangListbox");
  const selected = list?.querySelector('.lang-select-option[aria-selected="true"]');
  if (!list || !selected) return;
  const pad = 6;
  const top = selected.offsetTop;
  const bottom = top + selected.offsetHeight;
  const viewTop = list.scrollTop;
  const viewBottom = viewTop + list.clientHeight;
  if (top < viewTop + pad) list.scrollTop = Math.max(0, top - pad);
  else if (bottom > viewBottom - pad) list.scrollTop = bottom - list.clientHeight + pad;
}

function setLangPanelOpen(open) {
  const root = $("langSelectRoot");
  const trig = $("targetLangTrigger");
  const list = $("targetLangListbox");
  if (!root || !trig || !list) return;
  root.classList.toggle("is-open", open);
  trig.setAttribute("aria-expanded", open ? "true" : "false");
  list.hidden = !open;
  if (open) {
    syncLangListSelection();
    requestAnimationFrame(() => scrollLangListToSelected());
  }
}

async function chooseTargetLang(value) {
  const sel = $("targetLang");
  if (!sel) return;
  sel.value = value;
  syncLangTriggerLabel();
  syncLangListSelection();
  setLangPanelOpen(false);
  await persistSettings({ targetLang: value });
}

function toggleLangPanel() {
  const list = $("targetLangListbox");
  if (!list) return;
  setLangPanelOpen(list.hidden);
}

function formatVolumePct(v) {
  const n = Math.round(Number(v) * 100);
  return `${Number.isFinite(n) ? n : 0}%`;
}

function syncVolLabel() {
  const el = $("volPct");
  if (el) el.textContent = formatVolumePct($("speechVolume").value);
}

function isSubtitleOverlayOn() {
  return $("toggleSubtitle").getAttribute("aria-checked") === "true";
}

function isAdblockOn() {
  return $("toggleAdblock").getAttribute("aria-checked") === "true";
}

function syncSubtitleSwitch(on) {
  const btn = $("toggleSubtitle");
  if (!btn) return;
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function syncAdblockSwitch(on) {
  const btn = $("toggleAdblock");
  if (!btn) return;
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function setTab(which) {
  const tabConfig = $("tabConfig");
  const tabGuide = $("tabGuide");
  const panelConfig = $("panelConfig");
  const panelGuide = $("panelGuide");
  const isGuide = which === "guide";
  tabConfig.setAttribute("aria-selected", isGuide ? "false" : "true");
  tabGuide.setAttribute("aria-selected", isGuide ? "true" : "false");
  tabConfig.classList.toggle("is-active", !isGuide);
  tabGuide.classList.toggle("is-active", isGuide);
  panelConfig.hidden = isGuide;
  panelGuide.hidden = !isGuide;
}

async function readMergedSettings() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return mergeExtensionSettings(r[STORAGE_KEY]);
}

async function load() {
  const s = await readMergedSettings();
  $("targetLang").value = s.targetLang;
  buildLangListbox();
  syncLangTriggerLabel();
  $("speechVolume").value = String(s.speechVolume);
  syncVolLabel();
  syncSubtitleSwitch(s.showSubtitleOverlay !== false);
  syncAdblockSwitch(s.adblockEnabled !== false);
  /** Chỉ lưu 3 khóa; nếu storage cũ có field thừa → thu gọn một lần. */
  const cur = await chrome.storage.local.get(STORAGE_KEY);
  const raw = cur[STORAGE_KEY];
  if (raw == null || typeof raw !== "object") {
    await chrome.storage.local.set({ [STORAGE_KEY]: buildPersistedStoragePayload({}) });
  } else {
    const keep = new Set(["adblockEnabled", "showSubtitleOverlay", "targetLang"]);
    const hasExtra = Object.keys(raw).some((k) => !keep.has(k));
    if (hasExtra) {
      await chrome.storage.local.set({ [STORAGE_KEY]: buildPersistedStoragePayload(raw) });
    }
  }
}

/**
 * @param {Partial<{ targetLang: string; showSubtitleOverlay: boolean; adblockEnabled: boolean }>} [patch]
 */
async function persistSettings(patch = {}) {
  const prev = mergeExtensionSettings((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  const payload = buildPersistedStoragePayload({
    ...patch,
    adblockEnabled: isAdblockOn(),
    showSubtitleOverlay: isSubtitleOverlayOn(),
    targetLang: patch.targetLang != null ? patch.targetLang : $("targetLang").value
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: payload });
  if (prev.adblockEnabled !== payload.adblockEnabled) {
    try {
      await chrome.runtime.sendMessage({ type: "YTHUB_REFRESH_ADBLOCK" });
    } catch {
      /* SW có thể chưa sẵn sàng — onChanged vẫn xử lý khi đổi adblock */
    }
  }
}

$("tabConfig").addEventListener("click", () => setTab("config"));
$("tabGuide").addEventListener("click", () => setTab("guide"));

$("targetLangTrigger").addEventListener("click", () => {
  toggleLangPanel();
});

$("targetLangTrigger").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setLangPanelOpen(false);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
    const list = $("targetLangListbox");
    if (list?.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setLangPanelOpen(true);
    }
  }
});

document.addEventListener("click", (e) => {
  const root = $("langSelectRoot");
  if (root?.contains(e.target)) return;
  setLangPanelOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("targetLangListbox")?.hidden) {
    setLangPanelOpen(false);
    $("targetLangTrigger")?.focus();
  }
});

$("speechVolume").addEventListener("input", syncVolLabel);
$("speechVolume").addEventListener("change", syncVolLabel);

$("toggleSubtitle").addEventListener("click", () => {
  syncSubtitleSwitch(!isSubtitleOverlayOn());
  persistSettings();
});

$("toggleAdblock").addEventListener("click", () => {
  syncAdblockSwitch(!isAdblockOn());
  persistSettings();
});

load();
