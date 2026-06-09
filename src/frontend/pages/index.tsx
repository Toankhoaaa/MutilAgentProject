import Head from "next/head";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────
type MockEmail = {
  sender: string;
  subject: string;
  tag: string;
  tagBg: string;
  tagColor: string;
  avatarBg: string;
};

// ── Dashboard visual mockup ───────────────────────────────────────────────────
const MOCK_EMAILS: MockEmail[] = [
  {
    sender: "Sarah Chen",
    subject: "Q2 Budget Approval",
    tag: "Urgent",
    tagBg: "rgba(239,68,68,0.12)",
    tagColor: "#fca5a5",
    avatarBg: "rgba(239,68,68,0.15)",
  },
  {
    sender: "Mike Torres",
    subject: "Partnership Inquiry",
    tag: "Draft Ready",
    tagBg: "rgba(16,185,129,0.12)",
    tagColor: "#6ee7b7",
    avatarBg: "rgba(16,185,129,0.15)",
  },
  {
    sender: "Alex Kim",
    subject: "Contract Renewal",
    tag: "Need Reply",
    tagBg: "rgba(59,130,246,0.12)",
    tagColor: "#93c5fd",
    avatarBg: "rgba(59,130,246,0.15)",
  },
  {
    sender: "Dev Team",
    subject: "Release Notes v2.4",
    tag: "Newsletter",
    tagBg: "rgba(139,92,246,0.12)",
    tagColor: "#c4b5fd",
    avatarBg: "rgba(139,92,246,0.15)",
  },
];

function DashboardMockup() {
  return (
    <div className="relative select-none">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[3rem]"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 55% 50%, rgba(99,102,241,0.18) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Card */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "#0d1117",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow:
            "0 0 0 1px rgba(0,0,0,0.5), 0 32px 72px rgba(0,0,0,0.55), 0 8px 24px rgba(99,102,241,0.1)",
        }}
      >
        {/* Window chrome */}
        <div
          className="flex items-center gap-1.5 px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span className="w-3 h-3 rounded-full" style={{ background: "#ff5f57" }} />
          <span className="w-3 h-3 rounded-full" style={{ background: "#febc2e" }} />
          <span className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />

          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "#34d399" }}
            />
            <span
              className="text-xs font-mono"
              style={{ color: "#52525b", letterSpacing: "0.02em" }}
            >
              4 agents running
            </span>
          </div>
        </div>

        {/* Header row */}
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
        >
          <svg
            className="w-3.5 h-3.5 flex-shrink-0"
            fill="none"
            stroke="#6366f1"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
            />
            <polyline
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              points="22,6 12,13 2,6"
            />
          </svg>
          <span className="text-xs font-semibold" style={{ color: "#a1a1aa" }}>
            Inbox Pipeline
          </span>
          <span
            className="ml-auto text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
          >
            247 today
          </span>
        </div>

        {/* Email rows */}
        <div className="p-2.5 space-y-0.5">
          {MOCK_EMAILS.map((email) => (
            <div
              key={email.sender}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.025)" }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: email.avatarBg, color: email.tagColor }}
              >
                {email.sender[0]}
              </div>

              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-medium truncate"
                  style={{ color: "#d4d4d8" }}
                >
                  {email.sender}
                </p>
                <p className="text-xs truncate" style={{ color: "#52525b" }}>
                  {email.subject}
                </p>
              </div>

              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                style={{ background: email.tagBg, color: email.tagColor }}
              >
                {email.tag}
              </span>
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div className="px-2.5 pb-2.5">
          <div
            className="rounded-xl p-3.5"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div className="grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ["247", "Processed"],
                  ["38", "Drafted"],
                  ["4.2s", "Avg. Reply"],
                ] as [string, string][]
              ).map(([value, label]) => (
                <div key={label}>
                  <p className="text-sm font-bold" style={{ color: "#f4f4f5" }}>
                    {value}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "#52525b" }}>
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating badge: agent status */}
      <div
        className="absolute -bottom-5 -left-5 flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{
          background: "#0d1117",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse"
          style={{ background: "#34d399" }}
        />
        <span className="text-xs font-medium" style={{ color: "#a1a1aa" }}>
          Classifier Agent
        </span>
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}
        >
          Running
        </span>
      </div>

      {/* Floating badge: draft created */}
      <div
        className="absolute -top-4 -right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{
          background: "#0d1117",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          fill="none"
          stroke="#818cf8"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
        <span className="text-xs font-medium" style={{ color: "#a1a1aa" }}>
          Draft created
        </span>
      </div>
    </div>
  );
}

// ── Hero Section ──────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-20 pb-32 lg:pt-28 lg:pb-40">
      {/* Soft background radial */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 w-[700px] h-[700px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 65%)",
        }}
      />

      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-12 lg:gap-20 items-center">

          {/* ── Left: Typography ── */}
          <div>
            <h1
              className="font-bold tracking-tight text-zinc-900 leading-[1.07]"
              style={{ fontSize: "clamp(2.75rem, 5.5vw, 4.25rem)" }}
            >
              Automate Email
              <br />
              <span style={{ color: "#6366f1" }}>Triage at Scale</span>
            </h1>

            <p
              className="mt-6 leading-relaxed text-zinc-500"
              style={{ fontSize: "clamp(1rem, 1.5vw, 1.125rem)", maxWidth: "38ch" }}
            >
              Multi-agent AI classifies, drafts, and routes every email.
              Your team handles decisions, not inboxes.
            </p>

            <div className="mt-10 flex items-center gap-3">
              <Link
                href="/login"
                className="btn-primary"
                style={{ padding: "0.625rem 1.375rem", fontSize: "0.9375rem" }}
              >
                Request Access
              </Link>
              <Link
                href="/dashboard"
                className="btn-secondary"
                style={{ padding: "0.625rem 1.375rem", fontSize: "0.9375rem" }}
              >
                View Dashboard
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M12 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </div>

            {/* Social proof row */}
            <div className="mt-12 flex items-center gap-5">
              <div className="flex -space-x-2.5">
                {["#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b"].map((bg, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full ring-2 ring-white flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: bg }}
                  >
                    {["S", "M", "A", "D"][i]}
                  </div>
                ))}
              </div>
              <p className="text-sm text-zinc-400">
                <span className="font-semibold text-zinc-700">120+ teams</span>{" "}
                on the waitlist
              </p>
            </div>
          </div>

          {/* ── Right: Visual placeholder ── */}
          <div
            className="hidden lg:block"
            style={{ transform: "perspective(900px) rotateY(-6deg) rotateX(2deg)" }}
          >
            <DashboardMockup />
          </div>

        </div>
      </div>
    </section>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#6366f1" }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="white"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.2}
                d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
              />
              <polyline
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.2}
                points="22,6 12,13 2,6"
              />
            </svg>
          </div>
          <span
            className="font-semibold text-zinc-900 tracking-tight"
            style={{ fontSize: "0.9375rem" }}
          >
            Email Orchestrator
          </span>
        </div>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-500">
          <a href="#features" className="hover:text-zinc-900 transition-colors duration-150">
            Features
          </a>
          <a href="#how-it-works" className="hover:text-zinc-900 transition-colors duration-150">
            How it works
          </a>
          <a href="#pricing" className="hover:text-zinc-900 transition-colors duration-150">
            Pricing
          </a>
        </nav>

        {/* CTA */}
        <Link
          href="/login"
          className="btn-primary"
          style={{ fontSize: "0.8125rem", padding: "0.375rem 1rem" }}
        >
          Sign in
        </Link>

      </div>
    </header>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Email Orchestrator — AI-Powered Inbox Automation</title>
        <meta
          name="description"
          content="Multi-agent AI that classifies, drafts, and routes every email automatically. Built for B2B teams."
        />
      </Head>

      <div className="min-h-screen bg-white">
        <Navbar />
        <main>
          <HeroSection />
          {/* Phase 2+ sections: Features, Workflow, Pricing, CTA */}
        </main>
        <footer
          className="py-8 px-6 text-center text-sm text-zinc-400"
          style={{ borderTop: "1px solid #f4f4f5" }}
        >
          2026 Email Orchestrator. All rights reserved.
        </footer>
      </div>
    </>
  );
}
