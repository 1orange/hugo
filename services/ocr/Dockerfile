FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn rapidocr-onnxruntime pillow numpy \
  # rapidocr pulls the desktop OpenCV, which needs X11 libraries (libxcb) a
  # slim image lacks; the headless build is the same cv2 without them.
  && pip uninstall -y opencv-python \
  && pip install --no-cache-dir opencv-python-headless

COPY main.py .

EXPOSE 8090

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
