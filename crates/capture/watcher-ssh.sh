# watcher-ssh.sh — per-command capture of interactive SSH sessions, no hooks.
#
# The Watcher watches your LOCAL shell. When you `ssh` into a box and work interactively, the whole
# session is one opaque block to it (OSC-133 markers bracket the outer shell only). This wraps `ssh`
# in `script`, which allocates a PTY and records the session's input/output/timing to files the app
# ingests as ON-TARGET commands — so post-exploitation work lands in the debrief at full fidelity.
#
# Source it into the watched shell on capture start (the agent does this on --attach/--interactive),
# or by hand:  source crates/capture/watcher-ssh.sh
#
# Requires util-linux `script` >= 2.35 (Linux/WSL) for --log-in/--log-out/--log-timing.
# macOS/BSD `script` uses different flags — a portable variant is TODO.
#
# CAUTION: the input log (--log-in) is a RAW keystroke record. Passwords you type at a prompt
# (sudo, ssh) land in it. The ingester re-redacts IPs and flag-shaped tokens, but NOT arbitrary
# secrets — prefer key-based auth, and treat these logs as sensitive until the scrubber lands.

ssh() {
  # only tap interactive sessions; a one-shot `ssh host 'cmd'` is already captured locally as one command
  if [ "$#" -ge 2 ]; then
    command ssh "$@"
    return
  fi

  local dir="${WATCHER_HOME:-$HOME/.watcher}/ssh"
  mkdir -p "$dir"
  local id="${WATCHER_SESSION:-$$}-$(date +%s 2>/dev/null || echo 0)"

  if command -v script >/dev/null 2>&1 && script --help 2>&1 | grep -q -- --log-in; then
    script -q \
      --log-in    "$dir/$id.in"  \
      --log-out   "$dir/$id.out" \
      --log-timing "$dir/$id.tm" \
      -c "command ssh $(printf '%q ' "$@")"
  else
    # no capable `script` — run normally rather than silently drop the session
    echo "[watcher] script --log-in unavailable; this ssh session won't be captured per-command" >&2
    command ssh "$@"
  fi
}
