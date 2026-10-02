"""
google_health_setup.py — One-time setup script to authorize Google Health API access.
Runs a local loopback server to handle Google's OAuth 2.0 redirect, exchanges the
authorization code for a permanent refresh token, and tests the connection.

Usage:
  uv run --with requests python google_health_setup.py
"""

import http.server
import json
import os
import sys
import urllib.parse
import webbrowser
import requests

REDIRECT_PORT = 8085
REDIRECT_URI = f"http://127.0.0.1:{REDIRECT_PORT}/callback"

# Google Health API scopes for Sleep and Health Metrics
SCOPES = [
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
]

auth_code = None

class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/callback":
            params = urllib.parse.parse_qs(parsed.query)
            if "code" in params:
                auth_code = params["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"""
                    <html>
                    <body style="font-family: sans-serif; text-align: center; padding: 40px;">
                        <h2 style="color: #166534;">Google Health Authorization Successful!</h2>
                        <p>You can close this tab and return to your terminal.</p>
                    </body>
                    </html>
                """)
            elif "error" in params:
                self.send_response(400)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(f"Authorization error: {params.get('error')}".encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silence default HTTP server logging
        return

def main():
    print("=" * 65)
    print(" Google Health API (Premium) Authorization Setup")
    print("=" * 65)
    print("\nBefore starting, make sure you have created an OAuth 2.0 Client ID")
    print("(Application Type: 'Desktop App') in the Google Cloud Console.")
    print("See GOOGLE_HEALTH_SETUP.md for full instructions.\n")

    client_id = input("Google OAuth Client ID: ").strip()
    if not client_id:
        print("ERROR: Client ID is required.", file=sys.stderr)
        sys.exit(1)

    client_secret = input("Google OAuth Client Secret: ").strip()
    if not client_secret:
        print("ERROR: Client Secret is required.", file=sys.stderr)
        sys.exit(1)

    auth_params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(auth_params)

    server = http.server.HTTPServer(("127.0.0.1", REDIRECT_PORT), OAuthCallbackHandler)
    server.timeout = 120

    print("\nOpening browser for Google authorization...")
    print(f"If your browser doesn't open automatically, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    print("Waiting for authorization callback in browser (timeout in 2 minutes)...")
    while not auth_code:
        server.handle_request()

    if not auth_code:
        print("\nERROR: Failed to receive authorization code.", file=sys.stderr)
        sys.exit(1)

    print("\nAuthorization code received! Exchanging for tokens...")

    token_resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": auth_code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=15,
    )

    if token_resp.status_code != 200:
        print(f"ERROR: Token exchange failed ({token_resp.status_code}): {token_resp.text}", file=sys.stderr)
        sys.exit(1)

    tokens = token_resp.json()
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        print("WARNING: No refresh token returned. Did you include prompt=consent?", file=sys.stderr)
        print(json.dumps(tokens, indent=2))
        sys.exit(1)

    print("\nTokens acquired successfully! Testing Google Health API connection...")
    access_token = tokens.get("access_token")
    test_resp = requests.get(
        "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )

    if test_resp.status_code == 200:
        print("Google Health API test passed! (HTTP 200 OK)")
    elif test_resp.status_code == 403:
        print("Note: Token valid, but verify Google Health API is enabled in your Google Cloud project.")
    else:
        print(f"API Response ({test_resp.status_code}): {test_resp.text[:120]}")

    print("\n" + "=" * 65)
    print("SUCCESS! Add these secrets to your GitHub repository:")
    print("👉 https://github.com/davelane26/weight-dashboard-v2/settings/secrets/actions")
    print("=" * 65)
    print(f"\nSecret: GOOGLE_HEALTH_CLIENT_ID\nValue : {client_id}\n")
    print(f"Secret: GOOGLE_HEALTH_CLIENT_SECRET\nValue : {client_secret}\n")
    print(f"Secret: GOOGLE_HEALTH_REFRESH_TOKEN\nValue : {refresh_token}\n")
    print("=" * 65)

if __name__ == "__main__":
    main()
