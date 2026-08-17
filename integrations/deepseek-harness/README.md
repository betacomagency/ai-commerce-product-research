# dsh-commerce-research

Out-of-tree DeepSeek Harness bundle cho AI Commerce Product Research app.

Bundle không chứa business logic. Nó đăng ký bốn tools gọi API local: tạo/đọc Product Job, dựng Commerce Package và yêu cầu tạo 4 ảnh Shopee. SQLite, source provenance, Product Knowledge và creative assets vẫn thuộc application layer.

```bash
npm run harness:install
npm run harness:web
```

Chạy hai lệnh trên từ project root. Wrapper dùng Node 22.19 tương thích DSH và khởi động từ thư mục bundle để tách `.env` của Commerce app khỏi launch environment của DSH.

Commerce app phải chạy trước ở `COMMERCE_APP_BASE_URL` (mặc định `http://127.0.0.1:3000`).

Ví dụ trong Harness:

```text
Hãy dùng commerce_research_create để nghiên cứu sản phẩm từ ảnh tại /absolute/path/product.jpg.
Sau khi job hoàn tất, dùng commerce_research_get để trả về Product Knowledge và nội dung Shopee.
Chỉ khi tôi xác nhận, dùng commerce_images_generate để tạo 1 ảnh bìa và 3 ảnh mô tả.
```

`commerce_images_generate` yêu cầu Commerce app có `TOKENROUTER_API_KEY` và sẽ trừ TokenRouter balance theo model ảnh đã chọn.
