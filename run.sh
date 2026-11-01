#!/usr/bin/env bash
# Runs `hitop run` in ghcr.io/bohdaq/hitop:<version> with the workspace mounted at /work.
# Always exits 0: the action's last step sets the outcome from the exit code written here.
set -uo pipefail

out() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }
fail() {
  echo "::error title=hitop::$1"
  out exit-code 2
  out passed false
  exit 0
}

workspace="${GITHUB_WORKSPACE:-$PWD}"
out action-path "${GITHUB_ACTION_PATH:-$(cd "$(dirname "$0")" && pwd)}"

# Paths are relative to the workspace, which the container sees as /work.
inside() {
  case "$1" in
    "$workspace") echo . ;;
    "$workspace"/*) echo "${1#"$workspace"/}" ;;
    /*) return 1 ;;
    *) echo "$1" ;;
  esac
}

version="${INPUT_VERSION#v}"
[ -n "$version" ] || fail "the version input is required, for example version: 0.3.0-rc.2"
image="ghcr.io/bohdaq/hitop:$version"

command -v docker >/dev/null || fail "docker is not available on this runner; use a Linux runner such as ubuntu-latest"

path=$(inside "$INPUT_PATH") || fail "path must be inside the workspace: $INPUT_PATH"
report_dir=$(inside "${INPUT_OUT:-hitop-reports}") || fail "out must be inside the workspace: $INPUT_OUT"

args=(run "$path" --reporter "$INPUT_REPORTER" --out "$report_dir")
[ -n "$INPUT_ENV" ] && args+=(--env "$INPUT_ENV")
if [ -n "$INPUT_ENV_FILE" ]; then
  env_file=$(inside "$INPUT_ENV_FILE") || fail "env-file must be inside the workspace: $INPUT_ENV_FILE"
  args+=(--env-file "$env_file")
fi

while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  [ -z "$line" ] && continue
  case "$line" in *=*) ;; *) fail "secrets: expected NAME=value, got a line without '='" ;; esac
  value="${line#*=}"
  [ -n "$value" ] && echo "::add-mask::$value"
  args+=(--secret "$line")
done <<< "$INPUT_SECRETS"

while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  [ -z "$line" ] && continue
  args+=(--var "$line")
done <<< "$INPUT_VARS"

# shellcheck disable=SC2206 # documented: extra arguments are split on whitespace
[ -n "$INPUT_ARGS" ] && args+=($INPUT_ARGS)

# Pass HITOP_* variables from the step's env by name, so values never appear on a command line.
docker_env=(-e HOME=/tmp -e HITOP_KEYCHAIN=off)
while IFS= read -r name; do
  case "$name" in HITOP_KEYCHAIN | HITOP_EXIT_CODE | HITOP_REPORT_FILE | HITOP_VERSION | HITOP_SUMMARY | HITOP_ACTION_PATH) continue ;; esac
  docker_env+=(-e "$name")
done < <(compgen -e | grep '^HITOP_' || true)

# A tag that isn't on ghcr.io but is already on the runner (built by an earlier step, for
# example to test hitop itself) is used as it is.
if ! docker pull -q "$image" >/dev/null; then
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "::notice title=hitop::$image is not on ghcr.io; using the image already on this runner"
  else
    fail "could not pull $image; check the version input (tags: https://github.com/bohdaq/hitop/pkgs/container/hitop)"
  fi
fi

shown=()
hide=0
for a in "${args[@]}"; do
  if [ "$hide" = 1 ]; then shown+=("${a%%=*}=••••"); hide=0; continue; fi
  [ "$a" = --secret ] && hide=1
  shown+=("$a")
done
echo "$image: hitop ${shown[*]}"
# --network host: requests reach services the job started on localhost.
# --user: reports are written as the runner user, so later steps can read and remove them.
docker run --rm --network host --user "$(id -u):$(id -g)" "${docker_env[@]}" \
  -v "$workspace:/work" -w /work "$image" "${args[@]}"
code=$?

abs_dir="$workspace/$report_dir"
out exit-code "$code"
out passed "$([ "$code" = 0 ] && echo true || echo false)"
out report-dir "$abs_dir"
if [ -f "$abs_dir/junit.xml" ]; then out junit-file "$abs_dir/junit.xml"; else out junit-file ""; fi
if [ -f "$abs_dir/report.json" ]; then out report-file "$abs_dir/report.json"; else out report-file ""; fi
exit 0
