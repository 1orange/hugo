import base64
import io
from typing import Any

import numpy as np
from fastapi import FastAPI
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

app = FastAPI()
engine = RapidOCR()


def decode_image(item: dict[str, Any]) -> np.ndarray:
    kind = item.get("kind")
    raw = base64.b64decode(item["data"])
    if kind == "rgba":
        width = int(item["width"])
        height = int(item["height"])
        arr = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 4))
        rgb = arr[:, :, :3]
        return rgb
    image = Image.open(io.BytesIO(raw))
    if image.mode != "RGB":
        image = image.convert("RGB")
    return np.array(image)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ocr")
def ocr(body: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    boxes: list[dict[str, Any]] = []
    for image in body.get("images") or []:
        if not isinstance(image, dict) or "data" not in image:
            continue
        rgb = decode_image(image)
        result, _ = engine(rgb)
        if not result:
            continue
        for entry in result:
            text = entry[1]
            quad = entry[0]
            xs = [point[0] for point in quad]
            ys = [point[1] for point in quad]
            boxes.append(
                {
                    "text": text,
                    "x": float(min(xs)),
                    "y": float(min(ys)),
                }
            )
    return {"boxes": boxes}
