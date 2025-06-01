'use strict';

// Load OpenTelemetry instrumentation before anything else
require('./instrumentation');

const express = require('express');
const mongoose = require('mongoose');
const pino = require('pino');
const { trace, metrics, context } = require('@opentelemetry/api');

// Create a logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: { service: process.env.SERVICE_NAME || 'service-b' },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

// Create custom metrics
const meter = metrics.getMeter('service-b-meter');
const requestCounter = meter.createCounter('service_b_requests_total', {
  description: 'Total number of requests to Service B',
});

const responseTimeHistogram = meter.createHistogram('service_b_response_time', {
  description: 'Response time of Service B',
  unit: 'ms',
});

const dbOperationHistogram = meter.createHistogram('service_b_db_operation_time', {
  description: 'Database operation time in Service B',
  unit: 'ms',
});

// Create Express app
const app = express();
const port = process.env.PORT || 8082;
const dbUrl = process.env.DATABASE_URL || 'mongodb://mongodb:27017/microservices';

app.use(express.json());

// Connect to MongoDB
mongoose.connect(dbUrl, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  logger.info('Connected to MongoDB');
})
.catch((error) => {
  logger.error({ msg: 'Error connecting to MongoDB', error: error.message });
});

// Define a schema and model for data
const DataSchema = new mongoose.Schema({
  message: String,
  timestamp: { type: Date, default: Date.now },
  service: String,
});

const Data = mongoose.model('Data', DataSchema);

// Middleware to add trace context to logs
app.use((req, res, next) => {
  const currentSpan = trace.getSpan(context.active());
  if (currentSpan) {
    const traceId = currentSpan.spanContext().traceId;
    const spanId = currentSpan.spanContext().spanId;
    res.locals.traceId = traceId;
    res.locals.spanId = spanId;
    
    // Add trace context to logger
    req.log = logger.child({ trace_id: traceId, span_id: spanId });
  } else {
    req.log = logger;
  }
  next();
});

// Log all requests
app.use((req, res, next) => {
  const startTime = Date.now();
  req.log.info({ 
    msg: `Request received: ${req.method} ${req.url}`,
    method: req.method,
    url: req.url,
    service: 'service-b'
  });

  // Count the request
  requestCounter.add(1, { method: req.method, path: req.path });

  // Record response time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    responseTimeHistogram.record(duration, { method: req.method, path: req.path, status_code: res.statusCode.toString() });
    
    req.log.info({
      msg: `Request completed: ${req.method} ${req.url}`,
      method: req.method,
      url: req.url,
      status_code: res.statusCode,
      duration_ms: duration,
      service: 'service-b'
    });
  });

  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

// API endpoint to get data
app.get('/api/data', async (req, res) => {
  const tracer = trace.getTracer('service-b-tracer');
  
  // Create a span for the database operation
  const span = tracer.startSpan('get_data_from_db');
  
  try {
    await context.with(trace.setSpan(context.active(), span), async () => {
      req.log.info({ msg: 'Fetching data from database', service: 'service-b' });
      
      const startTime = Date.now();
      
      // Simulate some processing
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      
      // Get data from database or create if none exists
      let data = await Data.findOne({ service: 'service-b' }).exec();
      
      if (!data) {
        data = new Data({
          message: 'Hello from Service B!',
          service: 'service-b',
        });
        await data.save();
      }
      
      const duration = Date.now() - startTime;
      dbOperationHistogram.record(duration, { operation: 'find_or_create' });
      
      const responseData = {
        service: 'service-b',
        timestamp: new Date().toISOString(),
        message: data.message,
        database_id: data._id.toString()
      };
      
      res.json(responseData);
      span.end();
    });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message }); // Error status
    span.end();
    
    req.log.error({
      msg: 'Error fetching data from database',
      error: error.message,
      service: 'service-b'
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API endpoint to create data
app.post('/api/data', async (req, res) => {
  const tracer = trace.getTracer('service-b-tracer');
  
  // Create a span for the database operation
  const span = tracer.startSpan('create_data_in_db');
  
  try {
    await context.with(trace.setSpan(context.active(), span), async () => {
      const { message } = req.body;
      
      if (!message) {
        throw new Error('Message is required');
      }
      
      req.log.info({ msg: 'Creating new data in database', service: 'service-b' });
      
      const startTime = Date.now();
      
      // Create new data
      const data = new Data({
        message,
        service: 'service-b',
      });
      
      await data.save();
      
      const duration = Date.now() - startTime;
      dbOperationHistogram.record(duration, { operation: 'create' });
      
      const responseData = {
        service: 'service-b',
        timestamp: new Date().toISOString(),
        message: data.message,
        database_id: data._id.toString()
      };
      
      res.status(201).json(responseData);
      span.end();
    });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message }); // Error status
    span.end();
    
    req.log.error({
      msg: 'Error creating data in database',
      error: error.message,
      service: 'service-b'
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start the server
app.listen(port, () => {
  logger.info(`Service B listening on port ${port}`);
});