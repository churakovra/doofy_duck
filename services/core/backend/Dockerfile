FROM golang:1.27.2-alpine AS build
WORKDIR /src
COPY services/core/simulation /src/services/core/simulation
COPY services/core/backend /src/services/core/backend
WORKDIR /src/services/core/backend
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/core ./cmd/core \
    && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/core-migrate ./cmd/migrate

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/core /core
COPY --from=build /out/core-migrate /core-migrate
EXPOSE 8080
ENTRYPOINT ["/core"]
