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

    /// A one-shot command that sources the `ssh()` capture tap into the watched shell, so
    /// interactive SSH sessions are recorded per-command (via `script`) instead of vanishing
    /// into one opaque block. None where unsupported (Windows). `session_uuid` ties the ssh
    /// logs to this engagement.
    fn ssh_tap_command(&self, _session_uuid: &str) -> Option<String> {
        None
    }

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

#[derive(Default)]
pub struct WindowsShell {
    /// Explicit shell binary from `--shell`; None launches the profile default (powershell.exe).
    pub program: Option<String>,
}
impl ShellProfile for WindowsShell {
    fn platform_tag(&self) -> &'static str {
        "conpty"
    }
    fn shell_command(&self) -> CommandBuilder {
        // An explicit --shell binary is launched as-is; the default gets -NoLogo/-NoProfile to
        // keep the capture clean and fast (those flags are PowerShell-specific).
        match &self.program {
            Some(p) => CommandBuilder::new(p.clone()),
            None => {
                let mut cmd = CommandBuilder::new("powershell.exe");
                cmd.arg("-NoLogo");
                cmd.arg("-NoProfile");
                cmd
            }
        }
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
#[derive(Default)]
pub struct UnixShell {
    /// Explicit shell binary from `--shell`; None falls back to $SHELL, then /bin/bash.
    pub program: Option<String>,
}
impl ShellProfile for UnixShell {
    fn platform_tag(&self) -> &'static str {
        "unix-pty"
    }
    fn shell_command(&self) -> CommandBuilder {
        let shell = self
            .program
            .clone()
            .or_else(|| std::env::var("SHELL").ok())
            .unwrap_or_else(|| "/bin/bash".to_string());
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
    fn ssh_tap_command(&self, session_uuid: &str) -> Option<String> {
        Some(format!(
            "export WATCHER_SESSION='{session_uuid}'; . \"$HOME/.watcher/watcher-ssh.sh\" 2>/dev/null"
        ))
    }
}

/// Pick the shell-integration profile by shell *family* (basename), not host OS: `--shell bash`
/// on Windows (git-bash / WSL) still needs bash's Final Term markers, not the PowerShell prompt.
/// The requested binary is remembered so it — not the profile default — is what gets launched.
pub fn profile_for_shell(shell: &str) -> Box<dyn ShellProfile> {
    let base = shell
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell)
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    let program = Some(shell.to_string());
    match base.as_str() {
        "powershell" | "pwsh" => Box::new(WindowsShell { program }),
        "bash" | "sh" | "zsh" | "fish" | "dash" | "ash" | "ksh" => Box::new(UnixShell { program }),
        // Unknown family: launch the requested binary under the host's default marker scheme.
        _ =>
        {
            #[cfg(windows)]
            {
                Box::new(WindowsShell { program })
            }
            #[cfg(not(windows))]
            {
                Box::new(UnixShell { program })
            }
        }
    }
}

pub fn platform_profile() -> Box<dyn ShellProfile> {
    #[cfg(windows)]
    {
        Box::new(WindowsShell::default())
    }
    #[cfg(not(windows))]
    {
        Box::new(UnixShell::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_family_is_selected_by_basename_not_os() {
        // Family follows the shell name, not the host: bash always gets unix markers, pwsh conpty.
        assert_eq!(profile_for_shell("bash").platform_tag(), "unix-pty");
        assert_eq!(profile_for_shell("/usr/bin/zsh").platform_tag(), "unix-pty");
        assert_eq!(profile_for_shell(r"C:\Program Files\Git\bin\bash.exe").platform_tag(), "unix-pty");
        assert_eq!(profile_for_shell("pwsh").platform_tag(), "conpty");
        assert_eq!(profile_for_shell("powershell.exe").platform_tag(), "conpty");
    }

    #[test]
    fn detects_common_password_prompts() {
        let p = UnixShell::default();
        assert!(p.looks_like_password_prompt("[sudo] password for kali:"));
        assert!(p.looks_like_password_prompt("root@10.10.10.5's password:"));
        assert!(p.looks_like_password_prompt("Enter passphrase for key '/root/.ssh/id_rsa':"));
        assert!(!p.looks_like_password_prompt("uid=0(root) gid=0(root)"));
    }
}
