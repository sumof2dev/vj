"""
Ehaho Multi-Axis Scan (Config-Driven)
Targets a named stage instance, looks up DMX addresses from ravebox_config.json.
Sweeps:
  Phase 1 — X Rot × Y Rot  (sideways flattening)
  Phase 2 — Draw (delay) × Drawing (shape)
Saves frames + report to SAVE_DIR.
"""

import asyncio
import websockets
import json
import cv2
import numpy as np
import os
import ssl

# ── CONFIG ──────────────────────────────────────────────────────────────────
CONFIG_PATH = "/home/sumof2/vj/fixtures/ravebox_config.json"
SAVE_DIR    = "/home/sumof2/vj/tmp/multi_axis_results"
TARGET_INST = "Left1"   # Stage instance the camera is watching
GRID_SIZE   = 8         # Steps per axis (8×8 = 64 combinations per phase)

# Values held on all channels NOT being swept (neutral state)
BASE_DIM     = 215
BASE_PATTERN = 5    # A clear non-circular shape
BASE_ZOOM    = 255
# ────────────────────────────────────────────────────────────────────────────

os.makedirs(SAVE_DIR, exist_ok=True)


def load_addresses():
    """Return a dict of role->dmx_address for the TARGET_INST fixture."""
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)

    inst = next((s for s in cfg.get("stage", []) if s["id"] == TARGET_INST), None)
    if not inst:
        raise RuntimeError(f"Stage instance '{TARGET_INST}' not found in config")

    fix = next((f for f in cfg.get("fixtures", []) if f["id"] == inst["fixtureId"]), None)
    if not fix:
        raise RuntimeError(f"Fixture for instance '{TARGET_INST}' not found")

    base = int(inst["address"]) + int(inst.get("offset", 0))
    addrs = {}
    for i, ch in enumerate(fix.get("channels", [])):
        role = ch.get("role", "").lower()
        offset = int(ch["addrOffset"]) if "addrOffset" in ch else i
        addr = base + offset
        # Store by role; for duplicates keep the one with lower address
        if role and role not in addrs:
            addrs[role] = addr
        # Also store by channel name (normalised)
        name_key = ch.get("name", "").lower().replace(" ", "_")
        if name_key and name_key not in addrs:
            addrs[name_key] = addr

    print(f"\n[*] Resolved addresses for {TARGET_INST} (base={base}):")
    for k, v in sorted(addrs.items(), key=lambda x: x[1]):
        print(f"    {v:>4}  {k}")
    return addrs


def steps():
    return [int(x) for x in np.linspace(0, 255, GRID_SIZE)]


def already_captured(prefix, a, b):
    return os.path.exists(os.path.join(SAVE_DIR, f"{prefix}_{a:03d}_{b:03d}.jpg"))


async def send(ws, overrides):
    await ws.send(json.dumps({"type": "laser_override", "overrides": overrides}))


def analyze(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
    brightness = int(np.sum(gray) // 1000)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    complexity = sum(len(c) for c in contours)
    return complexity, brightness


async def run_scan():
    addrs = load_addresses()

    # Require these roles to exist
    required = ["dim", "pattern", "zoom", "x_rot", "y_rot", "draw", "drawing"]
    missing = [r for r in required if r not in addrs]
    if missing:
        raise RuntimeError(f"Could not resolve addresses for roles: {missing}\nAvailable: {list(addrs.keys())}")

    ssl_ctx = ssl.SSLContext()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    async with websockets.connect(
        "wss://localhost:8765", ssl=ssl_ctx,
        ping_interval=20, ping_timeout=60
    ) as ws:
        cap = cv2.VideoCapture(0)
        report = []

        # Set neutral base state (all non-swept channels)
        await send(ws, [
            {"address": addrs["dim"],     "value": BASE_DIM},
            {"address": addrs["pattern"], "value": BASE_PATTERN},
            {"address": addrs["zoom"],    "value": BASE_ZOOM},
            {"address": addrs["x_rot"],   "value": 0},
            {"address": addrs["y_rot"],   "value": 0},
            {"address": addrs["draw"],    "value": 0},
            {"address": addrs["drawing"], "value": 0},
        ])
        await asyncio.sleep(1.5)
        print(f"\n[*] Phase 1: X Rot × Y Rot sweep")

        # ── PHASE 1: Rotation ────────────────────────────────────────────────
        for x_rot in steps():
            for y_rot in steps():
                if already_captured("rot", x_rot, y_rot):
                    continue

                await send(ws, [
                    {"address": addrs["x_rot"], "value": x_rot},
                    {"address": addrs["y_rot"], "value": y_rot},
                ])
                await asyncio.sleep(0.5)

                ret, frame = cap.read()
                if ret:
                    comp, bright = analyze(frame)
                    fname = f"rot_{x_rot:03d}_{y_rot:03d}.jpg"
                    cv2.imwrite(os.path.join(SAVE_DIR, fname), frame)
                    report.append({
                        "type": "rotation", "x_rot": x_rot, "y_rot": y_rot,
                        "complexity": comp, "brightness": bright, "file": fname
                    })
                    print(f"  [Rot] X:{x_rot:>3} Y:{y_rot:>3} -> Comp:{comp}")

        # Reset rotation
        await send(ws, [
            {"address": addrs["x_rot"], "value": 0},
            {"address": addrs["y_rot"], "value": 0},
        ])
        await asyncio.sleep(0.8)
        print(f"\n[*] Phase 2: Draw (delay) × Drawing sweep")

        # ── PHASE 2: Drawing ─────────────────────────────────────────────────
        for draw_val in steps():
            for drawing_val in steps():
                if already_captured("draw", draw_val, drawing_val):
                    continue

                await send(ws, [
                    {"address": addrs["draw"],    "value": draw_val},
                    {"address": addrs["drawing"], "value": drawing_val},
                ])
                await asyncio.sleep(0.55)

                ret, frame = cap.read()
                if ret:
                    comp, bright = analyze(frame)
                    fname = f"draw_{draw_val:03d}_{drawing_val:03d}.jpg"
                    cv2.imwrite(os.path.join(SAVE_DIR, fname), frame)
                    report.append({
                        "type": "drawing", "draw": draw_val, "drawing": drawing_val,
                        "complexity": comp, "brightness": bright, "file": fname
                    })
                    print(f"  [Draw] delay:{draw_val:>3} drawing:{drawing_val:>3} -> Comp:{comp}")

        cap.release()

        report_path = os.path.join(SAVE_DIR, "multi_axis_report.json")
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n[*] Done. {len(report)} frames captured. Report: {report_path}")


if __name__ == "__main__":
    asyncio.run(run_scan())
