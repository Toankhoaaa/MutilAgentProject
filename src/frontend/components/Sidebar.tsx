import Link from "next/link";
import { useRouter } from "next/router";
import type { UserProfile } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const LayoutGridIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
);

const MailIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const CpuIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 3H7a2 2 0 00-2 2v2M9 3h6M9 3v18m6-18h2a2 2 0 012 2v2m0 0V7m0 0h-6m6 0v10m0 0v2a2 2 0 01-2 2h-2m0 0H9m6 0v-6M9 21H7a2 2 0 01-2-2v-2m0 0V15m0-6H5" />
  </svg>
);

const ChartIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const DatabaseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
  </svg>
);

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutGridIcon /> },
  { href: "/dashboard#emails", label: "Emails", icon: <MailIcon /> },
  { href: "/dashboard#agents", label: "Agent Status", icon: <CpuIcon /> },
  { href: "/dashboard#analytics", label: "Analytics", icon: <ChartIcon /> },
];

const adminNavItems: NavItem[] = [
  { href: "/admin/knowledge-base", label: "Knowledge Base", icon: <DatabaseIcon /> },
];

interface SidebarProps {
  user?: UserProfile | null;
}

export default function Sidebar({ user }: SidebarProps) {
  const router = useRouter();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Email</p>
            <p className="text-indigo-300 text-xs leading-tight">Orchestrator</p>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <p className="sidebar-section-label">Main Menu</p>
        {navItems.map((item) => {
          const isActive = router.pathname === item.href.split("#")[0];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
        <p className="sidebar-section-label mt-4">Admin</p>
        {adminNavItems.map((item) => {
          const isActive = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {user ? (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">
                {user.display_name
                  ? user.display_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
                  : user.email[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-300 truncate leading-tight">
                {user.display_name ?? user.email.split("@")[0]}
              </p>
              <p className="text-[10px] text-slate-500 truncate leading-tight">{user.email}</p>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-slate-600 text-center uppercase tracking-widest">
            Multi-Agent AI
          </div>
        )}
      </div>
    </aside>
  );
}
