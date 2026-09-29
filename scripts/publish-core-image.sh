#!/usr/bin/env bash
# Publishes an unofficial tether-core image from an upstream Tether release,
# follows the workflow, checks the image, and updates the Compose pins.
# See docs/RELEASING.md.
# Usage: scripts/publish-core-image.sh <vX.Y.Z> [--no-pins] [--dry-run] [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/release-lib.sh

upstream=zackb/tether
# Keep in sync with the minimum in .github/workflows/core-image.yml.
minimum=0.2.35

usage() {
  sed -n 's/^# Usage: //p' "$0" >&2
  exit 2
}

tag=
update_pins=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pins) update_pins=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h | --help) usage ;;
    -*) die "unknown option: $1" ;;
    *)
      [ -z "$tag" ] || usage
      tag=$1
      ;;
  esac
  shift
done
[ -n "$tag" ] || usage
case "$tag" in v*) ;; *) tag="v$tag" ;; esac
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "$tag is not an upstream vX.Y.Z release tag"
version=${tag#v}
if version_gt "$minimum" "$version"; then
  die "tether-web requires Tether $minimum or newer"
fi

require_tools git gh docker jq perl
slug=$(lowercase "$(repo_slug)")
image="ghcr.io/${slug%%/*}/tether-core"

step "Checking the upstream release"
release=$(gh release view "$tag" -R "$upstream" --json url,publishedAt \
  --jq '"\(.url) (published \(.publishedAt[:10]))"' 2>/dev/null) ||
  die "$upstream has no release $tag"
echo "$release"
latest=$(gh release view -R "$upstream" --json tagName --jq .tagName)
if [ "$latest" = "$tag" ]; then
  echo "This is upstream's newest release, so the image also becomes 'latest'."
else
  echo "Upstream's newest release is $latest, so 'latest' will not move."
fi
echo "Read that release's notes for protocol changes before publishing."

if docker buildx imagetools inspect "$image:$version" >/dev/null 2>&1; then
  echo "$image:$version already exists; publishing rebuilds and replaces that tag."
fi

step "Publish summary"
printf 'Upstream:  %s %s (%s)\n' "$upstream" "$tag" "$(remote_tag_commit "https://github.com/$upstream.git" "$tag" | cut -c1-12)"
printf 'Image:     %s:%s\n' "$image" "$version"
confirm "Start the core image workflow for $tag?"

started=$(utc_time_ago 60)
if [ "${DRY_RUN:-0}" = 1 ]; then
  run gh workflow run core-image.yml --ref main -f tether_tag="$tag"
  echo "Dry run complete; no workflow was started and no files changed."
  exit 0
fi
output=$(gh workflow run core-image.yml --ref main -f tether_tag="$tag" 2>&1) ||
  die "could not start core-image.yml: $output"
run_id=$(sed -n 's|.*/actions/runs/\([0-9][0-9]*\).*|\1|p' <<<"$output" | head -1)
[ -n "$run_id" ] || run_id=$(find_run core-image.yml "$started" --event workflow_dispatch)

step "Following the core image workflow"
watch_run "$run_id"

step "Checking the published image"
if platforms=$(image_platforms "$image:$version" 2>/dev/null); then
  revision=$(docker buildx imagetools inspect "$image:$version" --format '{{json .Image}}' |
    jq -r '."linux/amd64".config.Labels["org.opencontainers.image.revision"]')
  echo "Platforms: $platforms"
  echo "Upstream commit: $revision"
else
  echo "warning: could not read $image:$version. If the registry refused the read," \
    "check its visibility (docs/RELEASING.md#one-time-setup), then check it with:" \
    "docker buildx imagetools inspect $image:$version" >&2
fi

current=$(sed -n 's/^TETHER_CORE_TAG=//p' deploy/.env.example)
if [ "$update_pins" = 0 ]; then
  echo "Skipping the Compose pins (--no-pins)."
elif ! version_gt "$version" "$current"; then
  echo "The Compose example already pins $current; leaving it unchanged."
else
  step "Updating the Compose pins from $current to $version"
  export PIN_VERSION=$version
  perl -pi -e 's/^(TETHER_CORE_TAG|TETHER_VERSION)=.*/$1=$ENV{PIN_VERSION}/' deploy/.env.example
  perl -pi -e 's/(tether-core:\$\{TETHER_CORE_TAG:-)[^}]*/$1$ENV{PIN_VERSION}/' deploy/docker-compose.yml
  perl -pi -e 's/(TETHER_VERSION: \$\{TETHER_VERSION:-)[^}]*/$1$ENV{PIN_VERSION}/' deploy/docker-compose.build.yml
  perl -pi -e 's/(git clone --branch )v[0-9]+\.[0-9]+\.[0-9]+/$1v$ENV{PIN_VERSION}/' deploy/README.md
  git diff --stat -- deploy
  echo "Review the diff and open a pull request, for example:"
  echo "  git switch -c chore/tether-core-$version && git commit -am 'chore(deploy): use tether-core $version'"
fi

echo
echo "Published $image:$version."
