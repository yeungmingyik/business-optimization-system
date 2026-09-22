import json
import os
from pathlib import Path

import numpy as np


class WaybillOcr:
    name = "PaddleOCR-3.7.0/PP-OCRv6_small"

    def __init__(self):
        from paddleocr import PaddleOCR

        from models import verify_models

        model_root = Path(os.environ.get("BOS_OCR_MODEL_ROOT", "/models"))
        verify_models(model_root)
        self.pipeline = PaddleOCR(
            text_detection_model_name="PP-OCRv6_small_det",
            text_detection_model_dir=str(model_root / "PP-OCRv6_small_det"),
            text_recognition_model_name="PP-OCRv6_small_rec",
            text_recognition_model_dir=str(model_root / "PP-OCRv6_small_rec"),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device="cpu",
            cpu_threads=4,
            enable_mkldnn=False,
        )

    def predict(self, image):
        pixels = np.asarray(image)[:, :, ::-1].copy()
        results = self.pipeline.predict(pixels)
        lines = []
        for result in results:
            payload = result.json
            if isinstance(payload, str):
                payload = json.loads(payload)
            data = payload.get("res", payload)
            for text, score, box in zip(data["rec_texts"], data["rec_scores"], data["rec_polys"]):
                if text.strip():
                    lines.append({"text": text, "score": float(score), "box": box})
        return lines[:500]
