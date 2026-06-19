//! The platform-abstraction seam. `portable-pty` already hides the PTY mechanism
//! (ConPTY vs openpty); this trait captures the parts that genuinely differ per OS:
//! which shell to launch, how command boundaries are marked, and how to recognize a
//! password prompt for masking. Windows is a first-class target here, not a fallback.

use portable_pty::CommandBuilder;

pub trait ShellProfile {
    /// Tag recorded in provenance.platform.
    fn platform_tag(&self) -> &'static str;

    /// The shell to launch as the PTY child.
    fn shell_command(&self) -> CommandBuilder;

    /// A representative scripted session for the POC demo run.
    fn demo_commands(&self) -> Vec<String>;

    /// A one-shot command that installs OSC 133 shell-integration markers, so the shell
    /// emits exact prompt/command/done boundaries (with exit codes) — the same mechanism
    /// editors like VS Code inject. Replaces the echoed-sentinel boundary hack.
    fn integration_command(&self) -> String;

    /// Heuristic password-prompt masker. On Unix the daemon also reads the termios
    /// ECHO bit (deterministic); ConPTY does not surface that cleanly, so on Windows
    /// this heuristic (plus OSC 133 shell-integration markers) is the mechanism.
    fn looks_like_password_prompt(&self, text: &str) -> bool {
        let lower = text.to_lowercase();
        lower.contains("password:")
            || lower.contains("password for")
            || lower.contains("[sudo] password")
            || lower.contains("enter passphrase")
            || lower.contains("passphrase for")
    }
}

pub struct WindowsShell;
impl ShellProfile for WindowsShell {
    fn platform_tag(&self) -> &'static str {
        "conpty"
    }
    fn shell_command(&self) -> CommandBuilder {
        // -NoLogo/-NoProfile keep the capture clean and fast; the real daemon would
        // honor the user's configured shell (powershell, pwsh, cmd, nushell, ...).
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd.arg("-NoProfile");
        cmd
    }
    fn demo_commands(&self) -> Vec<String> {
        ["whoami", "echo watcher-capture-poc", "Get-Location"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
    fn integration_command(&self) -> String {
        // Redefine the prompt to emit D;<exit>, A, "PS> ", B around every command.
        // $? -> 0/1; the full daemon would use $LASTEXITCODE for native exit codes.
        "function prompt { $c = if ($?) { 0 } else { 1 }; $e=[char]27; $g=[char]7; \
         \"$e]133;D;$c$g$e]133;A${g}PS> $e]133;B$g\" }"
            .to_string()
    }
}

#[cfg_attr(windows, allow(dead_code))]
pub struct UnixShell;
impl ShellProfile for UnixShell {
    fn platform_tag(&self) -> &'static str {
        "unix-pty"
    }
    fn shell_command(&self) -> CommandBuilder {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        CommandBuilder::new(shell)
    }
    fn demo_commands(&self) -> Vec<String> {
        ["whoami", "echo watcher-capture-poc", "pwd", "id"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
    fn integration_command(&self) -> String {
        // PROMPT_COMMAND emits D;<exit>; PS1 emits A, "PS> ", B. Same Final Term markers.
        "export PROMPT_COMMAND='printf \"\\033]133;D;%s\\007\" \"$?\"'; \
         export PS1='\\033]133;A\\007PS> \\033]133;B\\007'"
            .to_string()
    }
}

pub fn platform_profile() -> Box<dyn ShellProfile> {
    #[cfg(windows)]
    {
        Box::new(WindowsShell)
    }
    #[cfg(not(windows))]
    {
        Box::new(UnixShell)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_password_prompts() {
        let p = UnixShell;
        assert!(p.looks_like_password_prompt("[sudo] password for kali:"));
        assert!(p.looks_like_password_prompt("root@10.10.10.5's password:"));
        assert!(p.looks_like_password_prompt("Enter passphrase for key '/root/.ssh/id_rsa':"));
        assert!(!p.looks_like_password_prompt("uid=0(root) gid=0(root)"));
    }
}
