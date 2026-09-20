{{-/*
Common labels
*/-}}
{{- define "monitoring.labels" -}}
helm.sh/chart: {{ include "monitoring.chart" . }}
app.kubernetes.io/name: {{ include "monitoring.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{-/*
Select all labels
*/-}}
{{- define "monitoring.selectorLabels" -}}
app.kubernetes.io/name: {{ include "monitoring.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{-/*
Chart name
*/-}}
{{- define "monitoring.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{-*/
Chart version
*/-}}
{{- define "monitoring.chart" -}}
{{- .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{-/*
Fullname
*/-}}
{{- define "monitoring.fullname" -}}
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
{{- define "monitoring.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "monitoring.fullname" . }}
{{- end }}
{{- end -}}