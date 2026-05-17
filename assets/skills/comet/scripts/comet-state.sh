#!/bin/bash
# Comet State — unified interface for .comet.yaml state management
# Usage: comet-state.sh <subcommand> <change-name> [args...]
#
# Subcommands:
#   init <change-name> <workflow>  — Initialize .comet.yaml with workflow defaults
#   get <change-name> <field>       — Read a field value from .comet.yaml
#   set <change-name> <field> <val> — Update a field value (Task 2)
#
# Workflows: full, hotfix, tweak

set -euo pipefail

# --- Color output helpers ---

red() { echo -e "\033[31m$1\033[0m" >&2; }
green() { echo -e "\033[32m$1\033[0m" >&2; }
yellow() { echo -e "\033[33m$1\033[0m" >&2; }

# --- Script location ---

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Input validation ---

validate_change_name() {
  local name="$1"
  # Reject empty names
  if [ -z "$name" ]; then
    red "ERROR: Change name cannot be empty" >&2
    exit 1
  fi
  # Only allow alphanumeric, hyphens, and underscores
  if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    red "ERROR: Invalid change name: '$name'" >&2
    red "Valid characters: a-z, A-Z, 0-9, -, _" >&2
    exit 1
  fi
  # Reject path traversal attempts
  if [[ "$name" =~ \.\. ]]; then
    red "ERROR: Change name cannot contain '..' (path traversal not allowed)" >&2
    exit 1
  fi
}

validate_enum() {
  local value="$1"
  shift
  local valid_values=("$@")

  for valid in "${valid_values[@]}"; do
    if [ "$value" = "$valid" ]; then
      return 0
    fi
  done

  red "ERROR: Invalid value: '$value'" >&2
  red "Valid values: ${valid_values[*]}" >&2
  exit 1
}

# --- Helper functions ---

yaml_field() {
  local field="$1"
  local yaml_file="$2"
  if [ -f "$yaml_file" ]; then
    grep "^${field}:" "$yaml_file" | sed "s/^${field}: *//" | tr -d '"' | tr -d "'"
  fi
}

file_nonempty() {
  [ -f "$1" ] && [ -s "$1" ]
}

# --- Subcommands ---

cmd_init() {
  local change_name="$1"
  local workflow="$2"

  validate_change_name "$change_name"
  validate_enum "$workflow" "full" "hotfix" "tweak"

  local change_dir="openspec/changes/$change_name"
  local yaml_file="$change_dir/.comet.yaml"

  # Check if .comet.yaml already exists
  if [ -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml already exists at $yaml_file"
    exit 1
  fi

  # Create change directory if it doesn't exist
  mkdir -p "$change_dir"

  # Set workflow-appropriate defaults
  local phase build_mode isolation verify_mode

  case "$workflow" in
    full)
      phase="design"
      build_mode="null"
      isolation="null"
      verify_mode="null"
      ;;
    hotfix|tweak)
      phase="build"
      build_mode="direct"
      isolation="branch"
      verify_mode="light"
      ;;
  esac

  # Write .comet.yaml
  cat > "$yaml_file" <<EOF
phase: $phase
build_mode: $build_mode
isolation: $isolation
verify_mode: $verify_mode
design_doc: null
plan: null
verify_result: pending
verified_at: null
archived: false
EOF

  green "Initialized: $yaml_file (workflow=$workflow)"
}

cmd_get() {
  local change_name="$1"
  local field="$2"

  validate_change_name "$change_name"

  local change_dir="openspec/changes/$change_name"
  local yaml_file="$change_dir/.comet.yaml"

  # Check if .comet.yaml exists
  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file"
    exit 1
  fi

  # Read and output the field value
  local value
  value=$(yaml_field "$field" "$yaml_file")
  echo "${value:-}"
}

# --- Main ---

SUBCOMMAND="${1:-}"
shift || true

case "$SUBCOMMAND" in
  init)
    if [ $# -lt 2 ]; then
      red "Usage: comet-state.sh init <change-name> <workflow>" >&2
      red "Workflows: full, hotfix, tweak" >&2
      exit 1
    fi
    cmd_init "$@"
    ;;
  get)
    if [ $# -lt 2 ]; then
      red "Usage: comet-state.sh get <change-name> <field>" >&2
      exit 1
    fi
    cmd_get "$@"
    ;;
  *)
    red "Unknown subcommand: $SUBCOMMAND" >&2
    echo "" >&2
    echo "Usage: comet-state.sh <subcommand> <change-name> [args...]" >&2
    echo "" >&2
    echo "Subcommands:" >&2
    echo "  init <change-name> <workflow>  — Initialize .comet.yaml with workflow defaults" >&2
    echo "  get <change-name> <field>       — Read a field value from .comet.yaml" >&2
    echo "" >&2
    echo "Workflows: full, hotfix, tweak" >&2
    exit 1
    ;;
esac
