import asyncio
import hmac
import io
import os
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 24_000_000
OCR_TIMEOUT_SECONDS = 85
IMAGE_TYPES = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def decode_image(data, media_type):
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != IMAGE_TYPES[media_type]:
                raise ValueError("IMAGE_TYPE_MISMATCH")
            if max(image.size) > 10000 or image.width * image.height > MAX_PIXELS:
                raise ValueError("IMAGE_PIXEL_LIMIT")
            image.load()
            return ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(422, "IMAGE_INVALID") from error


def load_engine():
    from engine import WaybillOcr

    return WaybillOcr()


def create_app(engine_factory=load_engine):
    @asynccontextmanager
    async def lifespan(app):
        token = os.environ.get("BOS_OCR_TOKEN", "")
        if len(token) < 32:
            raise RuntimeError("OCR_TOKEN_REQUIRED")
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="waybill-ocr")
        app.state.engine = await asyncio.get_running_loop().run_in_executor(executor, engine_factory)
        app.state.executor = executor
        app.state.token = token
        app.state.pending = 0
        app.state.ready = True
        try:
            yield
        finally:
            app.state.ready = False
            executor.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health():
        if not getattr(app.state, "ready", False):
            raise HTTPException(503, "OCR_NOT_READY")
        return {"status": "ok"}

    @app.post("/recognize")
    async def recognize(request: Request):
        authorization = request.headers.get("authorization", "")
        if not hmac.compare_digest(authorization.encode(), f"Bearer {app.state.token}".encode()):
            raise HTTPException(401, "UNAUTHORIZED")
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type not in IMAGE_TYPES:
            raise HTTPException(415, "IMAGE_TYPE_UNSUPPORTED")
        if app.state.pending >= 2:
            raise HTTPException(429, "OCR_BUSY")
        app.state.pending += 1
        future = None
        inference = None
        try:
            data = bytearray()
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, "IMAGE_BYTE_LIMIT")
                data.extend(chunk)
            if not data:
                raise HTTPException(422, "IMAGE_EMPTY")

            def predict():
                start = time.perf_counter()
                image = decode_image(data, media_type)
                try:
                    lines = app.state.engine.predict(image)
                finally:
                    image.close()
                return {
                    "lines": lines,
                    "durationMs": round((time.perf_counter() - start) * 1000),
                    "engine": app.state.engine.name,
                }

            loop = asyncio.get_running_loop()
            inference = app.state.executor.submit(predict)
            future = asyncio.wrap_future(inference)

            def released():
                app.state.pending -= 1

            def completed(result):
                if not result.cancelled():
                    result.exception()

            inference.add_done_callback(lambda _: loop.call_soon_threadsafe(released))
            future.add_done_callback(completed)
            deadline = loop.time() + OCR_TIMEOUT_SECONDS
            while True:
                finished, _ = await asyncio.wait({future}, timeout=0.1)
                if finished:
                    return future.result()
                if await request.is_disconnected():
                    inference.cancel()
                    raise HTTPException(499, "REQUEST_CANCELLED")
                if loop.time() >= deadline:
                    inference.cancel()
                    raise TimeoutError
        except asyncio.CancelledError:
            if inference is not None:
                inference.cancel()
            raise
        except TimeoutError as error:
            raise HTTPException(504, "OCR_TIMEOUT") from error
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(503, "OCR_FAILED") from error
        finally:
            if future is None:
                app.state.pending -= 1

    return app


app = create_app()
