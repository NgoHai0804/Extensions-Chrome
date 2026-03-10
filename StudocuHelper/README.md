#  Studocu Helper

Một tiện ích mở rộng nhẹ dành cho trình duyệt, giúp tối ưu hóa trải nghiệm đọc và lưu trữ tài liệu trên Studocu.

> **Trạng thái:** v1.0

## 📖 Giới thiệu

Công cụ này được phát triển để giải quyết các vấn đề hiển thị gây cản trở khi xem tài liệu học tập. Thay vì phải thao tác thủ công phức tạp, extension cung cấp giải pháp "một click" để làm sạch giao diện và xuất tài liệu ra định dạng in ấn chuẩn.

## ✨ Tính năng chính

### 1. Bypass Blur & Remove Watermark 
Đây là tính năng cốt lõi giúp hiển thị nội dung nguyên bản của tài liệu:
- **Xóa lớp phủ mờ (Unblur):** Loại bỏ các layer che khuất nội dung, giúp văn bản hiển thị rõ nét 100%.
- **Xóa Watermark:** Tự động ẩn các logo chìm, text quảng cáo hoặc các popup gây rối mắt đè lên nội dung.
- **Tối ưu hiển thị:** Giữ lại định dạng gốc (font chữ, bố cục) để người dùng có trải nghiệm đọc tốt nhất.

### 2. PDF Export 
Tính năng hỗ trợ lưu tài liệu về máy để in ấn hoặc đọc offline:
- **Render tự động:** Tự động cuộn và tải toàn bộ các trang tài liệu trước khi xuất.
- **Chuẩn khổ giấy A4:** Tự động căn chỉnh lề và kích thước trang phù hợp với máy in thông dụng.
- **Fix lỗi hiển thị:** Đã xử lý triệt để lỗi xuất hiện "vạch đen" (black line artifact) ở cuối trang thường gặp khi lưu trang web thành PDF.

---

## 📁 Cấu trúc dự án

```
Studocu-Helper-main/
├── manifest.json          # Cấu hình extension
├── popup/                 # Giao diện popup
│   ├── popup.html
│   ├── popup.css
│   └── popup.js           # Điều phối nút bấm
├── lib/                   # Thư viện tiện ích
│   ├── cookies.js         # Xóa cookies Studocu
│   ├── tabs.js            # Đợi tab load
│   └── status.js          # Cập nhật trạng thái
├── js/                    # Script chạy trên trang
│   ├── scroll.js          # Cuộn trang để tải nội dung
│   └── pdf-viewer.js      # Tạo viewer và in PDF
└── css/                   # Styles
    ├── viewer_styles.css  # Style cho viewer in PDF
    ├── custom_style.css   # Bypass Studocu
    └── study_print.css    # In study.soict.ai
```

---

## 🛠 Hướng dẫn cài đặt

Do đây là công cụ phát triển cá nhân (chưa đưa lên Store), bạn cần cài đặt thủ công qua chế độ Developer:

1. **Tải mã nguồn:** Tải file `.zip` của dự án về và giải nén (hoặc clone repository này).
2. **Mở trình quản lý tiện ích:** Truy cập đường dẫn `chrome://extensions/` trên trình duyệt (Chrome, Edge, Cốc Cốc...).
3. **Bật Developer Mode:** Gạt công tắc **"Developer mode"** ở góc trên bên phải màn hình.
4. **Tải tiện ích:** Nhấn nút **"Load unpacked"** và chọn thư mục chứa mã nguồn vừa giải nén.

---

## 📦 Cách sử dụng

1. Mở tài liệu Studocu cần xem.
2. Mở extension **Studocu Helper** và nhấn **"Bước 1: Xóa cookies"** nếu trang đang bị mờ hoặc có watermark.
3. Nhấn **"Bước 2: Kéo trang"** để tool tự cuộn lần lượt qua tất cả các trang (hoặc tự cuộn thủ công đến cuối nếu muốn).
4. Nhấn **"Bước 3: Download PDF"** để mở hộp thoại in / lưu PDF.  
   Hoặc dùng **"Auto"** để chạy liên tiếp cả 3 bước.
5. Chọn **Save as PDF** trong hộp thoại và lưu file về máy.