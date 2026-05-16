"""Tests for the GBrain communication engine (no network required)."""

from gbrain.communication import GBrainNetwork, Person, Match


class FakeClient:
    def __init__(self):
        self.calls = []

    def execute(self, task_id, service, action, params=None):
        self.calls.append((task_id, service, action, params))
        return []


def make_network():
    client = FakeClient()
    return GBrainNetwork(client, task_id="test-task")


def test_add_person():
    net = make_network()
    p = net.add_person("alice@example.com", name="Alice", interests=["ai", "music"])
    assert p.email == "alice@example.com"
    assert p.name == "Alice"
    assert p.interests == ["ai", "music"]
    assert "alice@example.com" in net.people


def test_tag_interests_deduplicates():
    net = make_network()
    net.add_person("bob@example.com", interests=["ai"])
    net.tag_interests("bob@example.com", ["AI", "robotics", "ai"])
    p = net.people["bob@example.com"]
    assert p.interests == ["ai", "robotics"]


def test_find_matches():
    net = make_network()
    net.add_person("a@test.com", name="A", interests=["ai", "design"])
    net.add_person("b@test.com", name="B", interests=["ai", "music"])
    net.add_person("c@test.com", name="C", interests=["cooking"])

    matches = net.find_matches()
    assert len(matches) == 1
    m = matches[0]
    assert m.shared_interests == ["ai"]
    assert {m.person_a.email, m.person_b.email} == {"a@test.com", "b@test.com"}


def test_find_matches_min_shared():
    net = make_network()
    net.add_person("a@test.com", interests=["ai", "design", "music"])
    net.add_person("b@test.com", interests=["ai", "music"])
    net.add_person("c@test.com", interests=["ai"])

    matches_2 = net.find_matches(min_shared=2)
    assert len(matches_2) == 1
    assert {matches_2[0].person_a.email, matches_2[0].person_b.email} == {"a@test.com", "b@test.com"}


def test_find_matches_for_specific_person():
    net = make_network()
    net.add_person("a@test.com", interests=["ai", "design"])
    net.add_person("b@test.com", interests=["ai"])
    net.add_person("c@test.com", interests=["design"])

    matches = net.find_matches_for("a@test.com")
    assert len(matches) == 2
    emails = {m.person_b.email for m in matches}
    assert emails == {"b@test.com", "c@test.com"}


def test_match_score():
    a = Person("a@test.com", interests=["ai", "design"])
    b = Person("b@test.com", interests=["ai", "design"])
    m = Match(a, b, shared_interests=["ai", "design"])
    assert m.score == 1.0

    c = Person("c@test.com", interests=["ai", "music"])
    m2 = Match(a, c, shared_interests=["ai"])
    assert 0.3 < m2.score < 0.4


def test_no_matches_without_interests():
    net = make_network()
    net.add_person("a@test.com")
    net.add_person("b@test.com")
    assert net.find_matches() == []


def test_discover_calls_service():
    net = make_network()
    net.discover_from_contacts()
    assert len(net.client.calls) == 1
    _, service, action, _ = net.client.calls[0]
    assert service == "google.contacts:franzoni.jaramillo@gmail.com"
    assert action == "list_contacts"
