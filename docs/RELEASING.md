# Releasing

This repository publishes two container images with separate version numbers:

| Image | Version | Published by |
| --- | --- | --- |
| `ghcr.io/napisani/tether-web` | tether-web's own semver | [`release.yml`](../.github/workflows/release.yml), when a `vX.Y.Z` tag is pushed |
| `ghcr.io/napisani/tether-core` | the upstream Tether version | [`core-image.yml`](../.github/workflows/core-image.yml), when run by hand |

Both images are built for amd64 and arm64. The [Compose example](../deploy/README.md) pulls them by default.

## Versioning rules

tether-web follows [Semantic Versioning](https://semver.org/) independently of Tether core. A Git tag of the form `vMAJOR.MINOR.PATCH`, optionally with a `-prerelease` suffix such as `-rc.1`, is the only record of a version. No file in the repository stores it, and `ui/package.json`'s `version` field is unused.

`make version` prints the version of the current checkout:

| Checkout | Output |
| --- | --- |
| Exactly on a release tag | `0.3.0` |
| Commits after a tag | `0.3.0-2-gabc1234` |
| Uncommitted changes | a `-dirty` suffix |
| Before the first release | `0.0.0-dev` |

The build writes this version into `tether-web --version`, the startup log line, the route status bar in the UI, and the image's `org.opencontainers.image.version` label.

Choose the next version from the changes since the last release:

| Change | While 0.x | From 1.0 |
| --- | --- | --- |
| Raising the minimum `tetherd` version, renaming or removing a configuration variable, or a deployment change that requires operator action | minor | major |
| A new feature that works with the current minimum `tetherd` | minor | minor |
| A bug fix | patch | patch |

The minimum `tetherd` version is 0.2.35. When a change raises it, update the requirement in the [README](../README.md#requirements) and the [deploy guide](../deploy/README.md), and say so in the release notes.

## One-time setup

Make each package public after its first publish. GHCR creates new packages as private, so anonymous `docker pull` and the Compose example fail until you change this. On GitHub, open your profile's **Packages** tab, select `tether-web` or `tether-core`, and set the visibility to **Public** under **Package settings**. GitHub does not let you make a public package private again.

Check for tag names that already exist in your clone. A clone that has fetched from upstream Tether has upstream's tags (`v0.1.0` to `v0.1.8` and `v0.2.0` to `v0.2.34`) in the same namespace. None of them is part of this repository's history, but `git tag` refuses to reuse their names. Push only the one tag you create, never `git push --tags`, which would copy the upstream tags to this repository.

The core workflow builds arm64 on GitHub's `ubuntu-24.04-arm` runners, which are free only for public repositories. If this repository becomes private, change that runner or remove arm64 from the core matrix.

## Release tether-web

Run the release script with a bump type or an exact version:

```bash
scripts/release-web.sh minor --dry-run   # preview without tagging
scripts/release-web.sh minor             # or patch, major, 0.3.0, 0.3.0-rc.1
```

The script needs `git`, `gh` (logged in), `docker` with Buildx, `jq` and `perl`. It does the following:

1. It fetches `origin/main` and reads the latest stable release from the tags on `origin`. It ignores local tags because this clone may hold upstream Tether's tags under the same names.
2. It computes the next version and rejects a version that isn't newer than the latest release, that already exists on `origin`, or whose name is taken by a local tag.
3. It checks CI for the `origin/main` commit. If CI is still running, it waits; if CI failed, it stops.
4. It lists the commits since the last release, prints a summary and asks for confirmation. `--yes` skips the prompt.
5. It creates an annotated tag on the `origin/main` commit and pushes only that tag.
6. It follows the release workflow until it finishes, then prints the GitHub Release URL and checks that the published image pulls and reports the new version.

After the script finishes, edit the GitHub Release notes if needed with `gh release edit <tag>`. GitHub generates the notes from merged pull requests. Add anything operators must act on, such as a raised minimum `tetherd` version or a renamed setting.

### What the release workflow does

1. The `version` job rejects the tag unless it matches `vMAJOR.MINOR.PATCH[-prerelease]` and points to a commit on `main`.
2. The `ci` job runs the full [`ci.yml`](../.github/workflows/ci.yml) checks against the tagged commit.
3. The `publish` job builds the image with the version and commit embedded, pushes it to GHCR, and creates the GitHub Release.

For a stable release such as `v0.3.0`, the image gets the tags `0.3.0`, `0.3` and `latest`. From 1.0 it also gets the major tag, such as `1`. The workflow leaves out the major tag during 0.x because minor releases may break compatibility. A prerelease such as `v0.3.0-rc.1` gets only its exact tag, and GitHub marks its release as a prerelease.

## Publish a core image

Upstream Tether publishes no registry image. Its [container guide](https://github.com/zackb/tether/blob/main/docs/CONTAINER.md) describes a local build only. This repository publishes an unofficial image from an unmodified upstream release so that operators can skip the C++ build. Publishing is manual, so that each core version is adopted deliberately.

Before publishing, read the upstream release notes for changes to the protocol this client uses: `protocol_info`, capabilities, pairing, and `operation_id` correlation. For a protocol change, run this client against the new daemon first. The Playwright suite uses a fake daemon and does not cover this.

Then run the core script with the upstream tag:

```bash
scripts/publish-core-image.sh v0.2.36 --dry-run   # preview without starting the workflow
scripts/publish-core-image.sh v0.2.36
```

The script needs the same tools as the release script, and `core-image.yml` must be on `main`. It does the following:

1. It rejects tags that are not `vX.Y.Z` or are older than `v0.2.35`, and checks that the upstream release exists. It prints the release URL and says whether the image will also become `latest`.
2. It warns if that version is already published, because publishing again replaces the tag.
3. After confirmation, it starts `core-image.yml` and follows the run until it finishes.
4. It prints the published platforms and the upstream commit from the image's `org.opencontainers.image.revision` label.
5. If the version is newer than the one the Compose example pins, it updates the pins in [`deploy/.env.example`](../deploy/.env.example), [`deploy/docker-compose.yml`](../deploy/docker-compose.yml), [`deploy/docker-compose.build.yml`](../deploy/docker-compose.build.yml) and the [deploy guide](../deploy/README.md). It leaves the changes uncommitted for you to review and open as a pull request. `--no-pins` skips this step.

### What the core workflow does

1. The `resolve` job rejects tags that are not plain `vX.Y.Z` or are older than `v0.2.35`. It records the commit the tag points to, so the later jobs build that commit even if the tag moves.
2. The `build` job runs on native amd64 and arm64 runners. Each builds upstream's `packaging/container/Dockerfile` test target, which runs upstream's unit tests, then the runtime target. It runs upstream's `scripts/test-container.sh` smoke test and pushes the tested image as `<version>-amd64` or `<version>-arm64`.
3. The `publish` job combines the two into a multi-architecture `<version>` tag. It adds `latest` only if the tag is upstream's newest release.

Running the workflow again for the same tag rebuilds the image, for example to pick up Ubuntu security updates in the base image. The new build replaces the `<version>` tag. Anyone who pinned the old digest keeps the old image.

## When a release goes wrong

A tag failed validation or CI. The workflow published nothing. Delete the tag locally and on GitHub, fix `main`, and tag again:

```bash
git push origin --delete "$tag"
git tag --delete "$tag"
```

Only delete a tag this way when nothing was published under it.

The image was pushed but the release step failed. Rerun only the failed jobs. A second push of the same version replaces the image tag.

```bash
gh run rerun <run-id> --failed
```

A published release is broken. Do not move or reuse its tag, because people may already have pulled that image. Fix `main` and release the next patch version, which also moves `latest`. If the broken image is unsafe to run, also delete that version in the package settings on GitHub and say so in its release notes.

A core build failed on one architecture. The `publish` job does not run, so the multi-architecture tag does not change. Check the job log, then rerun the failed jobs. If the failure is in upstream's tests, don't publish that version. Report it upstream instead.
