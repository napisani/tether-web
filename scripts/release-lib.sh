# shellcheck shell=bash
# Shared helpers for the release scripts; see docs/RELEASING.md.
# Sourced by bash 3.2 on macOS, so avoid bash 4 features.

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

# Prints the commit an existing tag $2 in remote $1 points to.
remote_tag_commit() {
  git ls-remote "$1" "refs/tags/$2" "refs/tags/$2^{}" |
    awk -v peeled="refs/tags/$2^{}" '$2 == peeled { p = $1 } NR == 1 { f = $1 } END { print p ? p : f }'
}

require_tools() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
  done
  gh auth status >/dev/null 2>&1 || die "gh is not logged in; run: gh auth login"
}

# Prints the command instead of running it when DRY_RUN=1.
run() {
  if [ "${DRY_RUN:-0}" = 1 ]; then
    printf '[dry run] %s\n' "$*"
  else
    "$@"
  fi
}

confirm() {
  [ "${ASSUME_YES:-0}" = 1 ] && return 0
  local answer
  printf '%s [y/N] ' "$1"
  read -r answer
  case "$answer" in
    y | Y | yes) ;;
    *) die "cancelled" ;;
  esac
}

repo_slug() {
  gh repo view --json nameWithOwner --jq .nameWithOwner
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# True when X.Y.Z version $1 is newer than $2.
version_gt() {
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$1"
  IFS=. read -r b1 b2 b3 <<<"$2"
  [ "$a1" -ne "$b1" ] && { [ "$a1" -gt "$b1" ]; return; }
  [ "$a2" -ne "$b2" ] && { [ "$a2" -gt "$b2" ]; return; }
  [ "$a3" -gt "$b3" ]
}

# UTC timestamp $1 seconds ago; BSD and GNU date disagree on date arithmetic.
utc_time_ago() {
  perl -MPOSIX -e 'print strftime("%Y-%m-%dT%H:%M:%SZ", gmtime(time - $ARGV[0]))' "$1"
}

# Waits for the newest run of workflow $1 created at or after UTC time $2 that
# matches the remaining `gh run list` filters, and prints its ID.
find_run() {
  local workflow=$1 since=$2 id _
  shift 2
  for _ in $(seq 1 30); do
    id=$(gh run list --workflow "$workflow" "$@" --limit 5 --json databaseId,createdAt \
      --jq "map(select(.createdAt >= \"$since\")) | .[0].databaseId // empty")
    [ -n "$id" ] && { printf '%s\n' "$id"; return 0; }
    sleep 4
  done
  die "no $workflow run appeared; check: gh run list --workflow $workflow"
}

# Prints the non-attestation platforms of a published multi-arch image.
image_platforms() {
  docker buildx imagetools inspect --raw "$1" |
    jq -r '[.manifests[].platform | select(.os != "unknown") | "\(.os)/\(.architecture)"] | join(" ")'
}

watch_run() {
  local id=$1
  gh run watch "$id" --exit-status --interval 15 ||
    die "run $id failed; inspect it with: gh run view $id --log-failed"
}
