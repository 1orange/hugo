import base64
import io
import os
from typing import Any

import numpy as np
from fastapi import FastAPI
from PIL import Image
from rapidocr import ModelType, OCRVersion, RapidOCR


def engine_params() -> dict[str, Any]:
    """
    PP-OCRv6's multilingual models read Slovak and Czech with their
    diacritics (ADR 0017); the PP-OCRv4 default of rapidocr-onnxruntime was
    Chinese/English and read "Dodávateľ" as "Dodavatel". OCR_VERSION=PP-OCRv5
    selects PaddleOCR's Latin recogniser instead, for comparison.
    """
    version = os.environ.get("OCR_VERSION", "PP-OCRv6")
    params: dict[str, Any] = {"Global.log_level": "warning"}
    # Version and model type must be rapidocr's enums; a language may be a
    # plain code such as "sk", which PP-OCRv6 resolves to its model.
    if version == "PP-OCRv5":
        params.update(
            {
                "Det.ocr_version": OCRVersion.PPOCRV5,
                "Det.model_type": ModelType.MOBILE,
                "Rec.ocr_version": OCRVersion.PPOCRV5,
                "Rec.lang_type": "latin",
                "Rec.model_type": ModelType.MOBILE,
            }
        )
        return params
    lang = os.environ.get("OCR_LANG", "sk")
    model_type = ModelType(os.environ.get("OCR_MODEL_TYPE", "small"))
    for task in ("Det", "Rec"):
        params[f"{task}.ocr_version"] = OCRVersion.PPOCRV6
        params[f"{task}.lang_type"] = lang
        params[f"{task}.model_type"] = model_type
    return params


app = FastAPI()
# Built at import, so `python -c "import main"` fetches the models at build time.
engine = RapidOCR(params=engine_params())


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
    for page, image in enumerate(body.get("images") or []):
        if not isinstance(image, dict) or "data" not in image:
            continue
        rgb = decode_image(image)
        result = engine(rgb)
        if result.boxes is None or result.txts is None:
            continue
        for quad, text in zip(result.boxes, result.txts):
            xs = [float(point[0]) for point in quad]
            ys = [float(point[1]) for point in quad]
            # Image pixels, y downwards; the size lets the app find columns.
            boxes.append(
                {
                    "text": text,
                    "x": float(min(xs)),
                    "y": float(min(ys)),
                    "width": float(max(xs) - min(xs)),
                    "height": float(max(ys) - min(ys)),
                    "page": page,
                }
            )
    return {"boxes": boxes}
