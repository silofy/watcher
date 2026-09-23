import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useReport } from "../store/report";
import { STEP_COUNT, deriveChecklist } from "../lib/onboarding";
import { llmStatus, pullModel, DEFAULT_MODEL } from "../lib/llm/runtime";
import { setCoachMode } from "../lib/llm/mode";
import { setApiKey, CLOUD_LABEL, type CloudName } from "../lib/llm/cloud";
import { Check, ScanEye, ArrowUpRight, Terminal, Crosshair, ChevronDown } from "./icons";
import { InstallReference } from "./Install";

/** Tauri-only: never read `window` at module load — only inside handlers/effects. */
const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const NUMERALS = ["①", "②", "③", "④", "⑤", "⑥"]; // ①②③④…

const STEPS = [
  { kicker: "The instrument", title: "Meet the Watcher" },
  { kicker: "Your own box", title: "Capture your first run" },
  { kicker: "Local AI", title: "Sharpen your coaching" },
  { kicker: "Preflight complete", title: "You're set" },
] as const;

// ── shared primitives ──────────────────────────────────────────────────────

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-edge border-t-signal" aria-hidden />;
}

/** A stenciled telemetry line — the readout style the rest of the app uses under live actions. */
function Readout({ tone, children }: { tone: "signal" | "match" | "stuck" | "muted"; children: ReactNode }) {
  const color = tone === "muted" ? "var(--color-muted)" : `var(--color-${tone})`;
  return (
    <div
      className="mono fade-in flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]"
      style={{ color, borderColor: `color-mix(in oklch, ${color} 30%, transparent)`, background: `color-mix(in oklch, ${color} 9%, transparent)` }}
    >
      {children}
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the command stays selectable by hand */
    }
  };
  return { copied, copy };
}

function CommandRow({ cmd }: { cmd: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center justify-between gap-3 overflow-x-auto rounded-md border border-edge bg-ink/70 px-3 py-2 ring-1 ring-inset ring-white/[0.02]">
      <code className="mono whitespace-pre text-[13px] text-fg">
        <span className="select-none text-faint">$ </span>
        {cmd}
      </code>
      <button
        type="button"
        onClick={() => copy(cmd)}
        className="label shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-panel-2"
        aria-label="Copy command"
      >
        {copied ? <span className="text-match">{"✓"} copied</span> : <span className="text-faint hover:text-fg">{"⧉"} copy</span>}
      </button>
    </div>
  );
}

/** The pill primary + ghost secondary the app uses for chrome. */
function Primary({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="label inline-flex items-center gap-1.5 rounded-md bg-signal px-4 py-2 transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
      style={{ color: "var(--color-ink)" }}
    >
      {children}
    </button>
  );
}

function Ghost({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="label rounded-md px-2 py-1 text-faint transition-colors hover:text-muted">
      {children}
    </button>
  );
}

// ── the progress rail (left spine) ─────────────────────────────────────────

function ProgressRail({ step, stepDone }: { step: number; stepDone: boolean[] }) {
  const setOnboardingStep = useReport((s) => s.setOnboardingStep);
  return (
    <nav aria-label="Onboarding steps" className="flex flex-col gap-0">
      {Array.from({ length: STEP_COUNT }).map((_, i) => {
        const meta = STEPS[i] ?? STEPS[0];
        const filled = i < step || stepDone[i];
        const active = i === step;
        return (
          <button
            key={i}
            type="button"
            onClick={() => setOnboardingStep(i)}
            className="group flex gap-3 text-left"
            aria-current={active ? "step" : undefined}
          >
            <div className="flex flex-col items-center">
              <span
                className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs transition-all duration-300 ${
                  filled
                    ? "bg-signal text-ink"
                    : active
                      ? "bg-ink text-signal ring-2 ring-signal"
                      : "bg-panel-2 text-faint ring-1 ring-edge group-hover:ring-muted"
                }`}
              >
                {active && !filled && <span className="absolute inset-0 animate-ping rounded-full ring-1 ring-signal/40" aria-hidden />}
                {filled ? <Check size={14} /> : NUMERALS[i]}
              </span>
              {i < STEP_COUNT - 1 && (
                <span className={`my-1 w-px flex-1 transition-colors duration-500 ${i < step ? "bg-signal/70" : "bg-edge"}`} style={{ minHeight: 26 }} />
              )}
            </div>
            <div className="pb-4 pt-1">
              <div className={`font-display text-sm font-semibold transition-colors ${active ? "text-fg" : filled ? "text-muted" : "text-faint group-hover:text-muted"}`}>
                {meta.title}
              </div>
              <div className="label mt-0.5 text-[10px] text-faint">{filled ? "done" : active ? "in progress" : meta.kicker}</div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

// ── step ① Meet the Watcher ────────────────────────────────────────────────

function StepMeet() {
  const { startLiveDemo, demo, markOnboardingStep } = useReport();
  const marked = useRef(false);

  useEffect(() => {
    if (demo?.phase === "compared" && !marked.current) {
      marked.current = true;
      markOnboardingStep("demo");
    }
  }, [demo?.phase, markOnboardingStep]);

  const streaming = demo != null && demo.phase !== "compared";
  const played = demo != null;

  const pipeline: { icon: ReactNode; head: string; body: string; tone: string }[] = [
    { icon: <span className="animate-pulse">{"●"}</span>, head: "Record", body: "a watched shell streams every command as you hack", tone: "var(--color-signal)" },
    { icon: <Crosshair size={13} />, head: "Grade", body: "read at once through ATT&CK · Kill Chain · CWE", tone: "var(--color-match)" },
    { icon: <ScanEye size={13} />, head: "Local", body: "nothing leaves your machine — no account, no upload", tone: "var(--color-muted)" },
  ];

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-[15px] leading-relaxed text-muted">
        A flight-data-recorder for your hacking practice. Record a run against any box, then read a{" "}
        <span className="text-fg">graded debrief</span> of what you did, how efficiently, and what you missed.
      </p>

      <ul className="space-y-px overflow-hidden rounded-lg border border-edge">
        {pipeline.map((p, i) => (
          <li key={p.head} className="rise flex items-start gap-3 bg-panel px-4 py-3" style={{ "--i": i } as CSSProperties}>
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[13px]" style={{ color: p.tone }}>
              {p.icon}
            </span>
            <div className="text-sm leading-relaxed">
              <span className="font-display font-semibold text-fg">{p.head}</span>
              <span className="text-muted"> — {p.body}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => startLiveDemo("abducted")}
          disabled={streaming}
          className="label inline-flex items-center gap-2 rounded-md border border-signal/40 bg-signal/10 px-4 py-2 text-signal transition-colors hover:bg-signal/15 disabled:cursor-progress disabled:opacity-60"
        >
          {"▶"} {played && !streaming ? "Replay the demo" : "Play a 60-second demo"}
        </button>

        {demo != null && (
          <Readout tone={demo.phase === "compared" ? "match" : "signal"}>
            {demo.phase === "compared" ? (
              <span>
                {"✓"} Debrief graded {"—"} replayed {demo.total} commands and unlocked the write-up comparison
              </span>
            ) : demo.phase === "resolved" ? (
              <span>{"◦"} run complete {"—"} grading the debrief{"…"}</span>
            ) : (
              <span>
                {"▶"} streaming{"…"} <span className="tabular-nums">{demo.n}</span>/<span className="tabular-nums">{demo.total}</span>
              </span>
            )}
          </Readout>
        )}
      </div>
    </div>
  );
}

// ── step ② Capture your first run ──────────────────────────────────────────

export function StepCapture() {
  const { sessionCards, switchSession, closeOnboarding, setOnboardingStep, onboardingStep } = useReport();

  const realCards = sessionCards.filter((c) => !c.demo);
  const newest = realCards.slice().sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))[0];
  const name = newest?.target?.name || newest?.machine?.name || "your run";
  const count = newest?.episodes ?? 0;

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-[15px] leading-relaxed text-muted">
        One command, from the repo root, turns a shell into a recorded session. Play a box in another window {"—"} each
        command streams into a live debrief here.
      </p>

      <CommandRow cmd="npm run capture -- --machine <box>" />
      <p className="text-xs text-faint">
        Other platforms name the target neutrally:{" "}
        <code className="mono rounded bg-panel-2 px-1 py-0.5 text-fg">--platform thm --target &lt;name&gt;</code>
      </p>

      {newest ? (
        <div className="space-y-3">
          <Readout tone="match">
            <Check size={15} />
            <span>
              Captured <span className="text-fg">{"“"}{name}{"”"}</span>
              {count > 0 && <> {"—"} {count} commands</>}
            </span>
          </Readout>
          <Primary
            onClick={() => {
              switchSession(newest.id);
              closeOnboarding();
            }}
          >
            Open my debrief <ArrowUpRight size={13} />
          </Primary>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-edge bg-panel px-4 py-3.5">
          <Readout tone="muted">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal/80" />
            </span>
            <span className="text-muted">waiting for a session{"…"} run the command above and it lands here live</span>
          </Readout>
          {!isDesktop() && (
            <p className="flex items-start gap-1.5 text-xs text-faint">
              <Terminal size={13} className="mt-px shrink-0" />
              Live detection runs in the desktop app {"—"} you can still skip ahead and capture later.
            </p>
          )}
          <Ghost onClick={() => setOnboardingStep(onboardingStep + 1)}>Skip for now {"—"} I{"’"}ll capture later {"→"}</Ghost>
        </div>
      )}

      <details className="group/all border-t border-edge pt-4">
        <summary className="label flex cursor-pointer list-none items-center gap-2 text-muted [&::-webkit-details-marker]:hidden">
          <ChevronDown size={12} className="transition-transform group-open/all:rotate-180" />
          All setup options
        </summary>
        <div className="mt-4">
          <InstallReference />
        </div>
      </details>
    </div>
  );
}

// ── step ③ Sharpen your coaching ───────────────────────────────────────────

const CLOUD_PROVIDERS: CloudName[] = ["anthropic", "openai", "gemini", "openrouter"];
type LocalPhase = "probing" | "ready" | "missing" | "downloading" | "error";

function StepAI() {
  const { setOnboardingStep, onboardingStep, markOnboardingStep } = useReport();
  const desktop = isDesktop();
  const [local, setLocal] = useState<LocalPhase>("probing");
  const [provider, setProvider] = useState<CloudName | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Guards post-await setState: the content column is keyed by step, so leaving mid-request
  // unmounts this. The coaching choice still persists; only the visual state is gated.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!desktop) {
      setLocal("missing");
      return;
    }
    let alive = true;
    llmStatus()
      .then((s) => {
        if (!alive) return;
        const want = DEFAULT_MODEL.split(":")[0];
        const has = (s.models ?? []).some((m) => m.split(":")[0] === want);
        setLocal(s.available && has ? "ready" : "missing");
      })
      .catch(() => {
        if (alive) setLocal("missing");
      });
    return () => {
      alive = false;
    };
  }, [desktop]);

  const finish = (label: string) => {
    markOnboardingStep("ai");
    if (mounted.current) setDone(label);
  };
  const useLocal = () => {
    setCoachMode("local");
    finish("Local AI");
  };
  const download = async () => {
    setErr(null);
    setLocal("downloading");
    try {
      const ok = await pullModel(DEFAULT_MODEL);
      if (ok) {
        setCoachMode("local");
        finish("Local AI");
      } else if (mounted.current) {
        setLocal("error");
      }
    } catch {
      if (mounted.current) setLocal("error");
    }
  };
  const saveCloud = async () => {
    if (!provider || !key.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await setApiKey(provider, key.trim());
      setCoachMode(provider);
      finish(CLOUD_LABEL[provider]);
    } catch (e) {
      if (mounted.current) setErr((e as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const skip = () => {
    setCoachMode("rules");
    setOnboardingStep(onboardingStep + 1);
  };

  if (done) {
    return (
      <Readout tone="match">
        <Check size={15} /> {done} coaching is on {"—"} your notes will be command-aware.
      </Readout>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-[15px] leading-relaxed text-muted">
        Coaching works out of the box on deterministic rules. A model rewrites each note into{" "}
        <span className="text-fg">command-aware advice</span>. Set one up now, or keep rules {"—"} your call.
      </p>

      {/* Local model */}
      <div className="space-y-2.5 rounded-lg border border-edge bg-panel/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="font-display text-sm font-semibold text-fg">Local model {"·"} fully offline</div>
            <div className="text-xs text-faint">Ollama runs {DEFAULT_MODEL} on your machine {"—"} commands never leave the device.</div>
          </div>
          {local === "ready" && <span className="label shrink-0 text-[10px] text-match">installed</span>}
        </div>
        {local === "probing" && (
          <Readout tone="muted">
            <Spinner /> Checking for a local model{"…"}
          </Readout>
        )}
        {local === "ready" && <Primary onClick={useLocal}>{"⚡"} Use local AI</Primary>}
        {local === "missing" && desktop && (
          <button
            type="button"
            onClick={download}
            className="label inline-flex items-center gap-2 rounded-md border border-signal/40 bg-signal/10 px-4 py-2 text-signal transition-colors hover:bg-signal/15"
          >
            {"⬇"} Download {DEFAULT_MODEL} (~2 GB)
          </button>
        )}
        {local === "missing" && !desktop && (
          <p className="text-xs text-faint">Installs from the desktop app {"—"} not available in the browser preview.</p>
        )}
        {local === "downloading" && (
          <Readout tone="signal">
            <Spinner /> Downloading {DEFAULT_MODEL}{"…"} runs once, then stays on your machine.
          </Readout>
        )}
        {local === "error" && (
          <div className="space-y-2">
            <Readout tone="stuck">{"⚠"} Download failed {"—"} check that Ollama is running.</Readout>
            <button
              type="button"
              onClick={download}
              className="label inline-flex items-center gap-2 rounded-md border border-edge px-4 py-2 text-fg transition-colors hover:bg-panel-2"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Cloud model */}
      <div className="space-y-2.5 rounded-lg border border-edge bg-panel/40 p-4">
        <div className="space-y-1">
          <div className="font-display text-sm font-semibold text-fg">Cloud model {"·"} strongest coaching</div>
          <div className="text-xs text-faint">
            Pick a provider and paste a key. Commands are redacted before anything is sent; the key is stored only on your machine.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {CLOUD_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { setProvider(p); setErr(null); }}
              style={provider === p ? { color: "var(--color-ink)" } : undefined}
              className={`label rounded-md px-3 py-1.5 text-[11px] ring-1 transition-colors ${
                provider === p ? "bg-signal ring-signal" : "text-muted ring-edge hover:ring-edge-bright"
              }`}
            >
              {CLOUD_LABEL[p]}
            </button>
          ))}
        </div>
        {provider && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={`${CLOUD_LABEL[provider]} API key`}
                className="mono min-w-0 flex-1 rounded-md border border-edge bg-ink/60 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-edge-bright"
              />
              <button
                type="button"
                onClick={saveCloud}
                disabled={saving || !key.trim()}
                className="label shrink-0 rounded-md bg-signal px-3 py-1.5 text-[11px] transition-[filter] hover:brightness-110 disabled:opacity-40"
                style={{ color: "var(--color-ink)" }}
              >
                {saving ? "Saving…" : "Save & use"}
              </button>
            </div>
            {err && <p className="text-xs text-stuck">{err}</p>}
          </div>
        )}
      </div>

      <Ghost onClick={skip}>Skip {"—"} rules-based coaching is solid {"→"}</Ghost>
    </div>
  );
}

// ── step ④ You're set ──────────────────────────────────────────────────────

function StepRecap() {
  const { onboardingDone, sessionCards, closeOnboarding } = useReport();
  const hasRealCapture = sessionCards.some((c) => !c.demo);
  const items = deriveChecklist({ demoDone: onboardingDone.demo, hasRealCapture, aiDone: onboardingDone.ai });

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-[15px] leading-relaxed text-muted">
        That{"’"}s the loop. Everything below is live in the app now {"—"} anything unchecked, you can finish anytime.
      </p>

      <ul className="overflow-hidden rounded-lg border border-edge">
        {items.map((it, i) => (
          <li
            key={it.key}
            className="rise flex items-center gap-3 border-b border-edge bg-panel px-4 py-3 last:border-b-0"
            style={{ "--i": i } as CSSProperties}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                it.done ? "bg-match/15 text-match" : "bg-panel-2 text-faint ring-1 ring-edge"
              }`}
            >
              {it.done ? <Check size={14} /> : <span className="text-xs">{"○"}</span>}
            </span>
            <span className={`flex-1 text-sm ${it.done ? "text-fg" : "text-muted"}`}>{it.label}</span>
            <span className="label text-[10px] text-faint">{it.done ? "done" : "later"}</span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-faint">
        Next: load a write-up on any run to unlock the{" "}
        <button type="button" onClick={closeOnboarding} className="text-signal underline decoration-signal/40 underline-offset-2 hover:decoration-signal">
          comparison
        </button>{" "}
        {"—"} coverage and {"“"}what you{"’"}d do differently{"”"}.
      </p>
    </div>
  );
}

// ── shell ──────────────────────────────────────────────────────────────────

export function Onboarding() {
  const { onboardingStep, setOnboardingStep, closeOnboarding, onboardingDone, sessionCards } = useReport();

  const step = Math.min(Math.max(onboardingStep, 0), STEP_COUNT - 1);
  const meta = STEPS[step] ?? STEPS[0];
  const isLast = step === STEP_COUNT - 1;
  const hasRealCapture = sessionCards.some((c) => !c.demo);
  const stepDone = [onboardingDone.demo, hasRealCapture, onboardingDone.ai, false];

  const body = step === 0 ? <StepMeet /> : step === 1 ? <StepCapture /> : step === 2 ? <StepAI /> : <StepRecap />;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink text-fg">
      {/* atmosphere — a single low, cool wash so the panel reads lit, not flat */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(120% 80% at 78% -10%, color-mix(in oklch, var(--color-signal) 12%, transparent), transparent 60%)" }}
      />

      <div className="relative mx-auto grid min-h-full w-full max-w-5xl grid-cols-1 lg:grid-cols-[300px_1fr]">
        {/* rail spine */}
        <aside className="flex flex-col justify-between gap-8 border-b border-edge px-7 py-8 lg:border-b-0 lg:border-r lg:py-11">
          <div className="space-y-8">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-signal/15 text-signal ring-1 ring-signal/20">
                <ScanEye size={17} />
              </span>
              <div>
                <div className="font-display text-[15px] font-semibold leading-tight text-fg">Watcher</div>
                <div className="label text-[10px] text-faint">activation</div>
              </div>
            </div>
            <ProgressRail step={step} stepDone={stepDone} />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEP_COUNT}>
              {Array.from({ length: STEP_COUNT }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? "w-6 bg-signal" : i < step ? "w-1.5 bg-signal/60" : "w-1.5 bg-edge"
                  }`}
                />
              ))}
            </div>
            <div className="label text-[11px] text-faint">
              Step {step + 1} of {STEP_COUNT}
            </div>
          </div>
        </aside>

        {/* content */}
        <main className="flex min-h-full flex-col px-7 py-8 lg:px-12 lg:py-11">
          <div key={step} className="flex-1">
            <div className="fade-in">
              <div className="label mb-2 flex items-center gap-2 text-signal">
                <span className="text-sm">{NUMERALS[step]}</span>
                {meta.kicker}
              </div>
              <h1 className="font-display text-[26px] font-semibold leading-tight text-fg lg:text-3xl">{meta.title}</h1>
            </div>
            <div className="mt-6">{body}</div>
          </div>

          {/* chrome */}
          <footer className="mt-10 flex items-center justify-between gap-4 border-t border-edge pt-5">
            <div>
              {step > 0 && <Ghost onClick={() => setOnboardingStep(step - 1)}>{"←"} Back</Ghost>}
            </div>
            <div className="flex items-center gap-2">
              <Ghost onClick={closeOnboarding}>Skip</Ghost>
              {isLast ? (
                <Primary onClick={closeOnboarding}>
                  Enter the Watcher <ArrowUpRight size={13} />
                </Primary>
              ) : (
                <Primary onClick={() => setOnboardingStep(step + 1)}>Next {"→"}</Primary>
              )}
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
