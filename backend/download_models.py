"""Download the face models into backend/models (about 45 MB). Run once: python download_models.py"""
from face_engine import MODELS_DIR, ensure_models

ensure_models()
print(f"Models ready in {MODELS_DIR}")
