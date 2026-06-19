//! A terminal model (brief §3.1, the VT-parser path) plus OSC 133 shell-integration
//! markers.
//!
//! Two regimes, switched by the alternate-screen mode:
//!   * Primary screen — a line-committing model. ConPTY repaints in place (CR, erase-line,
//!     cursor moves); we track a cursor column and commit settled lines on linefeed, so
//!     scrolling command output is reconstructed as the clean logical line stream.
//!   * Alternate screen — a cursor-addressable grid for full-screen TUIs (vim, htop, less).
//!     We render the grid and snapshot it when the app exits the alt screen.
//!
//! OSC 133 markers (A=prompt, B=command, C=output, D=done;exit) give exact command
//! boundaries and exit codes, raising boundary_confidence to 1.0.

use vte::{Params, Perform};

#[derive(Debug, Clone, PartialEq)]
pub struct Boundary {
    pub kind: u8, // b'A' | b'B' | b'C' | b'D'
    pub exit: Option<i64>,
    pub line: usize,
    pub at_us: u64, // wall-clock when the marker was seen (command timing)
}

fn now_us() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

/// A snapshot of a full-screen TUI, captured when the app left the alternate screen.
#[derive(Debug, Clone, PartialEq)]
pub struct TuiSnapshot {
    pub line: usize,
    pub text: String,
}

/// A fixed cursor-addressable cell grid for the alternate screen.
struct Grid {
    rows: usize,
    cols: usize,
    cells: Vec<Vec<char>>,
    cy: usize,
    cx: usize,
}

impl Grid {
    fn new(rows: usize, cols: usize) -> Self {
        Grid { rows, cols, cells: vec![vec![' '; cols]; rows], cy: 0, cx: 0 }
    }
    fn clear(&mut self) {
        for row in &mut self.cells {
            row.iter_mut().for_each(|c| *c = ' ');
        }
        self.cy = 0;
        self.cx = 0;
    }
    fn print(&mut self, c: char) {
        if self.cy < self.rows && self.cx < self.cols {
            self.cells[self.cy][self.cx] = c;
        }
        if self.cx + 1 < self.cols {
            self.cx += 1;
        }
    }
    fn newline(&mut self) {
        if self.cy + 1 < self.rows {
            self.cy += 1;
        }
    }
    fn erase_line(&mut self, mode: usize) {
        if self.cy >= self.rows {
            return;
        }
        let (a, b) = match mode {
            1 => (0, self.cx + 1),
            2 => (0, self.cols),
            _ => (self.cx, self.cols),
        };
        for x in a..b.min(self.cols) {
            self.cells[self.cy][x] = ' ';
        }
    }
    fn erase_display(&mut self, mode: usize) {
        match mode {
            2 => self.clear_keep_cursor(),
            1 => {
                for y in 0..=self.cy.min(self.rows.saturating_sub(1)) {
                    self.cells[y].iter_mut().for_each(|c| *c = ' ');
                }
            }
            _ => {
                for y in self.cy..self.rows {
                    self.cells[y].iter_mut().for_each(|c| *c = ' ');
                }
            }
        }
    }
    fn clear_keep_cursor(&mut self) {
        for row in &mut self.cells {
            row.iter_mut().for_each(|c| *c = ' ');
        }
    }
    fn snapshot(&self) -> String {
        let mut rows: Vec<String> = self
            .cells
            .iter()
            .map(|r| r.iter().collect::<String>().trim_end().to_string())
            .collect();
        while rows.last().map(|s| s.is_empty()).unwrap_or(false) {
            rows.pop();
        }
        rows.join("\n")
    }
}

pub struct Terminal {
    pub lines: Vec<String>,
    cur: Vec<char>,
    col: usize,
    pub osc133: Vec<Boundary>,
    pub tui_snapshots: Vec<TuiSnapshot>,
    grid: Grid,
    alt: bool,
}

impl Default for Terminal {
    fn default() -> Self {
        Terminal {
            lines: Vec::new(),
            cur: Vec::new(),
            col: 0,
            osc133: Vec::new(),
            tui_snapshots: Vec::new(),
            grid: Grid::new(50, 200),
            alt: false,
        }
    }
}

impl Terminal {
    pub fn new() -> Self {
        Terminal::default()
    }

    // ---- primary-screen line model ----
    fn write_char(&mut self, c: char) {
        while self.cur.len() < self.col {
            self.cur.push(' ');
        }
        if self.col < self.cur.len() {
            self.cur[self.col] = c;
        } else {
            self.cur.push(c);
        }
        self.col += 1;
    }
    fn linefeed(&mut self) {
        self.lines.push(self.cur.iter().collect());
        self.cur.clear();
        self.col = 0;
    }
    fn erase_line(&mut self, mode: usize) {
        match mode {
            0 => self.cur.truncate(self.col),
            1 => (0..self.col.min(self.cur.len())).for_each(|i| self.cur[i] = ' '),
            _ => self.cur.clear(),
        }
    }

    fn enter_alt(&mut self) {
        // commit any pending primary line, then switch to a fresh grid
        if !self.cur.is_empty() {
            self.linefeed();
        }
        self.alt = true;
        self.grid.clear();
    }
    fn exit_alt(&mut self) {
        let text = self.grid.snapshot();
        if !text.is_empty() {
            self.tui_snapshots.push(TuiSnapshot { line: self.lines.len(), text });
        }
        self.alt = false;
    }

    // ---- OSC 133 accessors ----
    pub fn d_count(&self) -> usize {
        self.osc133.iter().filter(|b| b.kind == b'D').count()
    }
    pub fn last_b_line(&self) -> Option<usize> {
        self.osc133.iter().filter(|b| b.kind == b'B').last().map(|b| b.line)
    }
    pub fn last_d(&self) -> Option<&Boundary> {
        self.osc133.iter().filter(|b| b.kind == b'D').last()
    }
    pub fn has_b(&self) -> bool {
        self.osc133.iter().any(|b| b.kind == b'B')
    }
}

pub struct Sink<'a> {
    pub t: &'a mut Terminal,
}

impl<'a> Perform for Sink<'a> {
    fn print(&mut self, c: char) {
        if self.t.alt {
            self.t.grid.print(c);
        } else {
            self.t.write_char(c);
        }
    }
    fn execute(&mut self, byte: u8) {
        if self.t.alt {
            match byte {
                0x0a => self.t.grid.newline(),
                0x0d => self.t.grid.cx = 0,
                0x08 => self.t.grid.cx = self.t.grid.cx.saturating_sub(1),
                _ => {}
            }
            return;
        }
        match byte {
            0x0a => self.t.linefeed(),
            0x0d => self.t.col = 0,
            0x08 => self.t.col = self.t.col.saturating_sub(1),
            0x09 => {
                let target = (self.t.col / 8 + 1) * 8;
                while self.t.col < target {
                    self.t.write_char(' ');
                }
            }
            _ => {}
        }
    }
    fn csi_dispatch(&mut self, params: &Params, _: &[u8], _: bool, action: char) {
        let mut it = params.iter();
        let p1 = it.next().and_then(|s| s.first().copied()).unwrap_or(0) as usize;
        let p2 = it.next().and_then(|s| s.first().copied()).unwrap_or(0) as usize;

        // alternate-screen switch (private modes 47 / 1047 / 1049)
        if (action == 'h' || action == 'l') && matches!(p1, 47 | 1047 | 1049) {
            if action == 'h' {
                self.t.enter_alt();
            } else {
                self.t.exit_alt();
            }
            return;
        }

        if self.t.alt {
            let g = &mut self.t.grid;
            match action {
                'H' | 'f' => {
                    g.cy = p1.saturating_sub(1).min(g.rows - 1);
                    g.cx = p2.saturating_sub(1).min(g.cols - 1);
                }
                'A' => g.cy = g.cy.saturating_sub(p1.max(1)),
                'B' => g.cy = (g.cy + p1.max(1)).min(g.rows - 1),
                'C' => g.cx = (g.cx + p1.max(1)).min(g.cols - 1),
                'D' => g.cx = g.cx.saturating_sub(p1.max(1)),
                'G' => g.cx = p1.saturating_sub(1).min(g.cols - 1),
                'd' => g.cy = p1.saturating_sub(1).min(g.rows - 1),
                'K' => g.erase_line(p1),
                'J' => g.erase_display(p1),
                _ => {}
            }
            return;
        }

        match action {
            'K' => self.t.erase_line(p1),
            'G' => self.t.col = p1.saturating_sub(1),
            'C' => self.t.col += p1.max(1),
            'D' => self.t.col = self.t.col.saturating_sub(p1.max(1)),
            _ => {}
        }
    }
    fn osc_dispatch(&mut self, params: &[&[u8]], _: bool) {
        if params.len() < 2 || params[0] != b"133" {
            return;
        }
        let kind = params[1].first().copied().unwrap_or(0);
        let exit = if kind == b'D' && params.len() >= 3 {
            std::str::from_utf8(params[2]).ok().and_then(|s| s.trim().parse::<i64>().ok())
        } else {
            None
        };
        self.t.osc133.push(Boundary { kind, exit, line: self.t.lines.len(), at_us: now_us() });
    }
    fn hook(&mut self, _: &Params, _: &[u8], _: bool, _: char) {}
    fn put(&mut self, _: u8) {}
    fn unhook(&mut self) {}
    fn esc_dispatch(&mut self, _: &[u8], _: bool, _: u8) {}
}

/// One reconstructed command from a live (interactive) session.
#[derive(Debug, Clone, PartialEq)]
pub struct Captured {
    pub cmd: String,
    pub output: String,
    pub exit: Option<i64>,
    pub start_us: u64, // OSC 133 'B' — command entered
    pub end_us: u64,   // OSC 133 'D' — command finished
}

/// Reconstruct commands from OSC 133 markers — for interactive capture, where we don't
/// know the command list ahead of time. Each B..D pair is a command; the command text is
/// recovered from the echoed prompt line, the output is everything after it. The spurious
/// initial D (from the integration prompt) has no preceding B and is skipped.
pub fn extract_sessions(t: &Terminal) -> Vec<Captured> {
    let mut out = Vec::new();
    let mut pending_b: Option<(usize, u64)> = None;
    for m in &t.osc133 {
        match m.kind {
            b'B' => pending_b = Some((m.line, m.at_us)),
            b'D' => {
                if let Some((bl, b_us)) = pending_b.take() {
                    let dl = m.line.min(t.lines.len());
                    let s = bl.min(dl);
                    let range = &t.lines[s..dl];
                    if let Some(first) = range.first() {
                        let cmd = first
                            .trim()
                            .strip_prefix("PS>")
                            .map(|x| x.trim().to_string())
                            .unwrap_or_else(|| first.trim().to_string());
                        let output = clean_lines(range.get(1..).unwrap_or(&[]), &cmd);
                        out.push(Captured { cmd, output, exit: m.exit, start_us: b_us, end_us: m.at_us });
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Strip the echoed prompt+command line and any prompt lines, leaving just the output.
pub fn clean_lines(lines: &[String], cmd: &str) -> String {
    lines
        .iter()
        .map(|l| l.trim_end())
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && t != "PS>" && !t.ends_with(cmd)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(bytes: &[u8]) -> Terminal {
        let mut t = Terminal::new();
        let mut parser = vte::Parser::new();
        let mut sink = Sink { t: &mut t };
        for &b in bytes {
            parser.advance(&mut sink, b);
        }
        t
    }

    #[test]
    fn carriage_return_overwrites_in_place() {
        let t = feed(b"abc\rX\n");
        assert_eq!(t.lines, vec!["Xbc"]);
    }

    #[test]
    fn erase_line_from_cursor() {
        let t = feed(b"abcdef\rXY\x1b[K\n");
        assert_eq!(t.lines, vec!["XY"]);
    }

    #[test]
    fn osc133_marks_boundaries_and_exit_code() {
        let t = feed(b"\x1b]133;A\x07PS> \x1b]133;B\x07whoami\nuser\n\x1b]133;D;0\x07");
        assert_eq!(t.lines, vec!["PS> whoami", "user"]);
        assert!(t.has_b());
        assert_eq!(t.last_d().unwrap().exit, Some(0));
    }

    #[test]
    fn captures_nonzero_exit() {
        let t = feed(b"\x1b]133;B\x07nmap\nnot found\n\x1b]133;D;127\x07");
        assert_eq!(t.last_d().unwrap().exit, Some(127));
    }

    #[test]
    fn clean_lines_strips_echo_and_prompt() {
        let lines: Vec<String> = ["PS> whoami", "desktop\\op", "PS>"].iter().map(|s| s.to_string()).collect();
        assert_eq!(clean_lines(&lines, "whoami"), "desktop\\op");
    }

    #[test]
    fn alt_screen_tui_is_snapshotted_with_cursor_addressing() {
        // enter alt screen; CUP to row 2 col 3, print HELLO; CUP row 4 col 1, "bye"; exit alt
        let t = feed(b"before\n\x1b[?1049h\x1b[2;3HHELLO\x1b[4;1Hbye\x1b[?1049l");
        assert_eq!(t.tui_snapshots.len(), 1);
        let snap = &t.tui_snapshots[0];
        assert!(snap.text.contains("HELLO"));
        assert!(snap.text.contains("bye"));
        // the alt-screen draw must NOT pollute the primary line log
        assert_eq!(t.lines, vec!["before"]);
        // HELLO sits at column 3 (two leading spaces) on its row
        assert!(snap.text.lines().any(|l| l == "  HELLO"));
    }

    #[test]
    fn alt_screen_erase_display_clears_grid() {
        let t = feed(b"\x1b[?1049h\x1b[1;1HXXXX\x1b[2J\x1b[1;1HY\x1b[?1049l");
        assert_eq!(t.tui_snapshots[0].text, "Y");
    }

    #[test]
    fn extract_sessions_recovers_commands_from_markers() {
        // spurious D, then two full prompt/command/output/done cycles with exit 0 and 1
        let stream = b"\x1b]133;D;0\x07\x1b]133;A\x07PS> \x1b]133;B\x07whoami\nuser\n\
                       \x1b]133;D;0\x07\x1b]133;A\x07PS> \x1b]133;B\x07id\nuid=0\n\x1b]133;D;1\x07";
        let t = feed(stream);
        let caps = extract_sessions(&t);
        assert_eq!(caps.len(), 2);
        // timing (start_us/end_us) is wall-clock, so assert the stable fields only.
        assert_eq!((caps[0].cmd.as_str(), caps[0].output.as_str(), caps[0].exit), ("whoami", "user", Some(0)));
        assert_eq!((caps[1].cmd.as_str(), caps[1].output.as_str(), caps[1].exit), ("id", "uid=0", Some(1)));
        assert!(caps[1].end_us >= caps[1].start_us);
    }
}
