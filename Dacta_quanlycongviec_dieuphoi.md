# Đặc tả kỹ thuật — Quản lý công việc thông minh & AI điều phối phân công

> Tài liệu thiết kế để giao cho AI code. Mọi quyết định kiến trúc dưới đây đã được chốt.
> Nguyên tắc xuyên suốt: **AI gợi ý, người dùng duyệt và quyết định. AI không bao giờ tự
> gửi email hay tự đẩy task vào danh sách chính.**

---

## 1. Tổng quan & phạm vi

Hệ bổ sung hai chức năng liên kết nhau:

**A. Quản lý công việc (Task Management)** — biến `action_items`/`deadline`/`priority` mà các
agent đã trích xuất thành thực thể Task có vòng đời (gợi ý → todo → đang làm → xong). Một email
có thể sinh **nhiều** task. AI sinh task ở trạng thái `suggested`; người dùng duyệt mới thành việc thật.

**B. AI điều phối phân công (Delegation)** — với một email giao việc cho nhiều phòng ban, AI
tách phần việc theo từng phòng và **soạn sẵn một email nháp riêng cho mỗi phòng** (chỉ chứa đúng
phần việc của họ). Người điều phối duyệt từng nháp, sửa người nhận nếu cần, rồi gửi.

### Mô hình người dùng (đã chốt)
- Hệ là **multi-user**: nhiều **người điều phối**, mỗi người một tài khoản, **cô lập theo `user_id`**
  (giữ nguyên mô hình hiện tại — KHÔNG phá vỡ).
- **Phòng ban (kế toán, marketing…) KHÔNG phải user trong hệ.** Họ là **người nhận email bên ngoài**.
  Vì vậy không cần multi-tenant phức tạp, không có task xuất hiện chéo giữa các tài khoản.

### Tái dùng hạ tầng sẵn có (không xây mới)
| Hạ tầng có sẵn | Dùng cho |
|---|---|
| Analysis Agent (`action_items`) | Nguồn sinh task gợi ý |
| Classifier (`deadline`, `priority_score`) | Gán deadline/priority cho task |
| Response Agent | Soạn nội dung email chia việc |
| Gmail `drafts().create()` | Tạo nháp email chia việc |
| APScheduler (đang dùng cho snooze) | Nhắc deadline task |
| `audit_logs` | Ghi vết tạo/sửa/gửi |
| Privacy Agent (mask PII) | Che PII trước mọi LLM call (BẮT BUỘC, xem §7) |
| Cô lập `user_id` | Mọi bảng mới đều scope theo user |

---

## 2. Mô hình dữ liệu (4 bảng mới)

> Lưu ý DB: dự án dùng SQLite + `create_all` (không tự ALTER). Sau khi thêm model, phải
> **xóa-tạo-lại** `email_orchestrator.db` (dữ liệu dev bỏ được). Mọi bảng có `user_id` để cô lập.

### 2.1 `tasks` — thực thể công việc
```
tasks
├── id                 PK
├── user_id            FK users.id, index, NOT NULL      # cô lập theo người điều phối
├── title              VARCHAR(255), NOT NULL
├── description        TEXT, nullable
├── status             ENUM(suggested, todo, in_progress, done, dismissed), default 'todo'
├── priority           INTEGER 1-5, default 3
├── deadline           DATE, nullable
├── source             ENUM(manual, ai_email, delegation), default 'manual'
├── source_email_id    VARCHAR(255), nullable, index     # gmail_message_id của email gốc
├── source_thread_id   VARCHAR(255), nullable
├── department         VARCHAR(100), nullable            # nếu task gắn với 1 phòng (từ delegation)
├── created_at         DATETIME, default now
├── updated_at         DATETIME, onupdate now
└── completed_at       DATETIME, nullable                # set khi status -> done
```
**Quy tắc trạng thái:**
- `suggested` = AI sinh, chờ duyệt. KHÔNG hiển thị lẫn với task thật — nằm ở khu "Gợi ý chờ duyệt".
- Duyệt → `todo`. Bỏ → `dismissed` (giữ lại để thống kê, không xóa cứng).
- `manual` task tạo thẳng ở `todo`.
- Khi `done`: set `completed_at = now`.

### 2.2 `departments` — bảng phòng ban → email (cấu hình)
```
departments
├── id            PK
├── user_id       FK users.id, index, NOT NULL
├── name          VARCHAR(100), NOT NULL                 # "Kế toán", "Marketing"
├── email         VARCHAR(255), NOT NULL                 # ketoan@cty.com
├── keywords      TEXT, nullable                         # từ khóa giúp AI map (vd "hóa đơn, công nợ")
├── created_at    DATETIME, default now
└── UNIQUE(user_id, name)                                # mỗi user không trùng tên phòng
```
> AI dùng `name` + `keywords` để map "phần việc kế toán" → đúng phòng. `email` để điền sẵn người
> nhận (người điều phối vẫn sửa được khi gửi — đã chốt).

### 2.3 `delegations` — một lần phân công (header, 1 email gốc)
```
delegations
├── id                 PK
├── user_id            FK users.id, index, NOT NULL
├── source_email_id    VARCHAR(255), NOT NULL            # gmail_message_id email giao việc
├── source_thread_id   VARCHAR(255), nullable
├── original_subject   VARCHAR(500)
├── status             ENUM(pending, partially_sent, completed, dismissed), default 'pending'
├── created_at         DATETIME, default now
```

### 2.4 `delegation_items` — mỗi phòng một nháp email
```
delegation_items
├── id              PK
├── delegation_id   FK delegations.id, index, NOT NULL
├── department_name VARCHAR(100)                         # tên phòng AI tách ra
├── department_id   FK departments.id, nullable          # map được thì set; không thì null
├── recipient_email VARCHAR(255), nullable               # điền sẵn từ departments; sửa được
├── work_items      JSON                                 # list[str] phần việc của phòng này
├── draft_subject   VARCHAR(500)                         # Response Agent soạn
├── draft_body      TEXT                                 # Response Agent soạn
├── gmail_draft_id  VARCHAR(255), nullable               # set sau khi tạo Gmail draft
├── status          ENUM(draft, sent, dismissed), default 'draft'
├── sent_at         DATETIME, nullable
```

---

## 3. Agent mới — `DelegationAgent` (tách việc theo phòng ban)

Theo đúng pattern các agent hiện có: **CrewAI + Gemini, fallback GeminiService**, output Pydantic,
**temperature thấp (0.2)** để ổn định.

### 3.1 Input
| Tham số | Vai trò |
|---|---|
| `email_subject` | Tiêu đề email giao việc (đã mask PII) |
| `email_body` | Nội dung (đã mask PII) |
| `known_departments` | list tên phòng + keywords (từ bảng `departments` của user) — giúp AI map đúng |

### 3.2 Output — `DelegationOutput`
```
DelegationOutput
├── is_delegation: bool                  # email này có phải giao việc nhiều phần không
└── assignments: list[DepartmentAssignment]
        ├── department_name: str         # tên phòng/người theo nội dung email
        ├── matched_department_id: int | None   # map với known_departments nếu khớp
        ├── work_items: list[str]        # các việc giao cho phòng này (tiếng Việt)
        ├── priority: int                # 1-5
        └── suggested_deadline: str | None   # ISO YYYY-MM-DD nếu email nhắc
```
**Quy tắc:**
- Nếu email không phải giao việc nhiều phần → `is_delegation=false`, `assignments=[]`.
- Mỗi phần việc chỉ thuộc **một** phòng (không trùng lặp giữa các phòng).
- AI cố gắng map `department_name` với `known_departments` (theo tên/keywords) để điền
  `matched_department_id`; không chắc thì để `null` (người điều phối tự chọn sau).
- KHÔNG bịa phòng ban không có trong email.

### 3.3 Prompt (khung — tự viết theo chuẩn các agent khác)
- Persona: chuyên gia điều phối công việc, đọc email giao việc và tách phần việc theo phòng ban.
- Few-shot 3-4 ví dụ: (1) email giao cho 2 phòng rõ ràng; (2) email chỉ 1 phòng; (3) email không
  phải giao việc → `is_delegation=false`; (4) email giao việc nhưng phòng không khớp known_departments.
- Nhấn: tách đúng phần việc, không để việc của phòng này lọt sang phòng kia.

---

## 4. API Endpoints

> Tất cả scope theo `user_id` của người đăng nhập. Mọi endpoint tạo/sửa/gửi → ghi `audit_logs`.

### 4.1 Task CRUD
| Method | Path | Mô tả |
|---|---|---|
| GET | `/tasks` | Danh sách task của user. Query: `status`, `priority`, `deadline_before`, `source`. |
| POST | `/tasks` | Tạo task thủ công (vào `todo`). |
| PATCH | `/tasks/{id}` | Sửa trường / đổi `status`. Khi `status=done` → set `completed_at`. |
| DELETE | `/tasks/{id}` | Xóa (hoặc soft-delete tùy chọn). |
| POST | `/tasks/{id}/confirm` | `suggested` → `todo` (duyệt gợi ý). |
| POST | `/tasks/{id}/dismiss` | → `dismissed`. |

### 4.2 Sinh task gợi ý từ email
| Method | Path | Mô tả |
|---|---|---|
| POST | `/emails/{message_id}/extract-tasks` | Chạy Analysis (`action_items`) trên email → tạo các task `status=suggested`, gắn `source=ai_email`, `source_email_id`, `priority`/`deadline` từ Classifier. Trả danh sách task vừa tạo. |

> Tối ưu: nếu email đã có classification trong cache (bảng `classifications`), tái dùng
> `deadline`/`priority` thay vì gọi lại LLM.

### 4.3 Departments (cấu hình phòng ban)
| Method | Path | Mô tả |
|---|---|---|
| GET | `/departments` | Danh sách phòng ban của user. |
| POST | `/departments` | Thêm phòng (`name`, `email`, `keywords`). |
| PATCH | `/departments/{id}` | Sửa. |
| DELETE | `/departments/{id}` | Xóa. |

### 4.4 Delegation (AI điều phối phân công)
| Method | Path | Mô tả |
|---|---|---|
| POST | `/emails/{message_id}/delegate` | (1) mask PII → (2) `DelegationAgent` tách việc theo phòng → (3) với mỗi assignment: map phòng→email từ `departments`, gọi **Response Agent** soạn `draft_subject`/`draft_body` chỉ chứa phần việc của phòng → (4) tạo `delegations` + `delegation_items`. Trả về delegation kèm các item (nháp). KHÔNG gửi gì. |
| GET | `/delegations/{id}` | Xem một lần phân công + các nháp. |
| GET | `/delegations` | Lịch sử phân công của user. |
| PATCH | `/delegation-items/{id}` | Sửa `recipient_email`, `draft_subject`, `draft_body` trước khi gửi. |
| POST | `/delegation-items/{id}/send` | Tạo Gmail draft (hoặc gửi) cho item này → set `gmail_draft_id`, `status=sent`, `sent_at`. Cập nhật `delegations.status`. |
| POST | `/delegation-items/{id}/dismiss` | Bỏ nháp này (`status=dismissed`). |

> **Quyết định gửi vs nháp:** v1 nên **tạo Gmail draft** (an toàn — người dùng bấm gửi trong Gmail),
> hoặc gửi thẳng qua `drafts().send()` nếu muốn. KHUYẾN NGHỊ: tạo draft trước, để người dùng kiểm
> lần cuối trong Gmail. (Lưu ý scope: gửi cần `gmail.compose`/`gmail.send` — xác nhận scope hiện có.)

---

## 5. Luồng nghiệp vụ

### 5.1 Sinh & quản lý task
```
Email được xử lý (pipeline hoặc /emails/{id}/extract-tasks)
   → Analysis trả action_items + Classifier cho deadline/priority
   → tạo N task status="suggested" (source=ai_email, link source_email_id)
   → Dashboard: khu "Gợi ý chờ duyệt"
   → Người dùng: Confirm (→ todo) / Dismiss
   → Quản lý trạng thái todo → in_progress → done (kéo-thả/nút)
   → Task có deadline → APScheduler tạo job nhắc (tái dùng cơ chế snooze)
```

### 5.2 AI điều phối phân công
```
Email giao việc nhiều phòng → POST /emails/{id}/delegate
   → Privacy mask PII
   → DelegationAgent: tách thành assignments[{department, work_items, priority, deadline}]
   → với mỗi assignment:
        • map department_name → departments → recipient_email (điền sẵn, sửa được)
        • Response Agent soạn email nháp chứa ĐÚNG phần việc của phòng đó
        • tạo delegation_item (status=draft)
   → (tùy chọn) tạo task suggested để người điều phối theo dõi "đã giao gì cho ai"
   → Dashboard: hiển thị các nháp theo phòng
   → Người điều phối: sửa người nhận/nội dung nếu cần → Send (tạo Gmail draft) / Dismiss
   → ghi audit_logs mỗi lần gửi
```

---

## 6. UI Dashboard (Next.js) — yêu cầu tối thiểu

- **Bảng Task theo cột trạng thái** (todo / in_progress / done) — kéo-thả hoặc nút đổi trạng thái.
- **Khu "Gợi ý chờ duyệt"** riêng (task `suggested`) với nút Duyệt/Bỏ từng cái.
- Mỗi task: hiện title, priority (badge), deadline, và **link về email gốc** (nếu `source_email_id`).
- **Trang cấu hình Phòng ban** (CRUD `departments`).
- **Màn Delegation**: từ một email → nút "Phân công" → hiển thị các nháp theo phòng, mỗi nháp cho
  sửa người nhận + nội dung + nút Gửi/Bỏ.
- Lọc/sắp task theo trạng thái, priority, deadline.

---

## 7. An toàn, quyền riêng tư, nhất quán (BẮT BUỘC)

1. **Privacy mask trước mọi LLM call.** `DelegationAgent` nhận `email_subject`/`email_body` → phải
   mask PII trước (như mọi agent khác). Không gửi nội dung thô cho LLM.
2. **AI không tự gửi.** Delegation chỉ tạo **nháp**; người điều phối duyệt mới gửi. Đây vừa là an toàn
   (AI chia sai thì người sửa được) vừa là điểm mạnh khi bảo vệ.
3. **Cô lập `user_id`** trên mọi bảng/endpoint. User A không thấy task/department/delegation của user B.
4. **Audit log** mọi hành động chạm email/việc: tạo task, đổi trạng thái, tạo nháp delegation, gửi.
5. **Xử lý lỗi mềm** khi LLM trả JSON sai schema (giống các agent khác): fallback an toàn, không
   làm hỏng cả request.
6. **Lưu ý DB:** thêm 4 model → xóa-tạo-lại `email_orchestrator.db`. Chạy uvicorn từ `src/` (vụ
   path tương đối `./` — tránh tạo file DB mồ côi).

---

## 8. Phạm vi v1 vs Hướng phát triển

### Làm trong v1 ("vừa phải")
- Task CRUD + vòng đời trạng thái + nhắc deadline (APScheduler).
- Sinh task gợi ý từ email (Analysis action_items) → người duyệt.
- Link hai chiều task ↔ email gốc.
- AI điều phối: tách việc theo phòng → soạn nháp email/phòng → người duyệt & gửi.
- Cấu hình bảng phòng ban → email (AI điền sẵn người nhận, sửa được).

### KHÔNG làm v1 (ghi vào "Hướng phát triển" trong báo cáo)
- AI tự ưu tiên/sắp xếp task bằng LLM.
- Phụ thuộc giữa task (A xong mới tới B).
- Đồng bộ task/sự kiện lên Google Calendar/Tasks.
- Phòng ban là user thật trong hệ với task chéo + theo dõi phòng ban đã hoàn thành chưa
  (cần họ phản hồi vào hệ — vượt phạm vi multi-tenant).
- Task hiển thị trên Chrome Extension (v1 chỉ Web dashboard).

---

## 9. Thứ tự triển khai đề xuất

1. Model 4 bảng + xóa-tạo-lại DB.
2. Task CRUD API + chuyển trạng thái.
3. UI Task (cột trạng thái + khu gợi ý) — **demo được sau bước này**.
4. Sinh task từ email (hook Analysis action_items → task suggested).
5. Nhắc deadline qua APScheduler.
6. Departments CRUD + UI cấu hình.
7. DelegationAgent (prompt + schema + fallback).
8. Delegation API (/delegate → tách + soạn nháp) + UI duyệt/gửi.
9. Audit + xử lý lỗi mềm + test.

> Sau bước 5 đã có chức năng "quản lý công việc" hoàn chỉnh để demo. Delegation (6-8) là phần
> nâng cao, cộng thêm — không phải điều kiện để phần task chạy. An toàn cho deadline đồ án.