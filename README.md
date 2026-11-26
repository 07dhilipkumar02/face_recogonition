# Face Recognition & DeepFace System

A face recognition web app built with **Python, OpenCV, DeepFace and React**. It detects faces, recognizes people, verifies faces, and analyzes them.

| Feature | What it does |
|---|---|
| **Live** | Real-time recognition from the webcam with name boxes, and automatic check-in |
| **Recognise** | Identifies everyone in a photo, including group photos (1:N) |
| **Analyse** | Detects every face and estimates age, gender and emotion |
| **Verify** | Checks whether two photos show the same person (1:1), with a similarity score |
| **People** | Register people with several photos each, from upload or webcam; rename, add or remove photos, search, and bulk-register from file names (`Abhi_1.jpg`) with duplicate-face warnings |
| **Attendance** | One check-in per person per day (first and last seen), a present/absent view by date, and CSV export for Excel |
| **Dashboard** | Totals, attendance and activity for the last 7 days, emotion, age and gender charts, and a recent-activity history |

**Tech:** FastAPI · OpenCV DNN (YuNet detection, SFace recognition, MobileFaceNet emotion, InsightFace age/gender) · SQLite · React 18 · Vite

No TensorFlow: the backend uses about 370 MB of RAM, so it runs on Render's free plan. The models (about 45 MB) download automatically on first start, or ahead of time with `python download_models.py`.

```
face_recognition/
├── backend/          FastAPI + DeepFace API (app.py)
│   ├── requirements.txt
│   ├── Dockerfile    for deployment
│   └── data/         face_system.db (SQLite, created at runtime)
└── frontend/         React + Vite UI
    └── src/components/  Live, Recognize, Analyze, Verify, People, Attendance, Dashboard panels
```

Upgrading from v1: on first start, faces from `data/faces.json` are imported automatically, and the old file is renamed to `faces.json.migrated`.

---

## Run locally (Windows)

**Requirements:** Python **3.10–3.12** (TensorFlow on Windows is most reliable on 3.11) and Node.js 18+.

### 1. Backend

```powershell
cd D:\face_recognition\backend
py -3.11 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The API runs on http://localhost:8000. Interactive docs are at http://localhost:8000/docs.

> The first request downloads model weights (about 600 MB) to `C:\Users\<you>\.deepface\weights`. That one request can take a few minutes. After that, each request takes 1–5 seconds on CPU.

### 2. Frontend (new terminal)

```powershell
cd D:\face_recognition\frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` to the backend automatically.

---

## API

| Method | Endpoint | Body (multipart/form-data) |
|---|---|---|
| GET | `/api/health` | – |
| POST | `/api/analyze` | `image` |
| POST | `/api/recognize` | `image`, `mode` (`photo`/`live`), `attendance` (`true`/`false`) |
| POST | `/api/verify` | `image1`, `image2` |
| GET | `/api/people?q=` | – |
| POST | `/api/people` | `name`, `images` (one or more) |
| POST | `/api/people/bulk` | `images` (names taken from file names) |
| GET / PATCH / DELETE | `/api/people/{id}` | PATCH: JSON `{"name": "..."}` |
| POST | `/api/people/{id}/photos` | `images` |
| DELETE | `/api/people/{id}/photos/{photo_id}` | – |
| GET | `/api/attendance?day=YYYY-MM-DD` | – |
| GET | `/api/attendance/export?start=&end=` | CSV download |
| DELETE | `/api/attendance/{id}` | – |
| GET / DELETE | `/api/history` · `/api/history/{id}` | – |
| GET | `/api/stats` | – |

### Configuration (environment variables)

| Variable | Default | Notes |
|---|---|---|
| `MODEL_NAME` | `Facenet512` | Also: `ArcFace`, `VGG-Face`, `SFace`… Re-register faces if you change it |
| `DETECTOR` | `opencv` | `retinaface` / `mtcnn` are more accurate but slower (need extra pip packages) |
| `MATCH_THRESHOLD` | model default (0.30) | Lower means stricter matching |
| `ALLOWED_ORIGINS` | `*` | Set this to your frontend URL in production |
| `MAX_IMAGE_SIDE` | `1280` | Large photos are scaled down for speed |

---

## Deploy

**Backend → Render (free plan works).** It uses about 370 MB of RAM at peak. Deploy `backend/` as a Docker web service, or as a Python service with build command `pip install -r requirements.txt && python download_models.py` and start command `uvicorn app:app --host 0.0.0.0 --port $PORT`. Set `ALLOWED_ORIGINS` to your frontend URL. Free instances sleep when idle and their disk is wiped on redeploy, so registered people are not permanent.

- **Backend → Hugging Face Spaces (free, 16 GB RAM):** create a Space, choose the **Docker** SDK, and upload the `backend/` folder. The Dockerfile downloads the weights at build time and serves on port 7860. Your API URL is `https://<user>-<space>.hf.space`.
  Free Spaces sleep when idle, and registered faces reset on restart unless you add persistent storage.
- Paid alternatives: Railway, Render (Standard plan, 2 GB) or a small VPS.
- **Frontend → Vercel:** set the root directory to `frontend` and add the env var `VITE_API_URL=https://<your-backend-url>`. Then set the backend's `ALLOWED_ORIGINS` to your Vercel URL.

---

## Privacy note

Face data is biometric data. Uploaded photos are processed in memory and not saved. Only registered people (face embeddings and thumbnails), attendance records and small history thumbnails are stored, in `backend/data/face_system.db`. Clear the history from the Dashboard. If you deploy this publicly, tell visitors so and don't register people without their consent.
