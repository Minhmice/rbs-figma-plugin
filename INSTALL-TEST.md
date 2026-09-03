# Test cài đặt nhanh

## Test lần đầu trên Windows

1. Mở PowerShell tại thư mục project.
2. Chạy:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-windows.ps1
```

3. Kiểm tra Chrome mở `chrome://extensions/` và cửa sổ folder `extension/`.
4. Bật **Developer mode** → **Load unpacked** → chọn folder `extension/`.
5. Đăng nhập Chrome bằng Google account được duyệt.
6. Mở `magnific.com`, đăng nhập Magnific.
7. Không bấm **Collect** hay **Send to proxy**. Chờ tối đa 15 giây.
7. Mở `http://localhost:8787/health`. Kiểm tra JSON có:
   - `"hasCookie": true`
   - `"cookieJars": 1` hoặc lớn hơn
8. Mở Figma → chạy plugin → mở Settings. Kiểm tra thấy `Connected`.
9. Search một asset → Insert.

## Test dùng hằng ngày

1. Đóng/mở lại Figma.
2. Mở `magnific.com`.
3. Chạy plugin.
4. Search → Insert.
5. Không mở terminal, không nhập Proxy URL, không sync CDP.

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

## Fallback

Nếu auto-sync không chạy: Settings → **Show advanced settings** → **Fallback: sync Chrome cookies (CDP)**.
Fallback chỉ chạy sau khi tự đóng Chrome. Script không còn tự kill Chrome, không đụng session/cookie của profile khác.

Extension chỉ sync khi Chrome profile có Google account đăng nhập. Nếu chưa đăng nhập Google, popup báo `Google sign-in required` và không đọc/gửi cookie Magnific.
