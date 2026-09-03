# Test cài đặt nhanh

## Test lần đầu trên Windows

1. Developer chạy `npm run build:exe`. Gửi designer `MagnificStock.exe`, `manifest.json`, `dist\code.js`, `dist\index.html` trong cùng một ZIP.
2. Designer import `manifest.json` một lần trong Figma Desktop.
3. Bỏ qua bước này khi test bản EXE.

4. Designer mở `MagnificStock.exe`. Kiểm tra icon app xuất hiện ở system tray.
5. Đăng nhập `magnific.com` trên Chrome.
6. Mở Figma → chạy plugin → **Settings → Show advanced settings → Connect Magnific**.
7. Đóng Chrome khi app yêu cầu; chờ trạng thái **Magnific connected**.
8. Mở lại Chrome.
9. Mở `http://localhost:8787/health`. Cookie được lưu tại `%LOCALAPPDATA%\MagnificStock\cookies` trên máy designer. Kiểm tra JSON có:
   - `"hasCookie": true`
   - `"cookieJars": 1` hoặc lớn hơn
10. Search một asset → Insert.

## Test dùng hằng ngày

1. Chạy `MagnificStock.exe`.
2. Mở Chrome và đăng nhập `magnific.com`.
3. Mở Figma và chạy plugin.
4. Nếu cookie hết hạn: **Settings → Show advanced settings → Connect Magnific**, đóng Chrome khi được yêu cầu, rồi mở lại.
5. Search → Insert.
6. Không cài Chrome extension, không mở terminal, không nhập Proxy URL.

## Test chặn khi chưa đăng nhập Google

1. Tạo Chrome profile chưa đăng nhập Google.
2. Load/reload extension trong profile đó.
3. Mở popup extension.
4. Kiểm tra thấy `Google sign-in required`.
5. Mở `magnific.com`.
6. Kiểm tra proxy không nhận cookie mới.

## Test không ảnh hưởng Chrome profile khác

1. Mở Chrome bằng profile đang dùng nhiều tài khoản.
2. Đảm bảo Chrome profile đã đăng nhập Google.
3. Mở `magnific.com`, để extension auto-sync.
4. Kiểm tra các tab/tài khoản khác vẫn còn đăng nhập.
5. Không chạy CDP fallback khi Chrome đang mở.

## Test mất kết nối

1. Tắt server hoặc đóng process Node.
2. Mở plugin. Phải thấy `Proxy unreachable`.
3. Chạy lại setup hoặc `npm run server`.
4. Mở `magnific.com`; extension tự gửi cookie lại.
5. Plugin phải chuyển lại `Connected` sau lần health check kế tiếp.

## Lỗi thường gặp

- `Proxy unreachable`: chạy `dist\MagnificStock.exe`.
- Không có cookie: mở `magnific.com`, đăng nhập, bấm **Connect Magnific**, rồi đóng Chrome khi được yêu cầu.
- Không sync được: đóng toàn bộ Chrome trước khi bấm **Connect Magnific** lần nữa.
- Không cần cài Chrome extension cho luồng bình thường.
