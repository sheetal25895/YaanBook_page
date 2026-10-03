"""Collect live ADS-B positions for every aircraft on YaanBook and write public/data/live.json.

Runs in GitHub Actions every 10 minutes (see .github/workflows/pages.yml); browsers can't call the
ADS-B feeds directly. Data: adsb.lol, licensed ODbL. Standard library only.

    python3 tools/live_positions.py                  # writes public/data/live.json
    SITE_URL=https://.../ python3 tools/live_positions.py   # also keeps last-seen data from the live site
"""
import json, math, os, re, time, urllib.error, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "public", "data", "live.json")
UA = {"User-Agent": "YaanBook/1.0 (+https://sheetal25895.github.io/YaanBook_page/)"}
# 250 nm circles that together cover India, including the Andamans.
POINTS = [(32.5, 75.5), (28.5, 77.0), (27.0, 83.0), (26.0, 91.5), (23.5, 72.0), (23.0, 79.0), (22.5, 87.5),
          (19.0, 73.5), (19.5, 80.0), (15.5, 75.0), (16.5, 81.5), (12.0, 77.5), (9.0, 77.0), (11.6, 92.7)]
KEEP_DAYS = 14


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == tries - 1:
                raise
            time.sleep(15 * (i + 1))  # rate limited: back off and retry


def km(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def main():
    ops = json.load(open(os.path.join(ROOT, "public", "data", "operators.json")))
    regs = {a["reg"].upper() for o in ops["operators"] for a in o["aircraft"] if a.get("reg")}
    src = open(os.path.join(ROOT, "public", "js", "data.js")).read()
    places = [(c, float(la), float(lo)) for c, la, lo in re.findall(r"\['([A-Z]{3})','[^']*','[^']*',([\d.]+),([\d.]+),'[AH]'\]", src)]

    prev = {}
    site = os.environ.get("SITE_URL")
    if site:
        try:
            prev = get(site.rstrip("/") + "/data/live.json").get("aircraft", {})
        except Exception as e:
            print("No previous live data:", e)

    now = int(time.time() * 1000)
    seen = {}
    for lat, lon in POINTS:
        try:
            j = get(f"https://api.adsb.lol/v2/point/{lat}/{lon}/250")
        except Exception as e:
            print("Feed error at", lat, lon, e)
            continue
        for v in j.get("ac", []):
            reg = (v.get("r") or "").upper()
            if reg not in regs or v.get("lat") is None:
                continue
            alt = v.get("alt_baro")
            gnd = alt == "ground" or (isinstance(alt, (int, float)) and alt < 200 and (v.get("gs") or 0) < 15)
            ts = int(j.get("now", now) - (v.get("seen_pos") or v.get("seen") or 0) * 1000)
            near = min(places, key=lambda p: km(v["lat"], v["lon"], p[1], p[2]))
            d = km(v["lat"], v["lon"], near[1], near[2])
            seen[reg] = {"lat": round(v["lat"], 4), "lon": round(v["lon"], 4), "alt": 0 if gnd else alt, "gs": round(v.get("gs") or 0),
                         "trk": round(v.get("track") or v.get("true_heading") or 0), "gnd": gnd, "flight": (v.get("flight") or "").strip(),
                         "seen": ts, "near": near[0], "nearKm": round(d)}
        time.sleep(4)

    out = {}
    for reg, p in prev.items():
        if reg in regs and now - p.get("seen", 0) < KEEP_DAYS * 864e5:
            out[reg] = p
    for reg, p in seen.items():
        last = out.get(reg, {}).get("lastGround")
        if p["gnd"] and p["nearKm"] <= 15:
            last = {"code": p["near"], "ts": p["seen"]}
        out[reg] = {**p, **({"lastGround": last} if last else {})}

    json.dump({"updated": now, "source": "adsb.lol (ODbL)", "tracked": len(regs), "liveNow": len(seen), "aircraft": out},
              open(OUT, "w"), separators=(",", ":"))
    print(f"{len(seen)} aircraft seen now, {len(out)} with recent positions")


if __name__ == "__main__":
    main()
