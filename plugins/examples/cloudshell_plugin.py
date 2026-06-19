"""Example source plugin: a CloudShell wrapper streaming to the Watcher daemon.

A real plugin would `subprocess` the user's commands and forward stdin/stdout; this self-contained
version emits canned activity so it runs anywhere for a demo. Usage:

    python plugins/examples/cloudshell_plugin.py [port]
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))
from watcher_sdk import Watcher  # noqa: E402


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    w = Watcher("aws-cloudshell", port=port, context_template="cloud:aws:cloudshell:us-east-1", has_stdin=True)
    w.session_start("AWS CloudShell engagement")

    # a real plugin would run these and capture output; here they are illustrative
    w.command("aws sts get-caller-identity")
    w.output('{"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/student"}')
    w.command("aws s3 ls")
    w.output("2024-06-17 09:14:02 my-research-bucket")
    # a "flag" appearing in output triggers the daemon's wrap-up nudge
    w.command("cat /tmp/flag.txt")
    w.output("0123456789abcdef0123456789abcdef")

    w.session_end()
    w.close()
    print(f"emitted plugin session to 127.0.0.1:{port}")


if __name__ == "__main__":
    main()
