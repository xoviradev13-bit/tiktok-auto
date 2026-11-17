import os
import re
import json
import time
import requests
from pathlib import Path
from typing import Dict, Any, Optional, Callable
from backend.config import DOWNLOADS_DIR
from backend.database import log_event
from backend.logger import get_logger

logger = get_logger("multi_downloader")

DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

class MultiPlatformDownloader:
    """
    Trình tải video đa nền tảng không watermark:
    - YouTube, Facebook, Instagram, Bilibili, Weibo (qua yt-dlp tối ưu)
    - Douyin (TikTok TQ - bóc tách qua Mobile Feed API không logo)
    - Xiaohongshu / RedNote (Tiểu Hồng Thư - bóc tách CDN stream sạch)
    """

    @staticmethod
    def extract_clean_url(text: str) -> str:
        """Trích xuất URL http/https sạch từ chuỗi văn bản người dùng copy/paste có kèm tiêu đề hoặc ghi chú"""
        if not text:
            return ""
        m = re.search(r"https?://[^\s<>\"\'\)]+", text)
        if m:
            clean = m.group(0).rstrip(".,;!?'\"，。！？）】>")
            return clean
        return text.strip()

    @classmethod
    def detect_platform(cls, url: str) -> str:
        clean_u = cls.extract_clean_url(url).lower()
        if "douyin.com" in clean_u or "iesdouyin.com" in clean_u:
            return "douyin"
        elif "rednote.com" in clean_u:
            return "rednote"
        elif "xiaohongshu.com" in clean_u or "xhslink.com" in clean_u:
            return "xiaohongshu"
        elif "youtube.com" in clean_u or "youtu.be" in clean_u:
            return "youtube"
        elif "facebook.com" in clean_u or "fb.watch" in clean_u or "fb.com" in clean_u:
            return "facebook"
        elif "instagram.com" in clean_u:
            return "instagram"
        elif "weibo.com" in clean_u or "weibo.cn" in clean_u:
            return "weibo"
        elif "bilibili.com" in clean_u or "b23.tv" in clean_u or "bilibili.tv" in clean_u:
            return "bilibili"
        elif "tiktok.com" in clean_u:
            return "tiktok"
        return "generic"

    def download(self, url: str, output_dir: Optional[Path] = None, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        target_dir = Path(output_dir) if output_dir else DOWNLOADS_DIR
        target_dir.mkdir(parents=True, exist_ok=True)

        clean_url = self.extract_clean_url(url)
        if not clean_url:
            return {"success": False, "message": "Liên kết rỗng hoặc không hợp lệ!"}

        platform = self.detect_platform(clean_url)
        log_event("INFO", f"Nhận diện nền tảng [{platform.upper()}] cho liên kết: {clean_url}")

        if progress_callback:
            progress_callback(5.0, 0, 0, "", "", f"Đã nhận diện nền tảng [{platform.upper()}], đang phân tích liên kết...", "")

        if platform == "douyin":
            res = self._download_douyin(clean_url, target_dir, progress_callback)
            if res.get("success"):
                return res
            log_event("WARNING", "Douyin parser fallback sang yt-dlp...")

        elif platform in ("xiaohongshu", "rednote"):
            res = self._download_xiaohongshu(clean_url, target_dir, progress_callback)
            if res.get("success"):
                return res
            log_event("WARNING", "Xiaohongshu/RedNote parser fallback sang yt-dlp...")

        # Mặc định dùng yt-dlp cho YouTube, Facebook, Instagram, Weibo, Bilibili, TikTok
        return self._download_ytdlp(clean_url, target_dir, platform, progress_callback)

    def _download_douyin(self, share_url: str, target_dir: Path, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Tải video Douyin gốc không logo/watermark thông qua mobile feed API"""
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
            "Referer": "https://www.douyin.com/",
        }

        try:
            clean_url = self.extract_clean_url(share_url)

            # 1. Theo dõi redirect để lấy item_id / video_id
            session = requests.Session()
            r = session.get(clean_url, headers=headers, allow_redirects=True, timeout=12)
            final_url = r.url

            video_id_match = re.search(r"(?:video|note|share/video)/(\d+)", final_url)
            if not video_id_match:
                video_id_match = re.search(r"modal_id=(\d+)", final_url)

            if not video_id_match:
                return {"success": False, "message": "Không tìm thấy ID video Douyin từ liên kết"}

            video_id = video_id_match.group(1)

            # 2. Thử lấy qua Mobile Feed API của Douyin (không bị dính ArgusSecurity challenge)
            title = f"douyin_{video_id}"
            cdn_url = None

            try:
                feed_api = f"https://api.amemv.com/aweme/v1/feed/?aweme_id={video_id}"
                feed_headers = {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                }
                feed_res = session.get(feed_api, headers=feed_headers, timeout=12).json()
                aweme_list = feed_res.get("aweme_list", [])
                if aweme_list:
                    aweme_item = aweme_list[0]
                    title = aweme_item.get("desc") or title
                    v_obj = aweme_item.get("video", {})
                    p_addr = v_obj.get("play_addr", {})
                    u_list = p_addr.get("url_list", [])
                    if u_list:
                        cdn_url = u_list[0].replace("playwm", "play")
            except Exception as e:
                logger.warning(f"Douyin feed API thất bại: {e}")

            # 3. Fallback sang Web Detail API nếu feed API không ra link
            if not cdn_url:
                api_url = f"https://www.iesdouyin.com/aweme/v1/web/aweme/detail/?aweme_id={video_id}"
                api_res = session.get(api_url, headers=headers, timeout=12).json()
                aweme_detail = api_res.get("aweme_detail", {})
                title = aweme_detail.get("desc") or title
                video_obj = aweme_detail.get("video", {})
                play_addr = video_obj.get("play_addr", {})
                url_list = play_addr.get("url_list", [])
                if url_list:
                    cdn_url = url_list[0].replace("playwm", "play")

            if not cdn_url:
                return {"success": False, "message": "Không trích xuất được link tải CDN Douyin không logo"}

            safe_title = re.sub(r'[\\/*?:"<>|]', "", title)[:60].strip() or f"douyin_{video_id}"
            output_file = target_dir / f"{safe_title}_{video_id}.mp4"

            # Tải file stream với progress callback
            dl_headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.douyin.com/",
            }
            with session.get(cdn_url, headers=dl_headers, stream=True, timeout=60) as stream:
                stream.raise_for_status()
                total_len = int(stream.headers.get("content-length") or 0)
                downloaded = 0
                start_t = time.time()
                with open(output_file, "wb") as f:
                    for chunk in stream.iter_content(chunk_size=131072):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress_callback and total_len > 0:
                            pct = min(99.0, round((downloaded / total_len) * 100, 1))
                            el = max(0.1, time.time() - start_t)
                            spd = round((downloaded / el) / (1024 * 1024), 2)
                            eta = int((total_len - downloaded) / max(1, downloaded / el))
                            progress_callback(pct, downloaded, total_len, f"{spd} MB/s", f"{eta}s", "Đang tải video Douyin...", title)

            if progress_callback:
                progress_callback(100.0, os.path.getsize(output_file), os.path.getsize(output_file), "", "", "Hoàn tất tải video!", title)

            log_event("SUCCESS", f"Tải Douyin thành công không watermark: {output_file.name}")
            return {
                "success": True,
                "file_path": str(output_file),
                "title": title,
                "platform": "douyin",
                "video_id": video_id,
            }
        except Exception as e:
            logger.error(f"Lỗi tải Douyin: {e}")
            return {"success": False, "message": f"Douyin Error: {str(e)}"}

    def _download_xiaohongshu(self, share_url: str, target_dir: Path, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Tải video Xiaohongshu / RedNote gốc không watermark"""
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
            "Referer": "https://www.rednote.com/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }

        try:
            clean_url = self.extract_clean_url(share_url)
            is_rednote = "rednote" in clean_url.lower()

            session = requests.Session()
            r = session.get(clean_url, headers=headers, allow_redirects=True, timeout=15)
            html = r.text

            match = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?</script>", html)
            video_url = None
            title = "rednote_video" if is_rednote else "xiaohongshu_video"

            if match:
                raw_json = match.group(1).replace(":undefined", ":null")
                try:
                    data = json.loads(raw_json)

                    # Dạng 1: Mobile RedNote (noteData)
                    note_obj = data.get("noteData", {}).get("data", {}).get("noteData")
                    if not note_obj:
                        # Dạng 2: Xiaohongshu Web/Desktop (noteDetailMap)
                        note_map = data.get("note", {}).get("noteDetailMap", {})
                        for k, v in note_map.items():
                            note_obj = v.get("note", {})
                            break

                    if note_obj:
                        title = note_obj.get("title") or note_obj.get("desc") or title
                        vid_data = note_obj.get("video", {})

                        # 1. Kiểm tra mediaV2 stream
                        media_v2 = vid_data.get("mediaV2")
                        if isinstance(media_v2, str):
                            try:
                                media_v2 = json.loads(media_v2)
                            except Exception:
                                media_v2 = {}
                        elif not isinstance(media_v2, dict):
                            media_v2 = {}

                        streams = media_v2.get("stream", {})
                        if isinstance(streams, dict):
                            for codec in ["h264", "h265"]:
                                for s in streams.get(codec, []):
                                    if isinstance(s, dict) and s.get("master_url"):
                                        video_url = s["master_url"]
                                        break
                                    elif isinstance(s, dict) and s.get("backup_urls"):
                                        video_url = s["backup_urls"][0]
                                        break
                                if video_url:
                                    break

                        # 2. Kiểm tra stream trong media thông thường
                        if not video_url:
                            stream_types = vid_data.get("media", {}).get("stream", {})
                            for st in ["h264", "h265"]:
                                streams_list = stream_types.get(st, [])
                                if streams_list and isinstance(streams_list, list):
                                    video_url = streams_list[0].get("masterUrl")
                                    if video_url:
                                        break

                        # 3. Kiểm tra originVideoKey
                        if not video_url:
                            origin_key = vid_data.get("consumer", {}).get("originVideoKey")
                            if origin_key:
                                video_url = f"http://sns-v11.rednotecdn.com/{origin_key}"
                except Exception as e:
                    logger.warning(f"Lỗi phân tích JSON XHS/RedNote: {e}")

            # 4. Fallback Regex tìm trực tiếp link CDN nếu không parse được qua JSON
            if not video_url:
                regex_cdn = re.search(r'(https?://[a-zA-Z0-9.-]+\.(?:xhscdn|rednotecdn)\.com/[a-zA-Z0-9_/-]+\.mp4)', html)
                if regex_cdn:
                    video_url = regex_cdn.group(1)

            if not video_url:
                return {"success": False, "message": "Không tìm thấy link video Xiaohongshu / RedNote"}

            safe_title = re.sub(r'[\\/*?:"<>|]', "", title)[:60].strip() or ("rednote_video" if is_rednote else "xhs_video")
            output_file = target_dir / f"{safe_title}.mp4"

            with session.get(video_url, headers=headers, stream=True, timeout=45) as stream:
                stream.raise_for_status()
                total_len = int(stream.headers.get("content-length") or 0)
                downloaded = 0
                start_t = time.time()
                with open(output_file, "wb") as f:
                    for chunk in stream.iter_content(chunk_size=131072):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress_callback and total_len > 0:
                            pct = min(99.0, round((downloaded / total_len) * 100, 1))
                            el = max(0.1, time.time() - start_t)
                            spd = round((downloaded / el) / (1024 * 1024), 2)
                            eta = int((total_len - downloaded) / max(1, downloaded / el))
                            progress_callback(pct, downloaded, total_len, f"{spd} MB/s", f"{eta}s", f"Đang tải {is_rednote and 'REDNOTE' or 'XIAOHONGSHU'}...", title)

            if progress_callback:
                progress_callback(100.0, os.path.getsize(output_file), os.path.getsize(output_file), "", "", "Hoàn tất tải video!", title)

            platform_tag = "rednote" if is_rednote else "xiaohongshu"
            log_event("SUCCESS", f"Tải {platform_tag.upper()} thành công: {output_file.name}")
            return {
                "success": True,
                "file_path": str(output_file),
                "title": title,
                "platform": platform_tag
            }
        except Exception as e:
            logger.error(f"Lỗi tải Xiaohongshu / RedNote: {e}")
            return {"success": False, "message": f"Xiaohongshu/RedNote Error: {str(e)}"}

    def _download_ytdlp(self, url: str, target_dir: Path, platform: str, progress_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """Tải bằng yt-dlp cho YouTube, Facebook, Instagram, Bilibili, Weibo, TikTok"""
        try:
            import yt_dlp
        except ImportError:
            return {"success": False, "message": "Chưa cài yt-dlp. Chạy lệnh: pip install yt-dlp"}

        clean_url = self.extract_clean_url(url)
        out_template = str(target_dir / "%(title).60s_%(id)s.%(ext)s")

        # Tự động phát hiện FFmpeg binary trong hệ thống hoặc qua get_ffmpeg_binary
        ffmpeg_bin = None
        try:
            from backend.modules.video_core.hardware_accel import get_ffmpeg_binary
            ffmpeg_bin = get_ffmpeg_binary()
        except Exception:
            pass

        def ytdl_progress_hook(d):
            if not progress_callback:
                return
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                dl = d.get("downloaded_bytes") or 0
                pct = 0.0
                if total > 0:
                    pct = min(99.0, round((dl / total) * 100, 1))
                elif "_percent_str" in d:
                    try:
                        pct = float(re.sub(r"[^\d.]", "", d["_percent_str"]))
                    except Exception:
                        pass
                speed = d.get("speed") or 0
                spd_str = f"{speed / (1024*1024):.2f} MB/s" if speed and speed >= 1024*1024 else (f"{speed / 1024:.1f} KB/s" if speed else "")
                eta = d.get("eta") or 0
                eta_str = f"{int(eta)}s" if eta else ""
                info_dict = d.get("info_dict", {})
                v_title = info_dict.get("title") or ""
                progress_callback(pct, dl, total, spd_str, eta_str, f"Đang tải {platform.upper()} ({pct}%)...", v_title)
            elif status == "finished":
                progress_callback(96.0, 0, 0, "", "", "Đang ghép nối âm thanh & hình ảnh (FFmpeg)...", "")

        ydl_opts = {
            "outtmpl": out_template,
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 30,
            "retries": 3,
            "fragment_retries": 3,
            "progress_hooks": [ytdl_progress_hook],
            "http_headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
        }

        if ffmpeg_bin and os.path.exists(str(ffmpeg_bin)):
            ydl_opts["ffmpeg_location"] = str(ffmpeg_bin)

        cookies_file = Path("cookies.txt")
        if cookies_file.exists():
            ydl_opts["cookiefile"] = str(cookies_file.absolute())

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(clean_url, download=True)
                filename = ydl.prepare_filename(info)
                # Nếu file sau merge là mp4
                base, _ = os.path.splitext(filename)
                final_mp4 = f"{base}.mp4" if os.path.exists(f"{base}.mp4") else filename

                actual_platform = platform if platform != "generic" else (info.get("extractor_key") or "generic").lower()
                if progress_callback:
                    final_size = os.path.getsize(final_mp4) if os.path.exists(final_mp4) else 0
                    progress_callback(100.0, final_size, final_size, "", "", "Hoàn tất tải video!", info.get("title", ""))

                log_event("SUCCESS", f"Tải {actual_platform.upper()} thành công: {os.path.basename(final_mp4)}")
                return {
                    "success": True,
                    "file_path": str(final_mp4),
                    "title": info.get("title", ""),
                    "platform": actual_platform,
                    "duration": info.get("duration", 0),
                    "video_id": info.get("id"),
                }
        except Exception as e:
            logger.error(f"Lỗi yt-dlp: {e}")
            return {"success": False, "message": f"yt-dlp Error: {str(e)}"}

# Singleton toàn cục
multi_downloader = MultiPlatformDownloader()
