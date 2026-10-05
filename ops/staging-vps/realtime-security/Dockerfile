# Staging-only candidate. No publishing/deployment is authorized by this file.
FROM --platform=linux/amd64 supabase/realtime@sha256:482868126f20243547d2d2cb03f78d78eeb318435c48198a1a43f8c491433864
USER root
COPY debian.sources /etc/apt/sources.list.d/debian.sources
COPY harden.sh /tmp/realtime-harden.sh
COPY snapshot.sha256 /tmp/realtime-snapshot.sha256
RUN /bin/sh /tmp/realtime-harden.sh && rm /tmp/realtime-harden.sh /tmp/realtime-snapshot.sha256
COPY --chmod=0555 staging-entrypoint.sh /usr/local/bin/barber-realtime-entrypoint
LABEL org.opencontainers.image.source="https://github.com/supabase/realtime" \
      org.opencontainers.image.revision="e0d1f657161f7f01e9b4be156627d974fdc6918d" \
      cloud.malabdullah.barber.candidate="realtime-security-local-only"
USER 65534:65534
ENTRYPOINT ["/usr/bin/tini", "-s", "-g", "--", "/usr/local/bin/barber-realtime-entrypoint"]
CMD ["/app/bin/server"]
