#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OMOCaptcha Solver Client
Compatible with OMOCaptcha API v2 (https://api.omocaptcha.com/v2)
Supports:
- TiktokSliderWebTask (TikTok drag puzzle)
- TiktokRotateWebTask (TikTok image rotation)
- Tiktok3DSelectObjectWebTask / TiktokSelectObjectWebTask
"""

import time
import base64
import requests
from typing import Dict, Any, Optional, Union, List


class OMOCaptchaSolver:
    BASE_URL = "https://api.omocaptcha.com/v2"

    def __init__(self, api_key: str):
        self.api_key = api_key.strip()

    def get_balance_info(self) -> Optional[Dict[str, Any]]:
        """Check detailed balance and package info on OMOCaptcha account."""
        if not self.api_key:
            return None
        try:
            r = requests.post(
                f"{self.BASE_URL}/getBalance",
                json={"clientKey": self.api_key},
                timeout=10
            )
            data = r.json()
            if data.get("errorId") == 0:
                return {
                    "balance": float(data.get("balance", 0.0) or 0.0),
                    "quantity": int(data.get("quantity", 0) or 0),
                    "package_name": data.get("packageName", "")
                }
        except Exception as e:
            print(f"[OMOCaptcha] Check balance error: {e}")
        return None

    def get_balance(self) -> Optional[float]:
        """Check remaining balance on OMOCaptcha account."""
        info = self.get_balance_info()
        if info:
            return info.get("balance")
        return None

    def create_task(self, task_payload: Dict[str, Any]) -> Optional[str]:
        """Submit task to OMOCaptcha and return taskId."""
        try:
            r = requests.post(
                f"{self.BASE_URL}/createTask",
                json={
                    "clientKey": self.api_key,
                    "task": task_payload
                },
                timeout=15
            )
            data = r.json()
            if data.get("errorId") == 0:
                return str(data.get("taskId"))
            else:
                desc = data.get("errorDescription") or data.get("errorCode") or "Unknown error"
                print(f"[OMOCaptcha] Create task failed: {desc}")
        except Exception as e:
            print(f"[OMOCaptcha] Exception creating task: {e}")
        return None

    def poll_result(self, task_id: str, timeout: int = 40) -> Optional[Dict[str, Any]]:
        """Poll getTaskResult until status is 'ready' or timeout reached."""
        start = time.time()
        while time.time() - start < timeout:
            time.sleep(1.5)
            try:
                r = requests.post(
                    f"{self.BASE_URL}/getTaskResult",
                    json={
                        "clientKey": self.api_key,
                        "taskId": task_id
                    },
                    timeout=10
                )
                data = r.json()
                if data.get("errorId") != 0:
                    desc = data.get("errorDescription") or data.get("errorCode")
                    print(f"[OMOCaptcha] Task error: {desc}")
                    return None

                status = data.get("status")
                if status == "ready":
                    return data.get("solution")
                elif status == "fail":
                    print("[OMOCaptcha] Task resolution failed by AI worker.")
                    return None
            except Exception as e:
                print(f"[OMOCaptcha] Polling exception: {e}")

        print("[OMOCaptcha] Polling timed out waiting for result.")
        return None

    def solve_tiktok_slider(self, image_base64: str) -> Optional[float]:
        """
        Solves TikTok slider captcha given base64 image data.
        Returns float: either ratio (0.0 to 1.0) or absolute pixel offset.
        """
        if not self.api_key:
            return None

        # Clean base64 header if present
        if "base64," in image_base64:
            image_base64 = image_base64.split("base64,")[1]

        task_id = self.create_task({
            "type": "TiktokSliderWebTask",
            "imageBase64": image_base64
        })

        if not task_id:
            return None

        print(f"[OMOCaptcha] Slider task #{task_id} submitted. Solving...")
        solution = self.poll_result(task_id, timeout=30)
        if not solution:
            return None

        # Extract X coordinate / distance / ratio
        x_val = solution.get("x")
        if x_val is None:
            x_val = solution.get("distance")
        if x_val is None and isinstance(solution.get("point"), dict):
            x_val = solution["point"].get("x")

        if x_val is not None:
            try:
                return float(x_val)
            except Exception:
                pass

        print(f"[OMOCaptcha] Could not parse solution payload: {solution}")
        return None

    def solve_tiktok_rotate(self, image_base64s: List[str]) -> Optional[int]:
        """
        Solves TikTok rotation captcha.
        Returns the angle (degrees) to rotate.
        """
        if not self.api_key:
            return None

        cleaned_images = []
        for img in image_base64s:
            if "base64," in img:
                img = img.split("base64,")[1]
            cleaned_images.append(img)

        task_id = self.create_task({
            "type": "TiktokRotateWebTask",
            "imageBase64s": cleaned_images
        })

        if not task_id:
            return None

        print(f"[OMOCaptcha] Rotate task #{task_id} submitted. Solving...")
        solution = self.poll_result(task_id, timeout=30)
        if solution and "angle" in solution:
            return int(solution["angle"])

        return None

