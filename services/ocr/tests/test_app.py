import asyncio
import io
import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from app import MAX_BYTES, create_app

TOKEN = "a" * 40
HEADERS = {"authorization": f"Bearer {TOKEN}", "content-type": "image/png"}


def png(width=16, height=12):
    with Image.new("1", (width, height), 1) as image:
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()


class FakeEngine:
    name = "test-ocr"

    def predict(self, image):
        return [{"text": f"{image.width}x{image.height}", "score": 0.99, "box": [[0, 0]] * 4}]


class AppTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"BOS_OCR_TOKEN": TOKEN})
        self.environment.start()
        self.client = TestClient(create_app(FakeEngine))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.environment.stop()

    def test_recognition_and_health(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        result = self.client.post("/recognize", content=png(), headers=HEADERS)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["lines"][0]["text"], "16x12")
        self.assertEqual(result.json()["engine"], "test-ocr")
        self.assertGreaterEqual(result.json()["durationMs"], 0)
        self.assertEqual(self.client.get("/docs").status_code, 404)

    def test_token_required(self):
        for token in [None, "Bearer bad-token"]:
            headers = {"content-type": "image/png"}
            if token:
                headers["authorization"] = token
            self.assertEqual(self.client.post("/recognize", content=png(), headers=headers).status_code, 401)

    def test_invalid_images_and_limits(self):
        for content, media_type, status in [
            (b"", "image/png", 422),
            (b"not an image", "image/png", 422),
            (png(), "image/jpeg", 422),
            (b"<svg></svg>", "image/svg+xml", 415),
            (png(6000, 6000), "image/png", 422),
            (png(10001, 1), "image/png", 422),
            (b"x" * (MAX_BYTES + 1), "image/png", 413),
        ]:
            with self.subTest(media_type=media_type, status=status, bytes=len(content)):
                result = self.client.post("/recognize", content=content, headers={**HEADERS, "content-type": media_type})
                self.assertEqual(result.status_code, status)
                self.assertEqual(self.client.app.state.pending, 0)

    def test_exif_orientation(self):
        output = io.BytesIO()
        with Image.new("RGB", (20, 10), "white") as image:
            exif = Image.Exif()
            exif[0x0112] = 6
            image.save(output, format="JPEG", exif=exif)
        result = self.client.post("/recognize", content=output.getvalue(), headers={**HEADERS, "content-type": "image/jpeg"})
        self.assertEqual(result.json()["lines"][0]["text"], "10x20")

    def test_engine_errors_do_not_leak(self):
        with patch.object(self.client.app.state.engine, "predict", side_effect=RuntimeError("private internal path")):
            result = self.client.post("/recognize", content=png(), headers=HEADERS)
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json(), {"detail": "OCR_FAILED"})
        self.assertEqual(self.client.post("/recognize", content=png(), headers=HEADERS).status_code, 200)

    def test_queue_is_bounded_and_recovers(self):
        release = threading.Event()
        original = self.client.app.state.engine.predict

        def blocked(image):
            if not release.wait(5):
                raise RuntimeError("TEST_TIMEOUT")
            return original(image)

        with patch.object(self.client.app.state.engine, "predict", blocked), ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.client.post, "/recognize", content=png(), headers=HEADERS)
            second = executor.submit(self.client.post, "/recognize", content=png(), headers=HEADERS)
            try:
                deadline = time.monotonic() + 3
                while self.client.app.state.pending < 2 and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertEqual(self.client.app.state.pending, 2)
                self.assertEqual(self.client.post("/recognize", content=png(), headers=HEADERS).status_code, 429)
            finally:
                release.set()
            self.assertEqual(first.result().status_code, 200)
            self.assertEqual(second.result().status_code, 200)
        self.assertEqual(self.client.post("/recognize", content=png(), headers=HEADERS).status_code, 200)

    def test_disconnected_queued_request_never_runs(self):
        release = threading.Event()
        started = threading.Event()
        calls = []

        class BlockingEngine(FakeEngine):
            def predict(self, image):
                calls.append(image.size)
                started.set()
                if not release.wait(5):
                    raise RuntimeError("TEST_TIMEOUT")
                return super().predict(image)

        class PendingRequest:
            headers = HEADERS
            disconnected = False

            async def stream(self):
                yield png()

            async def is_disconnected(self):
                return self.disconnected

        async def scenario():
            app = create_app(BlockingEngine)
            handler = next(route.endpoint for route in app.routes if route.path == "/recognize")
            async with app.router.lifespan_context(app):
                first = asyncio.create_task(handler(PendingRequest()))
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 2))
                    request = PendingRequest()
                    queued = asyncio.create_task(handler(request))
                    await asyncio.sleep(0.02)
                    self.assertEqual(app.state.pending, 2)
                    request.disconnected = True
                    with self.assertRaises(HTTPException) as failure:
                        await asyncio.wait_for(queued, 2)
                    self.assertEqual(failure.exception.status_code, 499)
                    await asyncio.sleep(0.02)
                    self.assertEqual(app.state.pending, 1)
                finally:
                    release.set()
                    await first
                self.assertEqual(len(calls), 1)
                self.assertEqual(app.state.pending, 0)

        asyncio.run(scenario())

    def test_timeout_cancels_waiting_work_without_releasing_running_slot(self):
        release = threading.Event()
        calls = []
        original = self.client.app.state.engine.predict

        def blocked(image):
            calls.append(image.size)
            if not release.wait(5):
                raise RuntimeError("TEST_TIMEOUT")
            return original(image)

        with patch("app.OCR_TIMEOUT_SECONDS", 0.2), patch.object(self.client.app.state.engine, "predict", blocked), ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(self.client.post, "/recognize", content=png(), headers=HEADERS)
            second = executor.submit(self.client.post, "/recognize", content=png(), headers=HEADERS)
            try:
                self.assertEqual(first.result(timeout=3).status_code, 504)
                self.assertEqual(second.result(timeout=3).status_code, 504)
                self.assertEqual(self.client.app.state.pending, 1)
            finally:
                release.set()
        deadline = time.monotonic() + 2
        while self.client.app.state.pending and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.client.app.state.pending, 0)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
