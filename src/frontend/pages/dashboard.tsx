import { useEffect } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import api from "@/lib/axios";
import type { UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function DashboardPage() {
  const router = useRouter();
  const { data: user, error } = useSWR<UserProfile>("/auth/me", fetcher, {
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (error) {
      router.replace("/login");
    } else if (user) {
      router.replace(user.is_admin ? "/admin" : "/emails");
    }
  }, [user, error, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    </div>
  );
}
