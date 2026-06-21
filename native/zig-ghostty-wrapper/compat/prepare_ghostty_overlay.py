#!/usr/bin/env python3
import os
import shutil
import sys
from pathlib import Path
from typing import Sequence


def copy_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        raise SystemExit(f"missing source: {src}")

    if not dst.exists():
        shutil.copytree(src, dst)
        return

    for root, dirnames, filenames in os.walk(src):
        root_path = Path(root)
        rel_path = root_path.relative_to(src)
        target_root = dst / rel_path
        target_root.mkdir(parents=True, exist_ok=True)

        for dirname in dirnames:
            (target_root / dirname).mkdir(parents=True, exist_ok=True)

        for filename in filenames:
            shutil.copy2(root_path / filename, target_root / filename)


def copy_file(src: Path, dst: Path) -> None:
    if not src.exists():
        raise SystemExit(f"missing source: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main(argv: Sequence[str]) -> int:
    if len(argv) != 4:
        print(
            "usage: prepare_ghostty_overlay.py <vendor-src-dir> <overlay-dir> <out-dir>",
            file=sys.stderr,
        )
        return 2

    vendor_src = Path(argv[1]).resolve()
    overlay_dir = Path(argv[2]).resolve()
    out_dir = Path(argv[3]).resolve()

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ghostty_src = out_dir / "ghostty-src"
    ghostty_src.mkdir(parents=True, exist_ok=True)

    for rel_dir in (
        "terminal",
        "unicode",
        "lib",
        "datastruct",
        "os",
        "simd",
    ):
        copy_tree(vendor_src / rel_dir, ghostty_src / rel_dir)

    for rel_file in (
        "config/url.zig",
        "fastmem.zig",
        "input/config.zig",
        "input/function_keys.zig",
        "input/key.zig",
        "input/key_encode.zig",
        "input/key_mods.zig",
        "input/kitty.zig",
        "tripwire.zig",
    ):
        copy_file(vendor_src / rel_file, ghostty_src / rel_file)

    copy_tree(overlay_dir, out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
