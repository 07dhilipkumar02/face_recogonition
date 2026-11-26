"""
Face Recognition System - FastAPI backend (v3, OpenCV models, low memory).

Storage: one SQLite file (data/face_system.db) holding people, their face
samples (embeddings), attendance records and analysis history.

Endpoints
  GET    /api/health
  POST   /api/analyze                          age / gender / emotion
  POST   /api/verify                           1:1 face comparison
  POST   /api/recognize                        1:N recognition (photo or live frame)
  GET    /api/people?q=                        list / search people
  POST   /api/people                           register a person (one or more photos)
  POST   /api/people/bulk                      register many people, names taken from file names
  GET    /api/people/{id}                      person + photo samples
  PATCH  /api/people/{id}                      rename
  POST   /api/people/{id}/photos               add photos
  DELETE /api/people/{id}/photos/{sample_id}   remove one photo
  DELETE /api/people/{id}                      remove person
  GET    /api/attendance?day=YYYY-MM-DD        present / absent for a day
  GET    /api/attendance/export?start=&end=    CSV download
  DELETE /api/attendance/{id}
  GET    /api/history?kind=&limit=
  DELETE /api/history/{id}   |   DELETE /api/history
  GET    /api/stats                            dashboard numbers
"""

import base64
import csv
import io
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import face_engine
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

# ----------------------------------------------------------------- config ---
MODEL_NAME = face_engine.MODEL_NAME     # SFace embeddings (OpenCV), no TensorFlow
DETECTOR = face_engine.DETECTOR_NAME    # YuNet face detector (OpenCV)
MAX_SIDE = int(os.getenv("MAX_IMAGE_SIDE", "1280"))  # photos are scaled down for speed
LIVE_MAX_SIDE = int(os.getenv("LIVE_MAX_SIDE", "640"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "8"))
MAX_FILES = int(os.getenv("MAX_FILES_PER_UPLOAD", "50"))
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "500"))
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data"))
DB_FILE = DATA_DIR / "face_system.db"
LEGACY_JSON = DATA_DIR / "faces.json"
# comma-separated; "https://site.vercel.app/" and "https://site.vercel.app" both work
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()] or ["*"]

# cosine distance (1 - similarity); lower MATCH_THRESHOLD = stricter matching
THRESHOLD = float(os.getenv("MATCH_THRESHOLD", face_engine.DEFAULT_THRESHOLD))

DATA_DIR.mkdir(parents=True, exist_ok=True)
_engine = None
_engine_lock = threading.Lock()


def engine() -> "face_engine.FaceEngine":
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = face_engine.FaceEngine()
    return _engine


_write_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_app):
    init_db()
    threading.Thread(target=_warm_up, daemon=True).start()
    yield


def _warm_up():
    """Download/load models in the background, then re-embed photos saved by an older model."""
    try:
        engine()
        migrate_embeddings()
    except Exception as e:  # keep serving; the first request will retry and report the error
        print("Model warm-up failed:", e, flush=True)


app = FastAPI(title="Face Recognition API", version="3.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------- database ---
SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    thumbnail TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS samples (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    embedding TEXT NOT NULL,
    thumbnail TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL,
    name TEXT NOT NULL,
    day TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    seen_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(person_id, day)
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    face_count INTEGER NOT NULL DEFAULT 0,
    thumbnail TEXT,
    data TEXT
);
CREATE INDEX IF NOT EXISTS idx_samples_person ON samples(person_id);
CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(day);
CREATE INDEX IF NOT EXISTS idx_history_kind ON history(kind, created_at);
"""


@contextmanager
def db():
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now() -> datetime:
    return datetime.now().astimezone()


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
    migrate_legacy_json()


def migrate_legacy_json() -> None:
    """Import faces registered with v1 (faces.json) into SQLite, once."""
    if not LEGACY_JSON.exists():
        return
    try:
        records = json.loads(LEGACY_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    with db() as conn:
        for r in records:
            if conn.execute("SELECT 1 FROM people WHERE id = ?", (r["id"],)).fetchone():
                continue
            stamp = r.get("created_at") or iso(now())
            conn.execute(
                "INSERT INTO people (id, name, thumbnail, created_at) VALUES (?, ?, ?, ?)",
                (r["id"], r["name"], r.get("thumbnail"), stamp),
            )
            conn.execute(
                "INSERT INTO samples (id, person_id, model, embedding, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (new_id(), r["id"], MODEL_NAME, json.dumps(r["embedding"]), r.get("thumbnail"), stamp),
            )
    LEGACY_JSON.rename(LEGACY_JSON.with_suffix(".json.migrated"))


# ------------------------------------------------------ embedding index ---
_index = None  # cached (matrix, person_ids, names)


def invalidate_index() -> None:
    global _index
    _index = None


def get_index():
    """All registered embeddings as a normalised matrix, for fast matching."""
    global _index
    if _index is None:
        with db() as conn:
            rows = conn.execute(
                "SELECT s.person_id, s.embedding, p.name FROM samples s "
                "JOIN people p ON p.id = s.person_id WHERE s.model = ?",
                (MODEL_NAME,),
            ).fetchall()
        if rows:
            m = np.array([json.loads(r["embedding"]) for r in rows], dtype=np.float32)
            m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-10
        else:
            m = np.zeros((0, 1), dtype=np.float32)
        _index = (m, [r["person_id"] for r in rows], {r["person_id"]: r["name"] for r in rows})
    return _index


def best_match(embedding: np.ndarray, exclude: str | None = None):
    """Closest registered person -> (person_id, name, distance) or (None, None, None)."""
    m, pids, names = get_index()
    if not pids:
        return None, None, None
    q = embedding / (np.linalg.norm(embedding) + 1e-10)
    dists = 1 - m @ q
    best = {}
    for pid, d in zip(pids, dists):
        if pid != exclude and (pid not in best or d < best[pid]):
            best[pid] = float(d)
    if not best:
        return None, None, None
    pid = min(best, key=best.get)
    return pid, names[pid], best[pid]


# ---------------------------------------------------------------- helpers ---
def to_py(obj):
    """Convert numpy types into plain Python so FastAPI can serialise them."""
    if isinstance(obj, dict):
        return {k: to_py(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_py(v) for v in obj]
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return round(float(obj), 4)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def decode_image(raw: bytes, max_side: int = MAX_SIDE) -> np.ndarray:
    if not raw:
        raise HTTPException(400, "Empty file")
    if len(raw) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Image larger than {MAX_UPLOAD_MB} MB")
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not read image. Use JPG, PNG or WEBP.")
    h, w = img.shape[:2]
    scale = max_side / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


async def read_image(upload: UploadFile, max_side: int = MAX_SIDE) -> np.ndarray:
    return decode_image(await upload.read(), max_side)


def size_of(img: np.ndarray) -> dict:
    h, w = img.shape[:2]
    return {"width": w, "height": h}


def region_of(area_: dict) -> dict:
    return {k: int(area_.get(k, 0)) for k in ("x", "y", "w", "h")}


def area(face: dict) -> int:
    return face["region"]["w"] * face["region"]["h"]


def embed_faces(img: np.ndarray) -> list[dict]:
    """Return [{embedding, region, score}] for every face found (empty list if none)."""
    eng = engine()
    return [
        {"embedding": eng.embed(img, f), "region": f["region"], "score": f["score"]}
        for f in eng.detect(img)
    ]


def migrate_embeddings() -> None:
    """Photos registered with a different model (e.g. DeepFace) are re-embedded from their thumbnails."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, thumbnail FROM samples WHERE model != ? AND thumbnail IS NOT NULL", (MODEL_NAME,)
        ).fetchall()
    if not rows:
        return
    updated = 0
    for r in rows:
        try:
            raw = base64.b64decode(r["thumbnail"].split(",", 1)[1])
            img = decode_image(raw)
            # thumbnails are tight crops; add a border so the detector sees the whole head
            img = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            faces = embed_faces(img)
        except Exception:
            continue
        if faces:
            emb = max(faces, key=area)["embedding"]
            with _write_lock, db() as conn:
                conn.execute(
                    "UPDATE samples SET model = ?, embedding = ? WHERE id = ?",
                    (MODEL_NAME, json.dumps(emb.tolist()), r["id"]),
                )
            updated += 1
    if updated:
        invalidate_index()
    print(f"Re-embedded {updated}/{len(rows)} saved photos with {MODEL_NAME}", flush=True)


def cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(1 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


def jpeg_data_url(img: np.ndarray, quality: int = 82) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode() if ok else ""


def crop_face(img: np.ndarray, region: dict, size: int = 160) -> str:
    x, y, w, h = region["x"], region["y"], region["w"], region["h"]
    pad = int(0.25 * max(w, h))
    H, W = img.shape[:2]
    crop = img[max(0, y - pad): min(H, y + h + pad), max(0, x - pad): min(W, x + w + pad)]
    if crop.size == 0:
        crop = img
    return jpeg_data_url(cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA), 85)


def thumb(img: np.ndarray, height: int = 120) -> np.ndarray:
    h, w = img.shape[:2]
    return cv2.resize(img, (max(1, int(w * height / h)), height), interpolation=cv2.INTER_AREA)


def add_history(kind: str, img: np.ndarray, face_count: int, data: dict) -> None:
    with _write_lock, db() as conn:
        conn.execute(
            "INSERT INTO history (kind, created_at, face_count, thumbnail, data) VALUES (?, ?, ?, ?, ?)",
            (kind, iso(now()), face_count, jpeg_data_url(thumb(img), 70), json.dumps(to_py(data))),
        )
        conn.execute(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)",
            (HISTORY_LIMIT,),
        )


def mark_attendance(matches: list[tuple[str, str]]) -> list[str]:
    """Record people as present today. Returns names that were newly marked."""
    stamp = now()
    day, ts = stamp.date().isoformat(), iso(stamp)
    newly = []
    with _write_lock, db() as conn:
        for pid, name in dict(matches).items():
            row = conn.execute("SELECT id FROM attendance WHERE person_id = ? AND day = ?", (pid, day)).fetchone()
            if row:
                conn.execute(
                    "UPDATE attendance SET last_seen = ?, seen_count = seen_count + 1, name = ? WHERE id = ?",
                    (ts, name, row["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO attendance (person_id, name, day, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
                    (pid, name, day, ts, ts),
                )
                newly.append(name)
    return newly


def parse_day(value: str | None, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, "Dates must look like YYYY-MM-DD")


# ------------------------------------------------------------------ routes ---
@app.get("/api/health")
def health():
    with db() as conn:
        people = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        photos = conn.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
    return {
        "status": "ok",
        "version": app.version,
        "model": MODEL_NAME,
        "detector": DETECTOR,
        "threshold": THRESHOLD,
        "people": people,
        "photos": photos,
    }


@app.post("/api/analyze")
async def analyze(image: UploadFile = File(...), save: bool = Form(True)):
    img = await read_image(image)
    eng = engine()
    faces = [
        {"region": f["region"], "confidence": f["score"], **eng.analyze(img, f)}
        for f in eng.detect(img)
    ]
    if save:
        add_history("analyze", img, len(faces), {
            "faces": [{"age": f["age"], "gender": f["gender"], "emotion": f["emotion"]} for f in faces]
        })
    return to_py({"image": size_of(img), "count": len(faces), "faces": faces})


@app.post("/api/verify")
async def verify(image1: UploadFile = File(...), image2: UploadFile = File(...), save: bool = Form(True)):
    img1, img2 = await read_image(image1), await read_image(image2)
    f1, f2 = embed_faces(img1), embed_faces(img2)
    if not f1 or not f2:
        missing = "first" if not f1 else "second"
        raise HTTPException(422, f"No face found in the {missing} image")
    a, b = max(f1, key=area), max(f2, key=area)  # compare the largest face in each photo
    distance = cosine_distance(a["embedding"], b["embedding"])
    similarity = max(0.0, min(1.0, 1 - distance / (2 * THRESHOLD)))
    verified = distance <= THRESHOLD
    if save:
        pair = np.hstack([thumb(img1), thumb(img2)])
        add_history("verify", pair, 2, {"verified": verified, "distance": distance, "similarity": similarity})
    return to_py({
        "verified": verified,
        "distance": distance,
        "threshold": THRESHOLD,
        "similarity": similarity,
        "model": MODEL_NAME,
        "image1": {**size_of(img1), "region": a["region"]},
        "image2": {**size_of(img2), "region": b["region"]},
    })


@app.post("/api/recognize")
async def recognize(
    image: UploadFile = File(...),
    mode: str = Form("photo"),            # "photo" or "live" (webcam frame)
    attendance: bool = Form(False),       # mark recognised people present today
):
    started = time.perf_counter()
    live = mode == "live"
    img = await read_image(image, LIVE_MAX_SIDE if live else MAX_SIDE)
    faces = []
    for f in embed_faces(img):
        pid, name, dist = best_match(f["embedding"])
        matched = pid is not None and dist <= THRESHOLD
        faces.append({
            "region": f["region"],
            "name": name if matched else "Unknown",
            "matched": matched,
            "person_id": pid if matched else None,
            "distance": dist,
            "confidence": max(0.0, min(1.0, 1 - dist / (2 * THRESHOLD))) if dist is not None else 0.0,
        })
    matched = [(f["person_id"], f["name"]) for f in faces if f["matched"]]
    newly_marked = mark_attendance(matched) if attendance and matched else []
    if not live:
        add_history("recognize", img, len(faces), {"names": [f["name"] for f in faces]})
    return to_py({
        "image": size_of(img),
        "count": len(faces),
        "threshold": THRESHOLD,
        "people_registered": len(get_index()[2]),
        "faces": faces,
        "attendance_marked": newly_marked,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    })


# ------------------------------------------------------------------ people ---
class RenameBody(BaseModel):
    name: str


def clean_name(name: str) -> str:
    name = " ".join(name.split())
    if not name or len(name) > 60:
        raise HTTPException(400, "Name must be 1-60 characters")
    return name


PERSON_SQL = (
    "SELECT p.id, p.name, p.thumbnail, p.created_at, "
    "(SELECT COUNT(*) FROM samples s WHERE s.person_id = p.id) AS photo_count, "
    "(SELECT MAX(last_seen) FROM attendance a WHERE a.person_id = p.id) AS last_seen "
    "FROM people p"
)


def person_summary(conn, pid: str) -> dict | None:
    row = conn.execute(PERSON_SQL + " WHERE p.id = ?", (pid,)).fetchone()
    return dict(row) if row else None


async def process_photos(files: list[UploadFile], person_id: str | None) -> tuple[list[dict], list[dict]]:
    """Embed each upload. Returns (accepted samples, per-file results)."""
    if len(files) > MAX_FILES:
        raise HTTPException(413, f"Upload at most {MAX_FILES} photos at a time")
    accepted, results = [], []
    for up in files:
        fname = up.filename or "photo"
        try:
            img = await read_image(up)
        except HTTPException as e:
            results.append({"file": fname, "ok": False, "error": e.detail})
            continue
        faces = embed_faces(img)
        if len(faces) != 1:
            err = "No face found" if not faces else f"Found {len(faces)} faces. Use photos with one person."
            results.append({"file": fname, "ok": False, "error": err})
            continue
        face = faces[0]
        res = {"file": fname, "ok": True}
        pid, name, dist = best_match(face["embedding"], exclude=person_id)
        if pid and dist <= THRESHOLD:
            res["warning"] = f"Looks like {name}, who is already registered"
        accepted.append({"embedding": face["embedding"], "thumbnail": crop_face(img, face["region"])})
        results.append(res)
    return accepted, results


def save_samples(conn, person_id: str, samples: list[dict]) -> None:
    stamp = iso(now())
    for s in samples:
        conn.execute(
            "INSERT INTO samples (id, person_id, model, embedding, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (new_id(), person_id, MODEL_NAME, json.dumps(s["embedding"].tolist()), s["thumbnail"], stamp),
        )


def upsert_person(name: str, samples: list[dict]) -> tuple[dict, bool]:
    """Create a person, or add photos to an existing person with the same name."""
    with _write_lock, db() as conn:
        row = conn.execute("SELECT id FROM people WHERE lower(name) = lower(?)", (name,)).fetchone()
        merged = row is not None
        pid = row["id"] if row else new_id()
        if not merged:
            conn.execute(
                "INSERT INTO people (id, name, thumbnail, created_at) VALUES (?, ?, ?, ?)",
                (pid, name, samples[0]["thumbnail"], iso(now())),
            )
        save_samples(conn, pid, samples)
        person = person_summary(conn, pid)
    invalidate_index()
    return person, merged


@app.get("/api/people")
def list_people(q: str = ""):
    with db() as conn:
        rows = conn.execute(
            PERSON_SQL + " WHERE p.name LIKE ? ORDER BY lower(p.name)", (f"%{q.strip()}%",)
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/people", status_code=201)
async def register_person(name: str = Form(...), images: list[UploadFile] = File(...)):
    name = clean_name(name)
    with db() as conn:
        existing = conn.execute("SELECT id FROM people WHERE lower(name) = lower(?)", (name,)).fetchone()
    samples, results = await process_photos(images, existing["id"] if existing else None)
    if not samples:
        reasons = "; ".join(f"{r['file']}: {r['error']}" for r in results)
        raise HTTPException(422, f"None of the photos could be used ({reasons})")
    person, merged = upsert_person(name, samples)
    return {"person": person, "merged": merged, "added": len(samples), "results": results}


TRAILING_NUMBER = re.compile(r"[\s_\-.]*(\(\d+\)|\d+)$")


def name_from_filename(filename: str) -> str:
    """'Abhi_2.jpg', 'Abhi (3).png', 'abhi-01.jpg' -> 'Abhi'; 'priya_sharma.jpg' -> 'Priya Sharma'."""
    stem = TRAILING_NUMBER.sub("", Path(filename).stem)
    stem = re.sub(r"[_\-.]+", " ", stem).strip()
    stem = " ".join(stem.split())
    return stem.title() if stem.islower() else stem


@app.post("/api/people/bulk", status_code=201)
async def bulk_register(images: list[UploadFile] = File(...)):
    if len(images) > MAX_FILES:
        raise HTTPException(413, f"Upload at most {MAX_FILES} photos at a time")
    groups: dict[str, list[UploadFile]] = {}
    results = []
    for up in images:
        name = name_from_filename(up.filename or "")
        if not name or len(name) > 60:
            results.append({"file": up.filename, "ok": False, "error": "Could not get a name from the file name"})
            continue
        groups.setdefault(name, []).append(up)
    people = []
    for name, files in groups.items():
        samples, res = await process_photos(files, None)
        results.extend({**r, "name": name} for r in res)
        if samples:
            person, merged = upsert_person(name, samples)
            people.append({**person, "merged": merged, "added": len(samples)})
    return {"people": people, "results": results}


@app.get("/api/people/{person_id}")
def get_person(person_id: str):
    with db() as conn:
        person = person_summary(conn, person_id)
        if not person:
            raise HTTPException(404, "Person not found")
        samples = conn.execute(
            "SELECT id, thumbnail, created_at FROM samples WHERE person_id = ? ORDER BY created_at, id",
            (person_id,),
        ).fetchall()
        recent = conn.execute(
            "SELECT day, first_seen, last_seen, seen_count FROM attendance WHERE person_id = ? "
            "ORDER BY day DESC LIMIT 10", (person_id,),
        ).fetchall()
    return {**person, "samples": [dict(s) for s in samples], "attendance": [dict(r) for r in recent]}


@app.patch("/api/people/{person_id}")
def rename_person(person_id: str, body: RenameBody):
    name = clean_name(body.name)
    with _write_lock, db() as conn:
        clash = conn.execute(
            "SELECT 1 FROM people WHERE lower(name) = lower(?) AND id != ?", (name, person_id)
        ).fetchone()
        if clash:
            raise HTTPException(409, f"Someone called {name} already exists")
        if conn.execute("UPDATE people SET name = ? WHERE id = ?", (name, person_id)).rowcount == 0:
            raise HTTPException(404, "Person not found")
        conn.execute("UPDATE attendance SET name = ? WHERE person_id = ?", (name, person_id))
        person = person_summary(conn, person_id)
    invalidate_index()
    return person


@app.post("/api/people/{person_id}/photos", status_code=201)
async def add_photos(person_id: str, images: list[UploadFile] = File(...)):
    with db() as conn:
        if not conn.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone():
            raise HTTPException(404, "Person not found")
    samples, results = await process_photos(images, person_id)
    if samples:
        with _write_lock, db() as conn:
            save_samples(conn, person_id, samples)
        invalidate_index()
    return {"added": len(samples), "results": results}


@app.delete("/api/people/{person_id}/photos/{sample_id}")
def delete_photo(person_id: str, sample_id: str):
    with _write_lock, db() as conn:
        row = conn.execute(
            "SELECT thumbnail FROM samples WHERE id = ? AND person_id = ?", (sample_id, person_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Photo not found")
        count = conn.execute("SELECT COUNT(*) FROM samples WHERE person_id = ?", (person_id,)).fetchone()[0]
        if count <= 1:
            raise HTTPException(400, "A person needs at least one photo. Delete the person instead.")
        conn.execute("DELETE FROM samples WHERE id = ?", (sample_id,))
        first = conn.execute(
            "SELECT thumbnail FROM samples WHERE person_id = ? ORDER BY created_at, id LIMIT 1", (person_id,)
        ).fetchone()
        # if the deleted photo was the profile picture, use the next one
        conn.execute(
            "UPDATE people SET thumbnail = ? WHERE id = ? AND thumbnail = ?",
            (first["thumbnail"], person_id, row["thumbnail"]),
        )
    invalidate_index()
    return {"deleted": sample_id}


@app.delete("/api/people/{person_id}")
def delete_person(person_id: str):
    with _write_lock, db() as conn:
        if conn.execute("DELETE FROM people WHERE id = ?", (person_id,)).rowcount == 0:
            raise HTTPException(404, "Person not found")
    invalidate_index()
    return {"deleted": person_id}


# -------------------------------------------------------------- attendance ---
@app.get("/api/attendance")
def attendance_for_day(day: str | None = None):
    d = parse_day(day, now().date()).isoformat()
    with db() as conn:
        present = conn.execute(
            "SELECT a.id, a.person_id, a.name, a.first_seen, a.last_seen, a.seen_count, p.thumbnail "
            "FROM attendance a LEFT JOIN people p ON p.id = a.person_id "
            "WHERE a.day = ? ORDER BY a.first_seen", (d,),
        ).fetchall()
        present_ids = {r["person_id"] for r in present}
        everyone = conn.execute("SELECT id, name, thumbnail FROM people ORDER BY lower(name)").fetchall()
    absent = [dict(p) for p in everyone if p["id"] not in present_ids]
    return {
        "day": d,
        "present": [dict(r) for r in present],
        "absent": absent,
        "present_count": len(present),
        "total_people": len(everyone),
    }


@app.get("/api/attendance/export")
def export_attendance(start: str | None = None, end: str | None = None):
    end_d = parse_day(end, now().date())
    start_d = parse_day(start, end_d - timedelta(days=29))
    if start_d > end_d:
        raise HTTPException(400, "Start date must be before end date")
    with db() as conn:
        rows = conn.execute(
            "SELECT name, day, first_seen, last_seen, seen_count FROM attendance "
            "WHERE day BETWEEN ? AND ? ORDER BY day, first_seen",
            (start_d.isoformat(), end_d.isoformat()),
        ).fetchall()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Date", "First seen", "Last seen", "Times seen"])
    for r in rows:
        w.writerow([r["name"], r["day"], r["first_seen"][11:19], r["last_seen"][11:19], r["seen_count"]])
    filename = f"attendance_{start_d.isoformat()}_to_{end_d.isoformat()}.csv"
    return Response(
        content="﻿" + buf.getvalue(),  # BOM so Excel opens it as UTF-8
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/attendance/{record_id}")
def delete_attendance(record_id: int):
    with _write_lock, db() as conn:
        if conn.execute("DELETE FROM attendance WHERE id = ?", (record_id,)).rowcount == 0:
            raise HTTPException(404, "Record not found")
    return {"deleted": record_id}


# ----------------------------------------------------------------- history ---
@app.get("/api/history")
def list_history(kind: str | None = None, limit: int = 30):
    limit = max(1, min(limit, 200))
    sql = "SELECT id, kind, created_at, face_count, thumbnail, data FROM history"
    args: list = []
    if kind:
        sql += " WHERE kind = ?"
        args.append(kind)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with db() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [{**dict(r), "data": json.loads(r["data"] or "{}")} for r in rows]


@app.delete("/api/history/{item_id}")
def delete_history_item(item_id: int):
    with _write_lock, db() as conn:
        if conn.execute("DELETE FROM history WHERE id = ?", (item_id,)).rowcount == 0:
            raise HTTPException(404, "History item not found")
    return {"deleted": item_id}


@app.delete("/api/history")
def clear_history():
    with _write_lock, db() as conn:
        n = conn.execute("DELETE FROM history").rowcount
    return {"deleted": n}


# ------------------------------------------------------------------- stats ---
AGE_GROUPS = [("0-17", 0, 17), ("18-24", 18, 24), ("25-34", 25, 34),
              ("35-44", 35, 44), ("45-54", 45, 54), ("55+", 55, 200)]
EMOTIONS = ["happy", "neutral", "surprise", "sad", "angry", "fear", "disgust"]


@app.get("/api/stats")
def stats():
    today = now().date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    with db() as conn:
        people = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        photos = conn.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
        kinds = {r[0]: r[1] for r in conn.execute("SELECT kind, COUNT(*) FROM history GROUP BY kind")}
        analyses = conn.execute("SELECT data FROM history WHERE kind = 'analyze'").fetchall()
        att = {r[0]: r[1] for r in conn.execute(
            "SELECT day, COUNT(*) FROM attendance WHERE day >= ? GROUP BY day", (days[0],)
        )}
        activity_rows = conn.execute(
            "SELECT substr(created_at, 1, 10) AS d, kind, COUNT(*) AS n FROM history "
            "WHERE substr(created_at, 1, 10) >= ? GROUP BY d, kind", (days[0],)
        ).fetchall()

    emotions = {e: 0 for e in EMOTIONS}
    gender = {"Man": 0, "Woman": 0}
    ages = {label: 0 for label, _, _ in AGE_GROUPS}
    faces_analyzed = 0
    for row in analyses:
        for f in json.loads(row["data"] or "{}").get("faces", []):
            faces_analyzed += 1
            emo = f.get("emotion", "neutral")
            emotions[emo] = emotions.get(emo, 0) + 1
            g = f.get("gender", "Man")
            gender[g] = gender.get(g, 0) + 1
            for label, lo, hi in AGE_GROUPS:
                if lo <= f.get("age", 0) <= hi:
                    ages[label] += 1
                    break

    activity = {d: {"analyze": 0, "recognize": 0, "verify": 0} for d in days}
    for r in activity_rows:
        if r["d"] in activity and r["kind"] in activity[r["d"]]:
            activity[r["d"]][r["kind"]] = r["n"]

    return {
        "totals": {
            "people": people,
            "photos": photos,
            "analyses": kinds.get("analyze", 0),
            "recognitions": kinds.get("recognize", 0),
            "verifications": kinds.get("verify", 0),
            "faces_analyzed": faces_analyzed,
            "present_today": att.get(today.isoformat(), 0),
        },
        "emotions": emotions,
        "gender": gender,
        "age_groups": ages,
        "attendance_7d": [{"day": d, "present": att.get(d, 0)} for d in days],
        "activity_7d": [{"day": d, **activity[d]} for d in days],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
