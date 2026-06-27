import { useRouter } from "next/router";
import Link from "next/link";
import { Moon, Bell, LogOut } from "lucide-react";
import type { UserProfile } from "@/lib/types";

interface TopbarProps {
  user: UserProfile | null;
}

function getInitials(user: UserProfile): string {
  if (user.display_name) {
    return user.display_name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return user.email[0].toUpperCase();
}

const channelTabs = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Emails", href: "/emails" },
  { label: "Schedules", href: "/schedules" },
];

export default function Topbar({ user }: TopbarProps) {
  const router = useRouter();

  const handleLogout = () => {
    if (user?.id) {
      try { sessionStorage.removeItem(`inbox_${user.id}`); } catch {}
    }
    window.location.href = "/api/v1/auth/logout";
  };

  const getGreeting = () => {
    const name = user?.display_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";
    return `Welcome back, ${name}`;
  };

  return (
    <header className="topbar">
      {/* Top row: page title + actions */}
      <div className="topbar-inner">
        <div className="flex items-center gap-2">
          <h1 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-ink)", margin: 0, letterSpacing: "-0.3px" }}>
            {channelTabs.find((t) => t.href === router.pathname)?.label ?? "Email Orchestrator"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Icon buttons */}
          <button className="topbar-icon-btn" title="Toggle dark mode" aria-label="Toggle dark mode">
            <Moon size={15} strokeWidth={1.75} />
          </button>
          <button className="topbar-icon-btn" title="Notifications" aria-label="Notifications">
            <Bell size={15} strokeWidth={1.75} />
          </button>

          {/* Separator */}
          <div style={{ width: 1, height: 24, background: "#E8EBF0", margin: "0 0.25rem" }} />

          {/* User greeting + avatar */}
          {user && (
            <div className="flex items-center gap-2.5">
              <div className="hidden sm:block text-right">
                <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#1E293B", lineHeight: 1.2 }}>
                  {getGreeting()}
                </p>
                <p style={{ fontSize: "0.6875rem", color: "#94A3B8", lineHeight: 1.2 }}>{user.email}</p>
              </div>
              <div className="avatar">
                {getInitials(user)}
              </div>
            </div>
          )}

          {/* Logout */}
          <button onClick={handleLogout} className="btn-logout">
            <LogOut size={15} strokeWidth={1.75} />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>

      {/* Channel tabs row */}
      <div className="topbar-tabs">
        {channelTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`channel-tab ${router.pathname === tab.href ? "channel-tab-active" : ""}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
