## Tổng quan luồng API

Luồng gọi API của extension Urban VPN (bản bạn đang reverse) gồm 4 bước chính:

1. **Đăng ký anonymous** → nhận **auth token** (`type = "anonm"`, có field `value`).
2. **Đổi auth token → security token `accs`** → nhận **AUTH_BEARER** (JWT dùng cho mọi request tiếp theo).
3. **Lấy danh sách countries + servers** từ `stats.falais.com` → chọn server (host, port, signature).
4. **Đổi signature server → proxy token `accs-proxy`** → nhận **username proxy** (`value`), password cố định `"1"`.

---

## 1. Đăng ký anonymous (Auth token)

- **URL**  
  `POST https://api-pro.urban-vpn.com/rest/v1/registrations/clientApps/URBAN_VPN_BROWSER_EXTENSION/users/anonymous`

- **Headers gợi ý**

```http
Accept: application/json
Accept-Language: vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5
Cache-Control: no-cache
Pragma: no-cache
```

- **Request body (JSON)**

```json
{
  "clientApp": {
    "name": "URBAN_VPN_BROWSER_EXTENSION",
    "browser": "CHROME"
  }
}
```

- **Response 200 (ví dụ thực tế)**

```json
{
  "type": "anonm",
  "value": "tqLSwx3oSlPoyvKeAf9iTH2LmB1PaYHZ",
  "creationTime": 1772542300689,
  "owner": {
    "id": "dc1b7fa2-1035-4446-8116-20753a0f3b86",
    "type": "ANONYMOUS"
  },
  "expired": false
}
```

- **Ý nghĩa chính**
  - `value`: **auth token** – được dùng làm Bearer cho bước 2.

---

## 2. Lấy security token `accs` (AUTH_BEARER)

- **URL**  
  `POST https://api-pro.urban-vpn.com/rest/v1/security/tokens/accs`

- **Headers**

```http
Authorization: Bearer <anon_token.value>   # lấy từ bước 1
Accept: application/json
Accept-Language: vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5
Cache-Control: no-cache
Pragma: no-cache
```

- **Request body (JSON)**

```json
{
  "type": "accs",
  "clientApp": {
    "name": "URBAN_VPN_BROWSER_EXTENSION"
  }
}
```

- **Response 200 (rút gọn từ thực tế)**

```json
{
  "type": "accs",
  "value": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiIsInppcCI6IkRFRiJ9....",
  "creationTime": 1772542301680,
  "expirationTime": 1772545901680,
  "owner": {
    "id": "dc1b7fa2-1035-4446-8116-20753a0f3b86",
    "type": "ANONYMOUS"
  },
  "clientApp": {
    "name": "URBAN_VPN_BROWSER_EXTENSION"
  },
  "features": [
    { "key": "autoserver" }
  ],
  "locations": [
    { "countryCode": "JP" },
    { "countryCode": "VN" },
    { "countryCode": "US" }
    // ...
  ],
  "package": {
    "id": "d227f944-fe22-48a5-ae44-45af51d43d7a",
    "name": "Veteran",
    "premiumAccess": false,
    "subscriptionAware": false
  },
  "expired": false
}
```

- **Ý nghĩa chính**
  - `value`: chính là **AUTH_BEARER** (JWT) bạn dùng cho:
    - `stats.falais.com/api/rest/v2/entrypoints/countries`
    - `security/tokens/accs-proxy`

---

## 3. Lấy danh sách countries + servers (chọn proxy)

- **URL**  
  `GET https://stats.falais.com/api/rest/v2/entrypoints/countries`

- **Headers**

```http
Authorization: Bearer <security_token.value>   # từ bước 2
Accept: application/json
Accept-Language: vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5
Cache-Control: no-cache
Pragma: no-cache
X-Client-App: URBAN_VPN_BROWSER_EXTENSION
```

- **Response 200 – cấu trúc quan trọng (rút gọn)**

```json
{
  "countries": {
    "elements": [
      {
        "accessType": "ACCESSIBLE",
        "code": {
          "iso2": "JP",
          "iso3": "JPN"
        },
        "title": "Japan",
        "servers": {
          "elements": [
            {
              "accessType": "ACCESSIBLE",
              "name": "p-jp2",
              "group": "Asia",
              "type": "PROXY",
              "address": {
                "primary": {
                  "host": "103.108.230.52",
                  "port": 8081,
                  "ip": "103.108.230.52"
                }
              },
              "weight": 44,
              "pool": "strong",
              "signature": "mqr9QYWPguqDvPLddt0nOOyeA-BxiF8p-...",
              "signatureExpirationTime": 1772542792528
            }
            // ... các server khác trong JP
          ],
          "count": 8
        }
      }
      // ... các country khác
    ]
  }
}
```

- **Trường cần dùng để tạo proxy**
  - `code.iso2`: mã nước (ví dụ `"JP"`, `"US"`, `"VN"`).
  - `servers.elements[]`:
    - `address.primary.host`: IP hoặc hostname proxy.
    - `address.primary.port`: port proxy (thường `8081`).
    - `signature`: chuỗi dùng để xin **proxy token** ở bước 4.
    - `weight`: extension thường chọn server có **weight lớn nhất**.

---

## 4. Lấy proxy token `accs-proxy` (username proxy)

Extension dùng `securityApi` là `https://api-pro.urban-vpn.com/rest/v1`, trong khi bạn cũng có thể dùng host alias `api-pro.falais.com`. Cấu trúc request giống nhau.

- **URL (theo extension)**  
  `POST https://api-pro.urban-vpn.com/rest/v1/security/tokens/accs-proxy`

  (Trong script ban đầu của bạn:  
  `https://api-pro.falais.com/rest/v1/security/tokens/accs-proxy` – cũng trả về cùng format.)

- **Headers**

```http
Authorization: Bearer <security_token.value>   # AUTH_BEARER từ bước 2
Accept: */*
Content-Type: application/json
Accept-Language: vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5
Cache-Control: no-cache
Pragma: no-cache
```

- **Request body (JSON)**  
  (signature lấy từ server bạn chọn trong bước 3.)

```json
{
  "type": "accs-proxy",
  "clientApp": {
    "name": "URBAN_VPN_BROWSER_EXTENSION"
  },
  "signature": "<signature_cua_server>"
}
```

- **Response 200 (dạng tương tự security token, rút gọn)**

```json
{
  "type": "accs-proxy",
  "value": "jzGdtOdyPeKy5tKD5PvW00dNz3ph-LOTEmgcavIo-7rsGCAwTOMKfX1FbaQEN-sS...", 
  "creationTime": 1772541339481,
  "expirationTime": 1772543139481,
  "owner": {
    "id": "ae261c16-037d-4f39-ab17-2b7017ab8bf1"
  },
  "features": [
    { "key": "autoserver" }
  ],
  "locations": [
    { "countryCode": "JP" }
  ],
  "package": {
    "id": "d227f944-fe22-48a5-ae44-45af51d43d7a",
    "name": "Veteran",
    "premiumAccess": false,
    "subscriptionAware": false
  },
  "expired": false
}
```

- **Ý nghĩa chính**
  - `value`: **username proxy**.
  - Password: extension đặt cố định là **`"1"`**.
  - Proxy đầy đủ:

```text
http://<value> : 1 @ <host> : <port>
```

Ví dụ:

```text
http://jzGdtOdyPeKy5tKD5PvW00dNz3ph-LOTEmgcavIo-7rsGCAwTOMKfX1FbaQEN-sS...:1@103.108.230.52:8081
```

---

## 5. Tóm tắt cách dùng trong code Python

### 5.1. Lấy AUTH_BEARER mới

```python
anon = register_anonymous()
auth_value = anon["value"]

sec = get_security_token(auth_value)
auth_bearer = sec["value"]  # dùng cho các API sau
```

### 5.2. Lấy proxy cho 1 country

1. Gọi `countries` với `Authorization: Bearer <auth_bearer>`.
2. Tìm `country.code.iso2 == "JP"` (ví dụ).
3. Chọn server có `weight` cao nhất, lấy:
   - `host = address.primary.host`
   - `port = address.primary.port`
   - `signature`
4. Gọi `/security/tokens/accs-proxy` với:

```json
{
  "type": "accs-proxy",
  "clientApp": { "name": "URBAN_VPN_BROWSER_EXTENSION" },
  "signature": "<signature>"
}
```

5. Lấy `proxy_token["value"]` làm **username**, password `"1"`, host/port từ server:

```python
proxy_url = f"http://{username}:1@{host}:{port}"
proxies = {"http": proxy_url, "https": proxy_url}
```

Sau đó có thể test:

```python
requests.get("https://api.ipify.org?format=json", proxies=proxies, timeout=10)
```

