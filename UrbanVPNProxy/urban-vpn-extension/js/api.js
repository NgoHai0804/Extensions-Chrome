export function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (resp) => {
        if (!resp) {
          reject(new Error("Không nhận được phản hồi từ background."));
          return;
        }
        if (!resp.ok) {
          reject(new Error(resp.error || "Lỗi từ background."));
          return;
        }
        resolve(resp);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export function getAccountInfo() {
  return sendMessage({ type: "GET_ACCOUNT_INFO" });
}

export function registerAccount() {
  return sendMessage({ type: "REGISTER_ACCOUNT" });
}

export function getCountries() {
  return sendMessage({ type: "GET_COUNTRIES" });
}

export function getProxyForCountry(countryIso2, serverName) {
  return sendMessage({
    type: "GET_PROXY_FOR_COUNTRY",
    countryIso2,
    serverName: serverName || null
  });
}

export function getLastProxy() {
  return sendMessage({ type: "GET_LAST_PROXY" });
}

