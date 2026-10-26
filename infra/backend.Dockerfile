FROM golang:1.27.3-alpine AS build
WORKDIR /src
COPY apps/backend/go.mod apps/backend/go.sum ./
RUN go mod download
COPY apps/backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/ ./cmd/api ./cmd/worker ./cmd/signer ./cmd/webhooks

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/ /usr/local/bin/
COPY packages/contracts/chains.json ./chains.json
USER 10001:10001
CMD ["api"]
