#!/usr/bin/env python3
"""List videos in a link-shared Google Drive folder: id, name, size.

Usage: python scripts/drive.py <folder-url-or-id>
Then read frames without downloading the whole file:
  python scripts/stream_frames.py --drive <id> --out media/<name> --count 24
"""
import html
import re
import sys

import requests


def folder_id(value):
    match = re.search(r"folders/([\w-]+)", value)
    return match.group(1) if match else value


def list_folder(value):
    page = requests.get(f"https://drive.google.com/embeddedfolderview?id={folder_id(value)}", timeout=30)
    page.raise_for_status()
    entries = re.findall(r'file/d/([\w-]+)/view.*?flip-entry-title">([^<]+)<', page.text, re.S)
    seen = {}
    for file_id, name in entries:
        seen.setdefault(file_id, html.unescape(name))
    return list(seen.items())


def size(file_id):
    response = requests.get(f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t",
                            headers={"Range": "bytes=0-0"}, timeout=30)
    match = re.search(r"/(\d+)$", response.headers.get("Content-Range", ""))
    return int(match.group(1)) if match else None


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    for file_id, name in list_folder(sys.argv[1]):
        bytes_ = size(file_id)
        print(f"{file_id}\t{name}\t{bytes_ / 1e6:.0f} MB" if bytes_ else f"{file_id}\t{name}\t(no access)")
