# (emberplus) Orchestrator

**Orchestrator** is a Node.js-based client for managing and monitoring Ember+ servers.

## Features & Endpoints

### Prometheus Metrics

- Each metric is labeled as an individual node in a tree structure, defined in `node-metrics-config.json`.
- Nodes retrieve an initial gauge value, then subscribe to changes, tracking their last known value for queries.

#### Example `node-metrics-config.json`:

```json
{
  "nodes": [
    {
      "path": "1.29.7.1.1",
      "name": "fan1",
      "type": "fan_speed"
    },
    {
      "path": "1.29.7.2.1",
      "name": "fan2",
      "type": "fan_speed"
    },
    {
      "path": "1.29.7.3.1",
      "name": "fan3",
      "type": "fan_speed"
    }
  ]
}
```

### Adding Nodes

Add nodes dynamically by sending a `POST` request to `/add-node` with a JSON body:

```json
{
  "path": "1.29.7.1.1",
  "name": "fan1",
  "type": "fan_speed"
}
```

### Reading Metrics

Access collected metrics at:

```
http://localhost:<METRICS_PORT>/metrics
```

Example output:

```
# HELP node_fan1_fan_speed_value Metric value for fan1
# TYPE node_fan1_fan_speed_value gauge
node_fan1_fan_speed_value{node="1.29.7.1.1",type="fan_speed",source="emberplus"} 2206

# HELP node_fan2_fan_speed_value Metric value for fan2
# TYPE node_fan2_fan_speed_value gauge
node_fan2_fan_speed_value{node="1.29.7.2.1",type="fan_speed",source="emberplus"} 2221

# HELP node_fan3_fan_speed_value Metric value for fan3
# TYPE node_fan3_fan_speed_value gauge
node_fan3_fan_speed_value{node="1.29.7.3.1",type="fan_speed",source="emberplus"} 2382
```

---

## Environment Variables

When setting up a new Docker container or environment, define the following variables:

| Variable       | Description                                   | Default |
|---------------|-----------------------------------------------|---------|
| `SERVER_IP`   | IP of the Ember+ server to be managed        | _None_  |
| `STUDIO_PORT` | Port of the Ember+ studio server             | _None_  |
| `METRICS_PORT`| Port for Prometheus metrics                  | `9090`  |

---

## Future Features (Planned)

- Support for adding nodes using descriptions or identifiers, not just path values.
- Multi-server support.

---
