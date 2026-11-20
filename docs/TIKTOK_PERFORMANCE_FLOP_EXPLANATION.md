# BẢNG TRA CỨU TIÊU CHÍ HIỆU SUẤT & PHÂN LOẠI FLOP PROFILE TIKTOK

Tài liệu này giải thích chi tiết ý nghĩa kỹ thuật và thực chiến của từng trạng thái trong bộ lọc **Hiệu Suất / Flop** tại `frontend/js/modules/gpm_farm.js` (dòng 133–148), kết hợp với thuật toán đánh giá tự động tại `backend/modules/channel_evaluator.py`.

---

## 1. Đoạn Mã Lọc Trong Frontend (`gpm_farm.js:L133-L148`)

```javascript
// Filter Flop / Performance
if (filterFlop !== 'ALL') {
    list = list.filter(p => {
        const fStatus = (p.flop_status || 'new').toLowerCase();
        if (filterFlop === 'GOOD') return fStatus === 'good';
        if (filterFlop === 'FLOP') return fStatus === '0_view' || fStatus === '200_view' || fStatus === 'unstable';
        if (filterFlop === '200_VIEW') return fStatus === '200_view';
        if (filterFlop === '0_VIEW') return fStatus === '0_view';
        if (filterFlop === 'UNSTABLE') return fStatus === 'unstable';
        if (filterFlop === 'NEW') return fStatus === 'new';
        if (filterFlop === 'BREAKOUT') return Boolean(p.is_breakout);
        if (filterFlop === 'RECOVERING') return Boolean(p.flop_recovering);
        return true;
    });
}
```

---

## 2. Chi Tiết Ý Nghĩa Từng Trạng Thái & Tiêu Chuẩn Kỹ Thuật

| Giá trị Lọc | Tên Hiển Thị | Cột Dữ Liệu | Tiêu Chuẩn Thuật Toán Kỹ Thuật | Ý Nghĩa Thực Chiến & Giải Pháp Vận Hành |
| :--- | :--- | :--- | :--- | :--- |
| `GOOD` | **🚀 Khỏe / Phát triển tốt** | `flop_status = 'good'` | • Median views của các clip trong cửa sổ đánh giá **> 300 views**.<br>• Tỷ lệ clip 0-view (<= 10 views) trong cửa sổ **< 34%**. | **Kênh khỏe mạnh.** Thuật toán phân phối tự nhiên, tương tác ổn định, không bị bóp đề xuất. Ưu tiên cấp thêm nội dung chất lượng cao. |
| `FLOP` | **⚠️ Tổng hợp Flop** | `flop_status IN ('0_view', '200_view', 'unstable')` | Gom gộp tất cả profile có vấn đề về phân phối (`0_view`, `200_view`, `unstable`). | **Bộ lọc quét nhanh.** Giúp người quản trị dàn acc phát hiện ngay các profile đang gặp trục trặc để kiểm tra và xử lý tập trung. |
| `200_VIEW` | **⚠️ Kẹt 200 View** | `flop_status = '200_view'` | • Median views của các clip trong cửa sổ đánh giá **<= 300 views** (`TIER1_V`). | **Kẹt trần Tier 1.** Video được đẩy vào nhóm thử nghiệm ban đầu (200–300 người) nhưng chỉ số giữ chân (retention / watch time) hoặc tương tác không đủ để đẩy sang Tier 2 (> 1.000 view). Cần cải thiện hook 3 giây đầu và nhịp điệu video. |
| `0_VIEW` | **🚨 0-View Flop** | `flop_status = '0_view'` | • Cả 3 clip gần nhất (đã đủ 24h tuổi) đều có views **<= 10 views** (`ZERO_V`). | **Bị bóp nghiêm trọng / Shadowban.** Kênh có dấu hiệu vi phạm chính sách, clip bị quét trùng lặp tuyệt đối, hoặc bị nhận diện bất thường về IP/VPN/Device fingerprint. Cần dừng đăng, kiểm tra lại nguồn clip và môi trường profile. |
| `UNSTABLE` | **⚡ Không Ổn Định** | `flop_status = 'unstable'` | • Median views **> 300**, nhưng tỷ lệ clip 0-view **>= 34%** (ví dụ: clip 2.000 view xen kẽ clip 0 view, 5 view, rồi 800 view). | **Phân phối trồi sụt bất thường.** Kênh không bị shadowban vĩnh viễn nhưng một số video dính bản quyền âm thanh, vi phạm từ khóa hoặc chất lượng không đồng đều. Cần chuẩn hóa lại khâu kiểm duyệt trước khi upload. |
| `NEW` | **🌱 Đang Nuôi** | `flop_status = 'new'` | • Kênh chưa có đủ tối thiểu **3 clip** đã đăng qua thời gian ân hạn **24 giờ** (`MIN_WINDOW = 3`, `MIN_AGE_HOURS = 24`). | **Kênh mới bắt đầu.** Hệ thống chưa có đủ mẫu dữ liệu thống kê để kết luận hiệu năng. Cần tiếp tục duy trì đăng đều 1–3 clip/ngày theo lịch. |
| `BREAKOUT` | **⚡ Đang Breakout (≥ 1,000v)** | `is_breakout = 1` | • Có clip trong 2 clip mới nhất đạt **>= 1.000 views** (`BREAKOUT_V`), trong khi mức view trung bình lịch sử trước đó **<= 300 views**. | **Bứt phá đề xuất!** Kênh đã vượt qua trần 200 view và đang được thuật toán đưa vào vòng thử nghiệm mở rộng. Đây là cơ hội vàng để đẩy thêm video cùng chủ đề để kéo kênh lên triệu view. |
| `RECOVERING`| **🔄 Đang Hồi Phục** | `flop_recovering = 1` | • Kênh trước đó bị gắn mác `0_view` hoặc `200_view`.<br>• Clip mới đã có view vượt ngưỡng, nhưng theo nguyên tắc **Hysteresis** (cần tối thiểu 2 clip liên tiếp vượt ngưỡng mới được tháo mác flop) nên đang được xếp vào diện theo dõi hồi phục. | **Dấu hiệu tích cực.** Kênh đang có xu hướng "sống lại" sau giai đoạn flop. Giữ nguyên chiến lược đăng hiện tại để kênh chính thức chuyển sang trạng thái "Khỏe". |

---

## 3. Các Cơ Chế Đánh Giá Cốt Lõi Trong Backend (`backend/modules/channel_evaluator.py`)

1. **Thời Gian Ân Hạn (Grace Period - 24 giờ):**
   - Clip mới đăng dưới 24 giờ sẽ **không** bị tính vào chỉ số flop. Thuật toán TikTok cần từ vài giờ đến một ngày để quét nội dung và phân phối đến khán giả.
2. **Cửa Sổ Trượt (Rolling Window - 72 giờ, 3 đến 7 clip):**
   - Đánh giá chỉ dựa trên các clip gần nhất (3 đến 7 video) để phản ánh đúng phong độ hiện tại của tài khoản, tránh trường hợp các clip cũ từ vài tháng trước làm sai lệch đánh giá hiện nay.
3. **Sử Dụng Trung Vị (Median Views):**
   - Thay vì dùng số trung bình cộng (Average) dễ bị méo bởi 1 clip bất ngờ triệu view, hệ thống dùng Trung vị (Median) để phản ánh chính xác khả năng cắn view trung bình thực sự của kênh.
4. **Cơ Chế Chống Nhiễu Hysteresis (Xuống nhanh, lên chậm):**
   - Khi kênh bị flop, cần tối thiểu **2 clip liên tiếp** vượt qua ngưỡng an toàn thì hệ thống mới chính thức gỡ mác flop. Điều này ngăn việc kênh bị đổi trạng thái liên tục qua lại chỉ vì một video may mắn ăn đề xuất tạm thời.
