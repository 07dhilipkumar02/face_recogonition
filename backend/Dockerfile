# Small image: OpenCV models only, no TensorFlow. Runs in 512 MB RAM (Render free plan).
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py face_engine.py download_models.py ./
# bake the ~45 MB of models into the image so start-up is instant
RUN python download_models.py

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
