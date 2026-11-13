# Dashboard trực vệ sinh NSV

Trang tổng quan lịch trực, điểm danh và số lần bị tick, lấy từ Google Sheet "Trực nhật nsv".
Tự cập nhật mỗi 30 phút bằng GitHub Actions và đăng lên GitHub Pages.

- `build.mjs` đọc sheet và tạo `site/data.json` (chỉ có tên viết tắt trong sheet, không có tên Zalo).
- `site/index.html` là trang dashboard.
- Mã sheet nằm trong secret `SHEET_ID`, không ghi trong code.
