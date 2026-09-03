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
5. Mở `magnific.com`, đăng nhập.
6. Không bấm **Collect** hay **Send to proxy**. Chờ tối đa 15 giây.
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

## Test mất kết nối

1. Tắt server hoặc đóng process Node.
2. Mở plugin. Phải thấy `Proxy unreachable`.
3. Chạy lại setup hoặc `npm run server`.
4. Mở `magnific.com`; extension tự gửi cookie lại.
5. Plugin phải chuyển lại `Connected` sau lần health check kế tiếp.

## Fallback

Nếu auto-sync không chạy: Settings → **Show advanced settings** → **Fallback: sync Chrome cookies (CDP)**.
Không dùng fallback khi Chrome đang có dữ liệu chưa lưu; CDP có thể đóng Chrome.
