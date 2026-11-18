"""Real socket-based checks. Start both servers first; no mocks or app launches."""

import json
from urllib.request import Request, ProxyHandler, build_opener
from urllib.error import HTTPError, URLError

BASE = "http://127.0.0.1:8000/api/"
# Local service checks must never go through a configured external proxy.
opener = build_opener(ProxyHandler({}))


def request(path, data=None, method=None, base=BASE):
    body = json.dumps(data).encode() if data is not None else None
    req = Request(
        base + path,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with opener.open(req, timeout=20) as response:
        return json.load(response)


def main():
    assert request("health")["status"] == "ready"
    assert request("commands")["commands"]
    for command in ("Hello NOVA", "what time is it?", "what's today's date?"):
        result = request("command", {"text": command})
        assert result["status"] == "completed", result
        print(command, "→", result["message"])
    assert request("command", {"text": "dance"})["status"] == "error"
    assert (
        request("command", {"text": "open calculator"})["status"]
        == "confirmation_required"
    )
    try:
        request("command", {"text": ""})
        raise AssertionError("Invalid input accepted")
    except HTTPError as error:
        assert error.code == 422
    original = request("settings")
    try:
        changed = {**original, "rate": 1.3 if original["rate"] != 1.3 else 1.4}
        assert request("settings", changed, "PUT") == changed
        assert request("settings") == changed
    finally:
        request("settings", original, "PUT")
    assert request("health", base="http://127.0.0.1:5173/api/")["status"] == "ready"
    with opener.open("http://127.0.0.1:5173", timeout=20) as response:
        assert b"NOVA" in response.read()
    print(
        "PASS: live backend, frontend proxy, commands, validation, confirmation, and settings round-trip."
    )
    print(
        "Continue with docs/VERIFICATION.md for visual, application, and hardware checks."
    )


if __name__ == "__main__":
    try:
        main()
    except (URLError, OSError, AssertionError, ValueError) as error:
        raise SystemExit(
            f"FAIL: live integration could not be verified: {error}. Start both services in your Mac Terminal and retry."
        ) from error
