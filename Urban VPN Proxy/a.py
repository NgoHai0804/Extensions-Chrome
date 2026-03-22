import requests
from dataclasses import dataclass
from typing import Dict, Tuple

ACCOUNT_API = "https://api-pro.urban-vpn.com/rest/v1"
SECURITY_API = "https://api-pro.urban-vpn.com/rest/v1"
COUNTRIES_URL = "https://stats.falais.com/api/rest/v2/entrypoints/countries"
TOKEN_URL = "https://api-pro.falais.com/rest/v1/security/tokens/accs-proxy"
CLIENT_APP = "URBAN_VPN_BROWSER_EXTENSION"
BROWSER = "CHROME"


def register_anonymous(timeout: int = 10) -> Dict:
    url = f"{ACCOUNT_API}/registrations/clientApps/{CLIENT_APP}/users/anonymous"
    payload = {
        "clientApp": {
            "name": CLIENT_APP,
            "browser": BROWSER,
        }
    }
    resp = requests.post(url, json=payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def get_security_token(auth_token_value: str, timeout: int = 10) -> Dict:
    url = f"{SECURITY_API}/security/tokens/accs"
    headers = {
        "authorization": f"Bearer {auth_token_value}",
        "accept": "application/json",
        "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
        "cache-control": "no-cache",
        "pragma": "no-cache",
    }
    payload = {
        "type": "accs",
        "clientApp": {
            "name": CLIENT_APP,
        },
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def get_fresh_auth_bearer(timeout: int = 10) -> str:
    anon = register_anonymous(timeout=timeout)
    auth_value = anon["value"]
    sec = get_security_token(auth_value, timeout=timeout)
    return sec["value"]


@dataclass
class ProxyServer:
    name: str
    host: str
    port: int
    signature: str


class UrbanVpnClient:
    def __init__(self, auth_bearer: str, timeout: int = 10):
        self.auth_bearer = auth_bearer
        self.timeout = timeout

    @property
    def common_headers(self) -> Dict[str, str]:
        return {
            "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "authorization": f"Bearer {self.auth_bearer}",
            "cache-control": "no-cache",
            "pragma": "no-cache",
        }

    def get_countries(self) -> Dict:
        headers = {
            **self.common_headers,
            "accept": "application/json",
            "x-client-app": "URBAN_VPN_BROWSER_EXTENSION",
        }
        r = requests.get(COUNTRIES_URL, headers=headers, timeout=self.timeout)
        r.raise_for_status()
        return r.json()

    def pick_server(self, country_iso2: str, data: Dict) -> ProxyServer:
        countries = data["countries"]["elements"]
        for c in countries:
            if c["code"]["iso2"] == country_iso2:
                servers = c["servers"]["elements"]
                best = max(servers, key=lambda s: s.get("weight", 0))
                addr = best["address"]["primary"]
                return ProxyServer(
                    name=best["name"],
                    host=addr["host"],
                    port=addr["port"],
                    signature=best["signature"],
                )
        raise ValueError(f"Không tìm thấy country {country_iso2}")

    def get_proxy_credentials(self, server: ProxyServer) -> Tuple[str, str]:
        headers = {
            **self.common_headers,
            "accept": "*/*",
            "content-type": "application/json",
        }
        payload = {
            "type": "accs-proxy",
            "clientApp": {"name": "URBAN_VPN_BROWSER_EXTENSION"},
            "signature": server.signature,
        }
        r = requests.post(TOKEN_URL, headers=headers, json=payload, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        username = data["value"]
        password = "1"
        return username, password

    def build_proxies(self, server: ProxyServer, username: str, password: str) -> Dict[str, str]:
        proxy_url = f"http://{username}:{password}@{server.host}:{server.port}"
        return {
            "http": proxy_url,
            "https": proxy_url,
        }

    def get_proxies_for_country(self, country_iso2: str) -> Tuple[ProxyServer, Dict[str, str]]:
        countries_data = self.get_countries()
        server = self.pick_server(country_iso2, countries_data)
        username, password = self.get_proxy_credentials(server)
        proxies = self.build_proxies(server, username, password)
        return server, proxies

    def test_ip(self, proxies: Dict[str, str]) -> requests.Response:
        return requests.get(
            "https://api.ipify.org?format=json",
            proxies=proxies,
            timeout=self.timeout,
        )


def main():
    timeout = 10
    auth_bearer = get_fresh_auth_bearer(timeout=timeout)
    print("AUTH_BEARER (rút gọn):", auth_bearer[:40] + "...")

    client = UrbanVpnClient(auth_bearer, timeout=timeout)

    target_country = "JP"  # đổi sang "VN", "US", ... nếu muốn
    server, proxies = client.get_proxies_for_country(target_country)
    print("Proxies:", proxies)
    print(f"Chọn server {server.name} {server.host}:{server.port}")

    resp = client.test_ip(proxies)
    print("Status:", resp.status_code)
    print("Body:", resp.text)


if __name__ == "__main__":
    main()