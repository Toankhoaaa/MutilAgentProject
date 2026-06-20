import Link from "next/link";
import { useRouter } from "next/router";
import type { UserProfile } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const MailIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const DatabaseIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const StarIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const RulesIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const AuditIcon = () => (
  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
  </svg>
);

// ── Menu constants ─────────────────────────────────────────────────────────────

const ADMIN_MENU_ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: <ShieldIcon /> },
  { href: "/admin/users", label: "User Management", icon: <UsersIcon /> },
  { href: "/admin/audit", label: "Audit Logs", icon: <AuditIcon /> },
  { href: "/admin/knowledge-base", label: "Knowledge Base", icon: <DatabaseIcon /> },
  { href: "/schedules", label: "Scheduler", icon: <CalendarIcon /> },
];

const USER_MENU_ITEMS: NavItem[] = [
  { href: "/emails", label: "Inbox", icon: <MailIcon /> },
  { href: "/schedules", label: "Schedules", icon: <CalendarIcon /> },
  { href: "/settings/rules", label: "Email Rules", icon: <RulesIcon /> },
  { href: "/knowledge", label: "Knowledge Base", icon: <DatabaseIcon /> },
];

// ── Component ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  user?: UserProfile | null;
}

export default function Sidebar({ user }: SidebarProps) {
  const router = useRouter();
  const isAdmin = user?.is_admin === true;
  const menuItems = isAdmin ? ADMIN_MENU_ITEMS : USER_MENU_ITEMS;

  const isActive = (href: string) =>
    href === "/admin"
      ? router.pathname === "/admin"
      : router.pathname === href || router.pathname.startsWith(href + "/");

  return (
    <aside className={`sidebar${isAdmin ? " sidebar--admin" : ""}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: isAdmin
                  ? "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)"
                  : "linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)",
              }}
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p style={{ color: isAdmin ? "#E2E8F0" : "#1E293B", fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>
                Email
              </p>
              <p style={{ color: isAdmin ? "#818CF8" : "#64748B", fontSize: "0.7rem", lineHeight: 1.2 }}>
                Orchestrator AI
              </p>
            </div>
          </div>
          {isAdmin && <span className="sidebar-admin-badge">Admin</span>}
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <p className="sidebar-section-label">
          {isAdmin ? "System Management" : "Main Menu"}
        </p>
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-item ${isActive(item.href) ? "sidebar-item-active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Upgrade card — regular users only */}
      {!isAdmin && (
        <div className="sidebar-upgrade-card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem" }}>
            <span style={{ color: "#3B82F6" }}><StarIcon /></span>
            <h4>Upgrade to PRO</h4>
          </div>
          <p>Unlock advanced AI features and unlimited processing</p>
          <a href="#" className="sidebar-upgrade-btn">Upgrade Account</a>
        </div>
      )}

      {/* Footer */}
      <div className="sidebar-footer">
        {user ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: isAdmin
                  ? "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)"
                  : "linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)",
              }}
            >
              <span style={{ color: "white", fontSize: "0.6875rem", fontWeight: 700 }}>
                {user.display_name
                  ? user.display_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
                  : user.email[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: isAdmin ? "#E2E8F0" : "#1E293B",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {user.display_name ?? user.email.split("@")[0]}
              </p>
              <p style={{
                fontSize: "0.6875rem",
                color: "#94A3B8",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {user.email}
              </p>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: "0.6875rem", color: "#94A3B8", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Multi-Agent AI
          </div>
        )}
      </div>
    </aside>
  );
}
