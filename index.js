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

    // Single network  gauge for all servers
    this.networkGauge = new client.Gauge({
      name: 'network',
      help: 'network details across servers',
      labelNames: ['path', 'name', 'hostName', 'macAdress', 'ipAdress', 'networkMask', 'gateway', 'linkSpeed', 'linkState', 'switchName', 'switchDescription', 'switchMacAdress', 'switchMgmtAddr', 'switchPortIntfName', 'switchPortDescription', 'vlan', 'source', 'server', 'studio']
    });
    this.registry.registerMetric(this.networkGauge);
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

  // Connect to networks
  if (serverConfig.nodes.networks) {
    const networkPromises = serverConfig.nodes.networks.map(async (network, index) => {
      try {
        const getSafeElement = async (path) => {
          try {
            return path ? await client.getElementByPath(path) : { contents: { value: null } };
          } catch (error) {
            console.error(`Error retrieving element at path ${path}:`, error);
            return { contents: { value: null } };
          }
        };

        const networkLinkState = await getSafeElement(network.linkState);
        const networkHostName = await getSafeElement(network.hostName);
        const networkMacAdress = await getSafeElement(network.macAdress);
        const networkIpAdress = await getSafeElement(network.ipAdress);
        const networkNetworkMask = await getSafeElement(network.networkMask);
        const networkGateway = await getSafeElement(network.gateway);
        const networkLinkSpeed = await getSafeElement(network.linkSpeed);
        const networkSwitchName = await getSafeElement(network.switchName);
        const networkSwitchDescription = await getSafeElement(network.switchDescription);
        const networkSwitchMacAdress = await getSafeElement(network.switchMacAdress);
        const networkSwitchMgmtAddr = await getSafeElement(network.switchMgmtAddr);
        const networkPortIntfName = await getSafeElement(network.portIntfName);
        const networkSwitchPortDescription = await getSafeElement(network.switchPortDescription);
        const networkVlan = await getSafeElement(network.vlan);

        // Extract values safely
        const extractValue = (node) => node?.contents?.value ?? null;

        const parseLinkState = (state) => (state === "up" ? 1 : state === "down" ? 0 : null);

        // Initial value
        config.networkGauge.set(
          {
            path: network.path,
            name: extractValue(network.name),
            hostName: extractValue(networkHostName),
            macAdress: extractValue(networkMacAdress),
            ipAdress: extractValue(networkIpAdress),
            networkMask: extractValue(networkNetworkMask),
            gateway: extractValue(networkGateway),
            linkSpeed: extractValue(networkLinkSpeed),
            switchName: extractValue(networkSwitchName),
            switchDescription: extractValue(networkSwitchDescription),
            switchMacAdress: extractValue(networkSwitchMacAdress),
            switchMgmtAddr: extractValue(networkSwitchMgmtAddr),
            switchPortIntfName: extractValue(networkPortIntfName),
            switchPortDescription: extractValue(networkSwitchPortDescription),
            vlan: extractValue(networkVlan),
            source: "emberplus",
            server: serverConfig.ip,
            studio: serverConfig.name,
          },
          parseLinkState(extractValue(networkLinkState))
        );

        // Subscribe to updates
        client.subscribe(networkLinkState, (updatedNode) => {
          const linkState = parseLinkState(extractValue(updatedNode));
          config.networkGauge.set(
            {
              path: network.path,
              name: extractValue(network.name),
              hostName: extractValue(networkHostName),
              macAdress: extractValue(networkMacAdress),
              ipAdress: extractValue(networkIpAdress),
              networkMask: extractValue(networkNetworkMask),
              gateway: extractValue(networkGateway),
              linkSpeed: extractValue(networkLinkSpeed),
              switchName: extractValue(networkSwitchName),
              switchDescription: extractValue(networkSwitchDescription),
              switchMacAdress: extractValue(networkSwitchMacAdress),
              switchMgmtAddr: extractValue(networkSwitchMgmtAddr),
              switchortIntfName: extractValue(networkPortIntfName),
              switchPortDescription: extractValue(networkSwitchPortDescription),
              vlan: extractValue(networkVlan),
              source: "emberplus",
              server: serverConfig.ip,
              studio: serverConfig.name,
            },
            linkState
          );
        });
      } catch (error) {
        console.error(`Error subscribing to network on ${serverName} at path ${network.path}:`, error);
      }
    });

    // Wait for all networks to be processed
    await Promise.all(networkPromises);
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