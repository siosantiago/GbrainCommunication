# GBrain Communication

A way to be able to talk to everyone else in this room about things you care about as fast as possible, start even working together before even meeting.

## How it works

GBrain connects to your Google services (Gmail, Calendar, Contacts) through [Clawvisor](https://app.clawvisor.com) — an API gateway where you approve what agents can access. It discovers people from your network, lets you tag interests, and matches people who should meet.

## Setup

### 1. Set environment variables

```bash
export CLAWVISOR_URL='https://app.clawvisor.com'
export CLAWVISOR_AGENT_TOKEN='cvis_...'  # from Clawvisor dashboard → Agents
```

### 2. Install

```bash
pip install -e .
```

### 3. Connect as an agent

```bash
gbrain connect --name gbrain
# Approve in Clawvisor dashboard when prompted
```

### 4. Create a standing task in Clawvisor

The agent declares what it needs — you approve in the dashboard. Use the `gbrain` CLI or Claude Code with the Clawvisor skill to create a task covering Gmail, Calendar, and Contacts access.

### 5. Discover and match

```bash
# Discover people from your connected services
gbrain discover --task-id <TASK_ID>

# Match people by interests
gbrain match --task-id <TASK_ID> \
  --people-json '[{"email":"a@x.com","interests":["ai","design"]},{"email":"b@x.com","interests":["ai"]}]'
```

## CLI Commands

| Command    | Description                                  |
|------------|----------------------------------------------|
| `health`   | Check Clawvisor gateway is reachable         |
| `catalog`  | List available services and actions          |
| `connect`  | Register this agent with Clawvisor           |
| `tasks`    | List current Clawvisor tasks                 |
| `discover` | Discover people from contacts/calendar/email |
| `match`    | Find interest-based matches between people   |

## Running tests

```bash
pip install pytest
pytest
```
