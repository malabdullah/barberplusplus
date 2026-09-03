#!/bin/sh
set -eu

target=${1:-}
if [ -z "$target" ]; then
  echo "Usage: scripts/bootstrap-staging-supabase.sh /absolute/new/install/path" >&2
  exit 1
fi
case "$target" in /*) ;; *) echo "Install path must be absolute." >&2; exit 1 ;; esac
[ ! -e "$target" ] || {
  echo "Refusing to overwrite existing path: $target" >&2
  exit 1
}

for command_name in git docker openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required." >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
release=$(tr -d '[:space:]' < "$repo_dir/ops/supabase/self-hosted.release")
expected_commit=$(tr -d '[:space:]' < "$repo_dir/ops/supabase/self-hosted.commit")
case "$release" in self-hosted/v[0-9]*.[0-9]*.[0-9]*) ;; *)
  echo "Invalid pinned release: $release" >&2
  exit 1
esac
case "$expected_commit" in
  *[!0-9a-f]*|'') echo "Invalid pinned Supabase commit." >&2; exit 1 ;;
esac
[ "${#expected_commit}" -eq 40 ] || {
  echo "Pinned Supabase commit must contain 40 hexadecimal characters." >&2
  exit 1
}

work_dir=$(mktemp -d)
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

git clone --quiet --filter=blob:none --no-checkout \
  https://github.com/supabase/supabase.git "$work_dir/source"
git -C "$work_dir/source" fetch --quiet --depth 1 origin "refs/tags/$release:refs/tags/$release"
resolved_commit=$(git -C "$work_dir/source" rev-list -n 1 "$release")
[ "$resolved_commit" = "$expected_commit" ] || {
  echo "Pinned Supabase tag no longer resolves to the reviewed commit." >&2
  exit 1
}
git -C "$work_dir/source" sparse-checkout init --cone
git -C "$work_dir/source" sparse-checkout set docker
git -C "$work_dir/source" checkout --quiet --detach "$expected_commit"

install -d -m 700 "$target"
cp -R "$work_dir/source/docker/." "$target/"
printf 'ref=%s\n' "$expected_commit" > "$target/.supabase-version"
printf '%s\n' "$release" > "$target/.supabase-release"
chmod 600 "$target/.supabase-version"

echo "Installed the pinned Supabase configuration $release at reviewed commit $expected_commit."
echo "Review upstream breaking changes, then run its setup without committing or printing generated secrets."
