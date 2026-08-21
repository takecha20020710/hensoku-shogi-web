FROM ubuntu:24.04 AS engine-builder

ARG DEBIAN_FRONTEND=noninteractive
ARG YANEURAOU_REF=33ccf1f907eb7184889fa23051243f81ab0bf973

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN git init /src/YaneuraOu \
    && git -C /src/YaneuraOu remote add origin https://github.com/yaneurao/YaneuraOu.git \
    && git -C /src/YaneuraOu fetch --depth 1 origin "${YANEURAOU_REF}" \
    && git -C /src/YaneuraOu checkout --detach FETCH_HEAD

COPY patches/yaneuraou-variant-rule.patch /tmp/yaneuraou-variant-rule.patch

RUN git -C /src/YaneuraOu apply --check /tmp/yaneuraou-variant-rule.patch \
    && git -C /src/YaneuraOu apply /tmp/yaneuraou-variant-rule.patch

WORKDIR /src/YaneuraOu/source

RUN make -j2 pgo-tournament \
        COMPILER=g++ \
        YANEURAOU_EDITION=YANEURAOU_ENGINE_MATERIAL \
        ENGINE_NAME=YaneuraOu-Material-SSE42 \
        TARGET_CPU=SSE42 \
    && install -D -m 0755 YaneuraOu-by-gcc /out/YaneuraOu \
    && make -j2 pgo-tournament \
        COMPILER=g++ \
        YANEURAOU_EDITION=YANEURAOU_ENGINE_MATERIAL \
        ENGINE_NAME=YaneuraOu-Material-AVX2 \
        TARGET_CPU=AVX2 \
    && install -D -m 0755 YaneuraOu-by-gcc /out/YaneuraOu-avx2


FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YANEURAOU_PATH=/opt/yaneuraou/YaneuraOu

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=engine-builder /out/YaneuraOu /opt/yaneuraou/YaneuraOu
COPY --from=engine-builder /out/YaneuraOu-avx2 /opt/yaneuraou/YaneuraOu-avx2
COPY --from=engine-builder /src/YaneuraOu/LICENSE /opt/yaneuraou/LICENSE
COPY app.py ./
COPY game_stats.py ./
COPY opening_book.py ./
COPY templates ./templates
COPY static ./static

RUN useradd --system --uid 10001 --create-home appuser \
    && chown -R appuser:appuser /app /opt/yaneuraou

USER appuser

EXPOSE 10000

CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 4 --timeout 120 app:app"]
