import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
    >
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        strokeLinecap="round"
        strokeWidth={2}
      />
    </svg>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
      <BotAvatar />
      <div
        style={{
          padding: "0.5625rem 0.875rem",
          background: "#F0F2F5",
          borderRadius: "1rem 1rem 1rem 0.25rem",
          display: "flex",
          gap: "0.25rem",
          alignItems: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#94A3B8",
              display: "block",
              animation: "typing-dot 1.4s ease infinite",
              animationDelay: `${i * 0.16}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function BotAvatar() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        flexShrink: 0,
        background: "var(--color-canvas-soft-2)",
        border: "1px solid var(--color-hairline)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="13" height="13" fill="none" stroke="var(--color-body)" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  isTyping = false,
}: {
  role: "user" | "assistant";
  content: string;
  isTyping?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        gap: "0.5rem",
        alignItems: "flex-end",
      }}
    >
      {!isUser && <BotAvatar />}
      <div
        style={{
          maxWidth: "75%",
          padding: "0.5625rem 0.75rem",
          borderRadius: isUser
            ? "1rem 1rem 0.25rem 1rem"
            : "1rem 1rem 1rem 0.25rem",
          background: isUser ? "var(--color-ink)" : "#F0F2F5",
          color: isUser ? "#fff" : "#1E293B",
          fontSize: "0.875rem",
          lineHeight: 1.55,
          wordBreak: "break-word",
        }}
      >
        {isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isTyping && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1em",
                  background: "var(--color-ink)",
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Widget ─────────────────────────────────────────────────────────────

export default function ChatboxWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  // typingText drives the typewriter; typingDisplay is the visible slice
  const [typingText, setTypingText] = useState<string | null>(null);
  const [typingDisplay, setTypingDisplay] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll on every update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingDisplay, statusText]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [isOpen]);

  // Typewriter effect — driven by typingText changes
  useEffect(() => {
    if (typingText === null) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypingDisplay(typingText.slice(0, i));
      if (i >= typingText.length) {
        clearInterval(interval);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: typingText },
        ]);
        setTypingText(null);
        setTypingDisplay("");
        setIsLoading(false);
        setStatusText(null);
      }
    }, 8);
    return () => clearInterval(interval);
  }, [typingText]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setIsLoading(true);
    setStatusText(null);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    let receivedToken = false;

    try {
      const resp = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
        credentials: "include",
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        throw new Error(`Server error (HTTP ${resp.status})`);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "status") {
              setStatusText(ev.text);
            } else if (ev.type === "token") {
              receivedToken = true;
              setStatusText(null);
              setTypingText(ev.text);
            } else if (ev.type === "error") {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: `Something went wrong: ${ev.text}` },
              ]);
              setIsLoading(false);
              setStatusText(null);
            } else if (ev.type === "done" && !receivedToken) {
              setIsLoading(false);
              setStatusText(null);
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't reach the server. Please try again.",
        },
      ]);
      setIsLoading(false);
      setStatusText(null);
    }
  }, [input, isLoading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    setIsOpen(false);
  };

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <>
      {/* ── Chat panel ──────────────────────────────────────────────── */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            bottom: "82px",
            right: "24px",
            width: "384px",
            maxHeight: "520px",
            background: "#ffffff",
            border: "1px solid var(--color-hairline)",
            borderRadius: "0.75rem",
            boxShadow: "0 4px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            zIndex: 199,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              background: "var(--color-canvas)",
              borderBottom: "1px solid var(--color-hairline)",
              padding: "0.875rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--color-canvas-soft-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="white"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>

            <div style={{ flex: 1 }}>
              <p
                style={{
                  color: "var(--color-ink)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                AI Assistant
              </p>
              <p
                style={{
                  color: "var(--color-mute)",
                  fontSize: "0.6875rem",
                  margin: 0,
                  lineHeight: 1.3,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: isLoading ? "#FCD34D" : "#34D399",
                    flexShrink: 0,
                  }}
                />
                {isLoading ? "Working..." : "Online · Ready to help"}
              </p>
            </div>

            <button
              onClick={handleClose}
              style={{
                background: "var(--color-canvas-soft-2)",
                border: "1px solid var(--color-hairline)",
                borderRadius: "0.375rem",
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--color-mute)",
                flexShrink: 0,
              }}
              title="Close"
            >
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Messages area */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              minHeight: 0,
            }}
          >
            {/* Empty state */}
            {isEmpty && (
              <div
                style={{
                  margin: "auto 0",
                  textAlign: "center",
                  padding: "1.5rem 1rem",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    margin: "0 auto 0.75rem",
                    background: "var(--color-canvas-soft-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    width="22"
                    height="22"
                    fill="none"
                    stroke="var(--color-body)"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p
                  style={{
                    color: "#1E293B",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    margin: "0 0 0.375rem",
                  }}
                >
                  How can I help you?
                </p>
                <p
                  style={{
                    color: "#94A3B8",
                    fontSize: "0.75rem",
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  Share a job link, search your inbox,
                  <br />
                  or ask me to draft a reply.
                </p>
              </div>
            )}

            {/* Committed messages */}
            {messages.map((msg, i) => (
              <MessageBubble key={i} role={msg.role} content={msg.content} />
            ))}

            {/* Live typewriter bubble */}
            {typingText !== null && (
              <MessageBubble
                role="assistant"
                content={typingDisplay}
                isTyping
              />
            )}

            {/* Tool-call status pill */}
            {statusText && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    padding: "0.3125rem 0.75rem",
                    background: "var(--color-canvas-soft-2)",
                    border: "1px solid var(--color-hairline)",
                    borderRadius: "9999px",
                    fontSize: "0.75rem",
                    color: "var(--color-mute)",
                    fontStyle: "italic",
                  }}
                >
                  <Spinner />
                  {statusText}
                </div>
              </div>
            )}

            {/* Typing dots (while waiting for first response) */}
            {isLoading && !statusText && typingText === null && <TypingDots />}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            style={{
              padding: "0.75rem",
              borderTop: "1px solid var(--color-hairline)",
              display: "flex",
              gap: "0.5rem",
              alignItems: "flex-end",
              flexShrink: 0,
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything… (Enter to send)"
              rows={1}
              disabled={isLoading}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid var(--color-hairline)",
                borderRadius: "0.375rem",
                padding: "0.5625rem 0.75rem",
                fontSize: "0.875rem",
                fontFamily: "inherit",
                color: "var(--color-ink)",
                background: isLoading ? "var(--color-canvas-soft-2)" : "#fff",
                outline: "none",
                lineHeight: 1.5,
                maxHeight: "120px",
                overflowY: "auto",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--color-ink)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--color-hairline)";
              }}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              style={{
                width: 36,
                height: 36,
                borderRadius: "0.625rem",
                border: "none",
                background: isLoading || !input.trim() ? "var(--color-canvas-soft-2)" : "var(--color-ink)",
                color: isLoading || !input.trim() ? "var(--color-mute)" : "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
              title="Send (Enter)"
            >
              <svg
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Toggle button ────────────────────────────────────────────── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          background: isOpen ? "var(--color-canvas)" : "var(--color-ink)",
          border: isOpen ? "1px solid var(--color-hairline)" : "none",
          color: isOpen ? "var(--color-ink)" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)",
          zIndex: 200,
          transition: "all 0.2s",
          flexShrink: 0,
        }}
        title={isOpen ? "Close AI Assistant" : "Open AI Assistant"}
      >
        {isOpen ? (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        )}

        {/* Unread indicator when panel is closed and has messages */}
        {!isOpen && messages.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#EF4444",
              border: "2px solid #fff",
            }}
          />
        )}
      </button>
    </>
  );
}
