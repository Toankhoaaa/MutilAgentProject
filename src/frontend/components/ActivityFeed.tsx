import { useState } from "react";
import type { AgentStatus } from "@/lib/types";

interface ActivityFeedProps {
  agentStatus?: AgentStatus | null;
}

interface ActivityItem {
  id: string;
  initials: string;
  avatarColor: string;
  action: string;
  time: string;
}

// Generate activity feed items from agent status + static seed data
function buildFeedItems(agentStatus?: AgentStatus | null): ActivityItem[] {
  const items: ActivityItem[] = [
    {
      id: "1",
      initials: "AI",
      avatarColor: "linear-gradient(135deg, #3B82F6, #6366F1)",
      action: "AI Agent processed incoming emails",
      time: "2 mins ago",
    },
    {
      id: "2",
      initials: "SC",
      avatarColor: "linear-gradient(135deg, #10B981, #059669)",
      action: "Scheduler triggered automatic email fetch",
      time: "15 mins ago",
    },
    {
      id: "3",
      initials: "AI",
      avatarColor: "linear-gradient(135deg, #3B82F6, #6366F1)",
      action: "Draft reply created for urgent email",
      time: "32 mins ago",
    },
    {
      id: "4",
      initials: "KB",
      avatarColor: "linear-gradient(135deg, #F59E0B, #D97706)",
      action: "Knowledge base context retrieved",
      time: "1h ago",
    },
    {
      id: "5",
      initials: "SC",
      avatarColor: "linear-gradient(135deg, #10B981, #059669)",
      action: "Scheduled run completed successfully",
      time: "2h ago",
    },
  ];

  // Prepend real agent status info if available
  if (agentStatus?.latest_run) {
    const run = agentStatus.latest_run;
    const processed = run.total_emails_processed;
    const llm = run.llm_calls_count;
    const durationSec = run.total_time_ms ? (run.total_time_ms / 1000).toFixed(1) : null;

    if (processed !== undefined || llm !== undefined) {
      items.unshift({
        id: "live",
        initials: "AI",
        avatarColor: "linear-gradient(135deg, #3B82F6, #6366F1)",
        action: `Processed ${processed ?? 0} emails, ${llm ?? 0} LLM calls${durationSec ? ` in ${durationSec}s` : ""}`,
        time: "Just now",
      });
    }
  }

  return items;
}

const mentionItems: ActivityItem[] = [
  {
    id: "m1",
    initials: "EM",
    avatarColor: "linear-gradient(135deg, #F43F5E, #E11D48)",
    action: "Urgent email flagged for your attention",
    time: "5 mins ago",
  },
  {
    id: "m2",
    initials: "EM",
    avatarColor: "linear-gradient(135deg, #F59E0B, #D97706)",
    action: "Important email requires a reply",
    time: "1h ago",
  },
  {
    id: "m3",
    initials: "EM",
    avatarColor: "linear-gradient(135deg, #3B82F6, #6366F1)",
    action: "Meeting request pending scheduling",
    time: "3h ago",
  },
];

export default function ActivityFeed({ agentStatus }: ActivityFeedProps) {
  const [activeTab, setActiveTab] = useState<"feed" | "mentions">("feed");

  const feedItems = buildFeedItems(agentStatus);
  const displayItems = activeTab === "feed" ? feedItems : mentionItems;

  return (
    <div className="activity-feed-panel" style={{ minHeight: 400 }}>
      {/* Header */}
      <div className="activity-feed-header">
        <h2 className="activity-feed-title">Activity</h2>
        <div className="activity-feed-tabs">
          <button
            className={`activity-tab ${activeTab === "feed" ? "activity-tab-active" : ""}`}
            onClick={() => setActiveTab("feed")}
          >
            Activity feed
          </button>
          <button
            className={`activity-tab ${activeTab === "mentions" ? "activity-tab-active" : ""}`}
            onClick={() => setActiveTab("mentions")}
          >
            Mentions
          </button>
        </div>
      </div>

      {/* Feed list */}
      <div className="activity-feed-list">
        {displayItems.map((item) => (
          <div key={item.id} className="activity-item">
            {/* Avatar */}
            <div
              className="activity-avatar"
              style={{ background: item.avatarColor, minWidth: 36 }}
            >
              {item.initials}
            </div>

            {/* Content */}
            <div className="activity-content">
              <p className="activity-action">{item.action}</p>
              <p className="activity-time">{item.time}</p>
            </div>
          </div>
        ))}

        {displayItems.length === 0 && (
          <div style={{ padding: "2rem", textAlign: "center", color: "#94A3B8", fontSize: "0.8125rem" }}>
            No activity yet.
          </div>
        )}
      </div>
    </div>
  );
}
