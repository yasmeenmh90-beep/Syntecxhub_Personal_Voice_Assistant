import webbrowser
from urllib.parse import urlparse
from .launcher import ActionError

HOSTS = {"www.google.com", "www.youtube.com", "github.com", "en.wikipedia.org"}


def open_web(url, label):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in HOSTS:
        raise ActionError("URL is not allowlisted.")
    try:
        if not webbrowser.open(url, new=2):
            raise ActionError(
                "Browser rejected the request. Check your default browser."
            )
    except OSError as exc:
        raise ActionError(f"Browser unavailable: {exc}") from exc
    return f"Browser accepted the request to open {label}."
