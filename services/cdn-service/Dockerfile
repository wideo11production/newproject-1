FROM golang:1.18-alpine AS builder

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o cdn-service ./services/cdn-service/cmd/cdn-service/

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/cdn-service .

EXPOSE 8089

CMD ["./cdn-service"]