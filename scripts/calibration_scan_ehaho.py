"""
Ehaho Hardware Calibration Scan
Phases:
  1. Pattern shape identification (DMX 0-96)
  2. Zoom calibration (static 0-124, dynamic 124-255)
  3. X position mapping
  4. Y position mapping
  5. Rotation analysis (Z, X, Y axes)

Reads addresses from ravebox_config.json — no hardcoded values.
Saves checkpoint per phase; safe to resume.
"""

import asyncio, websockets, json, cv2, numpy as np, os, ssl, time, math

CONFIG_PATH   = "/home/sumof2/vj/fixtures/ravebox_config.json"
SAVE_DIR      = "/home/sumof2/vj/tmp/calibration_results"
REPORT_PATH   = f"{SAVE_DIR}/calibration_report.json"
SUMMARY_PATH  = f"{SAVE_DIR}/calibration_summary.txt"
TARGET_INST   = "Left1"

os.makedirs(SAVE_DIR, exist_ok=True)
os.makedirs(f"{SAVE_DIR}/frames", exist_ok=True)

# ── ADDRESS LOADER ───────────────────────────────────────────────────────────

def load_addresses():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    inst = next(s for s in cfg["stage"] if s["id"] == TARGET_INST)
    fix  = next(f for f in cfg["fixtures"] if f["id"] == inst["fixtureId"])
    base = int(inst["address"]) + int(inst.get("offset", 0))
    addrs = {}
    for i, ch in enumerate(fix.get("channels", [])):
        role   = ch.get("role", "").lower()
        offset = int(ch["addrOffset"]) if "addrOffset" in ch else i
        if role and role not in addrs:
            addrs[role] = base + offset
    print(f"[*] {TARGET_INST} base={base}  roles: {addrs}")
    return addrs

# ── WEBSOCKET ────────────────────────────────────────────────────────────────

async def send_dmx(ws, overrides):
    await ws.send(json.dumps({"type": "laser_override", "overrides": overrides}))

def make_ssl():
    ctx = ssl.SSLContext()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE
    return ctx

# ── VISION ───────────────────────────────────────────────────────────────────

def capture_frame(cap):
    for _ in range(3):           # flush buffer
        cap.read()
    ret, frame = cap.read()
    return frame if ret else None

def largest_contour(frame, min_area=200):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    valid = [c for c in contours if cv2.contourArea(c) > min_area]
    return max(valid, key=cv2.contourArea) if valid else None

def classify_shape(contour, frame_shape):
    area      = cv2.contourArea(contour)
    perimeter = cv2.arcLength(contour, True)
    if perimeter < 1:
        return "unknown", 0, 0.0, 0.0

    circularity = 4 * math.pi * area / (perimeter ** 2)
    epsilon     = 0.04 * perimeter
    approx      = cv2.approxPolyDP(contour, epsilon, True)
    vertices    = len(approx)

    x, y, w, h  = cv2.boundingRect(contour)
    aspect       = min(w, h) / max(w, h) if max(w, h) > 0 else 0
    fh, fw       = frame_shape[:2]
    size_pct     = max(w, h) / max(fw, fh) * 100

    if circularity > 0.82:
        shape = "circle"
    elif vertices == 3:
        shape = "triangle"
    elif vertices == 4:
        shape = "square" if aspect >= 0.85 else "rectangle"
    elif vertices == 5:
        shape = "pentagon"
    elif vertices == 6:
        shape = "hexagon"
    elif vertices <= 10:
        shape = "complex_polygon"
    else:
        shape = "star_or_dynamic"

    rect      = cv2.minAreaRect(contour)
    angle_deg = rect[2]
    rw, rh    = rect[1]
    flatness  = min(rw, rh) / max(rw, rh) if max(rw, rh) > 0 else 1.0

    return shape, vertices, size_pct, angle_deg, flatness, circularity

def get_centroid(contour):
    M = cv2.moments(contour)
    if M["m00"] == 0:
        return (0, 0)
    return (int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"]))

def save_frame(frame, name):
    path = f"{SAVE_DIR}/frames/{name}.jpg"
    cv2.imwrite(path, frame)
    return path

# ── PHASE 1: PATTERNS ────────────────────────────────────────────────────────

async def phase_patterns(ws, cap, addrs):
    print("\n[Phase 1] Pattern Shape Identification (DMX 0–96)")
    checkpoint = f"{SAVE_DIR}/phase1_checkpoint.json"
    results    = {}

    if os.path.exists(checkpoint):
        with open(checkpoint) as f:
            results = json.load(f)
        print(f"  Resuming — {len(results)} values already done")

    # Neutral base
    await send_dmx(ws, [
        {"address": addrs["dim"],     "value": 215},
        {"address": addrs["pattern"], "value": 0},
        {"address": addrs["zoom"],    "value": 0},
        {"address": addrs["x_rot"],   "value": 0},
        {"address": addrs["y_rot"],   "value": 0},
        {"address": addrs["z_rot"],   "value": 0},
        {"address": addrs["x_pos"],   "value": 127},
        {"address": addrs["y_pos"],   "value": 127},
        {"address": addrs["draw"],    "value": 0},
        {"address": addrs["drawing"], "value": 0},
    ])
    await asyncio.sleep(1.5)

    for dmx in range(0, 97, 1):
        key = str(dmx)
        if key in results:
            continue

        await send_dmx(ws, [{"address": addrs["pattern"], "value": dmx}])
        await asyncio.sleep(0.5)

        frame = capture_frame(cap)
        if frame is None:
            results[key] = {"error": "no frame"}
            continue

        c = largest_contour(frame)
        if c is None:
            results[key] = {"shape": "none", "note": "no laser detected"}
            save_frame(frame, f"pat_{dmx:03d}_dark")
        else:
            shape, verts, size_pct, angle, flatness, circ = classify_shape(c, frame.shape)
            fname = save_frame(frame, f"pat_{dmx:03d}_{shape}")
            results[key] = {
                "shape": shape, "vertices": verts,
                "size_pct": round(size_pct, 1),
                "circularity": round(circ, 3),
                "angle_deg": round(angle, 1),
                "flatness": round(flatness, 3),
                "frame": fname
            }
            print(f"  PAT {dmx:>3}: {shape:<18} size={size_pct:.1f}%  circ={circ:.2f}")

        with open(checkpoint, "w") as f:
            json.dump(results, f)

    return results

# ── PHASE 2: ZOOM ────────────────────────────────────────────────────────────

async def phase_zoom(ws, cap, addrs, triangle_dmx):
    print(f"\n[Phase 2] Zoom Calibration (Pattern DMX={triangle_dmx})")
    checkpoint = f"{SAVE_DIR}/phase2_checkpoint.json"
    results    = {}

    if os.path.exists(checkpoint):
        with open(checkpoint) as f:
            results = json.load(f)

    await send_dmx(ws, [
        {"address": addrs["pattern"], "value": triangle_dmx},
        {"address": addrs["zoom"],    "value": 0},
        {"address": addrs["x_pos"],   "value": 127},
        {"address": addrs["y_pos"],   "value": 127},
    ])
    await asyncio.sleep(1.0)

    for dmx in range(0, 256, 4):
        key = str(dmx)
        if key in results:
            continue

        await send_dmx(ws, [{"address": addrs["zoom"], "value": dmx}])

        if dmx <= 124:
            await asyncio.sleep(0.5)
            frame = capture_frame(cap)
            frames = [frame] if frame is not None else []
        else:
            # Dynamic range: hold 3s, capture 5 frames
            await asyncio.sleep(1.0)
            frames = []
            for fi in range(5):
                frame = capture_frame(cap)
                if frame is not None:
                    save_frame(frame, f"zoom_{dmx:03d}_f{fi}")
                    frames.append(frame)
                await asyncio.sleep(0.6)

        if not frames:
            results[key] = {"error": "no frame"}
            continue

        sizes, centroids = [], []
        for fr in frames:
            c = largest_contour(fr)
            if c is not None:
                _, _, size_pct, _, _, _ = classify_shape(c, fr.shape)
                sizes.append(size_pct)
                centroids.append(get_centroid(c))

        if not sizes:
            results[key] = {"shape": "none", "dmx": dmx}
            continue

        avg_size = np.mean(sizes)

        # Motion detection (dynamic)
        motion_px = 0.0
        if len(centroids) > 1:
            dists = [math.dist(centroids[i], centroids[i+1]) for i in range(len(centroids)-1)]
            motion_px = max(dists)

        size_variance = np.std(sizes) if len(sizes) > 1 else 0.0
        is_dynamic    = motion_px > 20

        if not is_dynamic:
            classification = "static"
        elif size_variance > 5:
            classification = "pulsing"
        elif motion_px > 50:
            classification = "spinning"
        else:
            classification = "wave"

        save_frame(frames[0], f"zoom_{dmx:03d}")
        results[key] = {
            "dmx": dmx, "size_pct": round(float(avg_size), 1),
            "dynamic": is_dynamic, "motion_px": round(motion_px, 1),
            "size_variance": round(float(size_variance), 2),
            "classification": classification
        }
        print(f"  ZOOM {dmx:>3}: {avg_size:.1f}%  dynamic={is_dynamic}  [{classification}]  motion={motion_px:.1f}px")

        with open(checkpoint, "w") as f:
            json.dump(results, f)

    return results

# ── PHASE 3 & 4: POSITION ────────────────────────────────────────────────────

async def phase_position(ws, cap, addrs, triangle_dmx, axis):
    ch   = "x_pos" if axis == "x" else "y_pos"
    name = f"phase{'3' if axis == 'x' else '4'}"
    print(f"\n[Phase {'3' if axis == 'x' else '4'}] {axis.upper()} Position Mapping")
    checkpoint = f"{SAVE_DIR}/{name}_checkpoint.json"
    results    = {}

    if os.path.exists(checkpoint):
        with open(checkpoint) as f:
            results = json.load(f)

    await send_dmx(ws, [
        {"address": addrs["pattern"], "value": triangle_dmx},
        {"address": addrs["zoom"],    "value": 50},
        {"address": addrs["x_pos"],   "value": 127},
        {"address": addrs["y_pos"],   "value": 127},
    ])
    await asyncio.sleep(1.0)

    for dmx in range(0, 256, 4):
        key = str(dmx)
        if key in results:
            continue

        await send_dmx(ws, [{"address": addrs[ch], "value": dmx}])
        await asyncio.sleep(0.5)

        frame = capture_frame(cap)
        if frame is None:
            continue

        c = largest_contour(frame)
        if c is None:
            results[key] = {"dmx": dmx, "shape": "none"}
            continue

        cx, cy = get_centroid(c)
        fh, fw = frame.shape[:2]
        pos_pct = cx / fw * 100 if axis == "x" else cy / fh * 100
        save_frame(frame, f"{axis}pos_{dmx:03d}")
        results[key] = {"dmx": dmx, "pos_pct": round(pos_pct, 1)}
        print(f"  {axis.upper()}POS {dmx:>3}: {pos_pct:.1f}% of frame")

        with open(checkpoint, "w") as f:
            json.dump(results, f)

    # Reset
    await send_dmx(ws, [{"address": addrs[ch], "value": 127}])
    return results

# ── PHASE 5: ROTATION ────────────────────────────────────────────────────────

async def phase_rotation(ws, cap, addrs, triangle_dmx, rot_ch, label):
    print(f"\n[Phase 5{label}] {rot_ch.upper()} Rotation Analysis")
    checkpoint = f"{SAVE_DIR}/phase5_{rot_ch}_checkpoint.json"
    results    = {}

    if os.path.exists(checkpoint):
        with open(checkpoint) as f:
            results = json.load(f)

    # Reset all rotations, set triangle + medium zoom
    await send_dmx(ws, [
        {"address": addrs["pattern"], "value": triangle_dmx},
        {"address": addrs["zoom"],    "value": 80},
        {"address": addrs["x_pos"],   "value": 127},
        {"address": addrs["y_pos"],   "value": 127},
        {"address": addrs["z_rot"],   "value": 0},
        {"address": addrs["x_rot"],   "value": 0},
        {"address": addrs["y_rot"],   "value": 0},
    ])
    await asyncio.sleep(1.5)

    for dmx in range(0, 256, 8):
        key = str(dmx)
        if key in results:
            continue

        await send_dmx(ws, [{"address": addrs[rot_ch], "value": dmx}])
        await asyncio.sleep(1.0)

        frames = []
        for fi in range(3):
            fr = capture_frame(cap)
            if fr is not None:
                frames.append(fr)
            await asyncio.sleep(0.4)

        if not frames:
            continue

        angles, flatnesses, shapes = [], [], []
        for fr in frames:
            c = largest_contour(fr)
            if c is not None:
                shape, _, _, angle, flatness, _ = classify_shape(c, fr.shape)
                angles.append(angle)
                flatnesses.append(flatness)
                shapes.append(shape)

        if not angles:
            results[key] = {"dmx": dmx, "shape": "none"}
            continue

        avg_angle    = np.mean(angles)
        avg_flatness = np.mean(flatnesses)
        # Majority shape vote
        from collections import Counter
        dominant_shape = Counter(shapes).most_common(1)[0][0]

        save_frame(frames[0], f"{rot_ch}_{dmx:03d}")
        results[key] = {
            "dmx": dmx,
            "shape": dominant_shape,
            "angle_deg": round(float(avg_angle), 1),
            "flatness": round(float(avg_flatness), 3),
            "note": "flattening" if avg_flatness < 0.3 else ("line" if avg_flatness < 0.1 else "")
        }
        print(f"  {rot_ch.upper()} {dmx:>3}: shape={dominant_shape:<12} angle={avg_angle:.1f}°  flat={avg_flatness:.2f}")

        with open(checkpoint, "w") as f:
            json.dump(results, f)

    # Reset
    await send_dmx(ws, [{"address": addrs[rot_ch], "value": 0}])
    return results

# ── SUMMARY GENERATOR ────────────────────────────────────────────────────────

def summarize(report):
    lines = ["=" * 60, "EHAHO CALIBRATION SUMMARY", "=" * 60, ""]

    # Patterns
    lines.append("PATTERN SHAPES (CH4, DMX 0–96):")
    pat = report.get("patterns", {})
    current_shape, run_start = None, 0
    for i in range(97):
        s = pat.get(str(i), {}).get("shape", "none")
        if s != current_shape:
            if current_shape is not None:
                lines.append(f"  DMX {run_start:>3}–{i-1:<3}: {current_shape}")
            current_shape, run_start = s, i
    lines.append(f"  DMX {run_start:>3}–96 : {current_shape}")
    lines.append("")

    # Zoom
    lines.append("ZOOM CALIBRATION (CH5):")
    zoom = report.get("zoom", {})
    static_max = max((int(k) for k, v in zoom.items() if not v.get("dynamic")), default=124)
    lines.append(f"  Static range : DMX 0–{static_max}")
    lines.append(f"  Dynamic range: DMX {static_max+1}–255")
    sample_sizes = [(int(k), v["size_pct"]) for k, v in zoom.items() if "size_pct" in v]
    sample_sizes.sort()
    for dmx, sz in sample_sizes[::4]:
        lines.append(f"    DMX {dmx:>3}: {sz:.1f}% size")
    lines.append("")

    # Position
    lines.append("X POSITION (CH7):")
    xpos = report.get("x_pos", {})
    for dmx in [0, 64, 127, 191, 255]:
        p = xpos.get(str(dmx), {}).get("pos_pct", "?")
        lines.append(f"  DMX {dmx:>3}: {p}% of frame")
    lines.append("")
    lines.append("Y POSITION (CH8):")
    ypos = report.get("y_pos", {})
    for dmx in [0, 64, 127, 191, 255]:
        p = ypos.get(str(dmx), {}).get("pos_pct", "?")
        lines.append(f"  DMX {dmx:>3}: {p}% of frame")
    lines.append("")

    # Rotation
    for rot_key, rot_label in [("z_rot", "Z (in-plane)"), ("x_rot", "X (sideways)"), ("y_rot", "Y (vertical)")]:
        lines.append(f"ROTATION {rot_label} (DMX 0–255):")
        rot = report.get(f"rot_{rot_key}", {})
        flat_threshold = next((int(k) for k, v in sorted(rot.items(), key=lambda x: int(x[0]))
                               if v.get("flatness", 1.0) < 0.3), None)
        line_threshold = next((int(k) for k, v in sorted(rot.items(), key=lambda x: int(x[0]))
                               if v.get("flatness", 1.0) < 0.1), None)
        lines.append(f"  Starts flattening at : DMX ~{flat_threshold}")
        lines.append(f"  Near-line at         : DMX ~{line_threshold}")
        sample_rots = [(int(k), v.get("angle_deg","?"), v.get("flatness","?"))
                       for k, v in rot.items()]
        sample_rots.sort()
        for dmx, ang, flat in sample_rots[::4]:
            lines.append(f"    DMX {dmx:>3}: angle={ang}°  flatness={flat}")
        lines.append("")

    return "\n".join(lines)

# ── MAIN ─────────────────────────────────────────────────────────────────────

async def run():
    addrs = load_addresses()

    required = ["dim", "pattern", "zoom", "x_pos", "y_pos", "z_rot", "x_rot", "y_rot", "draw", "drawing"]
    missing  = [r for r in required if r not in addrs]
    if missing:
        raise RuntimeError(f"Missing roles: {missing}")

    report = {}
    if os.path.exists(REPORT_PATH):
        with open(REPORT_PATH) as f:
            report = json.load(f)

    async with websockets.connect(
        "wss://localhost:8765", ssl=make_ssl(),
        ping_interval=None, ping_timeout=None
    ) as ws:
        cap = cv2.VideoCapture(0)

        # ── Phase 1 ──
        if "patterns" not in report:
            report["patterns"] = await phase_patterns(ws, cap, addrs)
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        # Pick triangle for remaining phases (first DMX value classified as triangle)
        pat = report["patterns"]
        triangle_dmx = next(
            (int(k) for k in sorted(pat, key=int) if pat[k].get("shape") == "triangle"),
            9   # fallback
        )
        print(f"\n[*] Using triangle at DMX {triangle_dmx} for remaining phases")

        # ── Phase 2 ──
        if "zoom" not in report:
            report["zoom"] = await phase_zoom(ws, cap, addrs, triangle_dmx)
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        # ── Phase 3 ──
        if "x_pos" not in report:
            report["x_pos"] = await phase_position(ws, cap, addrs, triangle_dmx, "x")
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        # ── Phase 4 ──
        if "y_pos" not in report:
            report["y_pos"] = await phase_position(ws, cap, addrs, triangle_dmx, "y")
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        # ── Phase 5: Z Rot ──
        if "rot_z_rot" not in report:
            report["rot_z_rot"] = await phase_rotation(ws, cap, addrs, triangle_dmx, "z_rot", "a")
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        # ── Phase 5: X Rot ──
        if "rot_x_rot" not in report:
            report["rot_x_rot"] = await phase_rotation(ws, cap, addrs, triangle_dmx, "x_rot", "b")
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        # ── Phase 5: Y Rot ──
        if "rot_y_rot" not in report:
            report["rot_y_rot"] = await phase_rotation(ws, cap, addrs, triangle_dmx, "y_rot", "c")
            with open(REPORT_PATH, "w") as f: json.dump(report, f, indent=2)

        cap.release()

    # Generate summary
    summary = summarize(report)
    with open(SUMMARY_PATH, "w") as f:
        f.write(summary)
    print("\n" + summary)
    print(f"\n[*] Report : {REPORT_PATH}")
    print(f"[*] Summary: {SUMMARY_PATH}")

if __name__ == "__main__":
    asyncio.run(run())
