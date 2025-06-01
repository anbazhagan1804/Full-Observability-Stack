'use strict';

const opentelemetry = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

// Configure the SDK to export telemetry data to the console
// Enable all auto-instrumentations from the meta package
const exporterOptions = {
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4317',
};

const traceExporter = new OTLPTraceExporter(exporterOptions);
const metricExporter = new OTLPMetricExporter(exporterOptions);
const serviceName = process.env.SERVICE_NAME || 'service-b';

const sdk = new opentelemetry.NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: 'production',
  }),
  traceExporter,
  metricExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

// Initialize the SDK and register with the OpenTelemetry API
// this enables the API to record telemetry
sdk.start()
  .then(() => console.log('Tracing initialized'))
  .catch((error) => console.log('Error initializing tracing', error));

// Gracefully shut down the SDK on process exit
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

module.exports = sdk;