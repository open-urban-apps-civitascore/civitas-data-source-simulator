{{/* Release-scoped names, so two installs never collide. */}}
{{- define "simulator.fullname" -}}
{{- default .Release.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "simulator.generatorName" -}}{{ include "simulator.fullname" . }}-api{{- end -}}
{{- define "simulator.uiName" -}}{{ include "simulator.fullname" . }}-ui{{- end -}}
{{- define "simulator.brokerName" -}}{{ include "simulator.fullname" . }}-broker{{- end -}}
{{- define "simulator.databaseName" -}}{{ include "simulator.fullname" . }}-db{{- end -}}

{{- define "simulator.namespace" -}}
{{- default .Release.Namespace .Values.global.namespace -}}
{{- end -}}

{{/* In-cluster addresses. Built once here so no template guesses them. */}}
{{- define "simulator.apiAddress" -}}
http://{{ include "simulator.generatorName" . }}.{{ include "simulator.namespace" . }}.svc.cluster.local:{{ .Values.generator.service.port }}
{{- end -}}

{{- define "simulator.brokerAddress" -}}
mqtt://{{ include "simulator.brokerName" . }}.{{ include "simulator.namespace" . }}.svc.cluster.local:{{ .Values.broker.service.port }}
{{- end -}}

{{- define "simulator.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
