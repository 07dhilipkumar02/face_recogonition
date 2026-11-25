# Works on Render, Railway, Fly.io or Hugging Face Spaces (Docker SDK)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
# Download model weights at build time so the first request is fast
RUN python -c "import numpy as np; from deepface import DeepFace; img=np.zeros((224,224,3),np.uint8); DeepFace.represent(img, model_name='Facenet512', enforce_detection=False); DeepFace.analyze(img, actions=['age','gender','emotion'], enforce_detection=False, silent=True)"

ENV PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
