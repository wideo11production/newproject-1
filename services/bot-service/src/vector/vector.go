package vector

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/qdrant/go-client/qdrant"
	"github.com/sashabaranov/go-openai"
)

// QdrantClient wraps the Qdrant client and provides helper methods.
type QdrantClient struct {
	Client     *qdrant.Client
	Collection string
	OpenAIClient *openai.Client
	Ctx        context.Context
}

// NewQdrantClient creates a new Qdrant client with the given configuration.
func NewQdrantClient(host, port, apiKey string, openAIClient *openai.Client) (*QdrantClient, error) {
	var opts []qdrant.ClientOption
	if apiKey != "" {
		opts = append(opts, qdrant.WithAPIKey(apiKey))
	}
	client, err := qdrant.NewClient(host+":"+port, opts...)
	if err != nil {
		return nil, err
	}

	return &QdrantClient{
		Client:     client,
		Collection: "knowledge_base", // default collection
		OpenAIClient: openAIClient,
		Ctx:        context.Background(),
	}, nil
}

// EnsureCollection ensures that the collection exists with the given vector size.
func (c *QdrantClient) EnsureCollection(vectorSize int) error {
	exists, err := c.Client.CollectionExists(c.Ctx, c.Collection)
	if err != nil {
		return err
	}
	if !exists {
		// Create collection with cosine distance (default for OpenAI embeddings)
		err := c.Client.CreateCollection(c.Ctx, &qdrant.CreateCollection{
			CollectionName: c.Collection,
			VectorsConfig: &qdrant.VectorsConfig{
				Params: &qdrant.VectorParams{
					Distance: qdrant.Distance_Cosine,
					Size:     uint64(vectorSize),
				},
			},
		})
		if err != nil {
			return err
		}
		log.Printf("Collection %s created with vector size %d", c.Collection, vectorSize)
	}
	return nil
}

// StoreKnowledge stores a knowledge item with its embedding.
func (c *QdrantClient) StoreKnowledge(content string) (string, error) {
	// Get embedding from OpenAI
	embedding, err := c.getEmbedding(content)
	if err != nil {
		return "", err
	}

	// Generate a unique ID for the point (we can use a UUID or let Qdrant generate)
	// For simplicity, we'll use a random UUID string. In practice, you might want to use a deterministic ID based on content.
	pointID := uuid.New().String()

	// Create point
	point := &qdrant.Point{
		Id:      pointID, // Qdrant expects a string or uint64; we'll use string.
		Vectors: embedding,
		Payload: map[string]interface{}{
			"content": content,
			// We can store additional metadata here.
		},
	}

	// Upsert the point
	_, err = c.Client.Upsert(c.Ctx, c.Collection, []*qdrant.Point{point}, nil)
	if err != nil {
		return "", err
	}

	return pointID, nil
}

// SearchKnowledge searches for similar knowledge items based on the query text.
func (c *QdrantClient) SearchKnowledge(query string, limit int) ([]string, error) {
	// Get embedding for the query
	queryEmbedding, err := c.getEmbedding(query)
	if err != nil {
		return nil, err
	}

	// Perform search
	searchResult, err := c.Client.Search(c.Ctx, &qdrant.SearchPoints{
		CollectionName: c.Collection,
		Vector:         queryEmbedding,
		Limit:          uint64(limit),
		WithPayload:    true,
	}, nil)
	if err != nil {
		return nil, err
	}

	var results []string
	for _, point := range searchResult.Result {
		if content, ok := point.Payload["content"].(string); ok {
			results = append(results, content)
		}
	}

	return results, nil
}

// getEmbedding gets the embedding vector for a given text using OpenAI.
func (c *QdrantClient) getEmbedding(text string) ([]float32, error) {
	resp, err := c.OpenAIClient.CreateEmbeddings(c.Ctx, openai.EmbeddingRequest{
		Input: []string{text},
		Model: openai.ADAEmbeddingV2, // or another embedding model
	})
	if err != nil {
		return nil, err
	}

	if len(resp.Data) == 0 {
		return nil, fmt.Errorf("no embedding returned")
	}

	// Convert []float64 to []float32
	embedding64 := resp.Data[0].Embedding
	embedding32 := make([]float32, len(embedding64))
	for i, v := range embedding64 {
		embedding32[i] = float32(v)
	}

	return embedding32, nil
}