require('dotenv').config();
const { EmberClient } = require('emberplus-connection');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const token = process.env.INFLUXDB_TOKEN;
const url = process.env.INFLUXDB_URL;
const org = process.env.INFLUXDB_ORG;
const bucket = process.env.INFLUXDB_BUCKET;
const client = new InfluxDB({ url, token });
const writeClient = client.getWriteApi(org, bucket, 'ns');

const app = express();
const port = process.env.METRICS_PORT || 9090;

class MultiProviderMetricsConfig {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = this.loadConfig();
        this.clients = {};
    }

    loadConfig() {
        try {
            return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        } catch (error) {
            console.error('Error loading config:', error);
            return { providers: {} };
        }
    }

    sanitizeValue(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') {
            return value;
        }
        let numericValue = parseFloat(String(value).replace(/[^\d.-]/g, ''));
        return isNaN(numericValue)? null: numericValue;
    }
}

async function testInfluxDBWrite() {
    try {
        const testPoint = new Point('test_write')
          .tag('test', 'true')
          .floatField('value', 123);

        await writeClient.writePoint(testPoint);
        await writeClient.flush(); // Force the buffer to flush
        console.log('Test point written to InfluxDB successfully!');
    } catch (error) {
        console.error('Error writing test point to InfluxDB:', error);
    }
}

// Call the test function when the script starts
testInfluxDBWrite();

async function connectToProvider(config, providerName, providerConfig) {
  const client = new EmberClient(providerConfig.ip, providerConfig.port);

  client.on("error", e => {
      console.error(`Error on provider ${providerName}:`, e);
  });

  try {
      await client.connect();
      const req = await client.getDirectory(client.tree);
      await req.response;

      if (providerConfig.nodes.fans) {
          const fanPromises = providerConfig.nodes.fans.map(async (fan) => {
              try {
                  const emberNode = await client.getElementByPath(fan.path);
                  const value = emberNode.contents.value;
                  console.log(`Initial fan speed for ${fan.name} at ${fan.path}: ${value}`);

                  let point = new Point('fan_speed')
                    .tag('provider', providerName)
                    .tag('studio', providerConfig.name)
                    .tag('fan_name', fan.name)
                    .tag('path', fan.path);

                  if (typeof value === 'string') {
                      point.stringField('speed_raw', value);
                      const numericValue = config.sanitizeValue(value);
                      if (numericValue!== null) {
                          point.floatField('speed_numeric', numericValue);
                      }
                  } else if (typeof value === 'number') {
                      point.floatField('speed', value);
                  }

                  await writeClient.writePoint(point);
                  console.log('Written point:', point);

                  client.subscribe(emberNode, (updatedNode) => {
                      const newValue = updatedNode.contents?.value;
                      console.log(`Updated fan speed for ${fan.name} at ${fan.path}: ${newValue}`);

                      let point = new Point('fan_speed')
                        .tag('provider', providerName)
                        .tag('studio', providerConfig.name)
                        .tag('fan_name', fan.name)
                        .tag('path', fan.path);

                      if (typeof newValue === 'string') {
                          point.stringField('speed_raw', newValue);
                          const numericValue = config.sanitizeValue(newValue);
                          if (numericValue!== null) {
                              point.floatField('speed_numeric', numericValue);
                          }
                      } else if (typeof newValue === 'number') {
                          point.floatField('speed', newValue);
                      }

                      writeClient.writePoint(point);
                      console.log('Written updated point:', point);
                  });
              } catch (error) {
                  console.error(`Error subscribing to fan on ${providerName} at path ${fan.path}:`, error);
              }
          });

          await Promise.all(fanPromises);
      }

      if (providerConfig.nodes.Temperatures) {
          const tempPromises = providerConfig.nodes.Temperatures.map(async (temp) => {
              try {
                  const actualTempNode = await client.getElementByPath(temp.actualTemperature);
                  const highLimitNode = await client.getElementByPath(temp.highLimit);

                  const actualTemp = actualTempNode.contents.value;
                  const highLimit = highLimitNode.contents.value;

                  console.log(`Initial temperature for ${temp.name} at ${temp.actualTemperature}: ${actualTemp}, high limit: ${highLimit}`);

                  let point = new Point('temperature')
                    .tag('provider', providerName)
                    .tag('studio', providerConfig.name)
                    .tag('temperature_name', temp.name)
                    .tag('path', temp.path)
                    .floatField('actual_temp', config.sanitizeValue(actualTemp))
                    .floatField('high_limit', config.sanitizeValue(highLimit));

                  await writeClient.writePoint(point);
                  console.log('Written temperature point:', point);

                  client.subscribe(actualTempNode, (updatedNode) => {
                      const newActualTemp = updatedNode.contents?.value;
                      console.log(`Updated actual temp for ${temp.name}: ${newActualTemp}`);

                      let point = new Point('temperature')
                        .tag('provider', providerName)
                        .tag('studio', providerConfig.name)
                        .tag('temperature_name', temp.name)
                        .tag('path', temp.path)
                        .floatField('actual_temp', config.sanitizeValue(newActualTemp));

                      writeClient.writePoint(point);
                      console.log('Written updated actual temperature point:', point);
                  });

                  client.subscribe(highLimitNode, (updatedNode) => {
                      const newHighLimit = updatedNode.contents?.value;
                      console.log(`Updated high limit for ${temp.name}: ${newHighLimit}`);

                      let point = new Point('temperature')
                        .tag('provider', providerName)
                        .tag('studio', providerConfig.name)
                        .tag('temperature_name', temp.name)
                        .tag('path', temp.path)
                        .floatField('high_limit', config.sanitizeValue(newHighLimit));

                      writeClient.writePoint(point);
                      console.log('Written updated high limit temperature point:', point);
                  });
              } catch (error) {
                  console.error(`Error subscribing to temperature on ${providerName} at path ${temp.path}:`, error);
              }
          });

          await Promise.all(tempPromises);
      }

      if (providerConfig.nodes.ptp) {
          const ptpConfig = providerConfig.nodes.ptp;

          try {
              // Iterate through PTP metrics with a delay
              for (const [metricName, path] of Object.entries(ptpConfig)) {
                  try {
                      const emberNode = await client.getElementByPath(path);
                      const initialValue = emberNode.contents.value;

                      console.log(`Initial PTP value for ${metricName} at ${path}: ${initialValue}`);

                      let point = new Point('ptp')
                        .tag('provider', providerName)
                        .tag('studio', providerConfig.name); // Removed metric tag

                      // Directly store the sanitized value under the metric name as field
                      const sanitizedVal = config.sanitizeValue(initialValue);
                      if (sanitizedVal!== null) {
                          point.floatField(metricName, sanitizedVal);
                      } else {
                          // Handle non-numeric values if necessary
                          point.stringField(metricName, initialValue? initialValue.toString(): 'null');
                      }

                      await writeClient.writePoint(point);
                      console.log('Written PTP point:', point);

                      client.subscribe(emberNode, async (updatedNode) => {
                          try {
                              const newValue = updatedNode.contents?.value;
                              console.log(`Updated PTP value for ${metricName} at ${path}: ${newValue}`);

                              let updatePoint = new Point('ptp')
                                .tag('provider', providerName)
                                .tag('studio', providerConfig.name);

                              const newSanitizedVal = config.sanitizeValue(newValue);
                              if (newSanitizedVal!== null) {
                                  updatePoint.floatField(metricName, newSanitizedVal);
                              } else {
                                  updatePoint.stringField(metricName, newValue? newValue.toString(): 'null');
                              }


                              writeClient.writePoint(updatePoint);
                              console.log('Written updated PTP point:', updatePoint);
                          } catch (error) {
                              console.error(`Error handling PTP update for ${metricName} at ${path}:`, error);
                          }
                      });

                  } catch (error) {
                      console.error(`Error getting PTP metric ${metricName} at ${path}:`, error);
                  }

                  await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between metrics
              }
          } catch (error) {
              console.error(`Error processing PTP metrics for ${providerName}:`, error);
          }
      }

      if (providerConfig.nodes.Currents) {
        const currentPromises = providerConfig.nodes.Currents.map(async (current) => {
            try {
                const valueNode = await client.getElementByPath(current.value);
                const value = valueNode.contents.value;
                console.log(`Initial current value for ${current.name} at ${current.value}: ${value}`);
                let point = new Point('current')
                  .tag('provider', providerName)
                  .tag('studio', providerConfig.name)
                  .tag('current_name', current.name)
                  .tag('path', current.path)
                  .tag('type', current.type);

                if (typeof value === 'string') {
                    point.stringField('current_raw', value);
                    const numericValue = config.sanitizeValue(value);
                    if (numericValue!== null) {
                        point.floatField('current_numeric', numericValue);
                    }
                } else if (typeof value === 'number') {
                    point.floatField('current', value);
                }

                await writeClient.writePoint(point);
                console.log('Written current point:', point);

                client.subscribe(valueNode, (updatedNode) => {
                    const newValue = updatedNode.contents?.value;
                    console.log(`Updated current value for ${current.name} at ${current.value}: ${newValue}`);
                    let point = new Point('current')
                      .tag('provider', providerName)
                      .tag('studio', providerConfig.name)
                      .tag('current_name', current.name)
                      .tag('path', current.path)
                      .tag('type', current.type);

                    if (typeof newValue === 'string') {
                        point.stringField('current_raw', newValue);
                        const numericValue = config.sanitizeValue(newValue);
                        if (numericValue!== null) {
                            point.floatField('current_numeric', numericValue);
                        }
                    } else if (typeof value === 'number') {
                        point.floatField('current', newValue);
                    }

                    writeClient.writePoint(point);
                    console.log('Written updated current point:', point);
                });
            } catch (error) {
                console.error(`Error subscribing to current on ${providerName} at path ${current.value}:`, error);
            }
        });
        await Promise.all(currentPromises);
    }
    
    //----------------------------Offending Code Potentially--------------------------------------------------//

    if (providerConfig.nodes.systemStates) {
        const systemStateConfig = providerConfig.nodes.systemStates;
        try {
            for (const [metricName, path] of Object.entries(systemStateConfig)) {
                try {
                    const emberNode = await client.getElementByPath(path);
                    const initialValue = emberNode.contents.value;

                    console.log(`Initial System State value for ${metricName} at ${path}: ${initialValue}`);

                    let point = new Point('system_state')
                        .tag('provider', providerName)
                        .tag('studio', providerConfig.name);

                    const sanitizedVal = config.sanitizeValue(initialValue);
                    if (sanitizedVal !== null) {
                        point.floatField(metricName, sanitizedVal);
                    } else {
                        point.stringField(metricName, initialValue ? initialValue.toString() : 'null');
                    }

                    await writeClient.writePoint(point);
                    console.log('Written System State point:', point);

                    client.subscribe(emberNode, async (updatedNode) => {
                        try {
                            const newValue = updatedNode.contents?.value;
                            console.log(`Updated System State value for ${metricName} at ${path}: ${newValue}`);

                            let updatePoint = new Point('system_state')
                                .tag('provider', providerName)
                                .tag('studio', providerConfig.name);

                            const newSanitizedVal = config.sanitizeValue(newValue);
                            if (newSanitizedVal !== null) {
                                updatePoint.floatField(metricName, newSanitizedVal);
                            } else {
                                updatePoint.stringField(metricName, newValue ? newValue.toString() : 'null');
                            }

                            writeClient.writePoint(updatePoint);
                            console.log('Written updated System State point:', updatePoint);
                        } catch (error) {
                            console.error(`Error handling System State update for ${metricName} at ${path}:`, error);
                        }
                    });

                } catch (error) {
                    console.error(`Error getting System State metric ${metricName} at ${path}:`, error);
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            console.error(`Error processing System State metrics for ${providerName}:`, error);
        }
    }

    //------------------------------------------------------------------------------------------------------//

  } catch (error) {
      console.error(`Error connecting to provider ${providerName}:`, error);
  }
}

async function run(config) {
    for (const [providerName, providerConfig] of Object.entries(config.config.providers)) {
        await connectToProvider(config, providerName, providerConfig);
    }
}

const configPath = path.join(__dirname, 'multi-provider-metrics-config.json');
const nodeMetricsConfig = new MultiProviderMetricsConfig(configPath);

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.end('Metrics are disabled in this version, only console logs are displayed.');
});

app.listen(port, () => {
    console.log(`Metrics server listening at http://localhost:${port}/metrics`);
});

run(nodeMetricsConfig).catch(error => {
    console.error('Error running metrics collection:', error);
});