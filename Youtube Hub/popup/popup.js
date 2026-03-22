import { mergeExtensionSettings, STORAGE_KEY } from "../shared/settings.js";

const $ = (id) => document.getElementById(id);

function formatVolumePct(v) {
  const n = Math.round(Number(v) * 100);
  return `${Number.isFinite(n) ? n : 0}%`;
}

function syncVolLabel() {
  const el = $("volPct");
  if (el) el.textContent = formatVolumePct($("speechVolume").value);
}

function isSubtitleOverlayOn() {
  return $("toggleSubtitle").getAttribute("aria-pressed") === "true";
}

function syncSubtitleToggleUi(on) {
  const btn = $("toggleSubtitle");
  const text = $("toggleSubtitleText");
  if (!btn) return;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (text) text.textContent = on ? "Bật" : "Tắt";
}

async function readMergedSettings() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  return mergeExtensionSettings(r[STORAGE_KEY]);
}

async function load() {
  const s = await readMergedSettings();
  $("targetLang").value = s.targetLang;
  $("speechVolume").value = String(s.speechVolume);
  syncVolLabel();
  syncSubtitleToggleUi(s.showSubtitleOverlay !== false);
  await chrome.storage.local.set({ [STORAGE_KEY]: s });
}

async function save(showStatus) {
  const base = await readMergedSettings();
  const settings = mergeExtensionSettings({
    ...base,
    targetLang: $("targetLang").value,
    speechVolume: Number($("speechVolume").value),
    showSubtitleOverlay: isSubtitleOverlayOn()
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  if (showStatus) {
    $("status").textContent = "Đã lưu";
    setTimeout(() => ($("status").textContent = ""), 1500);
  }
}

$("save").addEventListener("click", () => save(true));

$("targetLang").addEventListener("change", () => save(false));

$("speechVolume").addEventListener("input", syncVolLabel);

$("toggleSubtitle").addEventListener("click", () => {
  syncSubtitleToggleUi(!isSubtitleOverlayOn());
  save(false);
});

load();
