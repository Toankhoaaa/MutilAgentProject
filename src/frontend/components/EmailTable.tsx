import type { ProcessedEmailDetail } from "@/lib/types";

const CATEGORY_STYLES: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  important: "bg-orange-100 text-orange-700",
  need_reply: "bg-blue-100 text-blue-700",
  newsletter: "bg-zinc-100 text-zinc-600",
  spam: "bg-zinc-200 text-zinc-500",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_STYLES[category.toLowerCase()] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {category}
    </span>
  );
}

interface Props {
  emails: ProcessedEmailDetail[];
  onSelect: (email: ProcessedEmailDetail) => void;
}

export default function EmailTable({ emails, onSelect }: Props) {
  return (
    <div className="divide-y divide-zinc-100 -mx-4 sm:mx-0 sm:rounded-lg sm:border sm:border-zinc-100 overflow-hidden">
      {emails.map((item) => {
        // Use explicit === false so undefined (legacy data) is treated as safe
        const isHighRisk = item.is_safe === false || item.security_risk_level === "high";
        const isMediumRisk = !isHighRisk && item.security_risk_level === "medium";

        return (
          <div
            key={item.gmail_message_id}
            onClick={() => onSelect(item)}
            className={[
              "px-4 py-3 bg-white hover:bg-zinc-50 transition-colors cursor-pointer",
              isHighRisk ? "border-l-4 border-l-red-500" : isMediumRisk ? "border-l-4 border-l-amber-400" : "",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {isHighRisk && (
                    <span className="shrink-0 inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-1.5 py-0.5 rounded border border-red-200">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd" />
                      </svg>
                      PHISHING
                    </span>
                  )}
                  {isMediumRisk && (
                    <span className="shrink-0 inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 rounded border border-amber-200">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      SUSPICIOUS
                    </span>
                  )}
                  <p className="text-sm font-medium text-zinc-800 truncate">
                    {item.subject || "(no subject)"}
                  </p>
                </div>
                <p className="text-xs text-zinc-400 truncate mt-0.5">{item.sender || "—"}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <CategoryBadge category={item.category} />
                <span className="text-xs text-zinc-400">P{item.priority_score}</span>
                {item.has_draft && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Draft
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-zinc-500 line-clamp-2">{item.summary}</p>
            {item.draft_subject && (
              <p className="text-xs text-zinc-400 mt-1 italic">Nháp: {item.draft_subject}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
