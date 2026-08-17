# Product Pipeline Roadmap

```text
Product Input
  -> Research Job
  -> Product Knowledge
  -> Research Readiness Gate
  -> Marketing Brief
  -> Content Drafts
  -> Creative Brief
  -> Image Assets
  -> Listing Draft
  -> Human Approval
  -> Marketplace Publish Adapter
```

## Phase 1 — Research (implemented)

Output duy nhất là versioned `ProductKnowledge`: identity, specifications, category, marketing hypotheses, sources, field evidence, conflicts, missing information, confidence và readiness.

Rules:

- Fact không đủ evidence giữ là `Unknown`.
- Hai URL cùng domain không mặc nhiên là hai nguồn độc lập.
- Một marketplace listing không đủ để xác minh fact nếu không phải official store.
- `completed` không mở downstream; chỉ `readiness.status = ready_for_content` mới mở.

## Phase 2 — Marketing & Content

Tạo `MarketingBrief` từ Product Knowledge đã đạt gate, sau đó sinh title, bullets, description, FAQ và key communication. Mỗi claim phải trỏ về field/evidence trong Product Knowledge. Content không tự bổ sung specification mới.

## Phase 3 — Product Image

Thêm abstraction `ImageProvider`; adapter đầu tiên dự kiến là OpenAI image generation. Thiết kế theo [official OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

Hai nhóm asset đầu tiên:

- `cover`: ảnh bìa sản phẩm sạch, đúng tỉ lệ marketplace, không chèn claim chưa xác minh.
- `information_card`: ảnh thông tin/feature card, chỉ dùng nội dung từ Marketing Brief và Product Knowledge đã duyệt.

Mỗi `CreativeAsset` cần lưu: Product Knowledge version, creative brief, prompt, provider/model, input image IDs, kích thước, trạng thái, output path, thời gian và lỗi. Ảnh gốc/reference phải được truyền cho provider khi cần giữ đúng hình dáng sản phẩm; output luôn cần human review trước khi publish.

## Phase 4 — Listing & Publish

Tạo `ListingDraft` trước, map category/attributes theo marketplace sau. Publish đi qua adapter riêng (`ShopeePublisher`, rồi mới tới Lazada/TikTok Shop), có idempotency key, validation, audit log và bước duyệt thủ công. Không cho phép Image Agent hoặc Publisher sửa Product Knowledge.

## Provider boundaries

```text
LlmProvider      -> extraction / synthesis / content
VisionProvider   -> understand reference images
SearchProvider   -> discover sources
ImageProvider    -> cover and information assets
VideoProvider    -> future video assets
PublishProvider  -> marketplace draft / publish
```

Model Router về sau chọn provider theo task, quality, latency và cost; application contracts ở trên không đổi.
