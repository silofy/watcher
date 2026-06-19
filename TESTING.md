# Testing The Watcher

The Watcher records the commands you run against an HTB box and grades the run against the box's
**intended path** (from a write-up): where you nailed it, where you went off-route, what you'd do
differently — plus wasted time, stealth/noise, and a coached playbook.

> Replace `<URL>` below with the deployed link before sharing.

---

## Option 0 — Just react to the demo (no setup, 2 minutes)

Open **`<URL>`**. You're looking at a real debrief of the *Uploadr* box. Click through the **Debrief**
tab — the "where you deviated" timeline, the intended-path graph, the coaching playbook, the stealth
chart. **Nothing to install.** This alone is hugely useful feedback.

---

## Option 1 — Run it on YOUR own box, from Pwnbox (recommended — nothing installed on your PC)

1. Spawn a box on HTB and open **Pwnbox**.
2. Get the capture agent into Pwnbox: transfer **`watcher-capture-linux-x86_64`** (HTB file manager or
   `scp`), then run it, tagging the box:
   ```bash
   chmod +x watcher-capture-linux-x86_64
   ./watcher-capture-linux-x86_64 --export ~/box.json --machine <BoxName> --os Linux
   ```
3. Hack the box as you normally would. Type `exit` when done — it writes `~/box.json`.
4. Download `~/box.json` out of Pwnbox to your computer.
5. In **`<URL>` → History → Import session** (or just drag the `.json` onto the page).
6. You'll be asked for the box's **write-up** — paste one (HTB official, 0xdf, or IppSec notes). That's
   what your run is compared against; without it there's no "intended path" half.
7. Read your debrief.

---

## Option 2 — Playing over the VPN from your own terminal

Same idea, but run the agent on your machine (connected to HTB's OpenVPN). You need the agent built for
your OS — **ask me for a Windows/Linux build** (only the Pwnbox/Linux one is prebuilt today):

```bash
watcher-capture --export ~/box.json --machine <BoxName> --os Linux
```

Then import `box.json` and paste the write-up, exactly like steps 5–7 above.

---

## What I'm looking for

- **Is the report clear at a glance?** What did you *not* understand?
- Does **"What you'd do differently"** match how you actually played the box?
- Is the **coaching** useful, or generic/obvious?
- Anything that felt **broken, slow, or pointless** — say so bluntly.

## Honest notes

- It's **offline** — your session JSON stays on your machine; only the write-up text is read locally.
- In the browser, write-up extraction is **keyword-based** (rough). It's much sharper in the desktop
  app with a local model (Ollama) — but the browser path is enough to evaluate the report.
- The **report and local-terminal capture** are the polished parts. The **Pwnbox agent, desktop app,
  and browser extension** work but are rougher and Windows/Linux-first.
