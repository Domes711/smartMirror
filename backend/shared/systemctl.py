"""systemctl + pm2 + node/npm helpers, extracted from supervisor.py.

`sudo -n` keeps every call non-interactive: without the sudoers rule installed
it fails immediately instead of blocking forever on a password prompt with no
TTY (which used to hang the supervisor before its HTTP server came up).
"""

import logging
import os
import subprocess

from .paths import PM2_APP

SYSTEMCTL = "/usr/bin/systemctl"

log = logging.getLogger("systemctl")

# Sourcing nvm explicitly: under systemd `bash -lc` does NOT load nvm (it lives
# in ~/.bashrc, skipped for non-interactive shells), so node/npm/pm2 are not on
# PATH. Every node-touching helper below shares this preamble.
_NVM_PREAMBLE = (
    'export NVM_DIR="$HOME/.nvm"; '
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '
)


def run(action: str, service: str) -> bool:
    """`sudo -n systemctl <action> <service>`. Returns success, never raises."""
    try:
        res = subprocess.run(
            ["sudo", "-n", SYSTEMCTL, action, service],
            check=False, capture_output=True, text=True,
            stdin=subprocess.DEVNULL, timeout=15,
        )
        if res.returncode == 0:
            log.info("systemctl %s %s", action, service)
            return True
        log.warning("systemctl %s %s failed (rc=%d): %s", action, service,
                    res.returncode, (res.stderr or "").strip())
    except Exception as exc:  # noqa: BLE001
        log.warning("systemctl %s %s failed: %s", action, service, exc)
    return False


def run_privileged_script(path: str, *args: str, timeout: int = 30) -> tuple:
    """`sudo -n <path> <args…>`, for the few operations a feature cannot do
    as its own user even with the systemctl allowances above — e.g.
    rewriting a unit file. The script itself, not this function, is the
    security boundary: sudoers grants NOPASSWD on this exact path only, so
    whatever the script does is already the full scope of what root-level
    actions a feature may trigger. Returns (returncode, combined output);
    never raises.
    """
    try:
        res = subprocess.run(
            ["sudo", "-n", path, *args],
            check=False, capture_output=True, text=True,
            stdin=subprocess.DEVNULL, timeout=timeout,
        )
        out = ((res.stdout or "") + (res.stderr or "")).strip()
        if res.returncode != 0:
            log.warning("%s failed (rc=%d): %s", path, res.returncode, out)
        return res.returncode, out
    except Exception as exc:  # noqa: BLE001
        log.warning("%s failed: %s", path, exc)
        return 1, str(exc)


def is_active(service: str) -> bool:
    try:
        out = subprocess.run([SYSTEMCTL, "is-active", service],
                             capture_output=True, text=True, timeout=10)
        return out.stdout.strip() == "active"
    except Exception:  # noqa: BLE001
        return False


def exists(service: str) -> bool:
    """True if the systemd unit <service>.service is installed."""
    try:
        out = subprocess.run([SYSTEMCTL, "list-unit-files", f"{service}.service"],
                             capture_output=True, text=True, timeout=10)
        return f"{service}.service" in out.stdout
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------- #
# node toolchain
# --------------------------------------------------------------------------- #
def _bash(cmd: str, cwd: str = None, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "-lc", cmd], cwd=cwd, capture_output=True,
                          text=True, timeout=timeout, stdin=subprocess.DEVNULL)


def node_bin():
    """Absolute path to the node binary, or None. Searches PATH then the nvm
    tree (systemd units do not inherit nvm's PATH)."""
    from_env = os.environ.get("NODE_BIN")
    if from_env:
        return from_env
    nvm = os.environ.get("NVM_DIR") or os.path.expanduser("~/.nvm")
    cmd = ('command -v node || ls -t "%s"/versions/node/*/bin/node 2>/dev/null '
           '| head -1' % nvm)
    try:
        r = subprocess.run(["sh", "-c", cmd], capture_output=True, text=True,
                           timeout=5)
        return (r.stdout or "").strip() or None
    except Exception:  # noqa: BLE001
        return None


def node_eval(expr: str, *argv: str, timeout: int = 20):
    """Run `node -e <expr> <argv…>`. Returns (returncode, stdout) — rc 127 when
    node isn't installed, so callers can distinguish "can't check" from "bad"."""
    args = " ".join(f'"{a}"' for a in argv)
    cmd = (_NVM_PREAMBLE +
           'N="${NODE_BIN:-$(command -v node || ls -t "$NVM_DIR"/versions/node/*/bin/node 2>/dev/null | head -1)}"; '
           '[ -n "$N" ] || exit 127; '
           f"\"$N\" -e '{expr}' {args}")
    try:
        r = _bash(cmd, timeout=timeout)
        return r.returncode, (r.stdout or "")
    except Exception as exc:  # noqa: BLE001
        return 1, str(exc)


def node_require_ok(path: str) -> bool:
    """True if `node -e require(path)` succeeds, i.e. the generated JS parses.

    Returns True when node is missing (rc 127) — we cannot validate, and
    blocking a config write on "no node here" would be worse than letting it
    through (the dev machine has no node toolchain for the Pi's config).
    """
    rc, _ = node_eval("require(process.argv[1])", path)
    return rc in (0, 127)


def npm_install(cwd: str) -> tuple:
    cmd = (_NVM_PREAMBLE +
           'NPM="${NPM_BIN:-$(command -v npm || ls -t "$NVM_DIR"/versions/node/*/bin/npm 2>/dev/null | head -1)}"; '
           '[ -n "$NPM" ] || { echo "npm not found"; exit 127; }; '
           '"$NPM" install --omit=dev --no-audit --no-fund')
    res = _bash(cmd, cwd=cwd, timeout=900)
    return res.returncode, ((res.stdout or "") + (res.stderr or ""))


def pm2_restart(app: str = None) -> dict:
    app = app or PM2_APP
    cmd = (_NVM_PREAMBLE +
           'PM2="${PM2_BIN:-$(command -v pm2 || ls -t "$NVM_DIR"/versions/node/*/bin/pm2 2>/dev/null | head -1)}"; '
           '[ -n "$PM2" ] || { echo "pm2 not found (install pm2 / check nvm)"; exit 127; }; '
           f'"$PM2" restart {app}')
    try:
        res = _bash(cmd, timeout=60)
        out = ((res.stdout or "") + (res.stderr or "")).strip()[-2000:]
        return {"ok": res.returncode == 0, "output": out}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "output": str(exc)}


def git_clone(url: str, dest: str, timeout: int = 300) -> tuple:
    res = subprocess.run(["git", "clone", "--depth", "1", url, dest],
                         capture_output=True, text=True, timeout=timeout,
                         stdin=subprocess.DEVNULL)
    return res.returncode, ((res.stdout or "") + (res.stderr or ""))


def have_sudoers() -> bool:
    return os.path.exists("/etc/sudoers.d/smartmirror")
