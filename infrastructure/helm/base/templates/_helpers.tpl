{{-/*
Common labels
*/-}}
{{- define "base.labels" -}}
helm.sh/chart: {{ include "base.chart" . }}
app.kubernetes.io/name: {{ include "base.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{-/*
Select all labels
*/-}}
{{- define "base.selectorLabels" -}}
app.kubernetes.io/name: {{ include "base.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{-/*
Chart name
*/-}}
{{- define "base.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{-*/
Chart version
*/-}}
{{- define "base.chart" -}}
{{- .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{-*/
Common annotations
*/-}}
{{- define "base.annotations" -}}
{{- end -}}

{{-/*
Fullname
*/-}}
{{- define "base.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end }}
{{- end -}}