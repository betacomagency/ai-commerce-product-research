# Phase 1 Architecture

```text
Web UI / DeepSeek Harness plugin
              |
              v
        Fastify API
              |
              v
  CommerceResearchHarness
    |      |       |       |
  Vision  Search  Fetch    LLM
    |      |       |       |
 Gemini  Tavily/  HTML   DeepSeek
         Brave
              |
              v
     Product Knowledge
              |
              v
      Research Readiness Gate
              |
       SQLite + local files
```

## Boundaries

- `src/application`: pipeline và business rules. Không import DeepSeek Harness core.
- `src/providers`: adapters cho LLM, Vision, Search và source fetch.
- `src/infrastructure`: SQLite, file storage, retry.
- `src/domain`: Product Knowledge schema, Job status và shared types.
- `integrations/deepseek-harness`: Cordis/DSH bundle mỏng gọi Commerce API.
- `public`: UI không cần client build tool.

Provider interfaces giữ business logic độc lập model. Local file storage nằm sau class riêng để có thể đổi thành S3. `JobStore` có thể được thay bằng PostgreSQL implementation khi chuyển sang multi-user/server deployment.

## Job lifecycle

```text
created
  -> analyzing
  -> researching
  -> synthesizing
  -> completed

Any stage -> failed
Insufficient identity -> needs_input
```

Mỗi transition và action có một progress event bền vững. UI chỉ hiển thị action log, không hiển thị chain-of-thought.

## Product Knowledge trust model

Schema giữ dữ liệu dùng chung cho nhiều ngành hàng và thêm ba phần ngoài schema tối thiểu:

- `evidence[]`: `field_path`, source IDs, confidence và status (`verified`, `user_provided`, `inferred`, `conflicting`, `unknown`).
- `conflicts[]`: các giá trị mâu thuẫn và cách xử lý.
- `confidence`: overall, coverage và source quality tách riêng.

Rules bắt buộc:

1. `verified` phải trỏ tới source ID hợp lệ.
2. User input là `user_provided`, không tự động thành verified.
3. Fallback chỉ cross-check trên các domain khác nhau; nhiều URL cùng domain không được tính là nhiều nguồn độc lập.
4. Giá trị không đủ evidence là `Unknown` và được thêm vào `missing_information`.
5. Marketing fields là giả thuyết tiềm năng, không phải product fact.

## Source priority

Fetcher gắn loại và reliability theo thứ tự: official brand, official marketplace, official document, major retailer, marketplace listing, other. Hệ thống không gắn nhãn official chỉ vì một listing tự nói “chính hãng”; domain/thông tin nguồn phải hỗ trợ phân loại đó.

## Production path

Các thay đổi tiếp theo không cần viết lại Product Knowledge business logic:

1. Đổi in-process runner sang queue worker (BullMQ/SQS).
2. Implement PostgreSQL `JobStore` và S3 `FileStorage`.
3. Thêm tenant/user IDs và authentication ở API layer.
4. Thêm Model Router chọn LLM/Vision theo task/cost.
5. Các agent Content/Image/Video/Shopee chỉ đọc Product Knowledge đã hoàn thành.

## Downstream safety gate

`completed` chỉ có nghĩa job đã chạy xong. Nó không đồng nghĩa dữ liệu đủ tốt để tạo content hoặc publish.
`product_knowledge.readiness` là gate deterministic của application layer:

- `blocked`: thiếu identity hoặc không có nguồn.
- `needs_review`: có dữ liệu nhưng evidence, nguồn uy tín hoặc confidence chưa đạt.
- `ready_for_content`: đủ điều kiện để phase Content & Creative đọc dữ liệu.

Content/Image/Publish không được đọc thẳng input ban đầu và không tự research lại. Chúng phải dùng đúng phiên bản Product Knowledge đã qua gate để tránh mỗi agent tạo một sự thật khác nhau.
