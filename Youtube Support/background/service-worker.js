/**
 * Không dùng trong bản release — manifest trỏ `main.js` (esbuild từ entry/main-entry.js).
 * Giữ file này để đọc / tham chiếu khi sửa packs trong entry/packs/sw-pack.js.
 */
import "./dubbing/sw.js";
import "./adblock/sw.js";
