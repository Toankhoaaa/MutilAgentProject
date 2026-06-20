export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  is_admin: boolean;
}

export interface AdminUserStats {
  total: number;
  active: number;
  suspended: number;
  premium: number;
}

export interface Classification {
  id: string;
  email_id: string;
  category: string | null;
  priority_score: number | null;
  summary: string | null;
  deadline: string | null;
  confidence: number | null;
  created_at: string;
}

export interface Draft {
  id: string;
  email_id: string;
  draft_content: string;
  draft_gmail_id: string | null;
  subject: string | null;
  is_modified: boolean | null;
  is_sent: boolean | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Email {
  id: string;
  user_id: string;
  gmail_message_id: string;
  thread_id: string | null;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  body_html: string | null;
  received_at: string | null;
  is_processed: boolean;
  processed_at: string | null;
  labels: string[] | null;
  created_at: string;
  updated_at: string;
  classification: Classification | null;
  draft: Draft | null;
  scheduling: SchedulingData | null;
  is_safe?: boolean;
  security_risk_level?: string | null;
  security_warnings?: string[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface OverviewStats {
  total_processed: number;
  urgent_count: number;
  drafts_created: number;
  time_saved_minutes: number;
}

export interface CategoryCountItem {
  category: string;
  count: number;
}

export interface CategoryDistribution {
  items: CategoryCountItem[];
}

export interface AgentRunDetail {
  id: string;
  run_type: string | null;
  triggered_by: string | null;
  total_emails_processed: number | null;
  total_time_ms: number | null;
  llm_calls_count: number | null;
  llm_total_time_ms: number | null;
  status: string | null;
  error_message: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface AgentStatus {
  system_status: 'idle' | 'running' | 'degraded';
  latest_run: AgentRunDetail | null;
  message: string | null;
}

export interface GmailEmailItem {
  gmail_message_id: string;
  thread_id: string | null;
  subject: string | null;
  sender: string | null;
  date: string | null;
  snippet: string | null;
}

export interface EventDetails {
  event_title: string | null;
  start_time: string | null;
  end_time: string | null;
  attendees: string[];
}

export interface AnalyzeEmailResponse {
  summary: string[];
  sentiment: string;
  action_items: string[];
  translation: string | null;
  detected_language: string;
  has_event: boolean;
  event_details: EventDetails | null;
  scheduling_id: string | null;
  is_safe: boolean;
  risk_level: "low" | "medium" | "high";
  warnings: string[];
}

export interface InboxEmailState extends GmailEmailItem {
  analysis: AnalyzeEmailResponse | null;
  isAnalyzing: boolean;
  category: string | null;
  priority_score: number | null;
}

export interface ProcessedEmailDetail {
  gmail_message_id: string;
  subject: string | null;
  sender: string | null;
  category: string;
  priority_score: number;
  summary: string;
  confidence: number;
  draft_subject: string | null;
  has_draft: boolean;
  is_safe?: boolean;
  security_risk_level?: string | null;
  security_warnings?: string[];
}

export interface ProcessEmailsResult {
  fetched: number;
  processed: number;
  skipped_duplicate: number;
  failed: number;
  drafts_created: number;
  run_id: string | null;
  llm_calls_count: number;
  llm_total_time_ms: number;
  total_time_ms: number;
  errors: Record<string, unknown>[];
  processed_emails: ProcessedEmailDetail[];
}

export interface SchedulerStatus {
  is_running: boolean;
  interval_minutes: number;
  next_run_at: string | null;
  last_run_at: string | null;
}

export interface SchedulingData {
  id: string;
  email_id: string;
  is_meeting_request: boolean;
  start_datetime: string | null;
  end_datetime: string | null;
  event_summary: string | null;
  suggested_reply: string | null;
  calendar_event_id: string | null;
  calendar_html_link: string | null;
  meet_link: string | null;
  event_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventResult {
  message: string;
  event_id: string | null;
  html_link: string | null;
  meet_link: string | null;
  is_available: boolean;
}

export interface EmailAnalysisResult {
  id: string;
  email_id: string;
  detected_language: string;
  summary: string[];
  translation: string | null;
  action_items: string[];
  sentiment: "Positive" | "Neutral" | "Negative";
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: number;
  user_id: string | null;
  email_id: string | null;
  agent_name: string | null;
  action: string | null;
  status: string | null;
  details: Record<string, unknown> | unknown[] | null;
  ip_address: string | null;
  created_at: string;
}

export interface UserActivityResponse {
  emails_processed: number;
  drafts_created: number;
  last_active_at: string | null;
  recent_logs: AuditLogEntry[];
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  is_admin: boolean;
  subscription_tier: string;
  max_requests: number;
  request_count: number;
  status: string;
  tier_expires_at: string | null;
  created_at: string;
}

export interface AdminUserListResponse {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface ScheduleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  status: 'PENDING' | 'CONFIRMED' | 'CONFLICT' | 'CANCELLED';
  emailSnippet: string;
  alternativeSlots: string[];
  html_link?: string | null;
  meet_link?: string | null;
  is_synced?: boolean;
}

export interface KnowledgeDocument {
  id: string;
  filename: string;
  source_email: string | null;
  ai_summary: string | null;
  notes: string | null;
  chroma_collection_id: string | null;
  chunk_count: number | null;
  status: 'processing' | 'ready' | 'failed';
  upload_date: string;
}

export interface KnowledgeListResponse {
  items: KnowledgeDocument[];
  total: number;
}

export type RuleField = 'sender' | 'subject' | 'body' | 'sender_domain';
export type RuleOperator = 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'not_contains' | 'regex';
export type RuleAction = 'force_category' | 'skip_ai' | 'trash' | 'alert' | 'skip_draft';
export type ForcedCategory = 'urgent' | 'important' | 'need_reply' | 'newsletter' | 'spam';

export interface EmailRule {
  id: string;
  user_id: string;
  name: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
  action: RuleAction;
  action_value: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  match_count: number;
}
