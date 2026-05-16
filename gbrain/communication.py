"""GBrain communication engine - discover, match, and connect people."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from gbrain.clawvisor_client import ClawvisorClient


@dataclass
class Person:
    email: str
    name: str = ""
    interests: list[str] = field(default_factory=list)
    source: str = ""

    @property
    def display_name(self) -> str:
        return self.name or self.email


@dataclass
class Match:
    person_a: Person
    person_b: Person
    shared_interests: list[str]

    @property
    def score(self) -> float:
        total = len(set(self.person_a.interests) | set(self.person_b.interests))
        if total == 0:
            return 0.0
        return len(self.shared_interests) / total


class GBrainNetwork:
    """Connects to Clawvisor services to discover people and match them by interests."""

    def __init__(self, client: ClawvisorClient, task_id: str):
        self.client = client
        self.task_id = task_id
        self.people: dict[str, Person] = {}

    def _exec(self, service: str, action: str, params: dict[str, Any] | None = None) -> Any:
        return self.client.execute(self.task_id, service, action, params)

    # -- Discovery from connected services --

    def discover_from_contacts(self, account: str = "franzoni.jaramillo@gmail.com") -> list[Person]:
        service = f"google.contacts:{account}"
        result = self._exec(service, "list_contacts", {"page_size": 100})
        contacts = result if isinstance(result, list) else result.get("contacts", [])
        for c in contacts:
            email = c.get("email", c.get("emailAddresses", [{}])[0].get("value", ""))
            if not email:
                continue
            name = c.get("name", c.get("displayName", ""))
            person = self.people.get(email, Person(email=email, name=name, source="contacts"))
            if name and not person.name:
                person.name = name
            self.people[email] = person
        return list(self.people.values())

    def discover_from_calendar(
        self,
        account: str = "franzoni.jaramillo@gmail.com",
        time_min: str | None = None,
        time_max: str | None = None,
    ) -> list[Person]:
        service = f"google.calendar:{account}"
        params: dict[str, Any] = {}
        if time_min:
            params["time_min"] = time_min
        if time_max:
            params["time_max"] = time_max
        result = self._exec(service, "list_events", params or None)
        events = result if isinstance(result, list) else result.get("events", [])
        for event in events:
            attendees = event.get("attendees", [])
            for att in attendees:
                email = att.get("email", "")
                if not email:
                    continue
                name = att.get("displayName", "")
                person = self.people.get(email, Person(email=email, name=name, source="calendar"))
                if name and not person.name:
                    person.name = name
                self.people[email] = person
        return list(self.people.values())

    def discover_from_email(
        self,
        account: str = "franzoni.jaramillo@gmail.com",
        query: str = "",
        max_results: int = 50,
    ) -> list[Person]:
        service = f"google.gmail:{account}"
        params: dict[str, Any] = {"max_results": max_results}
        if query:
            params["query"] = query
        result = self._exec(service, "list_messages", params)
        messages = result if isinstance(result, list) else result.get("messages", [])
        for msg in messages:
            sender = msg.get("from", msg.get("sender", ""))
            if "@" in sender:
                name_part = sender.split("<")[0].strip().strip('"') if "<" in sender else ""
                email_part = sender.split("<")[-1].rstrip(">").strip() if "<" in sender else sender
                person = self.people.get(
                    email_part, Person(email=email_part, name=name_part, source="email")
                )
                if name_part and not person.name:
                    person.name = name_part
                self.people[email_part] = person
        return list(self.people.values())

    # -- Interest tagging --

    def tag_interests(self, email: str, interests: list[str]) -> Person | None:
        person = self.people.get(email)
        if not person:
            return None
        existing = set(person.interests)
        for interest in interests:
            normalized = interest.strip().lower()
            if normalized and normalized not in existing:
                person.interests.append(normalized)
                existing.add(normalized)
        return person

    def add_person(self, email: str, name: str = "", interests: list[str] | None = None) -> Person:
        person = self.people.get(email, Person(email=email, name=name))
        if name and not person.name:
            person.name = name
        self.people[email] = person
        if interests:
            self.tag_interests(email, interests)
        return person

    # -- Matching --

    def find_matches(self, min_shared: int = 1) -> list[Match]:
        people = list(self.people.values())
        matches = []
        for i, a in enumerate(people):
            if not a.interests:
                continue
            for b in people[i + 1 :]:
                if not b.interests:
                    continue
                shared = list(set(a.interests) & set(b.interests))
                if len(shared) >= min_shared:
                    matches.append(Match(person_a=a, person_b=b, shared_interests=sorted(shared)))
        matches.sort(key=lambda m: m.score, reverse=True)
        return matches

    def find_matches_for(self, email: str, min_shared: int = 1) -> list[Match]:
        person = self.people.get(email)
        if not person or not person.interests:
            return []
        matches = []
        for other in self.people.values():
            if other.email == email or not other.interests:
                continue
            shared = list(set(person.interests) & set(other.interests))
            if len(shared) >= min_shared:
                matches.append(Match(person_a=person, person_b=other, shared_interests=sorted(shared)))
        matches.sort(key=lambda m: m.score, reverse=True)
        return matches

    # -- Introduction via email --

    def send_introduction(
        self,
        match: Match,
        account: str = "franzoni.jaramillo@gmail.com",
        custom_message: str = "",
    ) -> Any:
        service = f"google.gmail:{account}"
        shared = ", ".join(match.shared_interests)
        body = custom_message or (
            f"Hi {match.person_a.display_name} and {match.person_b.display_name},\n\n"
            f"I noticed you both share interests in: {shared}.\n\n"
            f"I thought you two should connect! You might find great opportunities "
            f"to collaborate.\n\n"
            f"Best,\nGBrain"
        )
        return self._exec(
            service,
            "send_email",
            {
                "to": [match.person_a.email, match.person_b.email],
                "subject": f"GBrain Intro: You both care about {shared}",
                "body": body,
            },
        )
