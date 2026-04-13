"""Save browser session cookies to GitHub as GARMIN_COOKIES secret.

Re-run this script any time Garmin asks you to log in again (~every 60-90 days).

HOW TO UPDATE COOKIES:
  1. Open Chrome -> connect.garmin.com (log in if needed)
  2. Press F12 -> Network tab -> type 'connectapi' in filter -> press F5
  3. Right-click any request -> Copy -> Copy as cURL (bash)
  4. Paste into parse_curl_cookies.py to extract the cookie dict
  5. Replace COOKIES dict below and re-run this script
"""
import base64
import json
import sys
from pathlib import Path

import requests
from nacl import encoding, public

# ── Paste updated cookies here when refreshing ───────────────────────────────
# JWT_WEB is intentionally excluded — it only lasts ~2 hours
COOKIES = {
    "__cflb": "02DiuJLbVZHipNWxN8xjvoq496EBZ92Ps2Uy6xN4UBEUt",
    "SESSIONID": "MWMwNDY5MDYtNjRmNC00MTk4LWFiNDctNjEyYzM2YjUwNDhm",
    "GARMIN-SSO": "1",
    "GARMIN-SSO-CUST-GUID": "2562f10c-764c-4da7-9099-bf662287af51",
    "GMN_TRACKABLE": "1",
    "session": (
        "Fe26.2*1*5005a45843b45e7bbd0eff4ac2d754377e9b5a4f2c06944d9489bdec06a2145c"
        "*pqrKs0S-1w0G8eYcisPPzg*Bz9nPWMY32bh-XkYF9hbjogKXn1qR1HEOnMhMT-X_9M-dAQ"
        "aFi9q3211v2dM6LRi42AW3v6xGWc_fwHP4l1KNpRRL0EsCEMdLmUx0FVM0AoxiFKCoSbX_co"
        "T7wwfmymFgJeLBdO34E8T9nCjkYURJHdGBhtthoX893xNemlIqKnO33BYxHpS3P2OTYSbpid_"
        "3acPwxvzHodszWEItxUM8Dalm5jAE40WTZjzrHJJlKRRfvqxRgCh1APWjri61_Z4AoA43LBVz"
        "a26-rjVmXKi_l__CLq-sAIneDsGd784zpmgEhS_Z__KPkQi3gGXciL9e8CGpL-LhftZSYjlSx"
        "4mxHKhhrlwu1vcSDvt-aXV3owzO_g_Tmo1emcdkS07MFwbHA_0LMq1jnkWuT5Wm7PVFYs_lpv"
        "968P1oqemeWWw0hJDEZI5EqiCpqNNv4yahqbSHvPNTTI31XHdSIPVmWqL1e5Tk9ZnOlpHD4_Q"
        "lGGmDyejc6e3sRqLsPvc9f7AcroAXZO85eJ3qsNldXkn3cfRNGAkqaR5Lp9XMGhEZbXMKvTd"
        "R5w-OBBvCzOtck_JH0plazR1ZTa9G8ULhASDE1UPpE48Lh-auahLoYdnCKLy6MHPW6dVj55q"
        "N6DSrWD5m11m1t92XyKRbgEfuPno9_J-dsyo0ixnmS_8hczbQVHVf0IofByjE_LyP6o5fCZip"
        "blNUitfRHZ773_SPvTIJzoK4NieM4YSyqev40-Lkscmy6j4t07IBYEnk0Rawph0vt-e1L4Q_M0"
        "RPyT32PfNk1xhopH_qYKFBTlugI29WKI5f04n2kz5PlJiLFiA7I3XZi207HvDRqtzFcto8H5"
        "gCgOjYed_6uHhtFl2aKTeq6N9Ymroll9SUA3MSlz7pJU6Oc7T4_K2uZI5G4EwcOy5uW6WSc2"
        "K3Ln3AoiZWWxlxqnWW6OeB9T8jMkDSGSwHhxh5Q9y3cX19uDjgtD1jzOELDlTt2PdDqCQs5"
        "XEFo6nxwgZ_Ur5o-dScw02BNgwBtV2JLYUWxyAdfJgVw0gT29AUllSeji4jyxJu4HdORsv7g"
        "GCtTe2oTkAv9Q1ANI8Ke3ym8kr4lNz3tg7ZuS87s1SFzr1nvYZpy3dbwYYeIf7aNh_Ljlqco"
        "1JhT6eDkY4a4p9X68a9IDh5i7E_ymSBNWtxyvTPBZk6TDPeU2avihwLk948n0xxObpNlB1pH7"
        "TEL0NiVQyv0eoSjLDveRB07M8EdfAsoE7dlyCVXr7USQ9pi1U9d3w7Ib0GkzQvF9JKsyC1AWp"
        "te2pQjjMYNPJC-UPza82e2ZUkY2OG3W-xqYD9vP1HR134F_DnErhUnNPFx4C2TXlz8m11Iaar"
        "RU0LCd536tJSp_NzkjSvmkVhCqoKVIzZoVpZ0iDsokCogCBdbBGWylfjL10xz1GRM-2k3UaeuS"
        "I-5nx2XJWt9a1CVBmK4v0fcwYyqJPMu2f6oPNeEqS8m9h5Epf2VsS_VzKL1DcLSnZk-rbnSet"
        "LFVAe7n-7cQ6dvdoeWcX8UuGj5ZoR-BwyibyVQ9Q1Vo9o873nHITVizJsVtkiL1Qc-YWe-kFf"
        "Spa1ZGmX0D27-G6c2H-wpZ0eD3RfRJbublb60I4hdhKegJmr8bLoGdSUUN4qNklxig7yXJ0xU"
        "GVs8RfRgc9VKL0E8GuWz1bDkHTw8qjf_KmyrlVxsz9nGgC7q1cAsD7_yZGFG5tM2WHD9CGts"
        "6nXqulodLQvNOWtsqCqyNg7lmKvV83WmbUjepGMpqI3yqV6H0kj7fOaeBtnraUgjYSn_EIjxg"
        "sjxjJxx49JhPlMJqkcBZZuhGfDoYluvnt6lNLD0VR2SJa1rUT68SFP4GEuNd0DlGR8m5co7wu"
        "vt3PFJc8rEVtW9aupY36Cl3ygOZ5zJWxUkZeDmgSQfzksAzbiBlpEP9owKqZcNEPMezxdPjIB"
        "AOviY-YIgPdzzzhrL-pkpHmrrL35CAtBcgFdlVYrU1gQ4wgQkhutit2MATUNyRPt4jZOwSgpV"
        "BvNqsadyNuJgD80xt_bQ5OTtqETmmCNIQ6Zb-vO3YXKhFs_tAZnPf9muUziFE5ruj7uV7nGK"
        "K6rvsxtuNGgnfBIsKGIcGK0ZG5_rQVRdQKb06evG2Y9_cSz_TvL6-meRanTe1tTUkyJD71dfY"
        "EdXsmXG69bg-8c_Dnpb3GM8VMI-h9BKxappsXolJNQvB7UJ0ZX2dp2OvshvQrzUuhBNBracPIC"
        "VQF83buuhHirdhRNDDNa_3IIZ22eKoxpAkSobgDb87gRcXzOFs5fy-VB-UZzBe18ENK"
        "cejRy9j8f0CkVYk-GHBEnwXZNui9H9Ueqda-FngEHgMCD08KkWD8dl7uLBDQiBmav-DkdJUVp"
        "OHIpL2S5wcxbGxKOpCPcLEEB-vLErDzSwqG5-JEeLANbZjL4_LWHru-8GagdjVTk9av4vveiQ"
        "wLeuOlqbJOxGDXy9zMklKPZYhqsvejVxBBwR1S4ESzHdDw61eQX-t6JXNAQ16FR7zFYf5iqvq"
        "TJbvPxqTvd45fPhDv_VzzXKWAzZvNC2PA7DulGEs1ZL3aXvkywcaEeuoK9oLm4zSd8DBXND0d"
        "KOnS2Qi_tG9XuW6voSyvBjxpie_ZB*1783240019134*635513e7f65ecf1c6307831e26a5eea"
        "06566b7b80f064d86b1f99e0db5ac7685*JktmwbOHWr0f2Bff0SE9zrfn9xMJfMc_pr4AePSm"
        "kmY~2"
    ),
}
# ─────────────────────────────────────────────────────────────────────────────

TOKEN_FILE = Path(__file__).parent.parent / ".github_token"
REPO = "davelane26/weight-dashboard-v2"
PROXY = {"http": "http://sysproxy.wal-mart.com:8080", "https": "http://sysproxy.wal-mart.com:8080"}


def load_github_token() -> str:
    for line in TOKEN_FILE.read_text().splitlines():
        if line.startswith("GITHUB_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise ValueError("GITHUB_TOKEN= not found")


def encrypt_secret(public_key_b64: str, value: str) -> str:
    key_bytes = base64.b64decode(public_key_b64)
    pub_key = public.PublicKey(key_bytes, encoding.RawEncoder)
    box = public.SealedBox(pub_key)
    return base64.b64encode(box.encrypt(value.encode())).decode()


def push_secret(name: str, value: str) -> bool:
    token = load_github_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "code-puppy",
    }
    base = f"https://api.github.com/repos/{REPO}"
    pk_r = requests.get(f"{base}/actions/secrets/public-key", headers=headers, proxies=PROXY, timeout=15)
    pk_r.raise_for_status()
    key_id, pub_key = pk_r.json()["key_id"], pk_r.json()["key"]
    resp = requests.put(
        f"{base}/actions/secrets/{name}",
        headers=headers,
        json={"encrypted_value": encrypt_secret(pub_key, value), "key_id": key_id},
        proxies=PROXY,
        timeout=15,
    )
    return resp.status_code in (201, 204)


def main() -> int:
    cookies_json = json.dumps(COOKIES)
    cookies_file = Path(__file__).parent / ".garmin_cookies"
    cookies_file.write_text(cookies_json)
    print(f"[OK] Saved cookies to {cookies_file.name}")

    print("Pushing GARMIN_COOKIES to GitHub...")
    ok = push_secret("GARMIN_COOKIES", cookies_json)
    if ok:
        print("[OK] GARMIN_COOKIES secret set on GitHub!")
        print("     Session expires in ~83 days. Re-run this script when it does.")
    else:
        print("[FAIL] Could not push to GitHub.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
