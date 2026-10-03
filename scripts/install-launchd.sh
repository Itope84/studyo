#!/usr/bin/env bash
# Run the Studyo server at login on this Mac, restarting it if it stops.
# Usage: scripts/install-launchd.sh            install and start
#        scripts/install-launchd.sh --uninstall stop and remove
set -euo pipefail
label="com.studyo.server"
plist="$HOME/Library/LaunchAgents/$label.plist"
root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$plist"
  echo "Removed $label"
  exit 0
fi

node_bin="$(command -v node)"
pnpm_bin="$(command -v pnpm)"
mkdir -p "$HOME/Library/LaunchAgents" "$root/library/_studyo"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>WorkingDirectory</key><string>$root</string>
  <key>ProgramArguments</key>
  <array>
    <string>$pnpm_bin</string><string>--filter</string><string>@studyo/server</string><string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node_bin"):$(dirname "$pnpm_bin"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$root/library/_studyo/server.log</string>
  <key>StandardErrorPath</key><string>$root/library/_studyo/server.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Installed $label. Logs: $root/library/_studyo/server.log"
