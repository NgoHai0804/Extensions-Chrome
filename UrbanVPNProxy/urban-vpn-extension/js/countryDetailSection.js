import { getProxyForCountry, getLastProxy } from "./api.js";

const PROXY_SECTION_STORAGE_KEY = "proxySectionState";

function saveProxySectionState(country, selectedServerName) {
  if (!country) return;
  try {
    chrome.storage.local.set({
      [PROXY_SECTION_STORAGE_KEY]: {
        country: {
          iso2: country.iso2,
          iso3: country.iso3,
          title: country.title,
          accessType: country.accessType,
          serversCount: country.serversCount,
          servers: country.servers || []
        },
        selectedServerName: selectedServerName || null
      }
    });
  } catch (_) {}
}

function loadProxySectionState() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([PROXY_SECTION_STORAGE_KEY], (items) => {
        resolve(items[PROXY_SECTION_STORAGE_KEY] || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function getFlagUrl(iso2) {
  if (!iso2 || iso2.length !== 2) return null;
  return `https://flagcdn.com/w320/${iso2.toLowerCase()}.png`;
}

function renderSelectedCountry(container, country) {
  if (!country) {
    container.textContent = "";
    return;
  }

  const flagUrl = getFlagUrl(country.iso2);
  const name = country.title || "Unknown";
  const iso = country.iso2 || "";
  const type = country.accessType || "UNKNOWN";
  const topup = country.servers || [];
  const serverCount = topup.length > 0 ? topup.length : (country.serversCount ?? 0);

  container.innerHTML = `
    <div class="selected-country-header">
      ${
        flagUrl
          ? `<img class="selected-country-flag" src="${flagUrl}" alt="${iso}" />`
          : ""
      }
      <div class="selected-country-meta">
        <div class="selected-country-title-row">
          <span class="selected-country-name">${name} (${iso})</span>
          <span class="badge">${type}</span>
        </div>
        <div class="selected-country-sub">Servers: ${serverCount}</div>
      </div>
    </div>
  `;
}

function clearProxyFields() {
  const fields = [
    "proxyUsername",
    "proxyPassword",
    "proxyHost",
    "proxyPort",
    "proxyHttp",
    "proxyHttps"
  ];
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  });
}

function attachCopyHandlers(statusEl) {
  const buttons = document.querySelectorAll("[data-copy-target]");
  buttons.forEach((btn) => {
    if (btn.dataset.bound === "1") return;

    const targetId = btn.getAttribute("data-copy-target");
    btn.addEventListener("click", () => {
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      const text = target.textContent || "";
      if (!text) return;

      const label = btn.closest(".proxy-field")?.querySelector(
        ".proxy-field-label"
      )?.textContent || "giá trị";

      const onOk = () => {
        if (statusEl) statusEl.textContent = `Đã copy ${label}.`;
      };
      const onFail = () => {
        if (statusEl) statusEl.textContent = `Không copy được ${label}.`;
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onOk).catch(onFail);
      } else {
        const tmp = document.createElement("textarea");
        tmp.value = text;
        document.body.appendChild(tmp);
        tmp.select();
        try {
          document.execCommand("copy");
          onOk();
        } catch {
          onFail();
        }
        document.body.removeChild(tmp);
      }
    });

    btn.dataset.bound = "1";
  });
}

function renderProxyResult(
  _container,
  country,
  server,
  proxies,
  username,
  password,
  statusEl
) {
  const usernameEl = document.getElementById("proxyUsername");
  const passwordEl = document.getElementById("proxyPassword");
  const hostEl = document.getElementById("proxyHost");
  const portEl = document.getElementById("proxyPort");
  const httpEl = document.getElementById("proxyHttp");
  const httpsEl = document.getElementById("proxyHttps");

  if (
    !usernameEl ||
    !passwordEl ||
    !hostEl ||
    !portEl ||
    !httpEl ||
    !httpsEl
  ) {
    return;
  }

  usernameEl.textContent = username || "";
  passwordEl.textContent = password || "";
  hostEl.textContent = server.host || "";
  portEl.textContent = String(server.port || "");
  httpEl.textContent = proxies.http || "";
  httpsEl.textContent = proxies.https || "";

  attachCopyHandlers(statusEl);
}

function renderServerSelect(selectEl, servers, selectedServerName) {
  if (!selectEl || !Array.isArray(servers)) return;
  selectEl.innerHTML = "";
  servers.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.name || "";
    opt.textContent = s.name ? `${s.name} (${s.host || ""}:${s.port || ""})` : `${s.host || ""}:${s.port || ""}`;
    selectEl.appendChild(opt);
  });
  if (selectedServerName) {
    const found = Array.from(selectEl.options).find(
      (o) => (o.value || "").toLowerCase() === String(selectedServerName).toLowerCase()
    );
    if (found) selectEl.value = found.value;
  } else if (selectEl.options.length > 0) {
    selectEl.selectedIndex = 0;
  }
}

export function initCountryDetailSection() {
  const selectedCountryEl = document.getElementById("selectedCountry");
  const statusEl = document.getElementById("proxyStatus");
  const resultEl = document.getElementById("proxyFields");
  const btnGetProxy = document.getElementById("btnGetProxy");
  const btnBack = document.getElementById("btnBackToList");
  const topupRow = document.getElementById("proxyTopupRow");
  const serverSelect = document.getElementById("proxyServerSelect");

  let currentCountry = null;

  function showCountry(country, selectedServerName) {
    currentCountry = country;
    if (!selectedCountryEl) return;
    renderSelectedCountry(selectedCountryEl, country);
    if (statusEl) statusEl.textContent = "";
    clearProxyFields();

    const servers = country.servers || [];
    const hasMultipleServers = servers.length >= 2;
    if (topupRow && serverSelect) {
      if (hasMultipleServers) {
        topupRow.style.display = "";
        renderServerSelect(serverSelect, servers, selectedServerName ?? null);
      } else {
        topupRow.style.display = "none";
      }
    }
    saveProxySectionState(country, serverSelect && serverSelect.options.length ? serverSelect.value : null);
  }

  function hide() {
    currentCountry = null;
    if (selectedCountryEl) selectedCountryEl.textContent = "";
    if (topupRow) topupRow.style.display = "none";
    if (serverSelect) serverSelect.innerHTML = "";
    if (statusEl) statusEl.textContent = "";
    clearProxyFields();
  }

  // Khôi phục phần PROXY khi mở popup: ưu tiên last proxy, không có thì load state đã lưu (country + danh sách server)
  if (selectedCountryEl && resultEl) {
    getLastProxy()
      .then((resp) => {
        const lp = resp.lastProxy;
        if (lp && lp.country && lp.server && lp.proxies) {
          currentCountry = lp.country;
          renderSelectedCountry(selectedCountryEl, currentCountry);
          const servers = (currentCountry && currentCountry.servers) || [];
          const hasMultipleServers = servers.length >= 2;
          if (topupRow && serverSelect && hasMultipleServers) {
            topupRow.style.display = "";
            renderServerSelect(serverSelect, servers, lp.server && lp.server.name);
          }
          renderProxyResult(
            resultEl,
            currentCountry,
            lp.server,
            lp.proxies,
            lp.username,
            lp.password,
            statusEl
          );
          if (statusEl) statusEl.textContent = "Đang hiển thị proxy lần trước.";
          return;
        }
        return loadProxySectionState();
      })
      .then((state) => {
        if (!state || !state.country) return;
        if (currentCountry) return;
        currentCountry = state.country;
        renderSelectedCountry(selectedCountryEl, currentCountry);
        const servers = (currentCountry && currentCountry.servers) || [];
        const hasMultipleServers = servers.length >= 2;
        if (topupRow && serverSelect && hasMultipleServers) {
          topupRow.style.display = "";
          renderServerSelect(serverSelect, servers, state.selectedServerName || null);
        }
      })
      .catch(() => {});
  }

  if (btnGetProxy) {
    btnGetProxy.addEventListener("click", () => {
      if (!currentCountry) return;
      const serverName =
        serverSelect && serverSelect.options.length > 0
          ? serverSelect.value || null
          : null;
      if (statusEl)
        statusEl.textContent = `Đang lấy proxy cho ${
          currentCountry.title || currentCountry.iso2
        }...`;
      clearProxyFields();

      getProxyForCountry(currentCountry.iso2, serverName)
        .then((resp) => {
          const { server, proxies, username, password } = resp.result;
          if (statusEl)
            statusEl.textContent = `Đã lấy proxy cho ${
              currentCountry.title || currentCountry.iso2
            }.`;

          renderProxyResult(
            resultEl,
            currentCountry,
            server,
            proxies,
            username,
            password,
            statusEl
          );
          saveProxySectionState(currentCountry, server && server.name);
        })
        .catch((err) => {
          if (statusEl) statusEl.textContent = "Lỗi lấy proxy: " + err.message;
        });
    });
  }

  if (serverSelect) {
    serverSelect.addEventListener("change", () => {
      if (currentCountry)
        saveProxySectionState(currentCountry, serverSelect.value || null);
    });
  }

  if (btnBack) {
    btnBack.addEventListener("click", () => {
      hide();
    });
  }

  return {
    showCountry,
    hide,
  };
}

