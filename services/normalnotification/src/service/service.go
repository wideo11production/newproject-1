package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/smtp"
	"time"

	"github.com/google/uuid"
	"github.com/newproject/services/normalnotification/src/config"
	"github.com/newproject/services/normalnotification/src/model"
	"github.com/newproject/services/normalnotification/src/repository"
)

// NotificationService handles sending notifications
type NotificationService struct {
	cfg          *config.Config
	repo         repository.NotificationRepository
}

// NewNotificationService creates a new NotificationService
func NewNotificationService(cfg *config.Config, repo repository.NotificationRepository) *NotificationService {
	return &NotificationService{
		cfg:          cfg,
		repo:         repo,
	}
}

// CreateNotification creates a new notification record
func (s *NotificationService) CreateNotification(
	ctx context.Context,
	recipient string,
	subject string,
	body string,
	channel string,
) (*model.Notification, error) {
	notification := &model.Notification{
		UUID:      uuid.New(),
		Recipient: recipient,
		Subject:   subject,
		Body:      body,
		Channel:   channel,
		Status:    model.StatusPending,
	}
	if err := s.repo.Create(ctx, notification); err != nil {
		return nil, err
	}
	return notification, nil
}

// SendNotification sends a notification via the specified channel
func (s *NotificationService) SendNotification(
	ctx context.Context,
	notification *model.Notification,
) error {
	// Update status to sending
	notification.Status = model.StatusSending
	if err := s.repo.Update(ctx, notification); err != nil {
		return err
	}

	// Send via the appropriate channel
	var err error
	switch notification.Channel {
	case model.ChannelEmail:
		err = s.sendEmail(ctx, notification)
	case model.ChannelSMS:
		// TODO: Implement SMS sending
		err = errors.New("sms channel not implemented")
	case model.ChannelPush:
		// TODO: Implement push notification
		err = errors.New("push channel not implemented")
	default:
		err = errors.New("unsupported notification channel")
	}

	if err != nil {
		notification.Status = model.StatusFailed
		notification.SentAt = nil
		// Update with failure status
		_ = s.repo.Update(ctx, notification) // Ignore error on best effort
		return fmt.Errorf("failed to send notification: %w", err)
	}

	// Mark as sent
	now := time.Now()
	notification.Status = model.StatusSent
	notification.SentAt = &now
	if err := s.repo.Update(ctx, notification); err != nil {
		return err
	}

	return nil
}

// sendEmail sends an email notification
func (s *NotificationService) sendEmail(
	ctx context.Context,
	notification *model.Notification,
) error {
	// Set up authentication information.
	auth := smtp.PlainAuth("", s.cfg.SMTP.Username, s.cfg.SMTP.Password, s.cfg.SMTP.Host)

	// Set up headers.
	var headers bytes.Buffer
	headers.WriteString("From: " + s.cfg.SMTP.From + "\r\n")
	headers.WriteString("To: " + notification.Recipient + "\r\n")
	headers.WriteString("Subject: " + notification.Subject + "\r\n")
	headers.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	headers.WriteString("\r\n") // End of headers
	headers.WriteString(notification.Body)

	// Connect to the server, authenticate, set the sender and recipient,
	// and send the email all in one step.
	toList := []string{notification.Recipient}
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

// GetPendingNotifications returns notifications that are pending to be sent
func (s *NotificationService) GetPendingNotifications(
	ctx context.Context,
) ([]*model.Notification, error) {
	return s.repo.ListByStatus(ctx, model.StatusPending)
}

// RetryFailedNotifications retries notifications that failed to send
func (s *NotificationService) RetryFailedNotifications(
	ctx context.Context,
) error {
	failed, err := s.repo.ListByStatus(ctx, model.StatusFailed)
	if err != nil {
		return err
	}
	for _, notification := range failed {
		// Reset status to pending and try sending again
		notification.Status = model.StatusPending
		notification.SentAt = nil
		if err := s.repo.Update(ctx, notification); err != nil {
			// Log error but continue with others
			continue
		}
		// Attempt to send
		go func(n *model.Notification) {
			if err := s.SendNotification(ctx, n); err != nil {
				// Log error
			}
		}(notification)
	}
	return nil
}