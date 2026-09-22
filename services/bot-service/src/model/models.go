package model

import (
	"time"

	"gorm.io/gorm"
)

// User represents a user in the system.
type User struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Username  string         `gorm:"unique;not null" json:"username"`
	Email     string         `gorm:"unique;not null" json:"email"`
	Password  string         `gorm:"not null" json:"-"` // hashed password
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// Chat represents a chat session between a user and the bot.
type Chat struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	UserID    uint           `gorm:"not null" json:"user_id"`
	Title     string         `gorm:"size:255" json:"title"` // optional title for the chat
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// Message represents a message within a chat.
type Message struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	ChatID    uint           `gorm:"not null" json:"chat_id"`
	Content   string         `gorm:"type:text;not null" json:"content"`
	IsBot     bool           `gorm:"not null" json:"is_bot"` // true if message is from bot, false if from user
	CreatedAt time.Time      `json:"created_at"`
}

// Knowledge represents a piece of knowledge stored in the vector database.
type Knowledge struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Title       string         `gorm:"size:255" json:"title"`
	Content     string         `gorm:"type:text;not null" json:"content"`
	Source      string         `gorm:"size:255" json:"source"` // e.g., URL, file path, etc.
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	// VectorID is the ID in the Qdrant vector store.
	VectorID    string         `gorm:"unique" json:"vector_id"`
}

// ChatResponse represents the response structure for a chat request.
type ChatResponse struct {
	Response string `json:"response"`
	ChatID   uint   `json:"chat_id"`
}