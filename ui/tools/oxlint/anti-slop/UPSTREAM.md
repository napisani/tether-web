# Upstream provenance

This directory vendors the generic anti-slop Oxlint plugin from:

- Repository: https://github.com/dmmulroy/anti-slop
- Source revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Source path: `src/`
- Copied on: 2026-09-23

The Effect-specific rules are intentionally not copied because `tether-web` does
not directly use Effect. Update this directory by reviewing upstream changes,
copying the generic `src/` assets, and updating this file and the lockfile when
the pinned revision changes.
