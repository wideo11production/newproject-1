package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/smtp"
	"text/template"

	"github.com/newproject/services/email/src/config"
	"github.com/newproject/services/email/src/model"
	"github.com/newproject/services/email/src/repository"
)

// EmailService handles sending emails
type EmailService struct {
	cfg          *config.Config
	templateRepo repository.EmailTemplateRepository
}

// NewEmailService creates a new EmailService
func NewEmailService(cfg *config.Config, repo repository.EmailTemplateRepository) *EmailService {
	return &EmailService{
		cfg:          cfg,
		templateRepo: repo,
	}
}

// SendEmail sends an email directly
func (s *EmailService) SendEmail(
	ctx context.Context,
	to string,
	subject string,
	body string,
	isHTML bool,
) error {
	// Set up authentication information.
	auth := smtp.PlainAuth("", s.cfg.SMTP.Username, s.cfg.SMTP.Password, s.cfg.SMTP.Host)

	// Set up headers.
	var headers bytes.Buffer
	headers.WriteString("From: " + s.cfg.SMTP.From + "\r\n")
	headers.WriteString("To: " + to + "\r\n")
	headers.WriteString("Subject: " + subject + "\r\n")
	if isHTML {
		headers.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	} else {
		headers.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	}
	headers.WriteString("\r\n") // End of headers
	headers.WriteString(body)

	// Connect to the server, authenticate, set the sender and recipient,
	// and send the email all in one step.
	toList := []string{to}
	err := smtp.SendMail(
		s.cfg.SMTP.Addr(),
		auth,
		s.cfg.SMTP.From,
		toList,
		headers.Bytes(),
	)
	if err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}
	return nil
}

// SendTemplateEmail sends an email using a template
func (s *EmailService) SendTemplateEmail(
	ctx context.Context,
	to string,
	templateName string,
	data interface{},
) error {
	// Get the template from the repository
	template, err := s.templateRepo.GetByName(ctx, templateName)
	if err != nil {
		return err
	}

	// Parse the template
	tmpl, err := template.New("email").Parse(template.Body)
	if err != nil {
		return fmt.Errorf("failed to parse template: %w", err)
	}

	// Execute the template
	var body bytes.Buffer
	if err := tmpl.Execute(&body, data); err != nil {
		return fmt.Errorf("failed to execute template: %w", err)
	}

	// Send the email
	return s.SendEmail(ctx, to, template.Subject, body.String(), template.IsHTML)
}