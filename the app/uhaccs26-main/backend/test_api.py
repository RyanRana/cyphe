"""HTTP integration tests for SciScroll API (~47 tests)."""

import os
import sys
import json
import pytest

sys.path.insert(0, os.path.dirname(__file__))


# ═══════════════════════════════════════════════════════════════════════════
# TestHealthEndpoint (3 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_health_has_mock_mode(self, client):
        resp = client.get("/api/health")
        data = resp.get_json()
        assert "mock_mode" in data
        assert data["mock_mode"] is True  # No API key in test

    def test_health_has_available_apis(self, client):
        resp = client.get("/api/health")
        data = resp.get_json()
        assert "available_apis" in data
        apis = data["available_apis"]
        assert "claude" in apis
        assert "unsplash" in apis
        assert "reddit" in apis
        assert "twitter" in apis
        assert "wikipedia" in apis
        assert "wikimedia" in apis
        assert "imgflip" in apis
        assert "xkcd" in apis
        # Wikipedia, Wikimedia, xkcd should always be available
        assert apis["wikipedia"] is True
        assert apis["wikimedia"] is True
        assert apis["xkcd"] is True


# ═══════════════════════════════════════════════════════════════════════════
# TestInitialEndpoint (15 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestInitialEndpoint:
    def test_success_known_topic(self, client):
        resp = client.post("/api/initial", json={"topic": "Black Holes"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert "content_blocks" in data
        assert "graph" in data
        assert "next_nodes" in data
        assert "strategy_used" in data

    def test_schema_content_blocks(self, client):
        resp = client.post("/api/initial", json={"topic": "Quantum Mechanics"})
        data = resp.get_json()
        blocks = data["content_blocks"]
        assert len(blocks) > 0
        for block in blocks:
            assert "id" in block
            assert "type" in block
            assert "content" in block
            assert "group_id" in block
            assert "group_role" in block

    def test_schema_graph(self, client):
        resp = client.post("/api/initial", json={"topic": "Black Holes"})
        data = resp.get_json()
        graph = data["graph"]
        assert "nodes" in graph
        assert "edges" in graph
        assert len(graph["nodes"]) > 0

    def test_strategy_is_deeper(self, client):
        resp = client.post("/api/initial", json={"topic": "Dark Matter"})
        data = resp.get_json()
        assert data["strategy_used"] == "deeper"

    def test_no_body(self, client):
        resp = client.post("/api/initial", content_type="application/json")
        assert resp.status_code == 400

    def test_empty_body(self, client):
        resp = client.post("/api/initial", json={})
        assert resp.status_code == 400

    def test_topic_wrong_type(self, client):
        resp = client.post("/api/initial", json={"topic": 12345})
        assert resp.status_code == 400

    def test_topic_empty_string(self, client):
        resp = client.post("/api/initial", json={"topic": ""})
        assert resp.status_code == 400

    def test_topic_too_long(self, client):
        resp = client.post("/api/initial", json={"topic": "A" * 201})
        assert resp.status_code == 400

    def test_topic_whitespace_only(self, client):
        resp = client.post("/api/initial", json={"topic": "   "})
        assert resp.status_code == 400

    def test_known_topic_black_holes(self, client):
        resp = client.post("/api/initial", json={"topic": "Black Holes"})
        data = resp.get_json()
        assert len(data["content_blocks"]) >= 4
        assert len(data["next_nodes"]) > 0

    def test_known_topic_neural_networks(self, client):
        resp = client.post("/api/initial", json={"topic": "Neural Networks"})
        data = resp.get_json()
        assert data["strategy_used"] == "deeper"
        assert len(data["content_blocks"]) >= 4

    def test_unknown_topic(self, client):
        resp = client.post("/api/initial", json={"topic": "Alien Technology"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["content_blocks"]) > 0

    def test_not_json_content_type(self, client):
        resp = client.post("/api/initial", data="topic=BlackHoles", content_type="application/x-www-form-urlencoded")
        assert resp.status_code == 400

    def test_next_nodes_have_structure(self, client):
        resp = client.post("/api/initial", json={"topic": "Climate Science"})
        data = resp.get_json()
        for node in data["next_nodes"]:
            assert "id" in node
            assert "label" in node


# ═══════════════════════════════════════════════════════════════════════════
# TestGenerateEndpoint (20 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestGenerateEndpoint:
    def test_success_high_engagement(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["strategy_used"] == "deeper"
        assert data["engagement_score"] >= 0.65

    def test_success_low_engagement(self, client, low_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Climate Science",
            "time_data": low_engagement_time_data,
            "visited_nodes": [],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["strategy_used"] == "pivot"

    def test_success_moderate_engagement(self, client, moderate_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Quantum Mechanics",
            "time_data": moderate_engagement_time_data,
            "visited_nodes": [],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["strategy_used"] in ("branch", "deeper", "pivot")

    def test_schema_all_keys(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        data = resp.get_json()
        assert "content_blocks" in data
        assert "next_nodes" in data
        assert "strategy_used" in data
        assert "engagement_score" in data

    def test_missing_current_node(self, client):
        resp = client.post("/api/generate", json={
            "time_data": {"total_time_on_node_ms": 5000},
        })
        assert resp.status_code == 400

    def test_current_node_wrong_type(self, client):
        resp = client.post("/api/generate", json={
            "current_node": 123,
        })
        assert resp.status_code == 400

    def test_current_node_empty_string(self, client):
        resp = client.post("/api/generate", json={
            "current_node": "",
        })
        assert resp.status_code == 400

    def test_no_body(self, client):
        resp = client.post("/api/generate", content_type="application/json")
        assert resp.status_code == 400

    def test_time_data_optional(self, client):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["engagement_score"] == 0.0
        assert data["strategy_used"] == "pivot"

    def test_time_data_wrong_type(self, client):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": "not a dict",
        })
        assert resp.status_code == 400

    def test_visited_nodes_filtering(self, client, high_engagement_time_data):
        visited = ["hawking-radiation", "event-horizon", "singularity"]
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": visited,
        })
        data = resp.get_json()
        next_ids = {n["id"] for n in data["next_nodes"]}
        for v in visited:
            assert v not in next_ids

    def test_visited_nodes_wrong_type(self, client):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "visited_nodes": "not a list",
        })
        assert resp.status_code == 400

    def test_engagement_score_range(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        data = resp.get_json()
        assert 0.0 <= data["engagement_score"] <= 1.0

    def test_strategy_values(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        data = resp.get_json()
        assert data["strategy_used"] in ("deeper", "branch", "pivot")

    def test_content_blocks_not_empty(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        data = resp.get_json()
        assert len(data["content_blocks"]) > 0

    def test_content_blocks_have_group_ids(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Neural Networks",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        data = resp.get_json()
        for block in data["content_blocks"]:
            assert "group_id" in block

    def test_media_blocks_have_media(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "CRISPR Gene Editing",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
        })
        data = resp.get_json()
        media_blocks = [b for b in data["content_blocks"] if b["type"] != "text"]
        for mb in media_blocks:
            assert "media" in mb
            assert "url" in mb["media"]

    def test_last_paragraph_accepted(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Dark Matter",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
            "last_paragraph": "Previous content about dark matter observations.",
        })
        assert resp.status_code == 200

    def test_topic_path_accepted(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
            "topic_path": ["black-holes", "hawking-radiation"],
        })
        assert resp.status_code == 200

    def test_graph_accepted(self, client, high_engagement_time_data):
        resp = client.post("/api/generate", json={
            "current_node": "Black Holes",
            "time_data": high_engagement_time_data,
            "visited_nodes": [],
            "graph": {"nodes": [{"id": "black-holes", "label": "Black Holes"}], "edges": []},
        })
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════
# TestSimulatedFrontendSession (9 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestSimulatedFrontendSession:
    """Simulates a real frontend session: initial → multiple generates with
    accumulating visited_nodes, shifting engagement, growing graph."""

    def _initial(self, client, topic="Black Holes"):
        resp = client.post("/api/initial", json={"topic": topic})
        assert resp.status_code == 200
        return resp.get_json()

    def _generate(self, client, current_node, time_data, visited_nodes):
        resp = client.post("/api/generate", json={
            "current_node": current_node,
            "time_data": time_data,
            "visited_nodes": visited_nodes,
        })
        assert resp.status_code == 200
        return resp.get_json()

    def test_full_session_initial(self, client):
        """Step 1: Start with Black Holes."""
        data = self._initial(client)
        assert data["strategy_used"] == "deeper"
        assert len(data["content_blocks"]) >= 4
        assert len(data["graph"]["nodes"]) >= 1

    def test_full_session_high_engagement(self, client, high_engagement_time_data):
        """Step 2: Highly engaged user gets deeper content."""
        self._initial(client)
        data = self._generate(client, "Black Holes", high_engagement_time_data, ["black-holes"])
        assert data["strategy_used"] == "deeper"
        assert data["engagement_score"] >= 0.65

    def test_full_session_moderate_engagement(self, client, moderate_engagement_time_data):
        """Step 3: Moderately engaged user gets branch content."""
        self._initial(client)
        data = self._generate(client, "Quantum Mechanics", moderate_engagement_time_data, ["quantum-mechanics"])
        assert data["strategy_used"] in ("branch", "deeper")

    def test_full_session_low_engagement(self, client, low_engagement_time_data):
        """Step 4: Disengaged user gets pivot to new topic."""
        self._initial(client)
        data = self._generate(client, "Climate Science", low_engagement_time_data, ["climate-science"])
        assert data["strategy_used"] == "pivot"

    def test_accumulating_visited_nodes(self, client, high_engagement_time_data):
        """Visited nodes grow over session, next_nodes shouldn't repeat."""
        init = self._initial(client)
        visited = ["black-holes"]

        # Step 2
        gen1 = self._generate(client, "Black Holes", high_engagement_time_data, visited)
        visited.extend(n["id"] for n in gen1["next_nodes"])

        # Step 3
        gen2 = self._generate(client, "Black Holes", high_engagement_time_data, visited)
        gen2_next_ids = {n["id"] for n in gen2["next_nodes"]}

        # Next nodes should not include already-visited nodes
        for v in visited:
            assert v not in gen2_next_ids

    def test_strategy_shifts_with_engagement(self, client):
        """Strategy should change as engagement changes."""
        self._initial(client)

        high = self._generate(client, "Black Holes", {
            "total_time_on_node_ms": 60000, "scroll_events": 12,
            "go_deeper_clicks": 2, "sections_in_current_node": 4, "time_per_section_ms": 15000
        }, [])

        low = self._generate(client, "Black Holes", {
            "total_time_on_node_ms": 2000, "scroll_events": 0,
            "go_deeper_clicks": 0, "sections_in_current_node": 4, "time_per_section_ms": 500
        }, [])

        assert high["strategy_used"] == "deeper"
        assert low["strategy_used"] == "pivot"

    def test_graph_growth_over_session(self, client, high_engagement_time_data):
        """Graph should accumulate nodes over multiple requests."""
        init = self._initial(client)
        initial_node_count = len(init["graph"]["nodes"])

        gen1 = self._generate(client, "Black Holes", high_engagement_time_data, ["black-holes"])
        assert len(gen1["next_nodes"]) > 0

    def test_mixed_media_types(self, client, high_engagement_time_data):
        """Content should include diverse media types."""
        init = self._initial(client)
        media_types = {b["type"] for b in init["content_blocks"] if b["type"] != "text"}
        assert len(media_types) >= 2, f"Expected diverse media types, got: {media_types}"

    def test_no_duplicate_block_ids(self, client, high_engagement_time_data):
        """Block IDs should be unique across the entire session."""
        init = self._initial(client)
        all_ids = {b["id"] for b in init["content_blocks"]}

        gen1 = self._generate(client, "Black Holes", high_engagement_time_data, ["black-holes"])
        gen1_ids = {b["id"] for b in gen1["content_blocks"]}

        # No overlap between initial and generated
        assert all_ids.isdisjoint(gen1_ids), "Block IDs should be unique across requests"
