import { useRouter } from "next/router";
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

export default function Topbar({ user }: TopbarProps) {
  const router = useRouter();

  const handleLogout = () => {
    window.location.href = "/api/v1/auth/logout";
  };

  const getPageTitle = () => {
    switch (router.pathname) {
      case "/dashboard": return "Dashboard";
      default: return "Email Orchestrator";
    }
  };

  return (
    <header className="topbar">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-800">{getPageTitle()}</h1>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-700 leading-tight">
                {user.display_name ?? user.email}
              </p>
              <p className="text-xs text-slate-400 leading-tight">{user.email}</p>
            </div>
            <div className="avatar">
              {getInitials(user)}
            </div>
          </div>
        )}
        <button onClick={handleLogout} className="btn-logout">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
