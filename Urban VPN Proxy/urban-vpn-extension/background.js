const ACCOUNT_API = "https://api-pro.urban-vpn.com/rest/v1";
const SECURITY_API = "https://api-pro.urban-vpn.com/rest/v1";
const COUNTRIES_URL = "https://stats.falais.com/api/rest/v2/entrypoints/countries";
const TOKEN_URL = "https://api-pro.falais.com/rest/v1/security/tokens/accs-proxy";
const CLIENT_APP = "URBAN_VPN_BROWSER_EXTENSION";
const BROWSER = "CHROME";

async function postJson(url, body, { headers = {} } = {}) {
  const finalHeaders = { ...headers };
  const hasContentType = Object.keys(finalHeaders).some(
    (k) => k.toLowerCase() === "content-type"
  );
  if (!hasContentType) {
    finalHeaders["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: finalHeaders,
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`POST ${url} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}


async function getJson(url, { headers = {} } = {}) {
  const resp = await fetch(url, {
    method: "GET",
    headers
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GET ${url} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function registerAnonymous(timeout = 10000) {
  const url = `${ACCOUNT_API}/registrations/clientApps/${CLIENT_APP}/users/anonymous`;
  const payload = {
    clientApp: {
      name: CLIENT_APP,
      browser: BROWSER
    }
  };
  return postJson(url, payload, { timeout });
}

async function getSecurityToken(authTokenValue, timeout = 10000) {
  const url = `${SECURITY_API}/security/tokens/accs`;
  const headers = {
    authorization: `Bearer ${authTokenValue}`,
    accept: "application/json",
    "accept-language":
      "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    "cache-control": "no-cache",
    pragma: "no-cache"
  };
  const payload = {
    type: "accs",
    clientApp: {
      name: CLIENT_APP
    }
  };
  return postJson(url, payload, { headers, timeout });
}

async function getFreshAuthBearer(timeout = 10000) {
  const anon = await registerAnonymous(timeout);
  const authValue = anon.value;
  const sec = await getSecurityToken(authValue, timeout);
  return sec.value;
}

function buildCommonHeaders(authBearer) {
  return {
    "accept-language":
      "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    authorization: `Bearer ${authBearer}`,
    "cache-control": "no-cache",
    pragma: "no-cache"
  };
}

async function getCountries(authBearer, timeout = 10000) {
  const headers = {
    ...buildCommonHeaders(authBearer),
    accept: "application/json",
    "x-client-app": CLIENT_APP
  };
  return getJson(COUNTRIES_URL, { headers, timeout });
}

function pickServer(countryIso2, data, preferredServerName) {
  const countries = data.countries.elements;
  for (const c of countries) {
    if (c.code && c.code.iso2 === countryIso2) {
      const servers = c.servers.elements || [];
      if (!servers.length) {
        throw new Error(`Không có server nào cho country ${countryIso2}`);
      }
      let chosen = servers[0];
      if (preferredServerName && preferredServerName.trim()) {
        const byName = servers.find(
          (s) => (s.name || "").toLowerCase() === String(preferredServerName).trim().toLowerCase()
        );
        if (byName) chosen = byName;
      } else {
        chosen = servers.reduce(
          (acc, cur) => ((cur.weight || 0) > (acc.weight || 0) ? cur : acc),
          servers[0]
        );
      }
      const addr = chosen.address.primary;
      return {
        name: chosen.name,
        host: addr.host,
        port: addr.port,
        signature: chosen.signature
      };
    }
  }
  throw new Error(`Không tìm thấy country ${countryIso2}`);
}

async function getProxyCredentials(authBearer, server, timeout = 10000) {
  const headers = {
    ...buildCommonHeaders(authBearer),
    accept: "*/*",
    "content-type": "application/json"
  };
  const payload = {
    type: "accs-proxy",
    clientApp: { name: CLIENT_APP },
    signature: server.signature
  };
  const data = await postJson(TOKEN_URL, payload, { headers });
  const username = data.value;
  const password = "1";
  return { username, password };
}

function buildProxies(server, username, password) {
  const proxyUrl = `http://${username}:${password}@${server.host}:${server.port}`;
  return {
    http: proxyUrl,
    https: proxyUrl
  };
}

async function getCachedAuthBearer() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["authBearer", "authBearerCreatedAt", "accountInfo"],
      (items) => {
      resolve(items);
      }
    );
  });
}

async function setCachedAuthBearer(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { authBearer: value, authBearerCreatedAt: Date.now() },
      () => resolve()
    );
  });
}

async function getValidAuthBearer() {
  const { authBearer, authBearerCreatedAt, accountInfo } =
    await getCachedAuthBearer();
  const now = Date.now();
  let tokenValid = false;

  if (
    accountInfo &&
    accountInfo.securityToken &&
    accountInfo.securityToken.expirationTime
  ) {
    const exp = accountInfo.securityToken.expirationTime;
    const MARGIN_MS = 60 * 1000;
    if (exp - now > MARGIN_MS) {
      tokenValid = true;
    }
  } else if (authBearer && authBearerCreatedAt) {
    const MAX_AGE_MS = 50 * 60 * 1000;
    if (now - authBearerCreatedAt < MAX_AGE_MS) {
      tokenValid = true;
    }
  }

  if (authBearer && tokenValid) {
    return authBearer;
  }

  const newAccount = await registerAndStoreAccount();
  return newAccount.securityToken.value;
}

async function getProxiesForCountry(countryIso2, serverName) {
  const timeout = 10000;
  const upperIso2 = countryIso2.trim().toUpperCase();

  const authBearer = await getValidAuthBearer();
  const countriesData = await getCountries(authBearer, timeout);
  const server = pickServer(upperIso2, countriesData, serverName);
  const { username, password } = await getProxyCredentials(
    authBearer,
    server,
    timeout
  );
  const proxies = buildProxies(server, username, password);

  // tìm metadata country tương ứng để hiển thị lại lần sau
  let lastCountry = null;
  try {
    const elements =
      (countriesData.countries && countriesData.countries.elements) || [];
    for (const c of elements) {
      if (c.code && c.code.iso2 === upperIso2) {
        const topup = (c.servers && c.servers.elements) || [];
        lastCountry = {
          iso2: c.code.iso2,
          iso3: c.code.iso3,
          title: c.title,
          accessType: c.accessType,
          serversCount: c.servers && c.servers.count,
          servers: topup.map((s) => ({
            name: s.name,
            host: s.address && s.address.primary && s.address.primary.host,
            port: s.address && s.address.primary && s.address.primary.port
          }))
        };
        break;
      }
    }
  } catch {
    // ignore metadata errors
  }

  await new Promise((resolve) => {
    chrome.storage.local.set(
      {
        lastCountryIso2: upperIso2,
        lastProxyInfo: {
          country: lastCountry,
          server,
          proxies,
          username,
          password,
          createdAt: Date.now()
        }
      },
      () => resolve()
    );
  });

  return {
    server,
    proxies,
    username,
    password
  };
}

async function registerAndStoreAccount() {
  const timeout = 10000;
  const anon = await registerAnonymous(timeout);
  const authValue = anon.value;
  const sec = await getSecurityToken(authValue, timeout);

  const accountInfo = {
    anonToken: {
      type: anon.type,
      value: anon.value,
      creationTime: anon.creationTime,
      owner: anon.owner,
      expired: anon.expired
    },
    securityToken: {
      type: sec.type,
      value: sec.value,
      creationTime: sec.creationTime,
      expirationTime: sec.expirationTime,
      owner: sec.owner,
      expired: sec.expired
    }
  };

  await new Promise((resolve) => {
    chrome.storage.local.set(
      {
        accountInfo,
        authBearer: sec.value,
        authBearerCreatedAt: Date.now()
      },
      () => resolve()
    );
  });

  return accountInfo;
}

async function getStoredAccountInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["accountInfo"], (items) => {
      resolve(items.accountInfo || null);
    });
  });
}

const COUNTRIES_CACHE_VERSION = 2; // format có servers (topup) cho mỗi nước

async function getCountriesList() {
  const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 phút
  const now = Date.now();

  const cached = await new Promise((resolve) => {
    chrome.storage.local.get(["countriesCache"], (items) => {
      resolve(items.countriesCache || null);
    });
  });

  if (
    cached &&
    cached.version === COUNTRIES_CACHE_VERSION &&
    Array.isArray(cached.countries) &&
    cached.fetchedAt &&
    now - cached.fetchedAt < CACHE_MAX_AGE_MS
  ) {
    return cached.countries;
  }

  const timeout = 10000;
  const authBearer = await getValidAuthBearer();
  const data = await getCountries(authBearer, timeout);
  const elements = (data.countries && data.countries.elements) || [];
  const countries = elements
    .filter((c) => c.code && c.code.iso2)
    .map((c) => {
      const topup = (c.servers && c.servers.elements) || [];
      return {
        iso2: c.code.iso2,
        iso3: c.code.iso3,
        title: c.title,
        accessType: c.accessType,
        serversCount: c.servers && c.servers.count,
        servers: topup.map((s) => ({
          name: s.name,
          host: s.address && s.address.primary && s.address.primary.host,
          port: s.address && s.address.primary && s.address.primary.port
        }))
      };
    });

  await new Promise((resolve) => {
    chrome.storage.local.set(
      {
        countriesCache: {
          version: COUNTRIES_CACHE_VERSION,
          countries,
          fetchedAt: now
        }
      },
      () => resolve()
    );
  });

  return countries;
}

async function getLastProxyInfo() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["lastProxyInfo"], (items) => {
      resolve(items.lastProxyInfo || null);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return undefined;
  }

  if (message.type === "GET_PROXY_FOR_COUNTRY") {
    const { countryIso2, serverName } = message;
    (async () => {
      try {
        const result = await getProxiesForCountry(countryIso2, serverName);
        sendResponse({ ok: true, result });
      } catch (e) {
        console.error("Error getting proxy:", e);
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "GET_LAST_PROXY") {
    (async () => {
      try {
        const lastProxy = await getLastProxyInfo();
        sendResponse({ ok: true, lastProxy });
      } catch (e) {
        console.error("Error getting last proxy:", e);
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "REGISTER_ACCOUNT") {
    (async () => {
      try {
        const accountInfo = await registerAndStoreAccount();
        sendResponse({ ok: true, accountInfo });
      } catch (e) {
        console.error("Error registering account:", e);
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "GET_ACCOUNT_INFO") {
    (async () => {
      try {
        const accountInfo = await getStoredAccountInfo();
        sendResponse({ ok: true, accountInfo });
      } catch (e) {
        console.error("Error getting account info:", e);
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "GET_COUNTRIES") {
    (async () => {
      try {
        const countries = await getCountriesList();
        sendResponse({ ok: true, countries });
      } catch (e) {
        console.error("Error getting countries:", e);
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }

  return undefined;
});

