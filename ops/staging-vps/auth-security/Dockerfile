FROM golang@sha256:cd9a32216aee5667f957a62d13a10032a63fd58e14b3f3d9cc8c2122f501e95e AS build
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOTOOLCHAIN=local GOMAXPROCS=2 GOPROXY=off
WORKDIR /src
COPY . .
RUN --network=none --mount=type=cache,id=barber-auth-vlyz06-gocache,target=/root/.cache/go-build go test -mod=vendor -p=2 ./internal/authremediation ./internal/observability ./internal/conf ./internal/crypto
RUN --network=none --mount=type=cache,id=barber-auth-vlyz06-gocache,target=/root/.cache/go-build go test -mod=vendor -p=2 ./internal/authremediation -fuzz=FuzzDataRowNeverPanics -fuzztime=20s -parallel=2
RUN --network=none --mount=type=cache,id=barber-auth-vlyz06-gocache,target=/root/.cache/go-build go build -mod=vendor -p=2 -trimpath -buildvcs=false -ldflags '-X github.com/supabase/auth/internal/utilities.Version=v2.197.0-barber-security-local1' -o /out/auth . && go version -m /out/auth

FROM supabase/gotrue@sha256:839f529492d116b4e8b7777c953a27c381d34c15a744b1bcefde5eefaa1f9f9f
USER root
RUN apk add --no-cache --upgrade libcrypto3=3.5.9-r0 libssl3=3.5.9-r0
COPY --from=build /out/auth /usr/local/bin/auth
COPY migrations/ /usr/local/etc/auth/migrations/
LABEL org.opencontainers.image.source="https://github.com/supabase/auth" \
      org.opencontainers.image.revision="4eee58f296d9698a1c2c0ae14d7a0b379c7622d3" \
      org.opencontainers.image.version="v2.197.0-barber-security-local1" \
      cloud.malabdullah.barber.candidate="LOCAL-ONLY: downstream vendored pgproto3 patch; grpc1.83.2; not upstream official release"
USER supabase
