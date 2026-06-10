import Head from "next/head";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import UserManagement from "@/components/UserManagement";
import api from "@/lib/axios";
import type { UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function AdminUsersPage() {
  const router = useRouter();

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  if (authError) return null;

  return (
    <>
      <Head>
        <title>User Management — Admin</title>
      </Head>
      <Layout user={user ?? null}>
        <UserManagement />
      </Layout>
    </>
  );
}
