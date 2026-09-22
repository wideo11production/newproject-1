package nats

import (
	"context"
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"newproject/services/bot-service/src/model"
	"newproject/services/bot-service/src/repository"
	"newproject/services/bot-service/src/vector"
)

// KnowledgeInput represents the incoming knowledge item from NATS.
type KnowledgeInput struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Source  string `json:"source,omitempty"`
}

// Consumer handles NATS JetStream messages for knowledge ingestion.
type Consumer struct {
	JSContext jetstream.Context
	Subject   string
	Stream    string
	Durable   string
	Repo      repository.Repository
	Vector    *vector.QdrantClient
	Ctx       context.Context
}

// NewConsumer creates a new NATS consumer.
func NewConsumer(natsURL, clusterID, clientID, subject, stream, durable string, repo repository.Repository, vectorClient *vector.QdrantClient) (*Consumer, error) {
	// Connect to NATS
	nc, err := nats.Connect(natsURL, nats.Name(clientID))
	if err != nil {
		return nil, err
	}

	// Create JetStream context
	js, err := jetstream.New(nc)
	if err != nil {
		return nil, err
	}

	// Ensure stream exists (optional, but we can try to create or use existing)
	_, err = js.Stream(stream)
	if err != nil {
		// Stream does not exist, create it
		_, err = js.AddStream(&jetstream.StreamConfig{
			Name:     stream,
			Subjects: []string{subject},
		})
		if err != nil {
			return nil, err
		}
	}

	return &Consumer{
		JSContext: js,
		Subject:   subject,
		Stream:    stream,
		Durable:   durable,
		Repo:      repo,
		Vector:    vectorClient,
		Ctx:       context.Background(),
	}, nil
}

// Start begins consuming messages from the subject.
func (c *Consumer) Start() error {
	// Create or update consumer
	cons, err := c.JSContext.CreateOrUpdateConsumer(c.Ctx, c.Stream, jetstream.ConsumerConfig{
		DurableName: c.Durable,
		FilterSubject: c.Subject,
		AckPolicy: jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return err
	}

	// Consume messages
	messages, err := cons.Messages()
	if err != nil {
		return err
	}

	// Process messages in a goroutine
	go func() {
		for msg := range messages {
			go func(m jetstream.Msg) {
				var input KnowledgeInput
				if err := json.Unmarshal(m.Data(), &input); err != nil {
					log.Printf("Error decoding knowledge input: %v", err)
					m.Nak() // negative acknowledgment
					return
				}

				// Store knowledge in Postgres
				knowledge := &model.Knowledge{
					Title:   input.Title,
					Content: input.Content,
					Source:  input.Source,
				}
				if err := c.Repo.CreateKnowledge(c.Ctx, knowledge); err != nil {
					log.Printf("Error storing knowledge in Postgres: %v", err)
					m.Nak()
					return
				}

				// Store embedding in Qdrant
				vectorID, err := c.Vector.StoreKnowledge(input.Content)
				if err != nil {
					log.Printf("Error storing knowledge in Qdrant: %v", err)
					m.Nak()
					return
				}

				// Update the knowledge record with the vector ID
				knowledge.VectorID = vectorID
				if err := c.Repo.UpdateKnowledge(c.Ctx, knowledge); err != nil {
					log.Printf("Error updating knowledge with vector ID: %v", err)
					m.Nak()
					return
				}

				log.Printf("Successfully processed knowledge: %s", input.Title)
				m.Ack() // acknowledge message
			}(msg)
		}
	}()

	return nil
}