require('dotenv').config();
const { EmberClient } = require('emberplus-connection');
const express = require('express');
const client = require('prom-client');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.METRICS_PORT || 9090;

class MultiServerMetricsConfig {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
    this.gauges = {};
    this.registry = new client.Registry();
    this.clients = {};
  }

  loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (error) {
      console.error('Error loading config:', error);
      return { 
        servers: {}
      };
    }
  }

  setupGauges() {
    // Single fan speed gauge for all servers
    this.fanSpeedGauge = new client.Gauge({
      name: 'fan_speed',
      help: 'Fan speed measurements across servers',
      labelNames: ['name', 'description', 'source', 'server', 'studio', 'path']
    });
    this.registry.registerMetric(this.fanSpeedGauge);
  }

  generateLocation(path) {
    // Extract the last part of the path as location
    const pathParts = path.split('.');
    return pathParts[pathParts.length - 1];
  }
}

async function connectToServer(config, serverName, serverConfig) {
  const client = new EmberClient(serverConfig.ip, serverConfig.port);
  
  client.on("error", e => {
    console.log(`Error on server ${serverName}:`, e);
  });

  await client.connect();
  const req = await client.getDirectory(client.tree);
  await req.response;

  // Connect to fans
  if (serverConfig.nodes.fans) {
    const fanPromises = serverConfig.nodes.fans.map(async (fan, index) => {
      try {
        const emberNode = await client.getElementByPath(fan.path);
        
        // Initial value
        const initialValue = parseInt(emberNode.contents.value.replace(' rpm', ''));
        config.fanSpeedGauge.set({ 
          name: fan.name, 
          description: fan.description, 
          source: 'emberplus',
          server: serverConfig.ip,
          studio: serverConfig.name,
          path: fan.path
        }, initialValue);

        // Subscribe to updates
        client.subscribe(emberNode, (updatedNode) => {
          const value = parseInt(updatedNode.contents?.value.replace(' rpm', ''));
          config.fanSpeedGauge.set({ 
            name: fan.name, 
            description: fan.description, 
            source: 'emberplus',
            server: serverConfig.ip,
            studio: serverConfig.name,
            path: fan.path
          }, value);
        });
      } catch (error) {
        console.error(`Error subscribing to fan on ${serverName} at path ${fan.path}:`, error);
      }
    });

    // Wait for all fans to be processed
    await Promise.all(fanPromises);
  }

  return client;
}

async function run(config) {
  config.setupGauges();

  // Connect to all servers
  for (const [serverName, serverConfig] of Object.entries(config.config.servers)) {
    await connectToServer(config, serverName, serverConfig);
  }
}

const configPath = path.join(__dirname, 'multi-server-metrics-config.json');
const nodeMetricsConfig = new MultiServerMetricsConfig(configPath);

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', nodeMetricsConfig.registry.contentType);
  res.end(await nodeMetricsConfig.registry.metrics());
});

app.listen(port, () => {
  console.log(`Metrics server listening at http://localhost:${port}/metrics`);
});

run(nodeMetricsConfig);