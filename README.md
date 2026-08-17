# AI Commerce Agent — Research, Shopee Content & Creative

App nhận tên, mô tả và/hoặc ảnh, nhận diện sản phẩm, research nhiều nguồn rồi lưu `Product Knowledge` có cấu trúc. Từ knowledge đó app tạo `Commerce Package` gồm tiêu đề/mô tả/thuộc tính Shopee, keyword truyền thông, kế hoạch 1 ảnh bìa + 3 ảnh mô tả và storyboard video 15 giây. Mỗi fact có evidence, source và confidence; dữ liệu không xác minh được giữ là `Unknown`.

## Chạy local

Yêu cầu: macOS Apple Silicon hoặc máy có Node.js 22.14+.

```bash
npm install
cp .env.example .env
npm run dev
```

Mở [http://127.0.0.1:3000](http://127.0.0.1:3000).

App chạy được ngay khi chưa có API key:

- Search dùng Brave Search HTML keyless.
- Parsing/synthesis dùng fallback bảo thủ, không biến inference thành fact.
- Ảnh được lưu nhưng không phân tích nếu thiếu Gemini key.

Để có extraction/cross-check tốt hơn, thêm vào `.env`:

```dotenv
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
TAVILY_API_KEY=... # optional; nếu trống sẽ dùng Brave Search HTML
TOKENROUTER_API_KEY=... # optional; chỉ dùng khi bấm Generate 4 images
```

Sau khi thay `.env`, restart server. Không commit `.env`.

Khi chỉ có `GEMINI_API_KEY`, chế độ `LLM_PROVIDER=auto` dùng Gemini cho Vision và structured synthesis. Nếu có `DEEPSEEK_API_KEY`, auto ưu tiên DeepSeek cho synthesis. Commerce Package vẫn được tạo ở trạng thái `review_required` khi knowledge chưa đủ readiness; app không tự publish. Tạo ảnh dùng GPT Image qua TokenRouter, mặc định `openai/gpt-5-image`, và chỉ chạy khi người dùng bấm nút hoặc gọi tool tương ứng.

## Kiểm tra project

```bash
npm run check
npm start
```

`npm run check` chạy typecheck, test và production build. Dữ liệu local nằm trong `data/commerce.sqlite`; ảnh nằm dưới `data/jobs/{job_id}/input/`. Refresh trang hoặc restart server không làm mất job.

## DeepSeek Harness integration

Repository ban đầu không chứa Harness core. MVP vì vậy không vendor hoặc sửa core. Integration được đóng gói thành bundle riêng tại [`integrations/deepseek-harness`](./integrations/deepseek-harness), theo extension model chính thức của DeepSeek Harness:

```bash
# Terminal 1: chạy Commerce app
npm run dev

# Terminal 2: cài bundle một lần, sau đó mở Harness Web
npm run harness:install
npm run harness:web
```

Các script Harness tự chạy DSH bằng Node 22.19 và đổi working directory sang bundle để DSH không đọc `.env` riêng của Commerce app. Không chạy `npx @deepseek-ai/dsh web` trực tiếp từ project root vì DSH bảo vệ một số biến launch/network như `DEEPSEEK_BASE_URL` và sẽ từ chối file `.env` đó.

Bundle thêm bốn model-facing tools:

- `commerce_research_create`: tạo job từ tên/thông tin và có thể đính kèm ảnh local bằng `imagePath`.
- `commerce_research_get`: đọc progress, sources, Product Knowledge, Commerce Package và assets.
- `commerce_package_build`: tạo lại nội dung Shopee/kế hoạch truyền thông cho job cũ.
- `commerce_images_generate`: tạo 1 ảnh bìa + 3 ảnh mô tả bằng GPT Image qua TokenRouter; đây là thao tác trừ TokenRouter balance.

`COMMERCE_APP_BASE_URL` có thể đổi endpoint mặc định `http://127.0.0.1:3000`. DeepSeek Harness hiện là Developer Preview và có thể có breaking changes; business logic không phụ thuộc core nên app vẫn chạy độc lập nếu API plugin thay đổi.

## API chính

| Method | Endpoint | Mục đích |
|---|---|---|
| `POST` | `/api/jobs` | Tạo job bằng `multipart/form-data` |
| `GET` | `/api/jobs` | Danh sách job đã lưu |
| `GET` | `/api/jobs/:id` | Job, progress, research và Product Knowledge |
| `POST` | `/api/jobs/:id/commerce-package` | Tạo lại listing Shopee và media/video plan |
| `POST` | `/api/jobs/:id/generate-images` | Xếp hàng tạo 4 ảnh qua TokenRouter |
| `GET` | `/api/jobs/:id/assets/:assetId` | Xem/tải ảnh đã tạo |
| `POST` | `/api/jobs/:id/research-again` | Tạo lần research mới từ input cũ |
| `POST` | `/api/harness/jobs` | Endpoint JSON cho DeepSeek Harness plugin |
| `GET` | `/api/health` | Health/provider status |

## Giới hạn hiện tại

- Chưa có authentication/multi-user, queue phân tán hoặc object storage.
- Job runner hiện chạy trong process; job đang chạy khi server tắt được đánh dấu `failed` và có thể Research Again.
- Search HTML keyless phù hợp MVP nhưng nên dùng Tavily hoặc search API có SLA khi deploy production.
- App tạo kế hoạch video/storyboard nhưng chưa render video thật.
- Shopee publish API chưa được bật; nội dung và ảnh cần human review trước khi đẩy lên marketplace.

Chi tiết thiết kế: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
Roadmap Content/Image/Publish: [`docs/PRODUCT-PIPELINE-ROADMAP.md`](./docs/PRODUCT-PIPELINE-ROADMAP.md).
