/**
 * Obfuscate `release/main.js` — cùng file: service worker + content script (YouTube có Trusted Types).
 *
 * - selfDefending: template thường dùng Function → "TrustedScript assignment" bị chặn trên trang.
 * - deadCodeInjection mức cao + bundle lớn: dễ SyntaxError (Identifier _0x… đã declared).
 * - stringArrayCallsTransform / debugProtection: vẫn tắt vì eval/Function / TT (xem lịch sử).
 *
 * selfDefending tắt → build-release chạy thêm Terser sau obfuscate.
 */
const base = require("./obfuscator.config.js");

module.exports = {
  ...base,
};
