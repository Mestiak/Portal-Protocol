#!/usr/bin/env python3
"""Upload all Tauri bundle files to the GitHub release for the current tag.

Handles URL-encoding (spaces in filenames like 'Portal Protocol_0.7.2.dmg'),
authentication via GITHUB_TOKEN, and detailed debug output.
"""
import glob
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def get_release_info(tag, token):
    url = f"https://api.github.com/repos/Mestiak/Portal-Protocol/releases/tags/{tag}"
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
        with urllib.request.urlopen(req) as resp:
            print(f"  GET release info: HTTP {resp.status}")
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  GET release info: HTTP {e.code}")
        print(f"  Response: {body}")
        return None


def upload_asset(upload_url_base, token, filepath):
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
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            asset_url = result.get("browser_download_url", "")
            print(f"  HTTP Status: {resp.status}")
            print(f"  Asset URL: {asset_url}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  HTTP Status: {e.code}")
        print(f"  Error: {body}")
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

    # Find all bundle files
    files = []
    for ext in ["*"]:
        pattern = os.path.join(bundle_dir, "**", ext)
        files.extend(glob.glob(pattern, recursive=True))

    files = [f for f in files if os.path.isfile(f) and f.endswith((".exe", ".msi", ".dmg",
              ".AppImage", ".deb", ".rpm", ".sig", ".tar.gz", ".zip"))]

    if not files:
        print("ERROR: No bundle files found!")
        print("=== Searching for bundles ===")
        for ext in ["*.exe", "*.msi", "*.dmg", "*.AppImage", "*.deb", "*.rpm"]:
            matches = glob.glob(os.path.join("src-tauri", "**", ext), recursive=True)
            if matches:
                print(f"  {ext}: {matches}")
        sys.exit(1)

    print(f"\n=== Found {len(files)} files to upload ===")
    for f in files:
        print(f"  {os.path.basename(f)} ({os.path.getsize(f)} bytes)")

    # Get release info
    release = get_release_info(tag, token)
    if release is None:
        print("ERROR: Could not get release info")
        sys.exit(1)

    upload_url = release.get("upload_url", "")
    if not upload_url:
        print("ERROR: No upload_url in release info")
        print(f"Release keys: {list(release.keys())}")
        sys.exit(1)

    # Replace URI template
    upload_url_base = upload_url.replace("{?name,label}", "?name=")
    print(f"\nUpload URL base: {upload_url_base}")

    # Upload each file
    print("\n=== Uploading ===")
    failed = 0
    for filepath in files:
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
