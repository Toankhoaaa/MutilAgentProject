# Multi-Agent Email Orchestrator

Đồ án tốt nghiệp: hệ thống AI đa tác tử (multi-agent) tự động hóa xử lý email Gmail — phân loại, phân tích, phát hiện lừa đảo, soạn thảo trả lời, trích xuất lịch hẹn và điều phối công việc — gồm backend API, dashboard quản trị và tiện ích mở rộng Chrome.

## Kiến trúc tổng quan

```
Chrome Extension (Gmail)        Next.js Dashboard (SPA)
        │                                │
        └───────────── HTTP / WebSocket ─┘
                        │
                 FastAPI Backend (/api/v1)
                        │
        ┌───────────────┼───────────────────┐
        │               │                   │
  EmailOrchestrator   ChromaDB (RAG /     SQLite (SQLAlchemy)
  (multi-agent        knowledge base)     + APScheduler
   pipeline)
```

- **Backend**: `src/backend/` — FastAPI, xử lý toàn bộ logic nghiệp vụ và pipeline agent.
- **Frontend**: `src/frontend/` — Next.js 15 (Pages Router), dashboard quản trị cho người dùng/admin.
- **Extension**: `src/extension/` — tiện ích Chrome (Manifest V3 + InboxSDK) chèn nút "AI Reply" trực tiếp vào giao diện Gmail.

## Tính năng chính

- **Pipeline đa tác tử** (`services/orchestrator.py`): mỗi email mới được xử lý tuần tự qua các agent CrewAI + Gemini:
  - `SecurityAgent` — sàng lọc phishing/lừa đảo trước khi xử lý tiếp
  - `ClassifierAgent` — phân loại danh mục (urgent, need_reply, spam, newsletter, …), độ ưu tiên, tóm tắt
  - `AnalysisAgent` — phát hiện ngôn ngữ, cảm xúc, action items, dịch thuật
  - `SchedulingAgent` — trích xuất lịch hẹn, tạo sự kiện Google Calendar, phát hiện trùng lịch
  - `ResponseAgent` — soạn thảo trả lời chuyên nghiệp cho email cần phản hồi
  - `DelegationAgent` — đề xuất điều phối/ủy quyền công việc theo phòng ban
  - `ChatAgent` / `RagAgent` — chatbot nội bộ dùng ChromaDB làm knowledge base
- **Quản trị**: quản lý người dùng, phòng ban (departments), ủy quyền (delegations), công việc (tasks), rule engine cho email, knowledge base, audit log.
- **Chrome Extension**: gắn trực tiếp vào Gmail, gọi API backend để phân tích email và chèn gợi ý trả lời vào ô soạn thư.
- **Realtime**: WebSocket (`/ws/notifications`) đẩy thông báo khi có email khẩn cấp hoặc agent chạy xong.
- **Scheduler nền**: APScheduler tự động polling Gmail, khôi phục snooze/nhắc việc khi khởi động lại.

## Cấu trúc thư mục

```
src/
├── backend/
│   ├── main.py                # Entry point FastAPI (prefix /api/v1)
│   ├── core/                  # config, database, scheduler, security, websocket manager
│   ├── api/routers/           # auth, emails, agents, admin, users, departments,
│   │                          # delegations, tasks, rules, knowledge, chat, stats, audit, scheduler
│   ├── models/                # SQLAlchemy ORM models
│   ├── schemas/                # Pydantic request/response schemas
│   └── services/
│       ├── agents/            # Các agent CrewAI (classifier, response, analysis,
│       │                      # scheduling, security, chat, rag, delegation…)
│       ├── orchestrator.py    # Điều phối pipeline xử lý email
│       ├── gmail_service.py   # Tích hợp Gmail API
│       ├── calendar_service.py# Tích hợp Google Calendar
│       ├── scheduling_service.py
│       ├── rule_engine.py     # Rule engine cho email
│       └── chroma_service.py  # Knowledge base / vector store (RAG)
├── frontend/                  # Next.js 15 + TypeScript + Tailwind CSS + SWR
│   ├── pages/                 # dashboard, emails, schedules, tasks, departments,
│   │                          # knowledge, admin, settings, login
│   └── components/            # UI components (bao gồm Schedule/, admin/)
└── extension/                 # Chrome Extension (Manifest V3, Vite, InboxSDK)
    └── src/
        ├── background/        # service worker
        └── content/           # content script chèn UI vào Gmail

tests/            # pytest — unit/integration test cho agent, API, scheduling
docs/             # tài liệu bổ sung (API, knowledge base RAG)
```

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Backend | FastAPI, SQLAlchemy, Pydantic, APScheduler, CrewAI, google-genai (Gemini), ChromaDB |
| Xác thực | Google OAuth2, JWT, Starlette SessionMiddleware |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, SWR, Axios |
| Extension | Manifest V3, Vite, InboxSDK, TypeScript |
| Cơ sở dữ liệu | SQLite (mặc định, đổi qua `DATABASE_URL`) |

## Cài đặt

### Yêu cầu
- Python 3.11+
- Node.js 18+
- Gemini API key, Google OAuth Client ID/Secret (cho Gmail/Calendar)

### Backend

```bash
cd src
python -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

Tạo file `.env` ở thư mục gốc dự án (hoặc `src/.env`) với các biến sau (xem `backend/core/config.py`):

```
DATABASE_URL=sqlite:///./email_orchestrator.db
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
JWT_SECRET_KEY=
SECRET_KEY=
ADMIN_REGISTRATION_SECRET=
FRONTEND_URL=http://localhost:3000
CHROMA_PERSIST_PATH=./chroma_db
```

Chạy server (từ thư mục `src/`):

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### Frontend

```bash
cd src/frontend
npm install
npm run dev
```

Truy cập `http://localhost:3000`. Các request `/api/*` được Next.js rewrite sang backend FastAPI.

### Chrome Extension

```bash
cd src/extension
npm install
npm run build     # hoặc npm run dev để build + watch
```

Vào `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** và trỏ tới thư mục `src/extension/dist`.

## Chạy test

```bash
pytest
```

(`pytest.ini` đã cấu hình `pythonpath = src`, `testpaths = tests`.)

## Ghi chú

Đây là dự án đồ án tốt nghiệp, ưu tiên cho mục đích demo/nghiên cứu. Xem thêm `ARCHITECTURE.md` để biết chi tiết luồng xử lý pipeline và các ràng buộc thiết kế (stateless, privacy-first, RAG dạng few-shot prompting).
