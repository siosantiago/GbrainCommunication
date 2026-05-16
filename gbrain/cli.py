"""CLI for GBrain Communication."""

from __future__ import annotations

import argparse
import json
import sys

from gbrain.clawvisor_client import ClawvisorClient, ClawvisorError
from gbrain.config import ClawvisorConfig
from gbrain.communication import GBrainNetwork


def cmd_health(args: argparse.Namespace) -> None:
    client = ClawvisorClient()
    result = client.health()
    print(json.dumps(result, indent=2) if isinstance(result, dict) else result)


def cmd_catalog(args: argparse.Namespace) -> None:
    client = ClawvisorClient()
    result = client.catalog(args.service)
    print(json.dumps(result, indent=2) if isinstance(result, (dict, list)) else result)


def cmd_connect(args: argparse.Namespace) -> None:
    client = ClawvisorClient()
    print(f"Connecting agent '{args.name}'... (approve in the Clawvisor dashboard)")
    result = client.connect_agent(name=args.name, description=args.description)
    print(json.dumps(result, indent=2))


def cmd_tasks(args: argparse.Namespace) -> None:
    client = ClawvisorClient()
    tasks = client.list_tasks()
    if not tasks:
        print("No tasks found.")
        return
    for t in tasks if isinstance(tasks, list) else [tasks]:
        status = t.get("status", "unknown")
        tid = t.get("id", t.get("task_id", "?"))
        purpose = t.get("purpose", "")[:80]
        print(f"  [{status}] {tid}  {purpose}")


def cmd_discover(args: argparse.Namespace) -> None:
    client = ClawvisorClient()
    network = GBrainNetwork(client, task_id=args.task_id)

    sources = args.sources.split(",") if args.sources else ["contacts", "calendar", "email"]
    for source in sources:
        source = source.strip()
        print(f"Discovering from {source}...")
        if source == "contacts":
            network.discover_from_contacts(args.account)
        elif source == "calendar":
            network.discover_from_calendar(args.account)
        elif source == "email":
            network.discover_from_email(args.account)

    print(f"\nDiscovered {len(network.people)} people:")
    for person in sorted(network.people.values(), key=lambda p: p.display_name):
        print(f"  {person.display_name} <{person.email}> (from {person.source})")


def cmd_match(args: argparse.Namespace) -> None:
    client = ClawvisorClient()
    network = GBrainNetwork(client, task_id=args.task_id)

    people_data = json.loads(args.people_json)
    for entry in people_data:
        network.add_person(
            email=entry["email"],
            name=entry.get("name", ""),
            interests=entry.get("interests", []),
        )

    if args.email:
        matches = network.find_matches_for(args.email, min_shared=args.min_shared)
    else:
        matches = network.find_matches(min_shared=args.min_shared)

    if not matches:
        print("No matches found.")
        return

    print(f"Found {len(matches)} match(es):\n")
    for m in matches:
        shared = ", ".join(m.shared_interests)
        print(f"  {m.person_a.display_name} <-> {m.person_b.display_name}")
        print(f"    Shared: {shared}  (score: {m.score:.0%})")
        print()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gbrain",
        description="GBrain Communication - connect and collaborate before you meet",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health", help="Check Clawvisor gateway health")

    cat = sub.add_parser("catalog", help="List available Clawvisor services")
    cat.add_argument("--service", default=None, help="Service ID for details")

    conn = sub.add_parser("connect", help="Register this agent with Clawvisor")
    conn.add_argument("--name", default="gbrain", help="Agent name")
    conn.add_argument("--description", default="GBrain Communication agent")

    sub.add_parser("tasks", help="List current tasks")

    disc = sub.add_parser("discover", help="Discover people from connected services")
    disc.add_argument("--task-id", required=True, help="Clawvisor task ID to operate under")
    disc.add_argument("--account", default="franzoni.jaramillo@gmail.com")
    disc.add_argument("--sources", default="contacts,calendar,email", help="Comma-separated sources")

    mat = sub.add_parser("match", help="Find matches between people by interests")
    mat.add_argument("--task-id", required=True, help="Clawvisor task ID")
    mat.add_argument("--people-json", required=True, help="JSON array of {email, name, interests}")
    mat.add_argument("--email", default=None, help="Find matches for a specific person")
    mat.add_argument("--min-shared", type=int, default=1, help="Minimum shared interests")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    handlers = {
        "health": cmd_health,
        "catalog": cmd_catalog,
        "connect": cmd_connect,
        "tasks": cmd_tasks,
        "discover": cmd_discover,
        "match": cmd_match,
    }
    try:
        handlers[args.command](args)
    except ClawvisorError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except EnvironmentError as e:
        print(f"Config error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
