#!/usr/bin/env python3
"""Version sync + bump gate for CI (and local pre-push).

Enforces two invariants so a `feat:` can never again land without a version
bump (the main-cz8 follow-up incident this gate was added for):

1. SYNC — the version declared in ``package.json``, ``pyproject.toml`` and
   ``tree-sitter.json`` (``metadata.version``) must all be IDENTICAL. The three
   bindings all build from these, so drift would publish mismatched artifacts.

2. BUMP — the version bump between the PR's base branch and HEAD must satisfy
   the SemVer level implied by the PR's own Conventional Commit messages:

       feat, perf                              -> minor
       fix                                     -> patch
       ``feat!``/``fix!``/BREAKING CHANGE      -> major
       docs, chore, style, test, refactor,
       build, ci, revert, perf-less housekeeping -> none (no bump required)

   So a PR that contains a ``feat:`` must bump at least minor (0.3.2 -> 0.4.0);
   a pure ``docs:`` PR needs no bump. Over-bumping is allowed (the gate only
   fails on an INSUFFICIENT bump), so a chore PR that carries a catch-up bump
   (like the one that introduced this gate) passes fine.

The gate is intentionally a single self-contained script (no third-party deps)
so it runs anywhere CPython runs.

Environment:
    BASE_REF   git ref of the PR base branch (default ``origin/main``).

Exit status: 0 on success, non-zero with a one-line reason on any violation.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# (file, reader). Readers return the declared version string or raise/exit.
VERSION_FILES = {
    "package.json": lambda s: json.loads(s)["version"],
    "pyproject.toml": lambda s: _pyproject_version(s),
    "tree-sitter.json": lambda s: json.loads(s)["metadata"]["version"],
}

# Conventional-Commit type -> minimum required SemVer level.
#   0 = none, 1 = patch, 2 = minor, 3 = major
TYPE_LEVEL = {"feat": 2, "perf": 2, "fix": 1}
LEVEL_NAME = {0: "none", 1: "patch", 2: "minor", 3: "major"}


def die(msg: str) -> "None":
    print(f"version_gate: {msg}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=True, capture_output=True, text=True
    ).stdout


def _pyproject_version(text: str) -> str:
    m = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not m:
        die("pyproject.toml has no top-level `version = \"...\"`")
    return m.group(1)


def read_head_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for rel, reader in VERSION_FILES.items():
        with open(REPO_ROOT / rel, encoding="utf-8") as f:
            versions[rel] = reader(f.read())
    return versions


def parse_semver(v: str) -> tuple[int, int, int]:
    m = re.match(r"^\s*(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*$", v)
    if not m:
        die(f"'{v}' is not a clean X.Y.Z semver")
    return tuple(int(x) for x in m.groups())  # type: ignore[return-value]


def bump_level(base: str, head: str) -> int:
    """SemVer level of base -> head (0 none, 1 patch, 2 minor, 3 major). -1 = downgrade."""
    b, h = parse_semver(base), parse_semver(head)
    if h < b:
        return -1
    if h[0] != b[0]:
        return 3
    if h[1] != b[1]:
        return 2
    if h[2] != b[2]:
        return 1
    return 0


def bump_example(base: str, level: int) -> str:
    b = parse_semver(base)
    return {
        3: f"{b[0] + 1}.0.0",
        2: f"{b[0]}.{b[1] + 1}.0",
        1: f"{b[0]}.{b[1]}.{b[2] + 1}",
    }.get(level, base)


def required_level(base_ref: str) -> tuple[int, list[str]]:
    """Max SemVer level implied by Conventional-Commit messages base_ref..HEAD."""
    try:
        raw = git("log", "--format=%B%x00", f"{base_ref}..HEAD")
    except subprocess.CalledProcessError:
        return 0, []  # no diff (e.g. push to main) -> nothing required
    required = 0
    seen: list[str] = []
    for msg in raw.split("\x00"):
        msg = msg.strip()
        if not msg:
            continue
        subject = msg.splitlines()[0]
        m = re.match(r"^([a-z]+)(?:\([^)]*\))?(!)?:", subject)
        if not m:
            continue  # non-conventional subject -> ignored (not a version signal)
        typ, bang = m.group(1), m.group(2)
        breaking = bang == "!" or re.search(r"^BREAKING[ -]CHANGE:", msg, re.MULTILINE) is not None
        level = 3 if breaking else TYPE_LEVEL.get(typ, 0)
        seen.append(f"{typ}{'!' if breaking else ''}")
        required = max(required, level)
    return required, seen


def main() -> None:
    base_ref = os.environ.get("BASE_REF", "origin/main")

    # 1. SYNC — all three version files must agree.
    versions = read_head_versions()
    distinct = set(versions.values())
    if len(distinct) != 1:
        die(
            "version files disagree:\n"
            + "\n".join(f"  {p}: {v}" for p, v in versions.items())
        )
    head_version = next(iter(distinct))
    print(f"version_gate: files in sync at {head_version}")

    # 2. BUMP — compare against the base branch.
    try:
        git("rev-parse", "--verify", base_ref)
    except subprocess.CalledProcessError:
        print(
            f"version_gate: base ref '{base_ref}' unavailable — "
            "skipping bump check (sync OK)."
        )
        return

    try:
        base_pkg = json.loads(git("show", f"{base_ref}:package.json"))
        base_version = base_pkg["version"]
    except (subprocess.CalledProcessError, KeyError, ValueError):
        print(
            f"version_gate: could not read base version from {base_ref} — "
            "skipping bump check (sync OK)."
        )
        return

    required, seen = required_level(base_ref)
    actual = bump_level(base_version, head_version)

    if actual < 0:
        die(f"head {head_version} is LOWER than base {base_version} (downgrade)")

    if required == 0:
        print(
            f"version_gate: no version-bearing commits in {base_ref}..HEAD "
            f"(found: {', '.join(seen) or 'none'}); no bump required."
        )
        return

    if actual < required:
        die(
            "insufficient version bump.\n"
            f"  base:          {base_version}\n"
            f"  head:          {head_version}  ({LEVEL_NAME[actual]})\n"
            f"  required:      {LEVEL_NAME[required]}  "
            f"(commits: {', '.join(seen) or 'none'})\n"
            f"  bump {base_version} -> {bump_example(base_version, required)} "
            "(or higher)"
        )

    print(
        f"version_gate: OK — {base_version} -> {head_version} "
        f"({LEVEL_NAME[actual]}) satisfies required {LEVEL_NAME[required]} "
        f"(commits: {', '.join(seen) or 'none'})."
    )


if __name__ == "__main__":
    main()
