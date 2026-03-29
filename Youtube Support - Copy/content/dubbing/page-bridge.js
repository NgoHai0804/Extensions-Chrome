(function ytdubPageBridge() {
  const h = String(location.hostname || "").toLowerCase();
  if (!h.includes("youtube") && !h.includes("youtu.be")) return;

  function parseJson(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function getPlayerResponse() {
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    const pr = window.ytplayer?.config?.args?.player_response;
    const a = parseJson(pr);
    if (a) return a;
    return window.ytcfg?.get?.("PLAYER_RESPONSE") || null;
  }

  function tick() {
    const playerResponse = getPlayerResponse();
    let pathId = "";
    try {
      const u = new URL(location.href);
      const hn = u.hostname.toLowerCase();
      if (hn === "youtu.be" || hn.endsWith(".youtu.be")) {
        const y = u.pathname.match(/\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (y) pathId = y[1];
      }
      if (!pathId) {
        const sh = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (sh) pathId = sh[1];
        else {
          const em = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
          if (em) pathId = em[1];
        }
      }
    } catch {
      /* ignore */
    }
    const videoId =
      playerResponse?.videoDetails?.videoId ||
      new URL(location.href).searchParams.get("v") ||
      pathId ||
      "";
    window.postMessage({ type: "YTDUB_V2_SNAPSHOT", payload: { playerResponse, videoId } }, "*");
  }

  tick();
  window.addEventListener("yt-navigate-finish", tick, true);
  window.addEventListener("yt-page-data-updated", tick, true);
  setInterval(tick, 2000);
})();
