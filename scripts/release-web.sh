#!/usr/bin/env bash
# Tags origin/main as a tether-web release, follows the release workflow, and
# checks the published image. See docs/RELEASING.md.
# Usage: scripts/release-web.sh <patch|minor|major|X.Y.Z[-prerelease]> [--dry-run] [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/release-lib.sh

usage() {
  sed -n 's/^# Usage: //p' "$0" >&2
  exit 2
}

bump=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h | --help) usage ;;
    -*) die "unknown option: $1" ;;
    *)
      [ -z "$bump" ] || usage
      bump=$1
      ;;
  esac
  shift
done
[ -n "$bump" ] || usage

require_tools git gh docker jq perl
slug=$(repo_slug)
image="ghcr.io/$(lowercase "$slug")"

step "Reading releases on origin"
git fetch --quiet origin main
sha=$(git rev-parse origin/main)
# Local tags are ignored: a clone may hold upstream Tether's tags under the same names.
remote_versions=$(git ls-remote --tags --refs origin 'v*' | sed 's|.*refs/tags/v||')
last=$(grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' <<<"$remote_versions" |
  sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true)
IFS=. read -r major minor patch <<<"${last:-0.0.0}"
case "$bump" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch) next="$major.$minor.$((patch + 1))" ;;
  *) next=${bump#v} ;;
esac

# Keep in sync with the tag check in .github/workflows/release.yml.
semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
[[ "$next" =~ $semver ]] || die "$next is not MAJOR.MINOR.PATCH[-prerelease]"
if [ -n "$last" ] && ! version_gt "${next%%-*}" "$last"; then
  die "$next must be newer than the latest release v$last"
fi
tag="v$next"
if grep -qxF "$next" <<<"$remote_versions"; then
  die "$tag already exists on origin"
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  die "a local tag $tag already exists, possibly an upstream Tether tag fetched into this clone; if it isn't a tether-web release, remove it with: git tag -d $tag"
fi

step "Checking CI on origin/main ($(git rev-parse --short "$sha"))"
ci=$(gh run list --workflow ci.yml --branch main --commit "$sha" --limit 1 \
  --json databaseId,status,conclusion --jq '.[0] // empty | "\(.databaseId) \(.status) \(.conclusion)"')
[ -n "$ci" ] || die "no CI run found for origin/main; push to main and wait for CI"
read -r ci_id ci_status ci_conclusion <<<"$ci"
if [ "$ci_status" != completed ]; then
  echo "CI is still running; waiting for it."
  watch_run "$ci_id"
elif [ "$ci_conclusion" != success ]; then
  die "CI on origin/main concluded '$ci_conclusion': gh run view $ci_id"
fi
echo "CI passed."

if [ -n "$last" ]; then
  step "Changes since v$last"
  git log --oneline "$(remote_tag_commit origin "v$last")..$sha"
else
  step "First release: $(git rev-list --count "$sha") commits"
fi

step "Release summary"
printf 'Tag:       %s (previous: %s)\n' "$tag" "${last:+v$last}${last:-none}"
printf 'Commit:    %s\n' "$(git log -1 --format='%h %s' "$sha")"
printf 'Image:     %s:%s\n' "$image" "$next"
case "$next" in *-*) echo "Type:      prerelease" ;; esac
confirm "Create and push $tag?"

started=$(utc_time_ago 60)
run git tag -a "$tag" -m "tether-web $tag" "$sha"
run git push origin "refs/tags/$tag"
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "Dry run complete; nothing was tagged or pushed."
  exit 0
fi

step "Following the release workflow"
watch_run "$(find_run release.yml "$started" --event push --branch "$tag")"

step "Checking the published release"
gh release view "$tag" --json url --jq .url
if platforms=$(image_platforms "$image:$next" 2>/dev/null) &&
  version=$(docker run --rm --pull always "$image:$next" --version 2>/dev/null); then
  echo "Image platforms: $platforms"
  echo "Image reports:   $version"
else
  echo "warning: could not pull $image:$next. If this is the package's first release," \
    "make it public (docs/RELEASING.md#one-time-setup), then retry:" \
    "docker run --rm $image:$next --version" >&2
fi

echo
echo "Released $tag. Add operator notes to the release if needed: gh release edit $tag"
