# Local runtime-base candidate only; bundles must be built separately using the
# pinned official shell-containing builder, then copied into this runtime.
FROM --platform=linux/amd64 supabase/edge-runtime@sha256:fded42ff725708990b1a0803633c2659453259d075c4bec6b4d01dfb82dc055e AS upstream
RUN test "$(sha256sum /usr/local/bin/edge-runtime | cut -d ' ' -f 1)" = 7883510fe308b4b5c49ec0a8e2020ec81c5fa41133239f3969a372b1cbf107ba && \
    mkdir /barber-native-evidence && \
    sha256sum /usr/local/bin/edge-runtime /usr/lib/libonnxruntime.so* > /barber-native-evidence/upstream.sha256 && \
    ldd /usr/local/bin/edge-runtime /usr/lib/libonnxruntime.so* > /barber-native-evidence/upstream-linkage.txt && \
    ! grep -q 'not found' /barber-native-evidence/upstream-linkage.txt

FROM --platform=linux/amd64 gcr.io/distroless/cc-debian13@sha256:20afe6a70f2565277b704cc17289cb557f353a3619f6350f52a2317106598df4
COPY --from=upstream --chown=0:0 /usr/local/bin/edge-runtime /usr/local/bin/edge-runtime
COPY --from=upstream --chown=0:0 /usr/lib/libonnxruntime.so* /usr/lib/
COPY --from=upstream --chown=0:0 /barber-native-evidence/ /usr/local/share/barber-edge-evidence/
ENV PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp DENO_DIR=/tmp/deno XDG_CACHE_HOME=/tmp/cache ORT_DYLIB_PATH=/usr/lib/libonnxruntime.so
WORKDIR /home/deno
USER 10001:10001
LABEL org.opencontainers.image.source="https://github.com/supabase/edge-runtime" \
      cloud.malabdullah.barber.candidate="edge-runtime-security-local-only" \
      cloud.malabdullah.barber.upstream-manifest="sha256:fded42ff725708990b1a0803633c2659453259d075c4bec6b4d01dfb82dc055e"
ENTRYPOINT ["edge-runtime"]
CMD ["--help"]
