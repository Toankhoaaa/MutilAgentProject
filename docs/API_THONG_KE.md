# Thống kê API — Multi-Agent Email Orchestrator

> **Ngày tạo:** 24/05/2026  
> **Phiên bản hệ thống:** 1.0.0  
> **Framework:** FastAPI (Python)  
> **Base URL API v1:** `/api/v1`  
> **Tài liệu tương tác:** `/docs` (Swagger UI), `/redoc` (ReDoc), `/openapi.json`

---

## 1. Tổng quan

| Chỉ số | Giá trị |
|--------|---------|
| Tổng endpoint REST | **22** |
| Endpoint WebSocket | **1** |
| **Tổng cộng** | **23** |
| Nhóm router | 7 (+ Root/Health) |
| Prefix API chính | `/api/v1` |
| Định dạng lỗi chuẩn | JSON `{ success: false, error: { type, message, details? } }` |

### Phân bổ theo HTTP Method

| Method | Số lượng | Tỷ lệ |
|--------|----------|-------|
| GET | 12 | 52.2% |
| POST | 4 | 17.4% |
| PUT | 6 | 26.1% |
| WebSocket | 1 | — |

### Phân bổ theo nhóm chức năng

| Nhóm | Tag OpenAPI | Số endpoint | File nguồn |
|------|-------------|-------------|------------|
| Root & Health | Root, Health | 2 | `app/main.py` |
| Xác thực | Authentication | 3 | `app/api/routers/auth.py` |
| Email | Emails | 7 | `app/api/routers/emails.py` |
| Agent AI | Agents | 3 | `app/api/routers/agents.py` |
| Cấu hình | Configuration | 4 | `app/api/routers/config.py` |
| Audit | Audit Logs | 1 | `app/api/routers/audit.py` |
| Thống kê | Analytics | 2 | `app/api/routers/stats.py` |
| Real-time | WebSocket | 1 | `app/api/routers/websockets.py` |

### Yêu cầu xác thực (JWT Bearer)

| Loại | Số endpoint | Ghi chú |
|------|-------------|---------|
| Không yêu cầu auth | 15 | Public, OAuth callback, test agents, config, stats, audit |
| Yêu cầu JWT Bearer | 6 | Các thao tác email cần quyền sở hữu |
| WebSocket | 0 (không auth) | Kết nối mở, không kiểm tra token |

**Endpoint yêu cầu JWT (`Authorization: Bearer <token>`):**
- `PUT /api/v1/emails/{email_id}/draft`
- `POST /api/v1/emails/{email_id}/send`
- `PUT /api/v1/emails/{email_id}/archive`
- `PUT /api/v1/emails/{email_id}/trash`
- `PUT /api/v1/emails/{email_id}/star`
- `GET /api/v1/auth/me`

---

## 2. Endpoint hệ thống (Root & Health)

### 2.1. GET `/`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Trang chào mừng, trả metadata dịch vụ và liên kết tài liệu |
| **Auth** | Không |
| **Response 200** | `{ success, service, version, status, message, docs, api_v1, endpoints }` |

### 2.2. GET `/health`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Health check / liveness probe cho load balancer |
| **Auth** | Không |
| **Response 200** | `{ "status": "ok" }` |

---

## 3. Authentication — `/api/v1/auth`

**File:** `app/api/routers/auth.py`  
**OAuth Scopes:** `gmail.modify`, `userinfo.email`, `userinfo.profile`, `openid`

### 3.1. GET `/api/v1/auth/login`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Khởi tạo đăng nhập Google OAuth, trả URL redirect |
| **Auth** | Không |
| **Response 200** | `AuthLoginResponse` |
| **Response 503** | File credentials Google chưa cấu hình |

**Response schema (`AuthLoginResponse`):**
```json
{
  "authorization_url": "string",
  "state": "string"
}
```

### 3.2. GET `/api/v1/auth/callback`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Callback OAuth — đổi authorization code lấy JWT |
| **Auth** | Không |
| **Query params** | `code` (bắt buộc), `state` (bắt buộc, CSRF) |
| **Response 200** | `TokenResponse` |
| **Response 400** | State không hợp lệ / đổi code thất bại |
| **Response 502** | Lỗi lấy profile Google |

**Response schema (`TokenResponse`):**
```json
{
  "access_token": "string",
  "token_type": "bearer",
  "expires_in_minutes": 0,
  "user": {
    "id": "uuid",
    "email": "string",
    "display_name": "string | null",
    "is_active": true
  }
}
```

### 3.3. GET `/api/v1/auth/me`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Lấy profile user đang đăng nhập |
| **Auth** | **JWT Bearer** (bắt buộc) |
| **Response 200** | `UserProfileResponse` |
| **Response 401** | Token không hợp lệ / user inactive |

---

## 4. Emails — `/api/v1/emails`

**File:** `app/api/routers/emails.py`

### 4.1. GET `/api/v1/emails/`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Danh sách email có phân trang, kèm classification & draft |
| **Auth** | Không |
| **Query params** | `limit` (1–100, mặc định 20), `offset` (≥0), `category` (mặc định `"all"`), `is_processed` (bool, tùy chọn) |
| **Response 200** | `PaginatedResponse[EmailResponse]` |

**EmailResponse (trích):**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "gmail_message_id": "string",
  "thread_id": "string | null",
  "sender": "string | null",
  "recipient": "string | null",
  "subject": "string | null",
  "body": "string | null",
  "body_html": "string | null",
  "received_at": "datetime | null",
  "is_processed": false,
  "processed_at": "datetime | null",
  "labels": ["string"],
  "created_at": "datetime",
  "updated_at": "datetime",
  "classification": { "category", "priority_score", "summary", "deadline", "confidence", ... },
  "draft": { "draft_content", "draft_gmail_id", "is_modified", "is_sent", ... }
}
```

### 4.2. POST `/api/v1/emails/process`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Kích hoạt pipeline xử lý email mới từ Gmail (batch, limit=5) |
| **Auth** | Không |
| **Request body** | Không |
| **Response 200** | `ProcessEmailsResponse` |
| **Luồng xử lý** | Gmail fetch → Classifier Agent → Response Agent → lưu DB + audit |

**ProcessEmailsResponse:**
```json
{
  "fetched": 0,
  "processed": 0,
  "skipped_duplicate": 0,
  "failed": 0,
  "drafts_created": 0,
  "run_id": "string | null",
  "llm_calls_count": 0,
  "llm_total_time_ms": 0,
  "total_time_ms": 0,
  "errors": []
}
```

### 4.3. PUT `/api/v1/emails/{email_id}/draft`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Cập nhật nội dung draft reply (chỉnh sửa thủ công) |
| **Auth** | **JWT Bearer** + kiểm tra quyền sở hữu email |
| **Path params** | `email_id` (UUID) |
| **Request body** | `DraftUpdateSchema` |
| **Response 200** | `DraftResponse` |
| **Response 403** | Không có quyền truy cập email |
| **Response 404** | Email hoặc draft không tồn tại |

**Request body:**
```json
{
  "draft_content": "string (min 1 ký tự)"
}
```

### 4.4. POST `/api/v1/emails/{email_id}/send`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Gửi draft qua Gmail API |
| **Auth** | **JWT Bearer** + quyền sở hữu |
| **Path params** | `email_id` (UUID) |
| **Response 200** | `DraftSendResponse` |
| **Response 400** | Draft chưa có `draft_gmail_id` |
| **Response 404** | Email/draft không tồn tại |
| **Response 502** | Lỗi Gmail API |

**DraftSendResponse:**
```json
{
  "message": "Draft sent successfully.",
  "gmail_message_id": "string | null",
  "gmail_thread_id": "string | null"
}
```

### 4.5. PUT `/api/v1/emails/{email_id}/archive`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Lưu trữ email (xóa label INBOX trên Gmail) |
| **Auth** | **JWT Bearer** + quyền sở hữu |
| **Response 200** | `EmailActionResponse` |
| **Response 502** | Lỗi Gmail API |

### 4.6. PUT `/api/v1/emails/{email_id}/trash`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Chuyển email vào thùng rác Gmail |
| **Auth** | **JWT Bearer** + quyền sở hữu |
| **Response 200** | `EmailActionResponse` |
| **Response 502** | Lỗi Gmail API |

### 4.7. PUT `/api/v1/emails/{email_id}/star`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Gắn sao email (thêm label STARRED) |
| **Auth** | **JWT Bearer** + quyền sở hữu |
| **Response 200** | `EmailActionResponse` |
| **Response 502** | Lỗi Gmail API |

**EmailActionResponse (dùng chung cho archive/trash/star):**
```json
{
  "message": "string",
  "email_id": "uuid",
  "gmail_message_id": "string",
  "labels": ["string"] | null
}
```

---

## 5. Agents — `/api/v1/agents`

**File:** `app/api/routers/agents.py`

### 5.1. GET `/api/v1/agents/status`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Trạng thái hệ thống agent (idle / running / degraded) |
| **Auth** | Không |
| **Response 200** | `AgentStatusResponse` |
| **Nguồn dữ liệu** | Bản ghi mới nhất trong bảng `agent_runs` |

**AgentStatusResponse:**
```json
{
  "system_status": "idle | running | degraded",
  "latest_run": { "id", "run_type", "status", "total_emails_processed", "llm_calls_count", ... },
  "message": "string | null"
}
```

### 5.2. POST `/api/v1/agents/classify`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Test Classifier Agent (stateless, không lưu DB) |
| **Auth** | Không |
| **Request body** | `ClassifyTestRequest` |
| **Response 200** | `EmailClassificationOutput` |
| **Response 502** | Lỗi gọi LLM |

**Request body:**
```json
{
  "subject": "string (1–500 ký tự)",
  "body": "string (min 1 ký tự)",
  "sender": "string | null (max 255)"
}
```

**Response (`EmailClassificationOutput`):**
```json
{
  "category": "urgent | important | need_reply | newsletter | spam",
  "priority_score": 1,
  "summary": "string (max 500, tối đa 2 câu)",
  "deadline": "string | date | null",
  "confidence": 0.0
}
```

### 5.3. POST `/api/v1/agents/draft`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Test Response Agent — tạo draft reply (stateless) |
| **Auth** | Không |
| **Request body** | `DraftTestRequest` |
| **Response 200** | `EmailResponseOutput` |
| **Response 400** | Category không hỗ trợ draft / agent skip |
| **Response 422** | Category không hợp lệ |
| **Response 502** | Lỗi gọi LLM |

**Request body:**
```json
{
  "email_subject": "string (1–500)",
  "email_body": "string (min 1)",
  "category": "urgent | important | need_reply | newsletter | spam",
  "priority_score": 1,
  "summary": "string (1–500)",
  "deadline": "string | date | null",
  "confidence": 0.0
}
```

**Response (`EmailResponseOutput`):**
```json
{
  "subject": "string",
  "body_content": "string"
}
```

---

## 6. Configuration — `/api/v1/config`

**File:** `app/api/routers/config.py`

### 6.1. GET `/api/v1/config/`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Liệt kê toàn bộ cấu hình hệ thống |
| **Auth** | Không |
| **Response 200** | `list[ConfigurationResponse]` |

**ConfigurationResponse:**
```json
{
  "key": "string",
  "value": "string | null",
  "data_type": "string | null",
  "description": "string | null",
  "is_editable": true,
  "updated_at": "datetime"
}
```

### 6.2. PUT `/api/v1/config/`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Cập nhật cấu hình theo key (vd: Gemini model id) |
| **Auth** | Không |
| **Request body** | `ConfigurationUpdateSchema` |
| **Response 200** | `ConfigurationResponse` |
| **Response 403** | Key không cho phép chỉnh sửa |
| **Response 404** | Key không tồn tại |

**Request body:**
```json
{
  "key": "string (1–100)",
  "value": "string"
}
```

### 6.3. PUT `/api/v1/config/tone`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Đặt giọng văn cho Response Agent (`agent_tone`) |
| **Auth** | Không |
| **Request body** | `AgentToneUpdateSchema` |
| **Response 200** | `ConfigurationResponse` |

**Request body:**
```json
{
  "tone": "professional | friendly | concise | ..."
}
```

### 6.4. PUT `/api/v1/config/signature`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Đặt chữ ký email (`user_signature`) |
| **Auth** | Không |
| **Request body** | `UserSignatureUpdateSchema` |
| **Response 200** | `ConfigurationResponse` |

**Request body:**
```json
{
  "signature": "string (1–1000 ký tự)"
}
```

---

## 7. Audit Logs — `/api/v1/audit`

**File:** `app/api/routers/audit.py`

### 7.1. GET `/api/v1/audit/`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Danh sách audit log có phân trang |
| **Auth** | Không |
| **Query params** | `limit` (1–200, mặc định 20), `offset`, `status`, `agent_name` |
| **Response 200** | `PaginatedResponse[AuditLogResponse]` |
| **Sắp xếp** | Mới nhất trước (`created_at DESC`) |

**AuditLogResponse:**
```json
{
  "id": 0,
  "user_id": "uuid | null",
  "email_id": "uuid | null",
  "agent_name": "string | null",
  "action": "string | null",
  "status": "success | failed | skipped | ...",
  "details": {},
  "ip_address": "string | null",
  "created_at": "datetime"
}
```

---

## 8. Analytics — `/api/v1/stats`

**File:** `app/api/routers/stats.py`

### 8.1. GET `/api/v1/stats/overview`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | KPI tổng quan dashboard |
| **Auth** | Không |
| **Response 200** | `OverviewStatsResponse` |

**OverviewStatsResponse:**
```json
{
  "total_processed": 0,
  "urgent_count": 0,
  "drafts_created": 0,
  "time_saved_minutes": 0.0
}
```

**Công thức `time_saved_minutes`:** `(drafts_created × 5) − (sum(llm_total_time_ms) / 60000)`

### 8.2. GET `/api/v1/stats/category-distribution`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Phân bố số lượng theo category (biểu đồ tròn) |
| **Auth** | Không |
| **Response 200** | `CategoryDistributionResponse` |

**CategoryDistributionResponse:**
```json
{
  "items": [
    { "category": "urgent", "count": 0 },
    { "category": "important", "count": 0 }
  ]
}
```

---

## 9. WebSocket

**File:** `app/api/routers/websockets.py`

### 9.1. WS `/ws/notifications`

| Thuộc tính | Chi tiết |
|------------|----------|
| **Mô tả** | Kênh real-time cho thông báo email khẩn & sự kiện hệ thống |
| **Auth** | Không (kết nối mở) |
| **Giao thức** | WebSocket |
| **Client → Server** | Text ping (giữ kết nối, server bỏ qua nội dung) |
| **Server → Client** | JSON broadcast |

**Ví dụ message server gửi:**
```json
{
  "type": "NEW_URGENT_EMAIL",
  "subject": "...",
  "summary": "..."
}
```

**Nguồn broadcast:** `EmailOrchestrator` qua `WebSocketManager` (`app/core/websocket_manager.py`)

---

## 10. API bên ngoài (External Integrations)

Hệ thống gọi các API bên thứ ba thông qua service layer (không expose trực tiếp qua REST).

### 10.1. Google OAuth 2.0

| Thuộc tính | Chi tiết |
|------------|----------|
| **File** | `app/api/routers/auth.py`, `app/services/gmail_service.py` |
| **Endpoint** | `https://accounts.google.com/o/oauth2/v2/auth` (redirect) |
| **Token exchange** | Google OAuth token endpoint (qua `google_auth_oauthlib`) |
| **User info** | `GET https://www.googleapis.com/oauth2/v2/userinfo` |
| **Scopes** | `gmail.modify`, `userinfo.email`, `userinfo.profile`, `openid` |

### 10.2. Gmail API v1

| Thuộc tính | Chi tiết |
|------------|----------|
| **File** | `app/services/gmail_service.py` |
| **Base** | `googleapiclient.discovery.build("gmail", "v1")` |
| **Mock mode** | Khi `GMAIL_MOCK_MODE=true` hoặc thiếu credentials |

| Method service | Gmail API call | Mục đích |
|----------------|----------------|----------|
| `fetch_unread_emails` | `users.messages.list` + `users.messages.get` | Lấy email chưa đọc |
| `fetch_unread_emails` | `users.messages.modify` (remove UNREAD) | Đánh dấu đã đọc |
| `create_draft` | `users.drafts.create` | Tạo draft reply |
| `send_draft` | `users.drafts.send` | Gửi draft |
| `modify_message_labels` | `users.messages.modify` | Thêm/xóa label |
| `archive_message` | `users.messages.modify` (remove INBOX) | Lưu trữ |
| `trash_message` | `users.messages.trash` | Thùng rác |
| `star_message` | `users.messages.modify` (add STARRED) | Gắn sao |

### 10.3. Google Gemini API

| Thuộc tính | Chi tiết |
|------------|----------|
| **File** | `app/services/llm_service.py` |
| **Client** | `google.genai.Client` |
| **Method chính** | `client.aio.models.generate_content` |
| **Cấu hình** | `GEMINI_API_KEY`, `GEMINI_MODEL` (env) |
| **Output** | JSON có schema (Pydantic validation) |
| **Retry** | 3 lần, exponential backoff |
| **Fallback** | Rule-based keyword khi LLM thất bại |

**Schema output từ agents:**
- Classification: `EmailClassificationOutput`
- Draft reply: `EmailResponseOutput`

---

## 11. Mã lỗi HTTP thống nhất

| HTTP Code | Ý nghĩa | Ví dụ endpoint |
|-----------|---------|----------------|
| 200 | Thành công | Hầu hết GET/PUT/POST |
| 400 | Request không hợp lệ | OAuth state sai, thiếu draft_gmail_id |
| 401 | Chưa xác thực | `/auth/me` token invalid |
| 403 | Không có quyền | Email không thuộc user, config không editable |
| 404 | Không tìm thấy | Email/draft/config key không tồn tại |
| 422 | Validation error | Body/query không pass Pydantic |
| 500 | Lỗi server nội bộ | Exception không xử lý |
| 502 | Lỗi dịch vụ bên ngoài | Gmail API, Gemini API, Google profile |
| 503 | Dịch vụ chưa sẵn sàng | OAuth credentials chưa cấu hình |

**Envelope lỗi:**
```json
{
  "success": false,
  "error": {
    "type": "validation_error | http_error | internal_server_error",
    "message": "string",
    "details": null
  }
}
```

---

## 12. Bảng tra cứu nhanh — Tất cả endpoint

| # | Method | Path | Auth | Mô tả ngắn |
|---|--------|------|------|------------|
| 1 | GET | `/` | — | Metadata dịch vụ |
| 2 | GET | `/health` | — | Health check |
| 3 | GET | `/api/v1/auth/login` | — | Bắt đầu OAuth Google |
| 4 | GET | `/api/v1/auth/callback` | — | Callback OAuth → JWT |
| 5 | GET | `/api/v1/auth/me` | JWT | Profile user hiện tại |
| 6 | GET | `/api/v1/emails/` | — | Danh sách email |
| 7 | POST | `/api/v1/emails/process` | — | Xử lý email mới (batch) |
| 8 | PUT | `/api/v1/emails/{id}/draft` | JWT | Sửa draft |
| 9 | POST | `/api/v1/emails/{id}/send` | JWT | Gửi draft Gmail |
| 10 | PUT | `/api/v1/emails/{id}/archive` | JWT | Lưu trữ email |
| 11 | PUT | `/api/v1/emails/{id}/trash` | JWT | Xóa vào thùng rác |
| 12 | PUT | `/api/v1/emails/{id}/star` | JWT | Gắn sao email |
| 13 | GET | `/api/v1/agents/status` | — | Trạng thái agent |
| 14 | POST | `/api/v1/agents/classify` | — | Test phân loại |
| 15 | POST | `/api/v1/agents/draft` | — | Test tạo draft |
| 16 | GET | `/api/v1/config/` | — | Liệt kê config |
| 17 | PUT | `/api/v1/config/` | — | Cập nhật config |
| 18 | PUT | `/api/v1/config/tone` | — | Đặt tone agent |
| 19 | PUT | `/api/v1/config/signature` | — | Đặt chữ ký email |
| 20 | GET | `/api/v1/audit/` | — | Audit logs |
| 21 | GET | `/api/v1/stats/overview` | — | KPI dashboard |
| 22 | GET | `/api/v1/stats/category-distribution` | — | Phân bố category |
| 23 | WS | `/ws/notifications` | — | Thông báo real-time |

---

## 13. Cấu trúc file liên quan

```
app/
├── main.py                          # Entrypoint, CORS, exception handlers
├── api/
│   ├── auth_dependencies.py         # JWT Bearer → User
│   ├── dependencies.py              # DB, Gmail, Agent DI
│   └── routers/
│       ├── auth.py                  # 3 endpoints
│       ├── emails.py                # 7 endpoints
│       ├── agents.py                # 3 endpoints
│       ├── config.py                # 4 endpoints
│       ├── audit.py                 # 1 endpoint
│       ├── stats.py                 # 2 endpoints
│       └── websockets.py            # 1 WebSocket
├── schemas/
│   ├── api_schemas.py               # Request/Response REST
│   ├── agent_schemas.py             # Agent I/O contracts
│   └── stats_schemas.py             # Analytics schemas
└── services/
    ├── gmail_service.py             # Gmail API wrapper
    ├── llm_service.py               # Gemini API wrapper
    └── orchestrator.py              # Pipeline xử lý email
```

---

## 14. Lệnh khởi chạy & tài liệu tự động

```bash
# Chạy server development
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Truy cập Swagger UI
# http://localhost:8000/docs

# Truy cập ReDoc
# http://localhost:8000/redoc

# OpenAPI JSON
# http://localhost:8000/openapi.json
```

---

*Tài liệu được tổng hợp tự động từ mã nguồn tại `app/api/` và `app/main.py`.*
