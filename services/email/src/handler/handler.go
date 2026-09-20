package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"newproject/services/email/src/model"
	"newproject/services/email/src/repository"
	"newproject/services/email/src/service"
)

// Handler holds the service dependencies for HTTP handlers
type Handler struct {
	emailService *service.EmailService
}

// NewHandler creates a new Handler with the given email service
func NewHandler(es *service.EmailService) *Handler {
	return &Handler{
		emailService: es,
	}
}

// RegisterRoutes registers the email-related routes on the given Gin engine
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	emailGroup := r.Group("/email")
	{
		emailGroup.POST("/send", h.SendEmail)
		emailGroup.POST("/template/send", h.SendTemplateEmail)
		templateGroup := emailGroup.Group("/templates")
		{
			templateGroup.POST("", h.CreateTemplate)
			templateGroup.GET("/:name", h.GetTemplateByName)
			templateGroup.PUT("/:name", h.UpdateTemplate)
			templateGroup.DELETE("/:name", h.DeleteTemplateByName)
			templateGroup.GET("", h.ListTemplates)
		}
	}
}

// SendEmail handles POST /email/send
// Expects JSON: { "to": "<email>", "subject": "<subject>", "body": "<body>", "is_html": <bool> }
// Returns HTTP 200 OK on success
func (h *Handler) SendEmail(c *gin.Context) {
	var req struct {
		To     string `json:"to" binding:"required,email"`
		Subject string `json:"subject" binding:"required"`
		Body   string `json:"body" binding:"required"`
		IsHTML bool   `json:"is_html"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.emailService.SendEmail(c.Request.Context(), req.To, req.Subject, req.Body, req.IsHTML); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

// SendTemplateEmail handles POST /email/template/send
// Expects JSON: { "to": "<email>", "template_name": "<name>", "data": <object> }
// Returns HTTP 200 OK on success
func (h *Handler) SendTemplateEmail(c *gin.Context) {
	var req struct {
		To          string      `json:"to" binding:"required,email"`
		TemplateName string      `json:"template_name" binding:"required"`
		Data        interface{} `json:"data" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.emailService.SendTemplateEmail(c.Request.Context(), req.To, req.TemplateName, req.Data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

// CreateTemplate handles POST /email/templates
// Expects JSON: { "name": "<name>", "subject": "<subject>", "body": "<body>", "is_html": <bool> }
// Returns JSON: { "template": <template object> }
func (h *Handler) CreateTemplate(c *gin.Context) {
	var req struct {
		Name    string `json:"name" binding:"required"`
		Subject string `json:"subject" binding:"required"`
		Body    string `json:"body" binding:"required"`
		IsHTML  bool   `json:"is_html"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	template := &model.EmailTemplate{
		Name:    req.Name,
		Subject: req.Subject,
		Body:    req.Body,
		IsHTML:  req.IsHTML,
	}
	if err := h.emailService.CreateTemplate(c.Request.Context(), template); err != nil {
		switch err {
		case repository.ErrEmailTemplateNotFound:
			c.JSON(http.StatusConflict, gin.H{"error": "template with this name already exists"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusCreated, gin.H{"template": template})
}

// GetTemplateByName handles GET /email/templates/:name
// Returns JSON: { "template": <template object> }
func (h *Handler) GetTemplateByName(c *gin.Context) {
	name := c.Param("name")
	template, err := h.emailService.GetTemplateByName(c.Request.Context(), name)
	if err != nil {
		switch err {
		case repository.ErrEmailTemplateNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"template": template})
}

// UpdateTemplate handles PUT /email/templates/:name
// Expects JSON: { "subject": "<subject>", "body": "<body>", "is_html": <bool> }
// Returns JSON: { "template": <template object> }
func (h *Handler) UpdateTemplate(c *gin.Context) {
	name := c.Param("name")
	var req struct {
		Subject string `json:"subject" binding:"omitempty"`
		Body    string `json:"body" binding:"omitempty"`
		IsHTML  bool   `json:"is_html"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get the existing template
	existing, err := h.emailService.GetTemplateByName(c.Request.Context(), name)
	if err != nil {
		switch err {
		case repository.ErrEmailTemplateNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// Update fields if provided
	if req.Subject != "" {
		existing.Subject = req.Subject
	}
	if req.Body != "" {
		existing.Body = req.Body
	}
	if req.IsHTML {
		existing.IsHTML = req.IsHTML
	}

	if err := h.emailService.UpdateTemplate(c.Request.Context(), existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"template": existing})
}

// DeleteTemplateByName handles DELETE /email/templates/:name
// Returns HTTP 204 No Content on success
func (h *Handler) DeleteTemplateByName(c *gin.Context) {
	name := c.Param("name")
	template, err := h.emailService.GetTemplateByName(c.Request.Context(), name)
	if err != nil {
		switch err {
		case repository.ErrEmailTemplateNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if err := h.emailService.DeleteTemplateByID(c.Request.Context(), template.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// ListTemplates handles GET /email/templates
// Returns JSON: { "templates": [<template object>] }
func (h *Handler) ListTemplates(c *gin.Context) {
	templates, err := h.emailService.ListTemplates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"templates": templates})
}