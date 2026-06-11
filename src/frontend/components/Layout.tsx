import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import ChatboxWidget from "./ChatboxWidget";
import type { UserProfile } from "@/lib/types";

interface LayoutProps {
  children: ReactNode;
  user: UserProfile | null;
}

export default function Layout({ children, user }: LayoutProps) {
  return (
    <div className="app-shell">
      <Sidebar user={user} />
      <div className="main-area">
        <Topbar user={user} />
        <main className="page-content">{children}</main>
      </div>
      <ChatboxWidget />
    </div>
  );
}
