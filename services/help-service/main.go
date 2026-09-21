package main

import (
	"fmt"
	"os"
)

// HelpService represents the ticket system for help requests
// Implements categories, SLAs, and ticket management

type HelpService struct {
	Name        string
	Categories  []Category
	SLAs        map[string]TimeDuration
	Tickets    *TicketStore
}

// Category represents a ticket category (e.g., "Technical", "Billing", "General")
type Category struct {
	Name string
}

// TimeDuration represents a time duration for SLA (e.g., "1h", "4h", "24h")
type TimeDuration string

// TicketStore abstracts ticket storage (could be PostgreSQL, Redis, etc.)
type TicketStore interface {
	Create(Ticket) error
	GetByID(id string) (*Ticket, error)
	Update(id string, updates map[string]interface{}) error
	Delete(id string) error
}

// Ticket represents a help desk ticket
type Ticket struct {
	ID        string    `json:"id"`
	Category  Category  `json:"category"`
	Subject   string    `json:"subject"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// NewHelpService creates a new HelpService instance
func NewHelpService(categories []Category, slaMap map[string]TimeDuration) *HelpService {
	return &HelpService{
		Name:        "help-service",
		Categories:  categories,
		SLAs:        slaMap,
		Tickets:     NewTicketStore(),
	}
}

// CreateTicket creates a new ticket in the system
func (hs *HelpService) CreateTicket(subject, category string) (*Ticket, error) {
	ticket := &Ticket{
		ID:        generateID(),
		Category:  Category{Name: category},
		Subject:  subject,
		Status:   "open",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	return hs.Tickets.Create(ticket)
}

// GetTicket retrieves a ticket by ID
func (hs *HelpService) GetTicket(id string) (*Ticket, error) {
	return hs.Tickets.GetByID(id)
}

// UpdateTicket updates a ticket's fields
func (hs *HelpService) UpdateTicket(id string, updates map[string]interface{}) error {
	return hs.Tickets.Update(id, updates)
}

// DeleteTicket removes a ticket
func (hs *HelpService) DeleteTicket(id string) error {
	return hs.Tickets.Delete(id)
}

// GenerateID creates a unique ID for tickets
func generateID() string {
	// Simple UUID-like generation
	return fmt.Sprintf("ticket_%s", time.Now().UnixNano())
}

// NewTicketStore creates a mock ticket store (replace with real implementation)
func NewTicketStore() TicketStore {
	return &MockTicketStore{}
}

// MockTicketStore implements TicketStore for demonstration
type MockTicketStore struct {
	tickets map[string]*Ticket
}

func (mt *MockTicketStore) Create(ticket *Ticket) error {
	m.tickets[ticket.ID] = ticket
	return nil
}

func (mt *MockTicketStore) GetByID(id string) (*Ticket, error) {
	if ticket, ok := mt.tickets[id]; ok {
		return ticket, nil
	}
	return nil, fmt.Errorf("ticket not found")
}

func (mt *MockTicketStore) Update(id string, updates map[string]interface{}) error {
	if ticket, ok := mt.tickets[id]; ok {
		ticket = *updateTicket(ticket, updates)
		m.tickets[id] = ticket
		return nil
	}
	return fmt.Errorf("ticket not found")
}

func (mt *MockTicketStore) Delete(id string) error {
	if _, ok := mt.tickets[id]; !ok {
		return fmt.Errorf("ticket not found")
	}
	delete(mt.tickets, id)
	return nil
}

func (mt *MockTicketStore) updateTicket(ticket *Ticket, updates map[string]interface{}) *Ticket {
	// Apply updates to the ticket
	if s, ok := updates["status"].(string); ok && s != "" {
		ticket.Status = s
	}
	if c, ok := updates["category"].(string); ok {
		ticket.Category.Name = c
	}
	return ticket
}

// MockTicketStore is a placeholder for a real database-backed store
type MockTicketStore struct {
	tickets map[string]*Ticket
}

func (mt *MockTicketStore) Create(ticket *Ticket) error {
	m.tickets[ticket.ID] = ticket
	return nil
}

func (mt *MockTicketStore) GetByID(id string) (*Ticket, error) {
	if ticket, ok := mt.tickets[id]; ok {
		return ticket, nil
	}
	return nil, fmt.Errorf("ticket not found")
}

func (mt *MockTicketStore) Update(id string, updates map[string]interface{}) error {
	if ticket, ok := mt.tickets[id]; ok {
		ticket = *updateTicket(ticket, updates)
		m.tickets[id] = ticket
		return nil
	}
	return fmt.Errorf("ticket not found")
}

func (mt *MockTicketStore) Delete(id string) error {
	if _, ok := mt.tickets[id]; !ok {
		return fmt.Errorf("ticket not found")
	}
	delete(mt.tickets, id)
	return nil
}

func (mt *MockTicketStore) updateTicket(ticket *Ticket, updates map[string]interface{}) *Ticket {
	// Apply updates to the ticket
	if s, ok := updates["status"].(string); ok && s != "" {
		ticket.Status = s
	}
	if c, ok := updates["category"].(string); ok {
		ticket.Category.Name = c
	}
	return ticket
}

// generateID creates a simple unique ID
func generateID() string {
	return fmt.Sprintf("ticket_%s", time.Now().UnixNano())
}
