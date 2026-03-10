import requests
from pprint import pprint

ACCOUNT_API = "https://api-pro.urban-vpn.com/rest/v1"
SECURITY_API = "https://api-pro.urban-vpn.com/rest/v1"
CLIENT_APP = "URBAN_VPN_BROWSER_EXTENSION"
BROWSER = "CHROME"

COMMON_HEADERS = {
    "accept": "application/json",
    "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    "cache-control": "no-cache",
    "pragma": "no-cache",
}


def register_anonymous(timeout: int = 10) -> dict:
    """
    Bước 1: đăng ký anonymous, trả về auth token (có field 'value').
    """
    url = f"{ACCOUNT_API}/registrations/clientApps/{CLIENT_APP}/users/anonymous"

    payload = {
        "clientApp": {
            "name": CLIENT_APP,
            "browser": BROWSER,
        }
    }

    resp = requests.post(url, json=payload, headers=COMMON_HEADERS, timeout=timeout)
    print("Register anonymous status:", resp.status_code)
    print("Register anonymous raw body:")
    print(resp.text)
    resp.raise_for_status()

    return resp.json()


def get_security_token(auth_token_value: str, timeout: int = 10) -> dict:
    """
    Bước 2: dùng auth_token.value để xin security token (accs).
    """
    url = f"{SECURITY_API}/security/tokens/accs"

    headers = {
        **COMMON_HEADERS,
        "authorization": f"Bearer {auth_token_value}",
    }

    payload = {
        "type": "accs",
        "clientApp": {
            "name": CLIENT_APP,
        },
    }

    resp = requests.post(url, json=payload, headers=headers, timeout=timeout)
    print("\nGet security token status:", resp.status_code)
    print("Get security token raw body:")
    print(resp.text)
    resp.raise_for_status()

    return resp.json()


def main():
    # B1: đăng ký anonymous -> auth token
    anon_token = register_anonymous()
    print("\nParsed anonymous token JSON:")
    pprint(anon_token)

    auth_value = anon_token.get("value")
    if not auth_value:
        print("\nKhông tìm thấy field 'value' trong anonymous token, dừng.")
        return

    # B2: đổi sang security token accs
    security_token = get_security_token(auth_value)
    print("\nParsed security token JSON:")
    pprint(security_token)

    sec_value = security_token.get("value")
    if sec_value:
        print("\nAUTH_BEARER (rút gọn):", sec_value[:40] + "...")
        print("Dùng trong header:")
        print(f"Authorization: Bearer {sec_value}")
    else:
        print("\nKhông tìm thấy field 'value' trong security token.")


if __name__ == "__main__":
    main()

