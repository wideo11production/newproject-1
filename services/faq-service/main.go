package main

import (
	"fmt"
	"time"
)

// FaqService represents the dynamic FAQ system
type FaqService struct {
	Name        string
	Queries     []FaqQuery
	Versions    map[string]string // version -> query text
	SearchEngine *SearchEngine
}

// Query represents a FAQ query
type Query struct {
	ID       string
	Question string
	Answer   string
	Version  string
}

// Version represents a version of the FAQ (used for versioning)
type Version struct {
	ID      string
	Content string
	Created time.Time
}

// SearchEngine abstracts the search functionality
type SearchEngine interface {
	Search(query string) ([]string, error)
}

// NewFaqService creates a new FaqService instance
func NewFaqService(queries []Query) *FaqService {
	return &FaqService{
		Name:        "faq-service",
		Queries:     queries,
		Versions:    make(map[string]string),
		SearchEngine: NewSimpleSearchEngine(),
	}
}

// AddQuery adds a new FAQ query
func (fs *FaqService) AddQuery(q Query) {
	fs.Queries = append(fs.Queries, q)
}

// GetQuery retrieves a specific query by ID
func (fs *FaqService) GetQuery(id string) (*Query, error) {
	for _, q := range fs.Queries {
		if q.ID == id {
			return &q, nil
		}
	}
	return nil, fmt.Errorf("query not found")
}

// GetAllQueries returns all queries
func (fs *FaqService) GetAllQueries() []Query {
	return fs.Queries
}

// UpdateVersion updates a FAQ version
func (fs *FaqService) UpdateVersion(versionID string, content string) {
	// Simplified: in a real implementation, this would update the version in the database
	fmt.Printf("Updating FAQ version %s with content: %s\n", versionID, content)
}

// SearchEngine wraps a simple in-memory search (replace with Elasticsearch/Lucene in production)
type SimpleSearchEngine struct {
	index map[string][]string
}

func NewSimpleSearchEngine() *SearchEngine {
	return &SimpleSearchEngine{
		index: make(map[string][]string),
	}
}

func (se *SimpleSearchEngine) Search(query string) ([]string, error) {
	// Simple keyword search
	var results []string
	for _, doc := range se.index {
		if contains(doc, query) {
			results = append(results, doc)
		}
	}
	return results, nil
}

func (se *SimpleSearchEngine) contains(text string, substring string) bool {
	return len(substring) > 0 && len(text) > 0 && containsSubstring(text, substring)
}

func containsSubstring(text, substring string) bool {
	return len(text) >= len(substring) && (text == substring || contains(text, substring))
}

// generateID creates a simple unique ID
func generateID() string {
	return fmt.Sprintf("faq_%s", time.Now().UnixNano())
}
