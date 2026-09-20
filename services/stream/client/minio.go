package client

import (
	"context"
	"fmt"

	"newproject/services/stream/config"
)

type MinIOClient struct {
	bucketName string
	endpoint   string
}

func NewMinIOClient(cfg *config.MinIOConfig) (*MinIOClient, error) {
	return &MinIOClient{
		bucketName: cfg.BucketName,
		endpoint:   cfg.Endpoint,
	}, nil
}

func (c *MinIOClient) DownloadFile(ctx context.Context, bucketName, objectName, filePath string) error {
	return fmt.Errorf("download not implemented: %s/%s from %s", bucketName, objectName, c.endpoint)
}

func (c *MinIOClient) UploadFile(ctx context.Context, bucketName, objectName, filePath string, data []byte) error {
	return fmt.Errorf("upload not implemented: %s/%s to %s", bucketName, objectName, c.endpoint)
}
