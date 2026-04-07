import { setYoutubeAriaFocusFixEnabled } from "../../content/a11y/youtube-aria-focus-fix.js";
import "../../content/dubbing/core/constants.js";

if (typeof window !== "undefined") {
  window.__YTHUB_SET_ARIA_FOCUS_FIX = setYoutubeAriaFocusFixEnabled;
}
import "../../content/dubbing/core/settings.js";
import "../../content/dubbing/core/config.js";
import "../../content/dubbing/core/logging.js";
import "../../content/dubbing/cc-constants.js";
import "../../content/dubbing/modules/content-env.js";
import "../../content/dubbing/modules/content-ui.js";
import "../../content/dubbing/modules/content-tts.js";
import "../../content/dubbing/modules/subtitle-utils.js";
import "../../content/dubbing/runtime.js";
import "../../content/dubbing/license-gate.js";
import "../../content/dubbing/ui.js";
import "../../content/dubbing/helpers.js";
import "../../content/dubbing/subtitle-loader.js";
import "../../content/dubbing/subtitle-timeline.js";
import "../../content/dubbing/tts.js";
import "../../content/dubbing/playback.js";
import "../../content/adblock/adblock-init.js";
import "../../content/content.js";
