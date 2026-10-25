#!/bin/sh
# Run as root after installing dependencies. Does not authenticate or generate images.
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ "$(id -u)" = 0 ] || { echo 'Run this provisioning script as root' >&2; exit 1; }
binary=$(find "$project/node_modules/@openai" -type f -name codex -perm /111 | head -n 1)
[ -n "$binary" ] || { echo 'Install @openai/codex first' >&2; exit 1; }
if ! id launchseeds-image >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/launchseeds-imagegen --shell /usr/sbin/nologin launchseeds-image
fi
install -d -m 755 /opt/launchseeds-imagegen
install -m 755 "$binary" /opt/launchseeds-imagegen/codex
host="$(dirname -- "$binary")/codex-code-mode-host"
[ -x "$host" ] || { echo 'Codex code-mode host missing; reinstall @openai/codex' >&2; exit 1; }
install -m 755 "$host" /opt/launchseeds-imagegen/codex-code-mode-host
install -m 644 "$project/src/server/assets/image-style-reference.png" /opt/launchseeds-imagegen/style-reference.png
install -d -m 700 -o launchseeds-image -g launchseeds-image /var/lib/launchseeds-imagegen /var/lib/launchseeds-imagegen/.codex /var/lib/launchseeds-imagegen/work
cat > /usr/local/bin/launchseeds-image-codex <<'WRAPPER'
#!/bin/sh
set -eu
cd /var/lib/launchseeds-imagegen/work
exec /usr/sbin/runuser -u launchseeds-image -- /usr/bin/env -i \
  HOME=/var/lib/launchseeds-imagegen USER=launchseeds-image LOGNAME=launchseeds-image \
  CODEX_HOME=/var/lib/launchseeds-imagegen/.codex PATH=/usr/local/bin:/usr/bin:/bin \
  /opt/launchseeds-imagegen/codex "$@"
WRAPPER
chmod 755 /usr/local/bin/launchseeds-image-codex
cat > /var/lib/launchseeds-imagegen/.codex/config.toml <<'CONFIG'
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
[features]
shell_tool = false
multi_agent = false
image_generation = true
view_image = false
apps = false
skill_mcp_dependency_install = false
CONFIG
chown launchseeds-image:launchseeds-image /var/lib/launchseeds-imagegen/.codex/config.toml
chmod 600 /var/lib/launchseeds-imagegen/.codex/config.toml
# No credentials are copied automatically. Login using this account, or install
# an explicitly authorized auth.json with owner launchseeds-image and mode 600.
/usr/local/bin/launchseeds-image-codex --version
echo 'Isolated runtime provisioned. Check: launchseeds-image-codex login status'
