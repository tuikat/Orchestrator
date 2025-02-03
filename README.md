# (emberplus) Orchestrator

**Orchestrator** is a Node.js-based client for monitoring Ember+ servers.

## Features & Endpoints

### Prometheus Metrics

- Each metric is labeled as an individual node in a tree structure, defined in `multi-server-metrics-config.json`.
- Nodes retrieve an initial gauge value, then subscribe to changes, tracking their last known value for queries.

#### Example `node-metrics-config.json`:

```json
{
  "servers": {
    "server1": {
      "ip": "serverIp",
      "name": "6A",
      "port": 9001,
      "nodes": {
        "fans": [
          {
            "path": "1.29.7.1.1",
            "name": "fan1",
            "description": "fan1"
          },
          {
            "path": "1.29.7.1.1",
            "name": "fan2", 
            "description": "fan2"
          },
          {
            "path": "1.29.7.3.1",
            "name": "fan3", 
            "description": "fan3"
          },
          {
            "path": "1.29.7.4.1",
            "name": "fan4", 
            "description": "fan4"
          }
        ]
      }
    }
  }
}
```

### Reading Metrics

Access collected metrics at:

```
http://localhost:<METRICS_PORT>/metrics
```

Example output:

```
# HELP fan_speed Fan speed measurements across servers
# TYPE fan_speed gauge
fan_speed{name="fan1",description="fan1",source="emberplus",server="serverIp",studio="6A",path="1.29.7.1.1"} 2296
fan_speed{name="fan2",description="fan2",source="emberplus",server="serverIp",studio="6A",path="1.29.7.1.1"} 2296
fan_speed{name="fan3",description="fan3",source="emberplus",server="serverIp",studio="6A",path="1.29.7.3.1"} 2464
fan_speed{name="fan4",description="fan4",source="emberplus",server="serverIp",studio="6A",path="1.29.7.4.1"} 2446
```

---

## Environment Variables

When setting up a new Docker container or environment, define the following variables:

| Variable       | Description                                   | Default |
|---------------|-----------------------------------------------|---------|
| `METRICS_PORT`| Port for Prometheus metrics                  | `9090`  |

---

---
