import Head from "next/head";
import Link from "next/link";
import { useRef, useState, useEffect, type ReactNode, type CSSProperties } from "react";
import { motion, useInView } from "motion/react";
import api from "@/lib/axios";
import type { UserProfile } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────
type MockEmail = {
  sender: string;
  subject: string;
  tag: string;
  tagBg: string;
  tagColor: string;
  avatarBg: string;
};

// ── Dashboard visual mockup data ──────────────────────────────────────────────
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

// ── Dashboard Mockup ──────────────────────────────────────────────────────────
function DashboardMockup() {
  return (
    <div className="relative select-none">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[3rem] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 55% 50%, rgba(99,102,241,0.18) 0%, transparent 70%)",
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
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="#6366f1" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
            />
            <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} points="22,6 12,13 2,6" />
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
                <p className="text-xs font-medium truncate" style={{ color: "#d4d4d8" }}>
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
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="#818cf8" viewBox="0 0 24 24">
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

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    api.get<UserProfile>("/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => setUser(null));
  }, []);

  const initials = user
    ? (user.display_name ?? user.email)
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

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
            <svg className="w-4 h-4" fill="none" stroke="white" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.2}
                d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
              />
              <polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} points="22,6 12,13 2,6" />
            </svg>
          </div>
          <span className="font-semibold text-zinc-900 tracking-tight" style={{ fontSize: "0.9375rem" }}>
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

        {/* Auth state */}
        {user ? (
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ring-2 ring-transparent group-hover:ring-indigo-200 transition-all"
              style={{ background: "#6366f1" }}
            >
              {initials}
            </div>
            <span
              className="hidden sm:block text-sm font-medium text-zinc-700 group-hover:text-zinc-900 transition-colors max-w-[140px] truncate"
            >
              {user.display_name ?? user.email}
            </span>
          </Link>
        ) : (
          <Link href="/login" className="btn-primary" style={{ fontSize: "0.8125rem", padding: "0.375rem 1rem" }}>
            Sign in
          </Link>
        )}

      </div>
    </header>
  );
}

// ── Reveal helper ─────────────────────────────────────────────────────────────
function Reveal({
  children,
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-6% 0px" });
  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
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
          background: "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 65%)",
        }}
      />

      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-12 lg:gap-20 items-center">

          {/* Left: Typography */}
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            {/* Social proof */}
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

          {/* Right: Dashboard mockup */}
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

// ── Workflow Section ──────────────────────────────────────────────────────────
function WorkFlowSection() {
  return (
    <section id="how-it-works" className="py-24 lg:py-32" style={{ background: "#0d1117" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <Reveal>
          <p className="text-xs font-semibold tracking-widest uppercase mb-4" style={{ color: "#52525b" }}>
            How it works
          </p>
          <h2
            className="font-bold tracking-tight leading-[1.08]"
            style={{ color: "#f4f4f5", fontSize: "clamp(2rem, 4vw, 3rem)" }}
          >
            Three agents.
            <br />
            <span style={{ color: "#6366f1" }}>One pipeline.</span>
          </h2>
          <p
            className="mt-5 leading-relaxed"
            style={{
              color: "#71717a",
              fontSize: "clamp(0.9375rem, 1.25vw, 1.0625rem)",
              maxWidth: "44ch",
            }}
          >
            Each email moves through a dedicated agent layer. No routing rules to configure,
            no if-else logic to maintain.
          </p>
        </Reveal>

        <div className="mt-16 lg:mt-20 space-y-5">

          {/* Step 01: Reading */}
          <Reveal delay={0.08}>
            <div
              className="rounded-2xl p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8 items-center"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className="text-xs font-bold tracking-widest px-2 py-0.5 rounded"
                    style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
                  >
                    01
                  </span>
                  <span className="text-xs font-medium" style={{ color: "#52525b" }}>
                    Reading
                  </span>
                </div>
                <h3
                  className="font-semibold mb-3"
                  style={{ color: "#f4f4f5", fontSize: "clamp(1.125rem, 2vw, 1.375rem)" }}
                >
                  Every thread, in under a second
                </h3>
                <p className="leading-relaxed text-sm" style={{ color: "#71717a", maxWidth: "46ch" }}>
                  The intake agent streams new messages from your inbox in real time via OAuth.
                  No polling delays, no missed threads, no forwarding rules to configure.
                </p>
              </div>

              <div
                className="hidden lg:flex flex-col gap-1.5 rounded-xl p-3"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {[
                  { from: "Sarah Chen", sub: "Q3 headcount plan" },
                  { from: "alex@vendorco.io", sub: "Contract renewal" },
                  { from: "Stripe", sub: "Invoice #1047 ready" },
                ].map((row) => (
                  <div
                    key={row.from}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}
                    >
                      {row.from[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate" style={{ color: "#d4d4d8" }}>
                        {row.from}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: "#52525b" }}>
                        {row.sub}
                      </p>
                    </div>
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
                      style={{ background: "#6366f1" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Step 02: Classifying */}
          <Reveal delay={0.16}>
            <div
              className="rounded-2xl p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8 items-center"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className="text-xs font-bold tracking-widest px-2 py-0.5 rounded"
                    style={{ background: "rgba(6,182,212,0.15)", color: "#22d3ee" }}
                  >
                    02
                  </span>
                  <span className="text-xs font-medium" style={{ color: "#52525b" }}>
                    Classifying
                  </span>
                </div>
                <h3
                  className="font-semibold mb-3"
                  style={{ color: "#f4f4f5", fontSize: "clamp(1.125rem, 2vw, 1.375rem)" }}
                >
                  Intent understood, urgency ranked
                </h3>
                <p className="leading-relaxed text-sm" style={{ color: "#71717a", maxWidth: "46ch" }}>
                  A fine-tuned classifier assigns urgency level, category, and routing tags to each
                  thread. High-priority customer emails surface above billing noise automatically.
                </p>
              </div>

              <div
                className="hidden lg:flex flex-col gap-1.5 rounded-xl p-3"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {[
                  { from: "Sarah Chen", tag: "Urgent", tagColor: "#fca5a5", tagBg: "rgba(239,68,68,0.15)" },
                  { from: "alex@vendorco.io", tag: "Need Reply", tagColor: "#93c5fd", tagBg: "rgba(59,130,246,0.15)" },
                  { from: "Stripe", tag: "Newsletter", tagColor: "#c4b5fd", tagBg: "rgba(139,92,246,0.15)" },
                ].map((row) => (
                  <div
                    key={row.from}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: "rgba(6,182,212,0.15)", color: "#22d3ee" }}
                    >
                      {row.from[0]}
                    </div>
                    <p className="text-[11px] font-medium flex-1 truncate" style={{ color: "#d4d4d8" }}>
                      {row.from}
                    </p>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                      style={{ background: row.tagBg, color: row.tagColor }}
                    >
                      {row.tag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Step 03: Drafting */}
          <Reveal delay={0.24}>
            <div
              className="rounded-2xl p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8 items-center"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className="text-xs font-bold tracking-widest px-2 py-0.5 rounded"
                    style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}
                  >
                    03
                  </span>
                  <span className="text-xs font-medium" style={{ color: "#52525b" }}>
                    Drafting
                  </span>
                </div>
                <h3
                  className="font-semibold mb-3"
                  style={{ color: "#f4f4f5", fontSize: "clamp(1.125rem, 2vw, 1.375rem)" }}
                >
                  Context-aware replies, one click to send
                </h3>
                <p className="leading-relaxed text-sm" style={{ color: "#71717a", maxWidth: "46ch" }}>
                  The drafting agent reads thread history, your tone profile, and company knowledge
                  base to write replies. Every draft lands ready to review, not to rewrite.
                </p>
              </div>

              <div
                className="hidden lg:block rounded-xl p-4"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: "#34d399" }}
                  />
                  <span className="text-[10px] font-mono" style={{ color: "#52525b" }}>
                    Draft ready
                  </span>
                </div>
                <div className="space-y-2">
                  {[
                    { w: "85%", a: 0.28 },
                    { w: "72%", a: 0.18 },
                    { w: "91%", a: 0.28 },
                    { w: "55%", a: 0.14 },
                  ].map(({ w, a }, i) => (
                    <div
                      key={i}
                      className="h-1.5 rounded-full"
                      style={{ width: w, background: `rgba(52,211,153,${a})` }}
                    />
                  ))}
                </div>
                <div
                  className="mt-4 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg w-fit"
                  style={{
                    background: "rgba(52,211,153,0.1)",
                    border: "1px solid rgba(52,211,153,0.2)",
                  }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="#34d399" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-[10px] font-semibold" style={{ color: "#34d399" }}>
                    Approve draft
                  </span>
                </div>
              </div>
            </div>
          </Reveal>

        </div>
      </div>
    </section>
  );
}

// ── ROI Metrics Section ───────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    quote:
      "We used to have two people doing email triage full time. Now it is a Monday morning review and they handle escalations.",
    name: "Marcus Webb",
    role: "Head of Customer Success",
    company: "Recurve",
    initials: "MW",
    avatarBg: "#6366f1",
  },
  {
    quote:
      "The drafts are not generic. They pick up our tone and reference previous conversations. That part genuinely surprised us.",
    name: "Priya Nair",
    role: "Operations Lead",
    company: "Folio Health",
    initials: "PN",
    avatarBg: "#0891b2",
  },
];

function RoiMetricsSection() {
  return (
    <section className="py-24 lg:py-36 bg-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <Reveal>
          <p className="text-xs font-semibold tracking-widest uppercase mb-4 text-zinc-400">
            Results
          </p>
          <h2
            className="font-bold tracking-tight text-zinc-900 leading-[1.08]"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", maxWidth: "18ch" }}
          >
            Numbers from our beta, unrounded.
          </h2>
        </Reveal>

        {/* Stats: editorial asymmetric grid */}
        <div className="mt-16 lg:mt-20 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-zinc-100">

          <Reveal delay={0.06} className="lg:pr-16 pb-12 lg:pb-0">
            <p
              className="font-bold tracking-tight text-zinc-900 leading-none"
              style={{ fontSize: "clamp(4rem, 9vw, 7.5rem)" }}
            >
              14.2
              <span className="text-zinc-300" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
                h
              </span>
            </p>
            <p className="mt-4 text-base text-zinc-500 leading-snug" style={{ maxWidth: "22ch" }}>
              saved per rep, per week
            </p>
            <p className="mt-2 text-xs text-zinc-400">avg. across 47 teams in early access</p>
          </Reveal>

          <Reveal delay={0.12} className="lg:px-16 py-12 lg:py-0">
            <p
              className="font-bold tracking-tight text-zinc-900 leading-none"
              style={{ fontSize: "clamp(3rem, 6vw, 5rem)" }}
            >
              94
              <span className="text-zinc-300" style={{ fontSize: "clamp(1.5rem, 3vw, 2.5rem)" }}>
                %
              </span>
            </p>
            <p className="mt-4 text-base text-zinc-500 leading-snug" style={{ maxWidth: "20ch" }}>
              of emails handled without manual triage
            </p>
            <p className="mt-2 text-xs text-zinc-400">remaining 6% flagged for human review</p>
          </Reveal>

          <Reveal delay={0.18} className="lg:pl-16 pt-12 lg:pt-0">
            <p
              className="font-bold tracking-tight text-zinc-900 leading-none"
              style={{ fontSize: "clamp(3rem, 6vw, 5rem)" }}
            >
              3.8
              <span className="text-zinc-300" style={{ fontSize: "clamp(1.5rem, 3vw, 2.5rem)" }}>
                s
              </span>
            </p>
            <p className="mt-4 text-base text-zinc-500 leading-snug" style={{ maxWidth: "20ch" }}>
              avg. classification time per email
            </p>
            <p className="mt-2 text-xs text-zinc-400">down from 6-8 min of manual review</p>
          </Reveal>

        </div>

        {/* Testimonials */}
        <div className="mt-20 lg:mt-24 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={0.1 + i * 0.1}>
              <div
                className="rounded-2xl p-8 h-full"
                style={{ background: "#fafafa", border: "1px solid #f1f1f1" }}
              >
                <p
                  className="leading-relaxed text-zinc-600"
                  style={{ fontSize: "clamp(0.9375rem, 1.25vw, 1.0625rem)" }}
                >
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: t.avatarBg }}
                  >
                    {t.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800">{t.name}</p>
                    <p className="text-xs text-zinc-400">
                      {t.role}, {t.company}
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}

// ── Feature Bento Grid ────────────────────────────────────────────────────────
function FeatureBentoGrid() {
  return (
    <section id="features" className="py-24 lg:py-32" style={{ background: "#f4f4f5" }}>
      <div className="max-w-7xl mx-auto px-6 lg:px-12">

        <Reveal>
          <p className="text-xs font-semibold tracking-widest uppercase mb-4 text-zinc-400">
            Features
          </p>
          <h2
            className="font-bold tracking-tight text-zinc-900 leading-[1.08]"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", maxWidth: "22ch" }}
          >
            From noise to signal,
            <br />
            on autopilot.
          </h2>
        </Reveal>

        {/* Asymmetric bento: left cell spans 2 rows, right has 2 stacked smaller cells */}
        <div className="mt-14 lg:mt-16 grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4 lg:gap-5">

          {/* Cell A: Auto Mode (spans full height left column) */}
          <Reveal delay={0.06} className="lg:row-span-2">
            <div
              className="relative rounded-3xl p-8 lg:p-10 flex flex-col h-full overflow-hidden"
              style={{
                background: "#0d1117",
                border: "1px solid rgba(255,255,255,0.06)",
                minHeight: "420px",
              }}
            >
              {/* Ambient glow */}
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse 55% 45% at 20% 85%, rgba(99,102,241,0.13) 0%, transparent 70%)",
                }}
              />

              <div className="relative z-10 flex flex-col h-full">
                {/* Header copy */}
                <div className="mb-auto pb-8">
                  <h3
                    className="font-semibold leading-snug"
                    style={{ color: "#f4f4f5", fontSize: "clamp(1.125rem, 2vw, 1.375rem)" }}
                  >
                    Let the pipeline run itself
                  </h3>
                  <p
                    className="mt-2 text-sm leading-relaxed"
                    style={{ color: "#71717a", maxWidth: "38ch" }}
                  >
                    Flip Auto Mode on and agents handle reading, classifying, and drafting
                    without waiting for a manual trigger.
                  </p>
                </div>

                {/* Main toggle */}
                <div
                  className="flex items-center justify-between px-5 py-4 rounded-2xl mb-2.5"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.09)",
                  }}
                >
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "#f4f4f5" }}>
                      Auto Mode
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#52525b" }}>
                      Process all incoming mail
                    </p>
                  </div>
                  {/* Toggle: ON */}
                  <div
                    className="relative w-11 h-6 rounded-full flex-shrink-0"
                    style={{
                      background: "#6366f1",
                      boxShadow: "0 0 14px rgba(99,102,241,0.45)",
                    }}
                  >
                    <div
                      className="absolute right-1 top-1 w-4 h-4 rounded-full"
                      style={{ background: "#ffffff" }}
                    />
                  </div>
                </div>

                {/* Sub-toggles */}
                {[
                  {
                    label: "Smart escalation",
                    sub: "Urgent threads ping Slack",
                    on: true,
                  },
                  {
                    label: "Auto-send confident drafts",
                    sub: "High-confidence replies only",
                    on: false,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between px-5 py-3.5 rounded-xl mb-2"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: item.on ? "#d4d4d8" : "#52525b" }}
                      >
                        {item.label}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: "#3f3f46" }}>
                        {item.sub}
                      </p>
                    </div>
                    <div
                      className="relative flex-shrink-0 rounded-full"
                      style={{
                        width: "34px",
                        height: "18px",
                        background: item.on ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <div
                        className="absolute top-[2px] rounded-full"
                        style={{
                          width: "14px",
                          height: "14px",
                          background: item.on ? "#c7d2fe" : "#3f3f46",
                          right: item.on ? "2px" : "auto",
                          left: item.on ? "auto" : "2px",
                        }}
                      />
                    </div>
                  </div>
                ))}

                {/* Live stats strip */}
                <div
                  className="mt-4 grid grid-cols-3 rounded-xl overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {[
                    { v: "247", l: "Processed" },
                    { v: "38", l: "Drafted" },
                    { v: "Live", l: "Status", green: true },
                  ].map((s, i) => (
                    <div
                      key={s.l}
                      className="flex flex-col items-center py-3"
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        borderRight: i < 2 ? "1px solid rgba(255,255,255,0.06)" : undefined,
                      }}
                    >
                      <span
                        className="text-sm font-bold"
                        style={{ color: s.green ? "#34d399" : "#f4f4f5" }}
                      >
                        {s.v}
                      </span>
                      <span className="text-[10px] mt-0.5" style={{ color: "#52525b" }}>
                        {s.l}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          {/* Cell B: Before - clutter inbox */}
          <Reveal delay={0.12}>
            <div
              className="rounded-3xl p-6 lg:p-7 h-full"
              style={{ background: "#fafafa", border: "1px solid #ececec" }}
            >
              <div className="flex items-center justify-between mb-4">
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: "#fff1f1", color: "#ef4444" }}
                >
                  Before
                </span>
                <span className="text-xs font-medium text-zinc-300">247 unread</span>
              </div>

              <div className="space-y-1.5">
                {[
                  ["noreply@mailchimp.com", "Weekly digest is here"],
                  ["Sarah Chen", "RE: RE: RE: Budget question"],
                  ["LinkedIn", "12 new notifications"],
                  ["hr@rippling.io", "FWD: Action Required: Benefits"],
                  ["alex@vendor.io", "Following up again..."],
                ].map(([from, sub]) => (
                  <div
                    key={sub}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "#f0f0f0" }}
                  >
                    <div
                      className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                      style={{ background: "#d4d4d8" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate text-zinc-400">{from}</p>
                      <p className="text-[10px] truncate text-zinc-400">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-xs text-zinc-300">
                No priority. Everything looks the same weight.
              </p>
            </div>
          </Reveal>

          {/* Cell C: After - AI-organized inbox */}
          <Reveal delay={0.18}>
            <div
              className="relative rounded-3xl p-6 lg:p-7 h-full overflow-hidden"
              style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div
                aria-hidden
                className="absolute top-0 right-0 w-44 h-44 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle at 80% 15%, rgba(52,211,153,0.09) 0%, transparent 70%)",
                }}
              />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <span
                    className="text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}
                  >
                    After
                  </span>
                  <span className="text-xs font-medium" style={{ color: "#52525b" }}>
                    3 need your attention
                  </span>
                </div>

                <div className="space-y-1.5">
                  {[
                    {
                      from: "Sarah Chen",
                      sub: "Q3 Budget Approval",
                      tag: "Urgent",
                      tc: "#fca5a5",
                      tb: "rgba(239,68,68,0.15)",
                    },
                    {
                      from: "alex@vendorco.io",
                      sub: "Contract Renewal",
                      tag: "Reply",
                      tc: "#93c5fd",
                      tb: "rgba(59,130,246,0.15)",
                    },
                    {
                      from: "Mike Torres",
                      sub: "Partnership Inquiry",
                      tag: "Draft Ready",
                      tc: "#6ee7b7",
                      tb: "rgba(16,185,129,0.12)",
                    },
                  ].map((row) => (
                    <div
                      key={row.sub}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.04)" }}
                    >
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                        style={{ background: row.tb, color: row.tc }}
                      >
                        {row.from[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium truncate" style={{ color: "#d4d4d8" }}>
                          {row.from}
                        </p>
                        <p className="text-[10px] truncate" style={{ color: "#52525b" }}>
                          {row.sub}
                        </p>
                      </div>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                        style={{ background: row.tb, color: row.tc }}
                      >
                        {row.tag}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="mt-4 text-xs" style={{ color: "#3f3f46" }}>
                  Rest archived or handled automatically.
                </p>
              </div>
            </div>
          </Reveal>

        </div>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <>
      <Head>
        <title>Email Orchestrator: AI-Powered Inbox Automation</title>
        <meta
          name="description"
          content="Multi-agent AI that classifies, drafts, and routes every email automatically. Built for B2B teams."
        />
      </Head>

      <div className="min-h-screen bg-white">
        <Navbar />
        <main>
          <HeroSection />
          <WorkFlowSection />
          <RoiMetricsSection />
          <FeatureBentoGrid />
          {/* Phase 3: Pricing, CTA */}
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
