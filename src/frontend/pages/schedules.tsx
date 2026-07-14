import Head from "next/head";
import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import EventList from "@/components/Schedule/EventList";
import EventDetailViewer from "@/components/Schedule/EventDetailViewer";
import EventFormModal, { localInputToIso, type EventFormValues } from "@/components/Schedule/EventFormModal";
import api from "@/lib/axios";
import type { ScheduleEvent, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

function parseAttendees(raw: string): string[] {
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

export default function SchedulesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<ScheduleEvent | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const { data: events, isLoading, error: fetchError, mutate } =
    useSWR<ScheduleEvent[]>("/emails/scheduled-events", fetcher);

  const handleSelect = useCallback((event: ScheduleEvent) => {
    setSelected(event);
  }, []);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const upsertLocal = useCallback(
    (updated: ScheduleEvent) => {
      setSelected(updated);
      mutate((prev) => {
        const exists = prev?.some((e) => e.id === updated.id);
        if (exists) {
          return prev?.map((e) => (e.id === updated.id ? updated : e));
        }
        return [updated, ...(prev ?? [])];
      }, false);
    },
    [mutate],
  );

  if (authError) return null;

  const handleConfirm = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      const { data } = await api.post(`/emails/scheduled-events/${selected.id}/confirm`);
      const updated: ScheduleEvent = {
        ...selected,
        status: "CONFIRMED",
        html_link: data.html_link ?? null,
        meet_link: data.meet_link ?? null,
        is_synced: true,
      };
      upsertLocal(updated);
      showToast("Lịch hẹn đã được xác nhận.", "success");
    } catch {
      showToast("Không thể xác nhận lịch hẹn. Vui lòng thử lại.", "error");
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (!selected) return;
    setCancelling(true);
    try {
      await api.delete(`/emails/scheduled-events/${selected.id}/cancel`);
      const updated: ScheduleEvent = {
        ...selected,
        status: "CANCELLED",
        html_link: null,
        meet_link: null,
        is_synced: false,
      };
      upsertLocal(updated);
      showToast("Lịch hẹn đã được huỷ.", "success");
    } catch {
      showToast("Không thể huỷ lịch hẹn. Vui lòng thử lại.", "error");
    } finally {
      setCancelling(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Xóa lịch hẹn "${selected.title}"?`)) return;
    setDeleting(true);
    const idToRemove = selected.id;
    try {
      await api.delete(`/emails/scheduled-events/${idToRemove}`);
      setSelected(null);
      mutate((prev) => prev?.filter((e) => e.id !== idToRemove), false);
      showToast("Lịch hẹn đã được xóa.", "success");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        // Event no longer exists in DB — remove from local list
        setSelected(null);
        mutate((prev) => prev?.filter((e) => e.id !== idToRemove), false);
        showToast("Lịch hẹn đã được xóa.", "success");
      } else {
        showToast("Không thể xóa lịch hẹn. Vui lòng thử lại.", "error");
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleResolve = async (newTime: string) => {
    if (!selected) return;
    try {
      const { data } = await api.post<ScheduleEvent>(
        `/emails/scheduled-events/${selected.id}/resolve`,
        { newTime },
      );
      upsertLocal(data);
      showToast("Đã chọn khung giờ mới.", "success");
    } catch {
      showToast("Không thể cập nhật khung giờ. Vui lòng thử lại.", "error");
    }
  };

  const handleFormSubmit = async (values: EventFormValues) => {
    setFormSaving(true);
    setFormError(null);
    const payload = {
      title: values.title,
      start_time: localInputToIso(values.startTime),
      end_time: localInputToIso(values.endTime),
      attendees: parseAttendees(values.attendees),
    };

    try {
      if (formMode === "create") {
        const { data } = await api.post<ScheduleEvent>("/emails/scheduled-events", payload);
        upsertLocal(data);
        setSelected(data);
        showToast("Lịch hẹn mới đã được tạo.", "success");
      } else if (formMode === "edit" && selected) {
        const { data } = await api.put<ScheduleEvent>(`/emails/scheduled-events/${selected.id}`, {
          title: payload.title,
          start_time: payload.start_time,
          end_time: payload.end_time,
          attendees: payload.attendees,
        });
        upsertLocal(data);
        showToast("Lịch hẹn đã được cập nhật.", "success");
      }
      setFormMode(null);
    } catch {
      setFormError("Không thể lưu lịch hẹn. Kiểm tra lại thông tin và thử lại.");
    } finally {
      setFormSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Lịch hẹn — Email Orchestrator</title>
      </Head>
      <Layout user={user ?? null}>
        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium shadow-lg transition-all ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {toast.message}
            <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Quản lý lịch hẹn</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Xem, tạo, chỉnh sửa và xác nhận các lịch hẹn được trích xuất từ email.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setFormMode("create");
            }}
            className="btn-primary self-start sm:self-auto"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo lịch hẹn
          </button>
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
                  onCancel={handleCancel}
                  onEdit={() => {
                    setFormError(null);
                    setFormMode("edit");
                  }}
                  onDelete={handleDelete}
                  confirming={confirming}
                  cancelling={cancelling}
                  deleting={deleting}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-20 text-slate-400 text-sm">
                <p>Chọn một lịch hẹn để xem chi tiết hoặc bấm &ldquo;Tạo lịch hẹn&rdquo;.</p>
              </div>
            )}
          </div>
        )}

        <EventFormModal
          mode={formMode === "edit" ? "edit" : "create"}
          event={formMode === "edit" ? selected : null}
          open={formMode !== null}
          saving={formSaving}
          error={formError}
          onClose={() => setFormMode(null)}
          onSubmit={handleFormSubmit}
        />
      </Layout>
    </>
  );
}
