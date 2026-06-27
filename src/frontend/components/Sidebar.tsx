import Link from "next/link";
import { useRouter } from "next/router";
import {
  Mail, Database, Calendar, Users, ListFilter,
  ClipboardCheck, Building2, Shield, ClipboardList, Zap,
} from "lucide-react";
import type { UserProfile } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// ── Menu constants ─────────────────────────────────────────────────────────────

const ADMIN_MENU_ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: <Shield size={16} strokeWidth={1.75} /> },
  { href: "/admin/users", label: "User Management", icon: <Users size={16} strokeWidth={1.75} /> },
  { href: "/admin/audit", label: "Audit Logs", icon: <ClipboardList size={16} strokeWidth={1.75} /> },
  { href: "/admin/knowledge-base", label: "Knowledge Base", icon: <Database size={16} strokeWidth={1.75} /> },
  { href: "/schedules", label: "Scheduler", icon: <Calendar size={16} strokeWidth={1.75} /> },
];

const USER_MENU_ITEMS: NavItem[] = [
  { href: "/emails", label: "Inbox", icon: <Mail size={16} strokeWidth={1.75} /> },
  { href: "/tasks", label: "Công việc", icon: <ClipboardCheck size={16} strokeWidth={1.75} /> },
  { href: "/schedules", label: "Schedules", icon: <Calendar size={16} strokeWidth={1.75} /> },
  { href: "/settings/rules", label: "Email Rules", icon: <ListFilter size={16} strokeWidth={1.75} /> },
  { href: "/knowledge", label: "Knowledge Base", icon: <Database size={16} strokeWidth={1.75} /> },
  { href: "/departments", label: "Phòng ban", icon: <Building2 size={16} strokeWidth={1.75} /> },
  { href: "/settings/delegation", label: "Cấu hình phân công", icon: <ListFilter size={16} strokeWidth={1.75} /> },
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
            <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 sidebar-logo-icon">
              <Zap size={15} strokeWidth={2} />
            </div>
            <div>
              <p style={{ color: isAdmin ? "#f0f0f0" : "var(--color-ink)", fontWeight: 600, fontSize: "0.9rem", lineHeight: 1.2 }}>
                Email
              </p>
              <p style={{ color: isAdmin ? "#888888" : "var(--color-mute)", fontSize: "0.7rem", lineHeight: 1.2 }}>
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
          {isAdmin ? "System" : "Main Menu"}
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

      {/* Footer */}
      <div className="sidebar-footer">
        {user ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--color-body)" }}
            >
              <span style={{ color: "white", fontSize: "0.6875rem", fontWeight: 600 }}>
                {user.display_name
                  ? user.display_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
                  : user.email[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: isAdmin ? "#f0f0f0" : "var(--color-ink)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {user.display_name ?? user.email.split("@")[0]}
              </p>
              <p style={{
                fontSize: "0.6875rem",
                color: "var(--color-mute)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {user.email}
              </p>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: "0.6875rem", color: "var(--color-mute)", textAlign: "center", fontFamily: "var(--font-mono)" }}>
            Multi-Agent AI
          </div>
        )}
      </div>
    </aside>
  );
}
