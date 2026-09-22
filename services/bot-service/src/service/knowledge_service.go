package service

import (
	"context"
	"fmt"
	"log"

	"newproject/services/bot-service/src/model"
	"newproject/services/bot-service/src/repository"
	"newproject/services/bot-service/src/vector"

	"github.com/sashabaranov/go-openai"
)

// KnowledgeService provides business logic for the AI knowledge assistant.
type KnowledgeService struct {
	Repo       repository.Repository
	Vector     *vector.QdrantClient
	OpenAIClient *openai.Client
	Ctx        context.Context
}

// NewKnowledgeService creates a new KnowledgeService.
func NewKnowledgeService(repo repository.Repository, qdrantClient *vector.QdrantClient, openAIClient *openai.Client) *KnowledgeService {
	return &KnowledgeService{
		Repo:       repo,
		Vector:     qdrantClient,
		OpenAIClient: openAIClient,
		Ctx:        context.Background(),
	}
}

// CreateChat creates a new chat for the given user.
func (s *KnowledgeService) CreateChat(userID uint) (*model.Chat, error) {
	chat := &model.Chat{
		UserID: userID,
		Title:  "New Chat", // default title; could be updated later based on first message
	}
	if err := s.Repo.CreateChat(s.Ctx, chat); err != nil {
		return nil, err
	}
	return chat, nil
}

// SendMessage sends a user message and returns the bot's response.
func (s *KnowledgeService) SendMessage(chatID uint, userID uint, content string) (*model.ChatResponse, error) {
	// 1. Save the user message
	userMsg := &model.Message{
		ChatID: chatID,
		Content: content,
		IsBot: false,
	}
	if err := s.Repo.CreateMessage(s.Ctx, userMsg); err != nil {
		return nil, err
	}

	// 2. Retrieve relevant knowledge from the vector store
	knowledgeResults, err := s.Vector.SearchKnowledge(content, 3) // top 3 similar knowledge items
	if err != nil {
		log.Printf("Error searching knowledge: %v", err)
		// Continue without knowledge
	}

	// 3. Build the prompt for OpenAI
	var context string
	if len(knowledgeResults) > 0 {
		context = "Use the following knowledge to answer the user's question:\n"
		for i, k := range knowledgeResults {
			context += fmt.Sprintf("%d. %s\n", i+1, k)
		}
		context += "\n"
	}

	// 4. Get chat history for context (last few messages)
	messages, err := s.Repo.GetMessagesByChatID(s.Ctx, chatID, 10) // last 10 messages
	if err != nil {
		log.Printf("Error getting messages: %v", err)
	}

	// 5. Prepare messages for OpenAI chat completion
	var openAIMessages []openai.ChatCompletionMessage
	// System message
	openAIMessages = append(openAIMessages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleSystem,
		Content: "You are a helpful AI assistant. Answer the user's question based on the provided knowledge and chat history.",
	})
	// Add knowledge as a system message if available
	if context != "" {
		openAIMessages = append(openAIMessages, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleSystem,
			Content: context,
		})
	}
	// Add chat history
	for _, msg := range messages {
		role := openai.ChatMessageRoleUser
		if msg.IsBot {
			role = openai.ChatMessageRoleAssistant
		}
		openAIMessages = append(openAIMessages, openai.ChatCompletionMessage{
			Role:    role,
			Content: msg.Content,
		})
	}
	// Add the current user message
	openAIMessages = append(openAIMessages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: content,
	})

	// 6. Call OpenAI chat completion
	resp, err := s.OpenAIClient.CreateChatCompletion(s.Ctx, openai.ChatCompletionRequest{
		Model:    openai.GPT3Dot5Turbo,
		Messages: openAIMessages,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get completion from OpenAI: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("no completion returned")
	}

	botResponse := resp.Choices[0].Message.Content

	// 7. Save the bot message
	botMsg := &model.Message{
		ChatID: chatID,
		Content: botResponse,
		IsBot: true,
	}
	if err := s.Repo.CreateMessage(s.Ctx, botMsg); err != nil {
		return nil, err
	}

	// 8. Update chat title if it's the first message (optional)
	// We could update the title based on the first user message, but for simplicity, we'll leave it.

	// 9. Return the response
	return &model.ChatResponse{
		Response: botResponse,
		ChatID:   chatID,
	}, nil
}