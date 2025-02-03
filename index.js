require('dotenv').config();
const { EmberClient } = require('emberplus-connection');
const express = require('express');
const client = require('prom-client');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.METRICS_PORT || 9090;

class NodeMetricsConfig {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
    this.gauges = {};
    this.registry = new client.Registry();
  }

  loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (error) {
      console.error('Error loading config:', error);
      return { nodes: [] };
    }
  }

  saveConfig() {
    fs.writeFileSync(
      this.configPath, 
      JSON.stringify(this.config, null, 2), 
      'utf8'
    );
  }

  addNode(path, name, type = 'generic') {
    const newNode = { path, name, type };
    this.config.nodes.push(newNode);
    this.saveConfig();
    return newNode;
  }

  createGauge(node) {
    const gaugeName = `node_${node.name}_${node.type}_value`;
    const gauge = new client.Gauge({
      name: gaugeName,
      help: `Metric value for ${node.name}`,
      labelNames: ['node', 'type', 'source']
    });
    this.gauges[node.path] = gauge;
    this.registry.registerMetric(gauge);
    return gauge;
  }

  setupGauges() {
    this.config.nodes.forEach(node => this.createGauge(node));
  }
}

async function run(config) {
  const client = new EmberClient(process.env.SERVER_IP, process.env.STUDIO_PORT);
  
  client.on("error", e => {
    console.log(e);
  });

  await client.connect();
  const req = await client.getDirectory(client.tree);
  await req.response;

  config.setupGauges();

  config.config.nodes.forEach(node => {
    const subscribeToNode = async () => {
      try {
        const emberNode = await client.getElementByPath(node.path);
        
        // Initial value
        const initialValue = parseInt(emberNode.contents.value.replace(' rpm', ''));
        config.gauges[node.path].set({ 
          node: node.path, 
          type: node.type, 
          source: 'emberplus' 
        }, initialValue);

        // Subscribe to updates
        client.subscribe(emberNode, (updatedNode) => {
          const value = parseInt(updatedNode.contents?.value.replace(' rpm', ''));
          config.gauges[node.path].set({ 
            node: node.path, 
            type: node.type, 
            source: 'emberplus' 
          }, value);
        });
      } catch (error) {
        console.error(`Error subscribing to node at path ${node.path}:`, error);
      }
    };
    
    subscribeToNode();
  });
}

const configPath = path.join(__dirname, 'node-metrics-config.json');
const nodeMetricsConfig = new NodeMetricsConfig(configPath);

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', nodeMetricsConfig.registry.contentType);
  res.end(await nodeMetricsConfig.registry.metrics());
});

app.post('/add-node', express.json(), (req, res) => {
  const { path, name, type } = req.body;
  const newNode = nodeMetricsConfig.addNode(path, name, type);
  nodeMetricsConfig.createGauge(newNode);
  res.json(newNode);
});

app.listen(port, () => {
  console.log(`Metrics server listening at http://localhost:${port}/metrics`);
});

run(nodeMetricsConfig);