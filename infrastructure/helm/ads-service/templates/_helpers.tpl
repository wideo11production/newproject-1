{{-/*
Common labels
*/-}}
{{- define "ads-service.labels" -}}
helm.sh/chart: {{ include "ads-service.chart" . }}
app.kubernetes.io/name: {{ include "ads-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{-/*
Select all labels
*/-}}
{{- define "ads-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ads-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{-/*
Chart name
*/-}}
{{- define "ads-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{-*/
Chart version
*/-}}
{{- define "ads-service.chart" -}}
{{- .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{-/*
Fullname
*/-}}
{{- define "ads-service.fullname" -}}
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
{{- define "ads-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "ads-service.fullname" . }}
{{- end }}
{{- end -}}