#!/usr/bin/env python3
"""
One-time Constant Contact authorization helper.

Opens the Constant Contact consent page, catches the redirect on localhost,
exchanges the code for tokens, and writes CC_REFRESH_TOKEN into .env.
Copy that value into the GitHub repository secret of the same name.

Requires CC_CLIENT_ID, CC_CLIENT_SECRET and CC_REDIRECT_URI in .env
(the redirect URI must match the one registered on the developer app, e.g.
http://localhost:8080/callback).

    python authorize.py
"""
import base64
import hashlib
import http.server
import os
import re
import secrets
import sys
import urllib.parse
import webbrowser
from pathlib import Path

import requests

from collect import TOKEN_URL, load_env

AUTH_URL = "https://authz.constantcontact.com/oauth2/default/v1/authorize"
SCOPES = "contact_data offline_access"


def main():
    env_path = Path(__file__).resolve().parent / ".env"
    load_env(env_path)
    cid, secret, redirect = (os.environ.get(k) for k in ("CC_CLIENT_ID", "CC_CLIENT_SECRET", "CC_REDIRECT_URI"))
    if not all([cid, secret, redirect]):
        sys.exit("Set CC_CLIENT_ID, CC_CLIENT_SECRET and CC_REDIRECT_URI in .env first.")

    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code", "scope": SCOPES,
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
    })

    parsed = urllib.parse.urlparse(redirect)
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Authorized. You can close this tab.</h2>")

        def log_message(self, *a):
            pass

    print("Opening browser for Constant Contact consent…")
    webbrowser.open(url)
    print("If it didn't open, visit:\n" + url)
    with http.server.HTTPServer((parsed.hostname or "localhost", parsed.port or 80), Handler) as srv:
        while "code" not in result and "error" not in result:
            srv.handle_request()
    if "error" in result:
        sys.exit(f"Authorization failed: {result.get('error_description') or result['error']}")
    if result.get("state") != state:
        sys.exit("State mismatch; aborting.")

    r = requests.post(TOKEN_URL, data={"grant_type": "authorization_code", "code": result["code"],
                                       "redirect_uri": redirect, "code_verifier": verifier},
                      auth=(cid, secret), timeout=30)
    if r.status_code != 200:
        sys.exit(f"Token exchange failed: HTTP {r.status_code} {r.text[:200]}")
    refresh = r.json()["refresh_token"]

    txt = env_path.read_text() if env_path.exists() else ""
    if re.search(r"^CC_REFRESH_TOKEN=", txt, re.M):
        txt = re.sub(r"^CC_REFRESH_TOKEN=.*$", f"CC_REFRESH_TOKEN={refresh}", txt, flags=re.M)
    else:
        txt += f"\nCC_REFRESH_TOKEN={refresh}\n"
    env_path.write_text(txt)
    print("Refresh token saved to .env. Add it to GitHub → Settings → Secrets as CC_REFRESH_TOKEN.")


if __name__ == "__main__":
    main()
