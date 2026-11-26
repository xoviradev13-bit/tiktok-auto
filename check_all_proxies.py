import os
import sys
import time
import socket
import requests
from pathlib import Path

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backend.modules.wireproxy_manager import wireproxy_manager, VPN_CONFIGS_DIR, WIREPROXY_EXE

def check_all():
    print("=" * 70)
    print("CHECKING ALL WIREPROXY / VPN CONFIGS ONE BY ONE")
    print("=" * 70)
    print(f"Wireproxy executable: {WIREPROXY_EXE} (Exists: {WIREPROXY_EXE.exists()})")
    print(f"VPN Configs Directory: {VPN_CONFIGS_DIR}")
    
    conf_files = sorted(list(VPN_CONFIGS_DIR.glob("*.conf")))
    print(f"Found {len(conf_files)} configuration files.\n")
    
    results = []
    
    for cf in conf_files:
        info = wireproxy_manager.parse_config_info(cf)
        pid = info["proxy_id"]
        country = info["country"]
        label = info["label"]
        print(f"\n--- Testing: {cf.name} ---")
        print(f"  Target: {label} (Country: {country}, Proxy ID: {pid})")
        
        # Start or restart proxy
        started = wireproxy_manager.start_proxy(cf)
        if not started:
            print(f"  [FAIL] Failed to start wireproxy process for {cf.name}")
            # Read log if exists
            log_path = Path("data/logs") / f"wireproxy_{pid}.log"
            if log_path.exists():
                with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                    log_content = f.read().strip()
                print(f"  Log output:\n    {log_content}")
            results.append({
                "file": cf.name,
                "country": country,
                "label": label,
                "port": None,
                "status": "PROCESS_FAILED",
                "ip": None,
                "latency": None,
                "error": "Could not bind port or process crashed"
            })
            continue
            
        meta = wireproxy_manager.proxies.get(pid, {})
        port = meta.get("port")
        print(f"  Listening on port: {port}")
        
        # Test internet connectivity via SOCKS5
        proxies = {
            "http": f"socks5h://127.0.0.1:{port}",
            "https": f"socks5h://127.0.0.1:{port}"
        }
        
        test_endpoints = [
            ("ipify", "https://api.ipify.org?format=json"),
            ("ipinfo", "https://ipinfo.io/json"),
        ]
        
        success = False
        detected_ip = None
        detected_country = None
        latency_ms = None
        err_msg = None
        
        for ep_name, ep_url in test_endpoints:
            t0 = time.time()
            try:
                resp = requests.get(ep_url, proxies=proxies, timeout=8)
                latency_ms = int((time.time() - t0) * 1000)
                if resp.status_code == 200:
                    data = resp.json()
                    detected_ip = data.get("ip")
                    detected_country = data.get("country")
                    success = True
                    break
            except Exception as e:
                err_msg = str(e)
                
        if success:
            print(f"  [SUCCESS] Connected! Exit IP: {detected_ip} (Country: {detected_country or country}) - Latency: {latency_ms}ms")
            results.append({
                "file": cf.name,
                "country": country,
                "label": label,
                "port": port,
                "status": "WORKING",
                "ip": detected_ip,
                "detected_country": detected_country,
                "latency": latency_ms,
                "error": None
            })
        else:
            print(f"  [FAIL] Cannot connect to Internet via proxy: {err_msg}")
            # Check wireproxy log
            log_path = Path("data/logs") / f"wireproxy_{pid}.log"
            if log_path.exists():
                with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                    log_content = f.read().strip()
                if log_content:
                    print(f"  Wireproxy log:\n    {log_content}")
            results.append({
                "file": cf.name,
                "country": country,
                "label": label,
                "port": port,
                "status": "CONNECTION_FAILED",
                "ip": None,
                "latency": None,
                "error": err_msg
            })
            
    print("\n" + "=" * 70)
    print("FINAL PROXY AUDIT SUMMARY")
    print("=" * 70)
    for r in results:
        status_str = f"[{r['status']}]"
        if r['status'] == "WORKING":
            print(f"  {r['country']:<4} | Port {r['port']} | {r['file']:<20} | IP: {r['ip']:<15} | Latency: {r['latency']}ms | {status_str}")
        else:
            print(f"  {r['country']:<4} | Port {str(r['port']):<5} | {r['file']:<20} | ERROR: {r['error']} | {status_str}")

if __name__ == "__main__":
    check_all()
