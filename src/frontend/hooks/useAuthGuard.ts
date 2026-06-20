import { useEffect } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import api from "@/lib/axios";
import type { UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

/**
 * Fetch the current session user and enforce route-level access control.
 *
 * - Unauthenticated requests (401) are redirected to /login.
 * - When requireAdmin is true, non-admin users are redirected to /emails.
 *
 * Returns `isLoading: true` while the session is being resolved or a redirect
 * is in progress, so callers can render null/skeleton and avoid flickering.
 */
export function useAuthGuard(requireAdmin = false) {
  const router = useRouter();
  const { data: user, error, isLoading } = useSWR<UserProfile>("/auth/me", fetcher, {
    revalidateOnFocus: false,
  });

  const isRedirecting = !!(error || (user && requireAdmin && !user.is_admin));

  useEffect(() => {
    if (error) {
      router.replace("/login");
    } else if (user && requireAdmin && !user.is_admin) {
      router.replace("/emails");
    }
  }, [user, error, requireAdmin, router]);

  return {
    user: user ?? null,
    isLoading: isLoading || isRedirecting,
  };
}
