FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends libglib2.0-0 libgomp1 libgl1 && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    BOS_OCR_MODEL_ROOT=/models PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 XDG_CACHE_HOME=/tmp/cache \
    PADDLE_HOME=/tmp/paddle PADDLE_PDX_CACHE_HOME=/tmp/paddlex \
    HF_HOME=/tmp/huggingface MODELSCOPE_CACHE=/tmp/modelscope MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app
COPY requirements.lock ./requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip pip install --no-compile -r requirements.lock
RUN groupadd --gid 10001 ocr && useradd --uid 10001 --gid 10001 --no-create-home ocr && mkdir /models && chown ocr:ocr /models
COPY app.py engine.py models.py models.json ./
COPY licenses ./licenses
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
