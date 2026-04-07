FROM postgres:16

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3-pip && \
    pip install --break-system-packages b2 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY archive-wal.sh /usr/local/bin/archive-wal.sh
RUN chmod +x /usr/local/bin/archive-wal.sh
