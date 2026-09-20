{{-/*
Common labels
*/-}}
{{- define "video-service.labels" -}}
helm.sh/chart: {{ include "video-service.chart" . }}
app.kubernetes.io/name: {{ include "video-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{-/*
Select all labels
*/-}}
{{- define "video-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "video-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{-/*
Chart name
*/-}}
{{- define "video-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{-*/
Chart version
*/-}}
{{- define "video-service.chart" -}}
{{- .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{-/*
Fullname
*/-}}
{{- define "video-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end }}
{{- end -}}

{{-/*
Service account name
*/-}}
{{- define "video-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "video-service.fullname" . }}
{{- end }}
{{- end -}}