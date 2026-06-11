import Head from "next/head";
import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import EventList from "@/components/Schedule/EventList";
import EventDetailViewer from "@/components/Schedule/EventDetailViewer";
import api from "@/lib/axios";
import type { ScheduleEvent, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function SchedulesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<ScheduleEvent | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const { data: events, isLoading, error: fetchError, mutate } =
    useSWR<ScheduleEvent[]>("/emails/scheduled-events", fetcher);

  if (authError) return null;

  const handleSelect = useCallback((event: ScheduleEvent) => {
    setSelected(event);
  }, []);

  const handleConfirm = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      await api.post(`/emails/scheduled-events/${selected.id}/confirm`);
      const updated: ScheduleEvent = { ...selected, status: "CONFIRMED" };
      setSelected(updated);
      mutate((prev) => prev?.map((e) => (e.id === selected.id ? updated : e)), false);
    } catch {
      // status remains unchanged; user can retry
    } finally {
      setConfirming(false);
    }
  };

  const handleResolve = async (newTime: string) => {
    if (!selected) return;
    try {
      await api.post(`/schedules/${selected.id}/resolve`, { newTime });
      const updated: ScheduleEvent = { ...selected, startTime: newTime, status: "PENDING" };
      setSelected(updated);
      mutate((prev) => prev?.map((e) => (e.id === selected.id ? updated : e)), false);
    } catch {
      // status remains unchanged; user can retry
    }
  };

  return (
    <>
      <Head>
        <title>Lịch hẹn — Email Orchestrator</title>
      </Head>
      <Layout user={user ?? null}>
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Quản lý lịch hẹn</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Xem và xác nhận các lịch hẹn được trích xuất từ email.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Đang tải lịch hẹn...
          </div>
        )}

        {fetchError && !isLoading && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm max-w-md">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Không thể tải dữ liệu lịch hẹn. Vui lòng thử lại.
          </div>
        )}

        {!isLoading && !fetchError && (
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            <div className="w-full sm:w-auto sm:flex-shrink-0">
              <EventList
                events={events ?? []}
                selectedId={selected?.id}
                onSelect={handleSelect}
              />
            </div>

            {selected ? (
              <div className="w-full sm:flex-1">
                <EventDetailViewer
                  event={selected}
                  onConfirm={handleConfirm}
                  onResolve={handleResolve}
                  confirming={confirming}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-20 text-slate-400 text-sm">
                <p>Chọn một lịch hẹn để xem chi tiết.</p>
              </div>
            )}
          </div>
        )}
      </Layout>
    </>
  );
}
