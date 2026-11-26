"""
Lightweight face engine: OpenCV DNN models only (no TensorFlow / PyTorch).
Fits comfortably in 512 MB RAM (e.g. Render's free plan).

  detection    YuNet           (OpenCV Zoo)        ~0.2 MB
  recognition  SFace           (OpenCV Zoo)        ~37 MB, 128-d embeddings
  emotion      MobileFaceNet   (OpenCV Zoo)        ~4.6 MB, 7 expressions
  age, gender  genderage       (InsightFace)       ~1.3 MB

Models are downloaded on first start into MODELS_DIR (default: backend/models).
Run `python download_models.py` to fetch them ahead of time.
"""

import os
import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np

MODELS_DIR = Path(os.getenv("MODELS_DIR", Path(__file__).parent / "models"))

MODEL_FILES = {
    "yunet": (
        "face_detection_yunet_2023mar.onnx",
        "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
    ),
    "sface": (
        "face_recognition_sface_2021dec.onnx",
        "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
    ),
    "fer": (
        "facial_expression_recognition_mobilefacenet_2022july.onnx",
        "https://huggingface.co/opencv/facial_expression_recognition/resolve/main/"
        "facial_expression_recognition_mobilefacenet_2022july.onnx",
    ),
    "genderage": (
        "genderage.onnx",
        "https://huggingface.co/DavidHoa/buffalo_l/resolve/main/genderage.onnx",
    ),
}

DETECT_SIDE = 640
MODEL_NAME = "SFace"
DETECTOR_NAME = "YuNet"
# SFace: cosine similarity >= 0.363 means same person  ->  distance (1 - cos) <= 0.637
DEFAULT_THRESHOLD = 0.637

# FER model output order -> the emotion names the frontend uses
EMOTIONS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]


def ensure_models(verbose: bool = True) -> None:
    """Download any missing model file."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for key, (fname, url) in MODEL_FILES.items():
        path = MODELS_DIR / fname
        if path.exists() and path.stat().st_size > 1000:
            continue
        if verbose:
            print(f"Downloading {key} model: {fname} …", flush=True)
        tmp = path.with_suffix(".part")
        req = urllib.request.Request(url, headers={"User-Agent": "face-recognition-app"})
        with urllib.request.urlopen(req, timeout=300) as resp, open(tmp, "wb") as out:
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        tmp.replace(path)


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


class FaceEngine:
    def __init__(self, score_threshold: float = float(os.getenv("DETECTION_THRESHOLD", "0.6"))):
        ensure_models()
        cv2.setNumThreads(int(os.getenv("CV_THREADS", "1")))  # small servers: fewer threads, less memory
        p = {k: str(MODELS_DIR / f) for k, (f, _) in MODEL_FILES.items()}
        self.detector = cv2.FaceDetectorYN.create(p["yunet"], "", (320, 320), score_threshold, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(p["sface"], "")
        self.fer = cv2.dnn.readNet(p["fer"])
        self.genderage = cv2.dnn.readNet(p["genderage"])
        self.lock = threading.Lock()  # cv2.dnn networks are not thread-safe

    # ------------------------------------------------------------ detection ---
    def detect(self, img: np.ndarray) -> list[dict]:
        """Faces as [{region, score, raw}] where raw is YuNet's 15-value row (full-size coordinates)."""
        h, w = img.shape[:2]
        # YuNet is most reliable (and fastest) around 640 px; detect on a smaller copy
        scale = min(1.0, DETECT_SIDE / max(h, w))
        small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
        with self.lock:
            self.detector.setInputSize((small.shape[1], small.shape[0]))
            _, faces = self.detector.detect(small)
        if faces is None:
            return []
        out = []
        for f in faces:
            f = f.copy()
            f[:14] /= scale  # box + 5 landmarks back to full-size pixels
            x, y, fw, fh = f[:4]
            x0, y0 = max(0, int(x)), max(0, int(y))
            out.append({
                "region": {
                    "x": x0, "y": y0,
                    "w": int(min(w, x + fw) - x0), "h": int(min(h, y + fh) - y0),
                },
                "score": float(f[14]),
                "raw": f,
            })
        return out

    # ----------------------------------------------------------- recognition ---
    def embed(self, img: np.ndarray, face: dict) -> np.ndarray:
        with self.lock:
            aligned = self.recognizer.alignCrop(img, face["raw"])
            feat = self.recognizer.feature(aligned)
        return np.asarray(feat, dtype=np.float32).flatten()

    # -------------------------------------------------------------- analysis ---
    def analyze(self, img: np.ndarray, face: dict) -> dict:
        with self.lock:
            # emotion: 112x112 face aligned on the 5 landmarks (same template as SFace)
            aligned = self.recognizer.alignCrop(img, face["raw"])
            rgb = cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            rgb = (rgb - 0.5) / 0.5
            self.fer.setInput(cv2.dnn.blobFromImage(rgb))
            emo = _softmax(self.fer.forward().flatten()) * 100

            # age + gender: 96x96 crop centred on the face, 1.5x its size (InsightFace recipe)
            x, y, w, h = (float(v) for v in face["raw"][:4])
            cx, cy = x + w / 2, y + h / 2
            s = 96 / (max(w, h) * 1.5)
            m = np.array([[s, 0, 48 - cx * s], [0, s, 48 - cy * s]], dtype=np.float32)
            crop = cv2.warpAffine(img, m, (96, 96), borderValue=0.0)
            self.genderage.setInput(cv2.dnn.blobFromImage(crop, 1.0, (96, 96), (0, 0, 0), swapRB=True))
            pred = self.genderage.forward().flatten()

        g = _softmax(pred[:2]) * 100  # index 0 = female, 1 = male
        emotion_scores = {name: float(v) for name, v in zip(EMOTIONS, emo)}
        return {
            "age": int(round(float(pred[2]) * 100)),
            "gender": "Man" if g[1] >= g[0] else "Woman",
            "gender_scores": {"Woman": float(g[0]), "Man": float(g[1])},
            "emotion": max(emotion_scores, key=emotion_scores.get),
            "emotion_scores": emotion_scores,
        }
