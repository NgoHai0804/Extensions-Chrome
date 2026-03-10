from __future__ import annotations

from flask import Flask, jsonify, render_template, request

from a import UrbanVpnClient, get_fresh_auth_bearer


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.post("/api/test-ip")
    def api_test_ip():
        data = request.get_json(silent=True) or {}
        country = (data.get("country") or "").upper().strip()

        if not country:
            return (
                jsonify({"ok": False, "error": "Thiếu mã quốc gia (ví dụ: JP, VN, US)."}),
                400,
            )

        timeout = 10

        try:
            auth_bearer = get_fresh_auth_bearer(timeout=timeout)
            client = UrbanVpnClient(auth_bearer, timeout=timeout)

            server, proxies = client.get_proxies_for_country(country)
            resp = client.test_ip(proxies)

            return jsonify(
                {
                    "ok": True,
                    "country": country,
                    "ip_response_status": resp.status_code,
                    "ip_response_body": resp.text,
                    "proxy_server": {
                        "name": server.name,
                        "host": server.host,
                        "port": server.port,
                    },
                    "proxies": proxies,
                }
            )
        except Exception as exc:  # noqa: BLE001
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": str(exc),
                    }
                ),
                500,
            )

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True)

