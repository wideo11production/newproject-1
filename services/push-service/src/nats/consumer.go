package nats

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
	"newproject/services/push-service/src/config"
	"newproject/services/push-service/src/service"
)

type Consumer struct {
	conn       *nats.Conn
	jetStream  nats.JetStreamContext
	sub        *nats.Subscription
	cfg        config.NATSConfig
	pushSvc    *service.PushService
	wg         sync.WaitGroup
}

type PushMessage struct {
	UserID  uint   `json:"user_id"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	Icon    string `json:"icon,omitempty"`
	URL     string `json:"url,omitempty"`
	Tag     string `json:"tag,omitempty"`
}

func NewConsumer(cfg config.NATSConfig, ps *service.PushService) (*Consumer, error) {
	nc, err := nats.Connect(cfg.URLs[0])
	if err != nil {
		return nil, err
	}

	js, err := nc.JetStream()
	if err != nil {
		return nil, err
	}

	return &Consumer{
		conn:    nc,
		jetStream: js,
		cfg:     cfg,
		pushSvc: ps,
	}, nil
}

func (c *Consumer) Start(ctx context.Context) error {
	sub, err := c.jetStream.QueueSubscribe(
		c.cfg.PushSubject,
		c.cfg.DurableConsumer,
		func(msg *nats.Msg) {
			c.handleMessage(ctx, msg)
		},
		nats.DeliverNew(),
		nats.AckExplicit(),
		nats.ManualAck(),
	)
	if err != nil {
		return err
	}
	c.sub = sub

	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		for {
			select {
			case <-ctx.Done():
				return
			}
		}
	}()

	log.Info().Str("subject", c.cfg.PushSubject).Str("consumer", c.cfg.DurableConsumer).Msg("NATS push consumer started")
	return nil
}

func (c *Consumer) handleMessage(ctx context.Context, msg *nats.Msg) {
	var pushMsg PushMessage
	if err := json.Unmarshal(msg.Data, &pushMsg); err != nil {
		log.Error().Err(err).Msg("failed to decode push message")
		_ = msg.Nak()
		return
	}

	result, err := c.pushSvc.SendMessage(ctx, pushMsg.UserID, pushMsg.Title, pushMsg.Body, pushMsg.Icon, pushMsg.URL, pushMsg.Tag)
	if err != nil {
		log.Error().Err(err).Msg("failed to send push message")
		_ = msg.Nak()
		return
	}

	log.Info().Str("message_id", result.MessageID.String()).Uint("user_id", pushMsg.UserID).Msg("push message queued")
	_ = msg.Ack()
}

func (c *Consumer) Close() {
	if c.sub != nil {
		_ = c.sub.Drain()
	}
	c.conn.Drain()
	c.conn.Close()
	c.wg.Wait()
	log.Info().Msg("NATS push consumer closed")
}
