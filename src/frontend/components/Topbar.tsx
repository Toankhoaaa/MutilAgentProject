import { useRouter } from "next/router";
import Link from "next/link";
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

const MoonIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
  </svg>
);

const BellIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const LogoutIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

const channelTabs = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Emails", href: "/emails" },
  { label: "Schedules", href: "/schedules" },
];

export default function Topbar({ user }: TopbarProps) {
  const router = useRouter();

  const handleLogout = () => {
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
          <h1 style={{ fontSize: "1rem", fontWeight: 700, color: "#1E293B", margin: 0 }}>
            {channelTabs.find((t) => t.href === router.pathname)?.label ?? "Email Orchestrator"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Icon buttons */}
          <button className="topbar-icon-btn" title="Toggle dark mode" aria-label="Toggle dark mode">
            <MoonIcon />
          </button>
          <button className="topbar-icon-btn" title="Notifications" aria-label="Notifications">
            <BellIcon />
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
            <LogoutIcon />
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
