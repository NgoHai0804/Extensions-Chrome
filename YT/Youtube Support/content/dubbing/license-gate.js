/** Kiểm tra key định kỳ — không ghi local; nhận ping từ SW (alarm 30 phút). */
import { runLicenseCheck } from "../../shared/key-check.js";
import { LICENSE_CHECK_INTERVAL_MS, LICENSE_RECHECK_MESSAGE_TYPE } from "../../shared/settings.js";

(function ytdubLicenseGate() {
  const g = typeof window !== "undefined" ? window : undefined;
  const V = g && g.__YTDUB_V3;
  if (!V) return;

  async function tick() {
    try {
      await runLicenseCheck(V);
    } catch {
      V.licenseGateOk = false;
      V.licenseCheckReason = "network";
    }
  }

  void tick();
  setInterval(() => void tick(), LICENSE_CHECK_INTERVAL_MS);

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === LICENSE_RECHECK_MESSAGE_TYPE) {
        void tick();
      }
    });
  } catch {
    /* ignore */
  }
})();
