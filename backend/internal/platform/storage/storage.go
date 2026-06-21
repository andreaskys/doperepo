package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Client embrulha o MinIO (S3-compatível) para as fotos dos anúncios.
type Client struct {
	mc        *minio.Client
	bucket    string
	publicURL string
}

// New conecta no MinIO, garante o bucket e deixa-o public-read.
func New(ctx context.Context, endpoint, accessKey, secretKey, bucket, publicURL string) (*Client, error) {
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false, // dev: MinIO em http
	})
	if err != nil {
		return nil, fmt.Errorf("minio client: %w", err)
	}

	c := &Client{mc: mc, bucket: bucket, publicURL: publicURL}
	if err := c.ensureBucket(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Client) ensureBucket(ctx context.Context) error {
	exists, err := c.mc.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("bucket exists: %w", err)
	}
	if !exists {
		if err := c.mc.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("make bucket: %w", err)
		}
	}
	// public-read: as fotos são exibidas direto via <img>. ponytail: política
	// anônima de GET no MVP; prod usaria CDN ou URLs presigned.
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}`, c.bucket)
	if err := c.mc.SetBucketPolicy(ctx, c.bucket, policy); err != nil {
		return fmt.Errorf("set policy: %w", err)
	}
	return nil
}

// Upload grava o objeto e devolve a URL pública.
func (c *Client) Upload(ctx context.Context, key, contentType string, r io.Reader, size int64) (string, error) {
	if _, err := c.mc.PutObject(ctx, c.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType}); err != nil {
		return "", fmt.Errorf("put object: %w", err)
	}
	return c.publicURL + "/" + c.bucket + "/" + key, nil
}

func (c *Client) Delete(ctx context.Context, key string) error {
	return c.mc.RemoveObject(ctx, c.bucket, key, minio.RemoveObjectOptions{})
}
