import os
import json
import random
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from backend.database import get_connection, log_event, log_campaign_event

class ContentDistributor:
    """
    Phân phối nội dung theo tài khoản:
    - Gán kênh nguồn cho nhóm tài khoản
    - Chống đăng trùng: mỗi clip chỉ gán cho 1 tài khoản duy nhất
    - Giới hạn số video mỗi ngày (daily cap) & giờ đăng ngẫu nhiên
    - Hỗ trợ làm nóng tài khoản mới (warm-up pacing)
    """
    def __init__(self, default_daily_limit: int = 2):
        self.default_daily_limit = default_daily_limit

    def get_global_min_interval(self, cursor=None) -> int:
        """Lấy cấu hình giãn cách tối thiểu toàn cục từ bảng settings, mặc định 60 phút"""
        try:
            local_conn = None
            if not cursor:
                local_conn = get_connection()
                cur = local_conn.cursor()
            else:
                cur = cursor
            cur.execute("SELECT value FROM settings WHERE key IN ('min_account_cooldown_minutes', 'min_post_interval_minutes')")
            row = cur.fetchone()
            if local_conn:
                local_conn.close()
            if row and row[0]:
                return max(15, int(row[0]))
        except Exception:
            pass
        return 60

    def can_account_post_today(self, gpm_id: str, max_daily: Optional[int] = None, cursor=None) -> bool:
        """Kiểm tra tài khoản đã đạt giới hạn video trong ngày chưa (tính gộp tất cả browser profile cùng nick)"""
        limit = max_daily or self.default_daily_limit
        today_prefix = datetime.now().strftime("%Y-%m-%d")

        local_conn = None
        if not cursor:
            local_conn = get_connection()
            cur = local_conn.cursor()
        else:
            cur = cursor

        cur.execute("SELECT id FROM gpm_profiles WHERE gpm_id = ?", (gpm_id,))
        p_row = cur.fetchone()
        if not p_row:
            if local_conn:
                local_conn.close()
            return True

        from backend.database import get_linked_profile_ids
        linked_ids = get_linked_profile_ids(cur, p_row[0])
        ph = ",".join("?" for _ in linked_ids)

        cur.execute(f"""
            SELECT COUNT(*) FROM upload_tasks ut
            WHERE ut.gpm_profile_id IN ({ph}) AND ut.status = 'completed' AND ut.uploaded_at LIKE ?
        """, (*linked_ids, f"{today_prefix}%"))
        count = cur.fetchone()[0]
        if local_conn:
            local_conn.close()

        return count < limit

    def is_clip_already_assigned(self, video_id: int, part_number: int = 1, cursor=None) -> bool:
        """Kiểm tra clip này (theo part) đã từng được gán hoặc đăng bởi tài khoản nào chưa"""
        local_conn = None
        if not cursor:
            local_conn = get_connection()
            cur = local_conn.cursor()
        else:
            cur = cursor

        cur.execute("""
            SELECT id FROM upload_tasks 
            WHERE video_id = ? AND (part_number = ? OR (part_number IS NULL AND ? = 1))
        """, (video_id, part_number, part_number))
        row = cur.fetchone()
        if local_conn:
            local_conn.close()
        return row is not None

    def format_account_persona_caption(
        self,
        title: str,
        tags: str,
        profile_id: int,
        description: str = ""
    ) -> Tuple[str, str]:
        """
        Đa dạng hóa phong cách đăng bài theo từng tài khoản (Account Persona Styling - Gap 2):
        Tránh triệt để việc 10-20 tài khoản cùng đăng 1 định dạng caption, cùng 1 bộ hashtag y hệt nhau
        khiến thuật toán TikTok phát hiện behavioral fingerprint của Farm.
        - Xoay vòng 4 kiểu định dạng tiêu đề (Persona framing)
        - Đảo ngẫu nhiên thứ tự hashtag theo seed tài khoản
        - Loại bỏ 100% dead tags (#fyp, #viral)
        """
        raw_title = (title or "").strip()
        persona_idx = profile_id % 4

        # 1. Đa dạng hóa phong cách tiêu đề
        if persona_idx == 0:
            persona_title = f"{raw_title} 🤯"
        elif persona_idx == 1:
            persona_title = f"{raw_title} — What do you think? 👇"
        elif persona_idx == 2:
            persona_title = f"Wait for it: {raw_title} 👀"
        else:
            persona_title = raw_title

        # 2. Xử lý mô tả và hashtag riêng biệt:
        # BẢO TỒN NGUYÊN VẸN cấu trúc ngữ pháp câu của phần mô tả (TUYỆT ĐỐI KHÔNG SHUFFLE từ ngữ thường).
        # Chỉ tách riêng các từ bắt đầu bằng '#' để lọc bỏ dead tags và đảo vị trí hashtag.
        banned = {"#fyp", "#viral", "#foryou", "#xuhuong", "#xuhuongtiktok", "#trending"}
        
        words = (tags or "").split()
        desc_words = []
        hashtags = []
        for w in words:
            w_strip = w.strip()
            if not w_strip:
                continue
            if w_strip.startswith("#"):
                if w_strip.lower() not in banned and w_strip not in hashtags:
                    hashtags.append(w_strip)
            else:
                desc_words.append(w_strip)
        
        # Chỉ đảo ngẫu nhiên thứ tự hashtag
        if hashtags:
            rng = random.Random(profile_id * 31 + len(raw_title))
            rng.shuffle(hashtags)
        
        desc_part = " ".join(desc_words).strip()
        tags_part = " ".join(hashtags).strip()
        
        if desc_part and tags_part:
            persona_tags = f"{desc_part}\n\n{tags_part}"
        elif tags_part:
            persona_tags = tags_part
        else:
            persona_tags = desc_part

        return persona_title, persona_tags

    def generate_random_schedule_time(self, start_hour: int = 9, end_hour: int = 22) -> str:
        """Tạo thời gian đăng ngẫu nhiên trong khung giờ quy định"""
        now = datetime.now()
        target_hour = random.randint(start_hour, end_hour)
        target_minute = random.randint(0, 59)
        scheduled = now.replace(hour=target_hour, minute=target_minute, second=0)

        # Nếu giờ đã qua trong ngày -> Lên lịch cho ngày mai
        if scheduled <= now:
            scheduled += timedelta(days=1)

        return scheduled.strftime("%Y-%m-%d %H:%M:%S")

    def schedule_campaign_upload(
        self,
        video_id: int,
        campaign: Dict[str, Any],
        title: str,
        tags: str,
        video_path: Optional[str] = None,
        part_number: int = 1,
        force_profile_id: Optional[int] = None,
        variant_tag: str = "",
        hook_copy: str = "",
        target_date_only: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Gán video đã render vào hàng đợi upload của chiến dịch:
        1. Chống trùng lặp theo Part (tránh gán 1 part nhiều lần)
        2. Chọn profile GPM thích hợp (hoặc giữ cùng profile cho chuỗi Part 1, 2, 3...)
        3. Tính toán khung giờ đăng tiếp theo dựa trên post_schedule & random_delay_minutes
        4. Tạo task trong upload_tasks và ghi log chiến dịch
        """
        conn = get_connection()
        cursor = conn.cursor()

        if campaign.get("auto_upload") == 0:
            conn.close()
            log_campaign_event(campaign.get("id", 0), "INFO", "distribute", f"Chiến dịch #{campaign.get('id', 0)} tắt 'Tự động tải lên TikTok' -> Bỏ qua lập lịch đăng cho video #{video_id} (Part {part_number}).")
            return None

        if self.is_clip_already_assigned(video_id, part_number=part_number, cursor=cursor):
            conn.close()
            return None

        # 1. Lấy danh sách GPM profiles của chiến dịch
        gpm_ids = []
        try:
            raw_gpm = campaign.get("gpm_profile_ids")
            if isinstance(raw_gpm, list):
                gpm_ids = raw_gpm
            elif isinstance(raw_gpm, str) and raw_gpm.strip():
                gpm_ids = json.loads(raw_gpm)
        except Exception:
            pass
        if not gpm_ids and campaign.get("gpm_profile_id"):
            gpm_ids = [campaign["gpm_profile_id"]]

        # Clean integer IDs
        clean_gpm_ids = []
        for gid in (gpm_ids or []):
            try:
                clean_gpm_ids.append(int(gid))
            except (ValueError, TypeError):
                pass

        if not clean_gpm_ids:
            conn.close()
            log_campaign_event(campaign.get("id", 0), "WARNING", "distribute", f"Chiến dịch không có profile GPMLogin nào để phân phối video #{video_id} (Part {part_number}).")
            return None

        # Chunked fetch of profiles to safely support hundreds/thousands of accounts without exceeding SQLite variable limits
        profiles = []
        for i in range(0, len(clean_gpm_ids), 400):
            chunk = clean_gpm_ids[i:i + 400]
            placeholders = ",".join("?" for _ in chunk)
            cursor.execute(f"SELECT * FROM gpm_profiles WHERE id IN ({placeholders})", tuple(chunk))
            profiles.extend([dict(r) for r in cursor.fetchall()])

        if not profiles:
            conn.close()
            return None

        # [Dedup Guard] Khử trùng lặp profiles cùng kênh MXH giữa các trình duyệt (GPMLogin & GenLogin)
        from backend.database import get_linked_profile_ids
        deduped_profiles = []
        seen_linked_ids = set()
        for p in profiles:
            p_id = p["id"]
            if p_id in seen_linked_ids:
                continue
            linked = set(get_linked_profile_ids(cursor, p_id))
            matching = [x for x in profiles if x["id"] in linked]
            if len(matching) > 1:
                # Ưu tiên gpm hoặc profile đầu tiên
                best = next((x for x in matching if (x.get("browser_type") or "gpm").lower() == "gpm"), matching[0])
            else:
                best = p
            deduped_profiles.append(best)
            seen_linked_ids.update(linked)
        profiles = deduped_profiles

        # Sắp xếp hoặc chọn profile
        mode = campaign.get("distribution_mode", "round_robin")
        daily_limit = campaign.get("daily_limit", self.default_daily_limit)

        chosen_profile = None
        # Nếu chỉ định ép profile (ví dụ Part 2, Part 3 cùng nick với Part 1)
        if force_profile_id:
            for p in profiles:
                if p["id"] == force_profile_id:
                    chosen_profile = p
                    break

        if not chosen_profile:
            today_prefix = target_date_only if target_date_only else datetime.now().strftime("%Y-%m-%d")
            all_p_ids = [p["id"] for p in profiles]
            counts_map = {p["id"]: 0 for p in profiles}
            completed_map = {p["id"]: 0 for p in profiles}
            queue_map = {p["id"]: 0 for p in profiles}

            from backend.database import get_linked_profile_ids
            # Đếm số lượng video hôm nay gộp theo tất cả browser profile cùng nick (GPMLogin + GenLogin)
            for p in profiles:
                linked = get_linked_profile_ids(cursor, p["id"])
                ph = ",".join("?" for _ in linked)
                cursor.execute(f"""
                    SELECT COUNT(*) FROM upload_tasks
                    WHERE gpm_profile_id IN ({ph}) AND (uploaded_at LIKE ? OR scheduled_time LIKE ?)
                """, (*linked, f"{today_prefix}%", f"{today_prefix}%"))
                counts_map[p["id"]] = cursor.fetchone()[0]

                cursor.execute(f"""
                    SELECT COUNT(*) FROM upload_tasks
                    WHERE gpm_profile_id IN ({ph}) AND status = 'completed' AND uploaded_at LIKE ?
                """, (*linked, f"{today_prefix}%"))
                completed_map[p["id"]] = cursor.fetchone()[0]

                cursor.execute(f"""
                    SELECT COUNT(*) FROM upload_tasks
                    WHERE gpm_profile_id IN ({ph}) AND status IN ('queued', 'processing')
                """, tuple(linked))
                queue_map[p["id"]] = cursor.fetchone()[0]

            random_delay = campaign.get("random_delay_minutes", 10)

            if mode == "parallel_slots":
                # Chế độ "Lấp Đầy Khung Giờ Song Song" (Mỗi nick có Proxy IP riêng):
                # Tìm profile có slot đăng khả dụng sớm nhất (ưu tiên hôm nay trước, rồi mới sang ngày mai)
                candidate_eval = []
                for p in profiles:
                    p_sched, p_limit, p_min_int = self._get_effective_schedule_params(campaign, p["id"], cursor=cursor)
                    next_time_str = self._calculate_next_post_time(
                        p_sched,
                        random_delay,
                        profile_id=p["id"],
                        cursor=cursor,
                        min_interval_minutes=p_min_int,
                        earliest_allowed_time=None,
                        enforce_farm_stagger=False,
                        daily_limit=p_limit,
                        target_date_only=target_date_only
                    )
                    if next_time_str:
                        candidate_eval.append((next_time_str, counts_map.get(p["id"], 0), queue_map.get(p["id"], 0), p))

                if candidate_eval:
                    # Ưu tiên: 1) Slot sớm nhất (hôm nay trước, rồi sang ngày mai), 2) Nick có ít clip hôm nay nhất, 3) Ít task chờ nhất
                    candidate_eval.sort(key=lambda x: (x[0], x[1], x[2]))
                    chosen_profile = candidate_eval[0][3]
                elif target_date_only:
                    # Toàn bộ profile đã lấp đầy ngày target_date_only
                    conn.close()
                    return None
            elif mode == "single_best":
                # Chế độ "Ưu Tiên Nick Điểm Uy Tín Cao Nhất":
                # Sắp xếp các nick theo điểm uy tín giảm dần (Followers, Views, Kiếm tiền Beta, Không flop, Trạng thái Active)
                def get_profile_score(p):
                    status = (p.get("status") or "active").lower()
                    if status != "active":
                        return -999999
                    followers = int(p.get("followers_count") or 0)
                    views = int(p.get("total_views") or 0)
                    is_cp = 10000 if (p.get("creator_program") == "active" or p.get("eligible_10k")) else 0
                    is_breakout = 5000 if p.get("is_breakout") else 0
                    is_flop = -5000 if (p.get("flop_status") == "flopped") else 0
                    return (followers * 2) + (views // 1000) + is_cp + is_breakout + is_flop

                best_profiles = sorted(profiles, key=get_profile_score, reverse=True)
                for p in best_profiles:
                    p_sched, p_limit, p_min_int = self._get_effective_schedule_params(campaign, p["id"], cursor=cursor)
                    if counts_map.get(p["id"], 0) < p_limit and completed_map.get(p["id"], 0) < p_limit:
                        t_check = self._calculate_next_post_time(
                            p_sched,
                            random_delay,
                            profile_id=p["id"],
                            cursor=cursor,
                            min_interval_minutes=p_min_int,
                            daily_limit=p_limit,
                            target_date_only=target_date_only
                        )
                        if t_check:
                            chosen_profile = p
                            break
            elif mode == "random":
                # Chế độ "Ngẫu nhiên": chọn ngẫu nhiên nick chưa đủ bài trên ngày mục tiêu
                random_candidates = list(profiles)
                random.shuffle(random_candidates)
                for p in random_candidates:
                    p_sched, p_limit, p_min_int = self._get_effective_schedule_params(campaign, p["id"], cursor=cursor)
                    if counts_map.get(p["id"], 0) < p_limit and completed_map.get(p["id"], 0) < p_limit:
                        t_check = self._calculate_next_post_time(
                            p_sched,
                            random_delay,
                            profile_id=p["id"],
                            cursor=cursor,
                            min_interval_minutes=p_min_int,
                            daily_limit=p_limit,
                            target_date_only=target_date_only
                        )
                        if t_check:
                            chosen_profile = p
                            break
            else:
                # Chế độ "Xoay vòng (Round-Robin)": sắp xếp theo nick có ít video trên ngày này nhất, sau đó đến ít task chờ nhất
                scored = sorted([(counts_map.get(p["id"], 0), queue_map.get(p["id"], 0), p) for p in profiles], key=lambda x: (x[0], x[1]))
                for cnt, q_cnt, p in scored:
                    p_sched, p_limit, p_min_int = self._get_effective_schedule_params(campaign, p["id"], cursor=cursor)
                    if cnt < p_limit and completed_map.get(p["id"], 0) < p_limit:
                        t_check = self._calculate_next_post_time(
                            p_sched,
                            random_delay,
                            profile_id=p["id"],
                            cursor=cursor,
                            min_interval_minutes=p_min_int,
                            daily_limit=p_limit,
                            target_date_only=target_date_only
                        )
                        if t_check:
                            chosen_profile = p
                            break

        if not chosen_profile:
            if target_date_only:
                conn.close()
                return None
            # Nếu tất cả đã chạm giới hạn hôm nay, gán cho profile có ít task trong hàng đợi nhất để gối đầu sang ngày mai
            scored_queue = sorted([(queue_map.get(p["id"], 0), p) for p in profiles], key=lambda x: x[0])
            chosen_profile = scored_queue[0][1]

        # Tính toán scheduled_time theo giai đoạn tài khoản (Warm-up Ngày 1-3 vs Tăng tốc Ngày 4-14)
        schedule_str, daily_limit, min_interval = self._get_effective_schedule_params(campaign, chosen_profile["id"], cursor=cursor)

        # Đảm bảo tuần tự Part tuyệt đối: Part 2 phải xếp lịch SAU Part 1 ít nhất min_interval
        earliest_allowed = None
        if part_number > 1:
            cursor.execute("""
                SELECT scheduled_time FROM upload_tasks
                WHERE video_id = ? AND part_number = ?
                ORDER BY id DESC LIMIT 1
            """, (video_id, part_number - 1))
            prev_row = cursor.fetchone()
            if prev_row and prev_row[0]:
                try:
                    prev_dt = datetime.strptime(prev_row[0], "%Y-%m-%d %H:%M:%S")
                    earliest_allowed = prev_dt + timedelta(minutes=min_interval)
                except Exception:
                    pass

        scheduled_time = self._calculate_next_post_time(
            schedule_str, 
            campaign.get("random_delay_minutes", 10), 
            profile_id=chosen_profile["id"], 
            cursor=cursor,
            min_interval_minutes=min_interval,
            earliest_allowed_time=earliest_allowed,
            enforce_farm_stagger=(mode != "parallel_slots"),
            daily_limit=daily_limit,
            target_date_only=target_date_only
        )
        if not scheduled_time:
            conn.close()
            return None

        # Áp dụng Gap 2: Account Persona Styling & Hashtag Permutation
        persona_title, persona_tags = self.format_account_persona_caption(
            title=title,
            tags=tags,
            profile_id=chosen_profile["id"]
        )

        cursor.execute("""
            INSERT INTO upload_tasks (video_id, gpm_profile_id, title, tags, status, scheduled_time, video_path, part_number, variant_tag, hook_copy)
            VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
        """, (video_id, chosen_profile["id"], persona_title, persona_tags, scheduled_time, video_path or '', part_number, variant_tag or '', hook_copy or ''))
        task_id = cursor.lastrowid

        cid = campaign.get("id", 0)
        pname = chosen_profile.get("name") or chosen_profile.get("gpm_id")
        log_msg = f"Đã lên lịch đăng video #{video_id} (Part {part_number}) cho profile '{pname}' vào lúc {scheduled_time} (Task #{task_id}, giãn cách ≥ {min_interval}p)."
        cursor.execute(
            "INSERT INTO campaign_logs (campaign_id, level, action, message, details) VALUES (?, 'SUCCESS', 'distribute', ?, '')",
            (cid, log_msg)
        )
        cursor.execute(
            "INSERT INTO system_logs (level, message, details) VALUES ('SUCCESS', ?, '')",
            (f"[Chiến dịch #{cid}] {log_msg}",)
        )
        conn.commit()
        conn.close()

        # Ghi song song log file
        try:
            from backend.logger import get_logger
            get_logger("system").info(f"[Chiến dịch #{cid}] {log_msg}")
        except Exception:
            pass

        return {
            "task_id": task_id,
            "profile_id": chosen_profile["id"],
            "profile_name": pname,
            "scheduled_time": scheduled_time,
            "part_number": part_number
        }

    def _get_effective_schedule_params(self, campaign: Dict[str, Any], profile_id: int, cursor=None):
        """Trả về (schedule_str, daily_limit, min_interval) hiệu lực cho profile theo giai đoạn Warm-up."""
        from backend.modules.account_warmup import account_warmup
        growth_info = account_warmup.get_profile_growth_stage(profile_id)
        is_warmup_mode = campaign.get("warmup_mode") == 1 or campaign.get("auto_pacing")
        user_schedule = (campaign.get("post_schedule") or "").strip()

        if is_warmup_mode and growth_info["stage"] == "warmup":
            schedule_str = user_schedule if user_schedule else "11:30, 19:30"
            daily_limit = min(campaign.get("daily_limit") or 2, 2)
            min_interval = 240
        elif is_warmup_mode and growth_info["stage"] == "acceleration":
            schedule_str = user_schedule if user_schedule else "07:00, 11:45, 17:30, 20:30"
            daily_limit = min(campaign.get("daily_limit") or 4, 4)
            min_interval = 120
        else:
            schedule_str = user_schedule if user_schedule else "07:00, 11:45, 17:30, 20:30"
            daily_limit = campaign.get("daily_limit") or self.default_daily_limit
            camp_min = campaign.get("min_post_interval_minutes")
            min_interval = int(camp_min) if (camp_min and int(camp_min) > 0) else self.get_global_min_interval(cursor=cursor)

        return schedule_str, daily_limit, min_interval

    def _calculate_next_post_time(
        self, 
        schedule_str: str, 
        random_delay_minutes: int = 10, 
        profile_id: int = None, 
        cursor = None,
        min_interval_minutes: int = 60,
        earliest_allowed_time: Optional[datetime] = None,
        enforce_farm_stagger: bool = True,
        daily_limit: int = 3,
        target_date_only: Optional[str] = None
    ) -> Optional[str]:
        """
        Tìm slot giờ đăng tiếp theo gần nhất từ danh sách post_schedule.
        Đảm bảo TUYỆT ĐỐI không bao giờ đăng quá gần nhau trên cùng 1 tài khoản (giãn cách tối thiểu min_interval_minutes, mặc định 60 phút).
        Đồng thời nếu có earliest_allowed_time (từ Part trước), slot bắt buộc phải >= earliest_allowed_time.
        Kiểm tra cả các video đang chờ duyệt/xử lý và các video đã đăng thành công trong 48 giờ qua.
        """
        if isinstance(schedule_str, list):
            slots = [str(s).strip() for s in schedule_str if str(s).strip()]
        elif isinstance(schedule_str, str):
            slots = [s.strip() for s in schedule_str.split(",") if s.strip()]
        else:
            slots = []
        now = datetime.now()
        candidates = []
        if min_interval_minutes is None:
            min_interval_minutes = self.get_global_min_interval(cursor=cursor)
        min_interval_seconds = max(15, min_interval_minutes) * 60

        # Mốc thời gian hợp lệ tối thiểu (ít nhất 10 phút sau hiện tại, và sau Part trước nếu có)
        min_valid_threshold = now + timedelta(minutes=10)
        if earliest_allowed_time and earliest_allowed_time > min_valid_threshold:
            min_valid_threshold = earliest_allowed_time

        # Tạo candidate slots cho 30 ngày liên tiếp để luôn có đủ slot an toàn (gối đầu liên tục)
        for day_offset in range(30):
            base_date = now + timedelta(days=day_offset)
            for s in slots:
                try:
                    parts = s.split(":")
                    sh, sm = int(parts[0]), int(parts[1])
                    t_slot = base_date.replace(hour=sh, minute=sm, second=0, microsecond=0)
                    # Thêm độ trễ jitter ngẫu nhiên
                    jitter = random.randint(-abs(random_delay_minutes), abs(random_delay_minutes))
                    t_slot_jittered = t_slot + timedelta(minutes=jitter)

                    # Phải sau mốc hợp lệ tối thiểu (giữ nguyên mọi khung giờ do người dùng tự cài đặt, kể cả 01:00)
                    if t_slot_jittered >= min_valid_threshold:
                        candidates.append(t_slot_jittered)
                except Exception:
                    pass

        candidates.sort()

        # Kiểm tra lịch sử và lịch trình của profile để tránh trùng hoặc quá gần giờ đăng
        existing_times = []
        farm_scheduled_times = []
        min_farm_stagger_seconds = 2 * 60  # Giãn cách 2 phút giữa các tài khoản để tránh mở trình duyệt cùng lúc gây nghẽn CPU

        if profile_id:
            local_conn = None
            try:
                if not cursor:
                    local_conn = get_connection()
                    cur = local_conn.cursor()
                else:
                    cur = cursor

                from backend.database import get_linked_profile_ids
                linked_ids = get_linked_profile_ids(cur, profile_id)
                ph = ",".join("?" for _ in linked_ids)

                # 1. Các task đang đợi hoặc đang đăng của profile này VÀ các profile cùng nick (kể cả trên browser khác)
                cur.execute(f"""
                    SELECT scheduled_time FROM upload_tasks
                    WHERE gpm_profile_id IN ({ph}) AND status IN ('queued', 'processing')
                      AND scheduled_time IS NOT NULL
                """, tuple(linked_ids))
                for row in cur.fetchall():
                    if row[0]:
                        try:
                            existing_times.append(datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S"))
                        except Exception:
                            pass

                # 2. Các task đã đăng thành công trong 48 giờ qua của profile này VÀ các profile cùng nick
                two_days_ago = (now - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")
                cur.execute(f"""
                    SELECT uploaded_at FROM upload_tasks
                    WHERE gpm_profile_id IN ({ph}) AND status = 'completed'
                      AND uploaded_at >= ?
                """, (*linked_ids, two_days_ago))
                for row in cur.fetchall():
                    if row[0]:
                        try:
                            existing_times.append(datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S"))
                        except Exception:
                            pass

                # 3. Gap 2: Farm-Level Anti-Clustering Guard (Giãn cách toàn Farm)
                # Chỉ áp dụng nếu enforce_farm_stagger=True (các chế độ khác parallel_slots)
                if enforce_farm_stagger:
                    cur.execute("""
                        SELECT scheduled_time FROM upload_tasks
                        WHERE gpm_profile_id NOT IN ({ph}) AND status IN ('queued', 'processing')
                          AND scheduled_time >= ?
                    """.replace("{ph}", ph), (*linked_ids, now.strftime("%Y-%m-%d %H:%M:%S")))
                    for row in cur.fetchall():
                        if row[0]:
                            try:
                                farm_scheduled_times.append(datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S"))
                            except Exception:
                                pass

            except Exception:
                pass
            finally:
                if local_conn:
                    try:
                        local_conn.close()
                    except Exception:
                        pass

        # Duyệt từng ngày một (Hôm nay -> Ngày mai -> Ngày mốt...)
        # Đảm bảo nguyên tắc TUYỆT ĐỐI: Lấp đầy hôm nay cho tất cả các nick trước, khi hôm nay kín mới gối sang ngày mai
        for day_offset in range(30):
            day_candidates = [c for c in candidates if (c.date() - now.date()).days == day_offset]
            if not day_candidates:
                continue

            cand_date_str = day_candidates[0].strftime("%Y-%m-%d")
            if target_date_only and cand_date_str != target_date_only:
                continue

            day_count = sum(1 for ext in existing_times if ext.strftime("%Y-%m-%d") == cand_date_str)
            if daily_limit and day_count >= daily_limit:
                continue

            # Bước 1: Tìm slot trên ngày này vừa an toàn tài khoản vừa giãn cách farm (tránh mở trình duyệt cùng phút)
            for cand in day_candidates:
                account_safe = not any(abs((cand - ext).total_seconds()) < min_interval_seconds for ext in existing_times)
                farm_safe = not enforce_farm_stagger or not any(abs((cand - fext).total_seconds()) < min_farm_stagger_seconds for fext in farm_scheduled_times)
                if account_safe and farm_safe:
                    return cand.strftime("%Y-%m-%d %H:%M:%S")

            # Bước 2: Nếu ngày này nick chưa đủ daily_limit nhưng farm đông:
            # Ưu tiên LẤP ĐẦY NGÀY NÀY (thỏa mãn giãn cách tài khoản) thay vì bị đẩy sang ngày mai
            for cand in day_candidates:
                account_safe = not any(abs((cand - ext).total_seconds()) < min_interval_seconds for ext in existing_times)
                if account_safe:
                    return cand.strftime("%Y-%m-%d %H:%M:%S")

        # Nếu chỉ định target_date_only mà ngày đó đã đầy/hết slot hợp lệ:
        if target_date_only:
            return None

        # Fallback an toàn: Lấy mốc thời gian lớn nhất, cộng thêm min_interval_minutes
        ref_times = [now] + existing_times
        if earliest_allowed_time:
            ref_times.append(earliest_allowed_time)
        reference_time = max(ref_times)
        safe_fallback = reference_time + timedelta(minutes=min_interval_minutes)
        return safe_fallback.strftime("%Y-%m-%d %H:%M:%S")

    def distribute_campaign_backlog(
        self,
        campaign: Dict[str, Any],
        max_items: Optional[int] = None
    ) -> int:
        """
        Tự động lấy video đã render có sẵn trong kho (Backlog Feed) để bù vào hàng đợi đăng:
        1. Lấy đúng các kênh nguồn thuộc chiến dịch (campaign.channel_ids).
        2. Sắp xếp từ MỚI ĐẾN CŨ (v.id DESC, v.created_at DESC).
        3. Kiểm tra file rendered_path trên đĩa, nếu mất file thì reset status='draft'.
        4. Bỏ qua video đã có task trong upload_tasks (chưa đăng hoặc đã đăng).
        5. Lấp đầy khung giờ HÔM NAY trước cho tất cả các profile của chiến dịch.
           Khi hôm nay đã đầy mới gối đầu sang ngày mai, ngày mốt...
        6. Đảm bảo mỗi video chỉ gán cho 1 nick duy nhất, không trùng lặp.
        """
        camp_id = campaign.get("id")
        if not camp_id:
            return 0

        if campaign.get("auto_upload") == 0:
            return 0

        # Lấy danh sách channel_ids của chiến dịch
        ch_ids = []
        try:
            raw_ch = campaign.get("channel_ids")
            if isinstance(raw_ch, list):
                ch_ids = [str(c).strip() for c in raw_ch if str(c).strip()]
            elif isinstance(raw_ch, str):
                ch_ids = json.loads(raw_ch)
        except Exception:
            pass

        if not ch_ids and campaign.get("channel_id"):
            ch_ids = [str(campaign.get("channel_id")).strip()]

        if not ch_ids:
            return 0

        backlog_videos = []
        conn = get_connection()
        try:
            cursor = conn.cursor()
            ph = ",".join("?" for _ in ch_ids)
            query = f"""
                SELECT v.id, v.title, v.rendered_path, v.ai_tags, v.created_at, v.channel_id
                FROM videos v
                WHERE v.channel_id IN ({ph})
                  AND v.status = 'rendered'
                  AND v.rendered_path IS NOT NULL AND v.rendered_path != ''
                  AND NOT EXISTS (
                      SELECT 1 FROM upload_tasks ut
                      WHERE ut.video_id = v.id AND ut.status IN ('queued', 'processing', 'completed')
                  )
                ORDER BY v.id DESC
            """
            cursor.execute(query, tuple(ch_ids))
            backlog_videos = [dict(r) for r in cursor.fetchall()]
        finally:
            conn.close()

        if not backlog_videos:
            return 0

        # Xác định ngày mục tiêu cần lấp đầy:
        # Tìm ngày sớm nhất còn slot trống để lấp đầy (Hôm nay -> nếu hôm nay đã kín thì Ngày mai...)
        # Đảm bảo CHỈ LẤP ĐẦY ĐÚNG 1 NGÀY NÀY, các ngày sau để trống hoàn toàn để ưu tiên cho video mới tải về
        now = datetime.now()
        clean_gpm_ids = []
        gpm_ids = []
        try:
            raw_gpm = campaign.get("gpm_profile_ids")
            if isinstance(raw_gpm, list): gpm_ids = raw_gpm
            elif isinstance(raw_gpm, str) and raw_gpm.strip(): gpm_ids = json.loads(raw_gpm)
        except Exception:
            pass
        if not gpm_ids and campaign.get("gpm_profile_id"):
            gpm_ids = [campaign["gpm_profile_id"]]
        
        for gid in (gpm_ids or []):
            try: clean_gpm_ids.append(int(gid))
            except Exception: pass

        target_date = None
        random_delay = campaign.get("random_delay_minutes", 10)
        for day_offset in range(30):
            check_date = (now + timedelta(days=day_offset)).strftime("%Y-%m-%d")
            for gid in clean_gpm_ids:
                p_sched, p_limit, p_min_int = self._get_effective_schedule_params(campaign, gid)
                slot_t = self._calculate_next_post_time(
                    p_sched,
                    random_delay,
                    profile_id=gid,
                    min_interval_minutes=p_min_int,
                    enforce_farm_stagger=False,
                    daily_limit=p_limit,
                    target_date_only=check_date
                )
                if slot_t and slot_t.startswith(check_date):
                    target_date = check_date
                    break
            if target_date:
                break

        if not target_date:
            # Tất cả các ngày trong 30 ngày tới đều đã kín lịch
            return 0

        scheduled_count = 0
        missing_file_ids = []
        limit = max_items if (max_items and max_items > 0) else len(backlog_videos)

        try:
            for row in backlog_videos:
                if scheduled_count >= limit:
                    break

                vid_id = row["id"]
                r_path = row["rendered_path"]
                title = row["title"] or f"Video #{vid_id}"
                tags = row["ai_tags"] or ""

                # Kiểm tra file thực tế trên đĩa
                if not r_path or not os.path.exists(r_path):
                    missing_file_ids.append(vid_id)
                    continue

                # Lên lịch phân phối cho video thành phẩm (CHỈ lấp đầy ngày target_date)
                res = self.schedule_campaign_upload(
                    video_id=vid_id,
                    campaign=campaign,
                    title=title,
                    tags=tags,
                    video_path=r_path,
                    part_number=1,
                    target_date_only=target_date
                )

                if res and res.get("task_id"):
                    scheduled_count += 1
                else:
                    # Ngày mục tiêu (target_date) đã kín hoàn toàn cho tất cả các nick!
                    # Dừng lại ngay, TUYỆT ĐỐI không gối sang ngày sau để dành ngày sau cho video mới
                    break

            if missing_file_ids:
                m_conn = get_connection()
                try:
                    m_cur = m_conn.cursor()
                    m_ph = ",".join("?" for _ in missing_file_ids)
                    m_cur.execute(f"UPDATE videos SET status = 'draft' WHERE id IN ({m_ph})", tuple(missing_file_ids))
                    m_conn.commit()
                finally:
                    m_conn.close()

            if scheduled_count > 0:
                log_campaign_event(
                    camp_id,
                    "SUCCESS",
                    "distribute",
                    f"⚡ [Bù Video Từ Kho] Đã tự động bốc {scheduled_count} video thành phẩm có sẵn trong kho (từ mới đến cũ) lấp kín các khung giờ ngày {target_date}. Ngày tiếp theo được để trống để ưu tiên video mới tải về!"
                )
        except Exception as e:
            log_campaign_event(camp_id, "ERROR", "distribute", f"Lỗi khi bốc video từ kho bù vào hàng đợi: {str(e)}")

        return scheduled_count

distributor = ContentDistributor()
