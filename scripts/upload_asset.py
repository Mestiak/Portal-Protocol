#!/usr/bin/env python3
"""Upload all Tauri bundle files to the GitHub release for the current tag.

Creates the release if it doesn't exist. Handles URL-encoding
for filenames with spaces like 'Portal Protocol_0.7.2.dmg'.
"""
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = "Mestiak/Portal-Protocol"


def get_release_info(tag, token, attempt=1):
    """GET a release by tag. Returns the release dict or None."""
    url = f"https://api.github.com/repos/{REPO}/releases/tags/{tag}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "tauri-ci-upload",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  Get release (attempt {attempt}): HTTP {resp.status}")
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  Get release (attempt {attempt}): HTTP {e.code}")
        if e.code == 404:
            if attempt < 5:
                print(f"  Release not found, retrying in 10s...")
                time.sleep(10)
                return get_release_info(tag, token, attempt + 1)
            print("  Release not found after 5 attempts")
        else:
            print(f"  Error: {body}")
        return None


def create_release(tag, token):
    """Create a draft release for the given tag."""
    url = f"https://api.github.com/repos/{REPO}/releases"
    body = ""
    notes_path = "RELEASE-NOTES.md"
    if os.path.isfile(notes_path):
        with open(notes_path, "r") as f:
            body = f.read()

    payload = json.dumps({
        "tag_name": tag,
        "name": f"Portal Protocol {tag}",
        "draft": True,
        "body": body,
    })

    req = urllib.request.Request(
        url,
        data=payload.encode("utf-8"),
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "tauri-ci-upload",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  Create release: HTTP {resp.status}")
            data = json.loads(resp.read())
            print(f"  Release ID: {data.get('id')}")
            print(f"  Upload URL: {data.get('upload_url', 'NOT SET')}")
            return data
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        print(f"  Create release: HTTP {e.code}")
        print(f"  Response: {resp_body}")
        if e.code == 422:
            print("  Release already exists, will retry GET")
        return None
    except Exception as e:
        print(f"  Create release error: {e}")
        return None


def upload_asset(upload_url_base, token, filepath):
    """Upload a single file to the release."""
    filename = os.path.basename(filepath)
    filename_enc = urllib.parse.quote(filename)
    full_url = f"{upload_url_base}{filename_enc}"
    filesize = os.path.getsize(filepath)

    print(f"  Uploading: {filename} ({filesize} bytes)")
    print(f"  URL: {full_url}")

    with open(filepath, "rb") as f:
        file_data = f.read()

    req = urllib.request.Request(
        full_url,
        data=file_data,
        headers={
            "Authorization": f"token {token}",
            "Content-Type": "application/octet-stream",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "tauri-ci-upload",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read())
            asset_url = result.get("browser_download_url", "")
            print(f"  HTTP Status: {resp.status}")
            print(f"  Asset URL: {asset_url}")
            return True
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode()
        print(f"  HTTP Status: {e.code}")
        print(f"  Error: {resp_body}")
        return False
    except Exception as e:
        print(f"  Error: {e}")
        return False


def main():
    token = os.environ.get("GITHUB_TOKEN", "")
    tag = os.environ.get("TAG_NAME", "")
    bundle_dir = os.environ.get("BUNDLE_DIR", "src-tauri/target/release/bundle")

    if not token:
        print("ERROR: GITHUB_TOKEN not set")
        sys.exit(1)
    if not tag:
        print("ERROR: TAG_NAME not set")
        sys.exit(1)

    print(f"Tag: {tag}")
    print(f"Bundle dir: {bundle_dir}")
    print(f"Repo: {REPO}")

    # Find all bundle files using os.walk (handles all platforms)
    valid_exts = (".exe", ".msi", ".dmg", ".AppImage", ".deb", ".rpm", ".sig", ".tar.gz", ".zip")
    files = []
    for root, dirs, filenames in os.walk(bundle_dir):
        for fn in filenames:
            if fn.endswith(valid_exts):
                files.append(os.path.join(root, fn))

    if not files:
        print("ERROR: No bundle files found!")
        print("=== Searching for bundles ===")
        for ext in ["*.exe", "*.msi", "*.dmg", "*.AppImage", "*.deb", "*.rpm"]:
            matches = glob.glob(os.path.join("src-tauri", "**", ext), recursive=True)
            if matches:
                for m in matches:
                    print(f"  Found: {m}")
        print("=== Listing src-tauri/target ===")
        for root, dirs, filenames in os.walk("src-tauri/target"):
            for fn in filenames:
                fp = os.path.join(root, fn)
                print(f"  {fp}")
        sys.exit(1)

    print(f"\n=== Found {len(files)} files to upload ===")
    for f in sorted(files):
        print(f"  {os.path.basename(f)} ({os.path.getsize(f)} bytes)")

    # Get or create the release
    release = get_release_info(tag, token)
    if release is None:
        print("\n=== Creating release ===")
        release = create_release(tag, token)
        if release is None:
            print("\n=== Retrying get release ===")
            release = get_release_info(tag, token)

    if release is None:
        print("ERROR: Could not get or create release")
        sys.exit(1)

    upload_url = release.get("upload_url", "")
    if not upload_url:
        print("ERROR: No upload_url in release info")
        print(f"Release keys: {list(release.keys())}")
        sys.exit(1)

    # Strip the URI template, keep base URL
    upload_url_base = upload_url.replace("{?name,label}", "?name=")
    print(f"\nUpload URL base: {upload_url_base}")
    print(f"Upload URL base length: {len(upload_url_base)}")

    # Upload each file
    print("\n=== Uploading ===")
    failed = 0
    for filepath in sorted(files):
        if not upload_asset(upload_url_base, token, filepath):
            failed += 1
            print(f"  FAILED: {os.path.basename(filepath)}")
        else:
            print(f"  SUCCESS: {os.path.basename(filepath)}")

    print(f"\n=== Upload complete: {len(files) - failed} succeeded, {failed} failed ===")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
