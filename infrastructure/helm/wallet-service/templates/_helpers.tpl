{{-/*
Common labels
*/-}}
{{- define "wallet-service.labels" -}}
helm.sh/chart: {{ include "wallet-service.chart" . }}
app.kubernetes.io/name: {{ include "wallet-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{-/*
Select all labels
*/-}}
{{- define "wallet-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "wallet-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{-/*
Chart name
*/-}}
{{- define "wallet-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{-*/
Chart version
*/-}}
{{- define "wallet-service.chart" -}}
{{- .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{-/*
Fullname
*/-}}
{{- define "wallet-service.fullname" -}}
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
{{- define "wallet-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "wallet-service.fullname" . }}
{{- end }}
{{- end -}}