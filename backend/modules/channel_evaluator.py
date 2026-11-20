"""
Channel Performance & Flop Evaluator
Evaluates TikTok channel performance using a 24h grace-period, 72h rolling window,
median views, hysteresis, and breakout signals.
"""

from datetime import datetime, timezone, timedelta
import statistics
import json
from typing import Dict, Any, List, Optional
from backend.database import get_connection, log_event

CFG = {
    "MIN_AGE_HOURS": 24,         # Grace period: chỉ xét clip >= 24h tuổi
    "WINDOW_HOURS": 72,          # Cửa sổ thời gian phân tích: 72h sau grace period
    "MIN_WINDOW": 3,             # Tối thiểu 3 clip để kết luận
    "MAX_WINDOW": 7,             # Tối đa 7 clip gần nhất
    "ZERO_V": 10,                # Ngưỡng coi là 0-view / shadowban
    "TIER1_V": 300,              # Ngưỡng kẹt trần Tier 1
    "BREAKOUT_V": 1000,          # Ngưỡng clip bứt phá (Breakout)
    "GOOD_MAX_ZERO_RATIO": 0.34, # Tỷ lệ clip 0-view trong window phải dưới 34% để đạt "good"
    "MAX_DATA_STALENESS_HOURS": 48 # Cảnh báo nếu dữ liệu quét đã quá 48h
}

VALID_FLOP_STATUSES = {"0_view", "200_view", "good", "unstable", "new"}

def _dt(x) -> datetime:
    """Chuyển đổi chuỗi ISO hoặc datetime naive sang UTC timezone-aware datetime."""
    if isinstance(x, str):
        # Hỗ trợ ISO string có hoặc không có Z / microsecond / khoảng trắng
        cleaned = x.replace("Z", "+00:00").replace(" ", "T")
        try:
            x = datetime.fromisoformat(cleaned)
        except Exception:
            # Fallback nếu định dạng sqlite YYYY-MM-DD HH:MM:SS
            try:
                x = datetime.strptime(x[:19], "%Y-%m-%d %H:%M:%S")
            except Exception:
                x = datetime.now(timezone.utc)
    if isinstance(x, (int, float)):
        x = datetime.fromtimestamp(x, tz=timezone.utc)
    return x if getattr(x, "tzinfo", None) else x.replace(tzinfo=timezone.utc)


def evaluate_channel_performance(
    videos: List[Dict[str, Any]],
    previous_flop: str = "",
    lifetime_avg: float = 0.0,
    now: Optional[datetime] = None,
    cfg: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Hàm phân loại thuần (Pure Function):
    - videos: danh sách dict [{"views": int, "posted_at": str|datetime, "status": str}]
    - previous_flop: trạng thái flop hiện tại (phục vụ Hysteresis)
    - lifetime_avg: view trung bình trọn đời của kênh
    """
    cfg = cfg or CFG
    now = now or datetime.now(timezone.utc)

    # 1. Chỉ nhận video hợp lệ (status == 'published')
    pub = []
    for v in videos:
        # Loại bỏ các clip under_review, restricted, removed, private
        if v.get("status", "published") != "published":
            continue
        try:
            t = _dt(v["posted_at"])
            age_h = (now - t).total_seconds() / 3600.0
            pub.append({
                "views": int(v.get("views", 0)),
                "t": t,
                "age_h": age_h
            })
        except Exception:
            continue

    # Sắp xếp mới nhất -> cũ hơn
    pub.sort(key=lambda x: x["t"], reverse=True)

    # 2. Breakout: nhìn cả clip vừa đăng < 24h
    # (Nếu có clip >= 1,000v trong 2 clip mới nhất và lịch sử các clip trước đó <= 300v)
    prior_views = [v["views"] for v in pub[1:]] if len(pub) > 1 else []
    prior_avg = statistics.mean(prior_views) if prior_views else lifetime_avg
    is_breakout = (
        any(v["views"] >= cfg["BREAKOUT_V"] for v in pub[:2])
        and prior_avg <= cfg["TIER1_V"]
    )

    # 3. Lọc Grace Period >= 24h -> Cửa sổ thời gian 72h -> Cắt tối đa MAX_WINDOW
    eligible = [v for v in pub if v["age_h"] >= cfg["MIN_AGE_HOURS"]]
    horizon = cfg["MIN_AGE_HOURS"] + cfg["WINDOW_HOURS"]
    window = [v for v in eligible if v["age_h"] <= horizon][:cfg["MAX_WINDOW"]]

    # Kênh đăng thưa: nếu trong 72h không đủ MIN_WINDOW clip, lấy MIN_WINDOW clip gần nhất đã đủ tuổi
    if len(window) < cfg["MIN_WINDOW"]:
        window = eligible[:cfg["MIN_WINDOW"]]

    # Nếu vẫn chưa đủ MIN_WINDOW clip đã qua 24h -> Kênh mới / Đang nuôi
    if len(window) < cfg["MIN_WINDOW"]:
        return {
            "flop_status": "new",
            "is_breakout": is_breakout,
            "recovering": False,
            "window_views": [v["views"] for v in window],
            "median_views": float(statistics.median([v["views"] for v in window])) if window else 0.0,
            "zero_ratio": round(sum(v["views"] <= cfg["ZERO_V"] for v in window) / len(window), 2) if window else 0.0,
            "reason": f"Mới có {len(window)} clip đủ 24h tuổi (cần tối thiểu {cfg['MIN_WINDOW']})"
        }

    views = [v["views"] for v in window]  # thứ tự: mới nhất -> cũ hơn
    recent3 = views[:3]
    med = statistics.median(views)
    zero_ratio = sum(x <= cfg["ZERO_V"] for x in views) / len(views)

    # 4. Phân loại sơ bộ (Candidate Status)
    # 0-View Flop: chỉ nhìn 3 clip gần nhất (đảm bảo clip cũ không đè clip mới)
    if all(x <= cfg["ZERO_V"] for x in recent3):
        cand = "0_view"
    elif med <= cfg["TIER1_V"]:
        cand = "200_view"
    elif zero_ratio < cfg["GOOD_MAX_ZERO_RATIO"]:
        cand = "good"
    else:
        # Tỷ lệ 0-view cao nhưng median > 300 (ví dụ [2000, 0, 5, 800, 0])
        cand = "unstable"

    # 5. Hysteresis (Xuống nhanh, lên chậm):
    # Thoát khỏi 0_view / 200_view chỉ khi 2 clip gần nhất đều vượt ngưỡng
    final_flop = cand
    recovering = False
    if previous_flop in ("0_view", "200_view") and cand != previous_flop:
        is_upgrade = (previous_flop == "0_view") or (previous_flop == "200_view" and cand in ("good", "unstable"))
        if is_upgrade:
            threshold = cfg["TIER1_V"] if cand in ("good", "unstable") else cfg["ZERO_V"]
            if not (len(views) >= 2 and all(x > threshold for x in views[:2])):
                final_flop = previous_flop
                recovering = True  # Đang theo dõi hồi phục

    return {
        "flop_status": final_flop,
        "is_breakout": is_breakout,
        "recovering": recovering,
        "window_views": views,
        "median_views": float(med),
        "zero_ratio": round(zero_ratio, 2)
    }


def upsert_profile_videos(gpm_profile_id: int, videos: List[Dict[str, Any]]) -> int:
    """
    Ghi / Cập nhật danh sách video của một profile vào bảng profile_videos (Idempotent Upsert).
    videos: [{"id": str, "title": str, "views": int, "likes": int, "status": str, "posted_at": str}]
    """
    if not videos or not gpm_profile_id:
        return 0

    conn = get_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0

    for v in videos:
        v_id = str(v.get("id") or v.get("video_id") or "").strip()
        if not v_id:
            continue
        title = v.get("title") or "No title"
        views = int(v.get("views") or v.get("play_count") or 0)
        likes = int(v.get("likes") or v.get("like_count") or v.get("digg_count") or 0)
        status = v.get("status") or "published"
        posted_at = v.get("posted_at") or v.get("post_time") or v.get("created_at") or now_iso

        cursor.execute("""
            INSERT INTO profile_videos (
                gpm_profile_id, video_id_str, title, views_count, likes_count, video_status, posted_at, scraped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(gpm_profile_id, video_id_str) DO UPDATE SET
                views_count = excluded.views_count,
                likes_count = excluded.likes_count,
                video_status = excluded.video_status,
                scraped_at = excluded.scraped_at
        """, (gpm_profile_id, v_id, title, views, likes, status, posted_at, now_iso))
        count += 1

    conn.commit()
    conn.close()
    return count


def recalculate_profile_flop(gpm_profile_id: int, now: Optional[datetime] = None) -> Dict[str, Any]:
    """
    Tính toán và cập nhật Flop Status ở Write Path sau khi Scraper/Upload cập nhật dữ liệu.
    Ghi thẳng vào database (flop_status, flop_since, is_breakout, flop_recovering, flop_window_views, flop_median_views).
    """
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Lấy thông tin hiện tại của profile
    cursor.execute("""
        SELECT id, gpm_id, name, flop_status, flop_since, consecutive_0_count, total_views
        FROM gpm_profiles WHERE id = ?
    """, (gpm_profile_id,))
    prof = cursor.fetchone()
    if not prof:
        conn.close()
        return {}

    curr_flop = (prof["flop_status"] or "").strip().lower()
    consecutive_0 = prof["consecutive_0_count"] or 0

    # 2. Lấy danh sách video từ profile_videos (chính), fallback sang upload_tasks nếu trống
    cursor.execute("""
        SELECT video_id_str as id, title, views_count as views, video_status as status, posted_at, scraped_at
        FROM profile_videos
        WHERE gpm_profile_id = ?
        ORDER BY posted_at DESC
    """, (gpm_profile_id,))
    v_rows = cursor.fetchall()
    latest_scraped_at = None

    if v_rows:
        videos = [dict(r) for r in v_rows]
        scraped_dates = [r["scraped_at"] for r in v_rows if r["scraped_at"]]
        if scraped_dates:
            latest_scraped_at = max(scraped_dates)
    else:
        # Fallback sang completed upload_tasks
        cursor.execute("""
            SELECT id, title, views_count as views, 'published' as status,
                   COALESCE(uploaded_at, created_at) as posted_at, created_at as scraped_at
            FROM upload_tasks
            WHERE gpm_profile_id = ? AND status = 'completed'
            ORDER BY id DESC
        """, (gpm_profile_id,))
        videos = [dict(r) for r in cursor.fetchall()]

    # 3. Kiểm tra tính tươi mới của dữ liệu (Staleness Check)
    now = now or datetime.now(timezone.utc)
    is_stale = False
    if latest_scraped_at:
        try:
            scrape_dt = _dt(latest_scraped_at)
            if (now - scrape_dt).total_seconds() / 3600.0 > CFG["MAX_DATA_STALENESS_HOURS"]:
                is_stale = True
        except Exception:
            pass

    # 4. Tính toán Lifetime Average
    lifetime_views = [int(v.get("views", 0)) for v in videos]
    lifetime_avg = statistics.mean(lifetime_views) if lifetime_views else 0.0

    # 5. Đánh giá qua Pure Function
    eval_res = evaluate_channel_performance(
        videos=videos,
        previous_flop=curr_flop,
        lifetime_avg=lifetime_avg,
        now=now,
        cfg=CFG
    )

    new_flop = eval_res["flop_status"]
    is_breakout = 1 if eval_res["is_breakout"] else 0
    recovering = 1 if eval_res["recovering"] else 0
    window_views_json = json.dumps(eval_res["window_views"])
    median_views = eval_res["median_views"]

    # 6. Quản lý thời điểm đổi nhãn & Consecutive 0-Views
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    flop_since = prof["flop_since"] or now_str
    if new_flop != curr_flop:
        flop_since = now_str
        log_event("INFO", f"⚡ [FLOP_STATUS] Profile '{prof['name']}' đổi trạng thái: {curr_flop or 'None'} -> {new_flop}")

    if new_flop == "0_view":
        consecutive_0 += 1
    else:
        consecutive_0 = 0

    # 7. Ghi lại kết quả vào database
    cursor.execute("""
        UPDATE gpm_profiles SET
            flop_status = ?,
            flop_since = ?,
            is_breakout = ?,
            flop_recovering = ?,
            flop_window_views = ?,
            flop_median_views = ?,
            consecutive_0_count = ?
        WHERE id = ?
    """, (new_flop, flop_since, is_breakout, recovering, window_views_json, median_views, consecutive_0, gpm_profile_id))
    conn.commit()
    conn.close()

    eval_res["is_stale"] = is_stale
    eval_res["consecutive_0_count"] = consecutive_0
    eval_res["gpm_profile_id"] = gpm_profile_id
    eval_res["profile_name"] = prof["name"]
    return eval_res


def recalculate_all_profiles_flop() -> Dict[str, Any]:
    """Cập nhật Flop Status định kỳ cho toàn bộ profiles."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM gpm_profiles")
    pids = [r["id"] for r in cursor.fetchall()]
    conn.close()

    results = {}
    for pid in pids:
        try:
            results[pid] = recalculate_profile_flop(pid)
        except Exception as e:
            log_event("WARNING", f"Lỗi cập nhật Flop cho profile #{pid}: {e}")
    return results
