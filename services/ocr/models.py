import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path


def manifest():
    return json.loads(Path(__file__).with_name("models.json").read_text(encoding="utf-8"))


def checksum(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def valid_model(root, model):
    return all(
        (root / model["name"] / name).is_file()
        and checksum(root / model["name"] / name) == expected
        for name, expected in model["files"].items()
    )


def verify_models(root):
    for model in manifest()["models"]:
        if not valid_model(root, model):
            raise RuntimeError(f"MODEL_CHECKSUM_INVALID:{model['name']}")


def prepare_models(root):
    root.mkdir(parents=True, exist_ok=True)
    for model in manifest()["models"]:
        if valid_model(root, model):
            continue
        with tempfile.TemporaryDirectory(prefix=".download-", dir=root) as temporary:
            staging = Path(temporary)
            archive_path = staging / "model.tar"
            with urllib.request.urlopen(model["url"], timeout=60) as response:
                with archive_path.open("wb") as file:
                    shutil.copyfileobj(response, file)
            if checksum(archive_path) != model["sha256"]:
                raise RuntimeError("MODEL_DOWNLOAD_CHECKSUM_INVALID")
            with tarfile.open(archive_path) as archive:
                if any(not (item.isfile() or item.isdir()) for item in archive.getmembers()):
                    raise RuntimeError("MODEL_ARCHIVE_INVALID")
                archive.extractall(staging, filter="data")
            model_directory = root / model["name"]
            model_directory.mkdir(exist_ok=True)
            for name, expected in model["files"].items():
                source = staging / model["archiveDirectory"] / name
                if checksum(source) != expected:
                    raise RuntimeError("MODEL_FILE_CHECKSUM_INVALID")
                os.replace(source, model_directory / name)
        print(f"MODEL_READY:{model['name']}", flush=True)
    verify_models(root)


if __name__ == "__main__":
    prepare_models(Path(os.environ.get("BOS_OCR_MODEL_ROOT", "/models")))
