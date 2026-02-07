"""Unit tests for the SciScroll content engine (~85 tests)."""

import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(__file__))

from topic_graph import slugify, get_node, get_subtopics, get_subtopic_nodes, find_topic_for_node, NODES, MAIN_TOPICS
from content_engine import (
    sanitize_time_data,
    compute_engagement_score,
    select_strategy,
    MediaVarietyTracker,
    MEDIA_TYPES,
    generate_mock_media,
    generate_content_blocks,
    generate_initial_content,
    validate_content_block,
    validate_response,
    validate_initial_response,
    VALID_GROUP_ROLES_TEXT,
    VALID_GROUP_ROLES_MEDIA,
    VALID_STRATEGIES,
)


# ═══════════════════════════════════════════════════════════════════════════
# TestSlugify (8 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestSlugify:
    def test_basic_slug(self):
        assert slugify("Black Holes") == "black-holes"

    def test_special_characters(self):
        assert slugify("CRISPR Gene Editing!") == "crispr-gene-editing"

    def test_unicode_characters(self):
        result = slugify("Schrödinger's Cat")
        assert "schr" in result
        assert " " not in result

    def test_empty_string(self):
        assert slugify("") == ""

    def test_whitespace_only(self):
        assert slugify("   ") == ""

    def test_long_string(self):
        long_text = "A" * 200
        result = slugify(long_text)
        assert len(result) <= 80

    def test_idempotent(self):
        """Slugifying a slug should return the same slug."""
        slug = slugify("Black Holes")
        assert slugify(slug) == slug

    def test_multiple_spaces_and_dashes(self):
        assert slugify("dark   matter--stuff") == "dark-matter-stuff"


# ═══════════════════════════════════════════════════════════════════════════
# TestSanitizeTimeData (10 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestSanitizeTimeData:
    def test_valid_data_passthrough(self, high_engagement_time_data):
        result = sanitize_time_data(high_engagement_time_data)
        assert result["total_time_on_node_ms"] == 60000
        assert result["scroll_events"] == 12
        assert result["go_deeper_clicks"] == 2

    def test_none_input(self):
        result = sanitize_time_data(None)
        assert result["total_time_on_node_ms"] == 0
        assert result["sections_in_current_node"] == 1

    def test_empty_dict(self):
        result = sanitize_time_data({})
        assert result["total_time_on_node_ms"] == 0
        assert result["current_node_id"] == ""

    def test_missing_keys_filled_with_defaults(self):
        result = sanitize_time_data({"total_time_on_node_ms": 5000})
        assert result["total_time_on_node_ms"] == 5000
        assert result["scroll_events"] == 0

    def test_wrong_types_handled(self):
        result = sanitize_time_data({"total_time_on_node_ms": "not a number"})
        assert result["total_time_on_node_ms"] == 0

    def test_negative_values_clamped(self):
        result = sanitize_time_data({"total_time_on_node_ms": -5000})
        assert result["total_time_on_node_ms"] == 0

    def test_float_values_converted(self):
        result = sanitize_time_data({"total_time_on_node_ms": 5000.7})
        assert result["total_time_on_node_ms"] == 5000

    def test_none_values_use_defaults(self):
        result = sanitize_time_data({"total_time_on_node_ms": None})
        assert result["total_time_on_node_ms"] == 0

    def test_sections_minimum_one(self):
        result = sanitize_time_data({"sections_in_current_node": 0})
        assert result["sections_in_current_node"] == 1

    def test_string_input(self):
        result = sanitize_time_data("not a dict")
        assert isinstance(result, dict)
        assert result["total_time_on_node_ms"] == 0


# ═══════════════════════════════════════════════════════════════════════════
# TestEngagementScoring (15 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestEngagementScoring:
    def test_high_engagement(self, high_engagement_time_data):
        score = compute_engagement_score(high_engagement_time_data)
        assert score >= 0.65
        assert score <= 1.0

    def test_low_engagement(self, low_engagement_time_data):
        score = compute_engagement_score(low_engagement_time_data)
        assert score < 0.65

    def test_moderate_engagement(self, moderate_engagement_time_data):
        score = compute_engagement_score(moderate_engagement_time_data)
        assert 0.1 <= score <= 0.8

    def test_zero_engagement(self, zero_engagement_time_data):
        score = compute_engagement_score(zero_engagement_time_data)
        assert score == 0.0

    def test_all_zeros(self):
        data = {
            "total_time_on_node_ms": 0,
            "scroll_events": 0,
            "go_deeper_clicks": 0,
            "sections_in_current_node": 1,
            "time_per_section_ms": 0,
        }
        assert compute_engagement_score(data) == 0.0

    def test_maximum_engagement(self):
        data = {
            "total_time_on_node_ms": 120000,
            "scroll_events": 20,
            "go_deeper_clicks": 5,
            "sections_in_current_node": 4,
            "time_per_section_ms": 30000,
        }
        score = compute_engagement_score(data)
        assert score == 1.0

    def test_score_clamped_at_one(self):
        data = {
            "total_time_on_node_ms": 999999,
            "scroll_events": 999,
            "go_deeper_clicks": 999,
            "sections_in_current_node": 1,
            "time_per_section_ms": 999999,
        }
        score = compute_engagement_score(data)
        assert score <= 1.0

    def test_score_clamped_at_zero(self):
        score = compute_engagement_score(None)
        assert score >= 0.0

    def test_click_boost(self):
        base = {
            "total_time_on_node_ms": 10000,
            "scroll_events": 3,
            "go_deeper_clicks": 0,
            "sections_in_current_node": 2,
            "time_per_section_ms": 5000,
        }
        with_clicks = dict(base)
        with_clicks["go_deeper_clicks"] = 2
        assert compute_engagement_score(with_clicks) > compute_engagement_score(base)

    def test_scroll_boost(self):
        base = {
            "total_time_on_node_ms": 10000,
            "scroll_events": 0,
            "go_deeper_clicks": 0,
            "sections_in_current_node": 2,
            "time_per_section_ms": 5000,
        }
        with_scrolls = dict(base)
        with_scrolls["scroll_events"] = 8
        assert compute_engagement_score(with_scrolls) > compute_engagement_score(base)

    def test_time_boost(self):
        base = {
            "total_time_on_node_ms": 5000,
            "scroll_events": 3,
            "go_deeper_clicks": 0,
            "sections_in_current_node": 2,
            "time_per_section_ms": 2500,
        }
        with_time = dict(base)
        with_time["total_time_on_node_ms"] = 50000
        with_time["time_per_section_ms"] = 25000
        assert compute_engagement_score(with_time) > compute_engagement_score(base)

    def test_determinism(self, high_engagement_time_data):
        s1 = compute_engagement_score(high_engagement_time_data)
        s2 = compute_engagement_score(high_engagement_time_data)
        assert s1 == s2

    def test_returns_float(self, high_engagement_time_data):
        score = compute_engagement_score(high_engagement_time_data)
        assert isinstance(score, float)

    def test_four_decimal_precision(self):
        data = {
            "total_time_on_node_ms": 12345,
            "scroll_events": 3,
            "go_deeper_clicks": 1,
            "sections_in_current_node": 3,
            "time_per_section_ms": 4115,
        }
        score = compute_engagement_score(data)
        decimals = str(score).split(".")[-1]
        assert len(decimals) <= 4

    def test_none_input(self):
        score = compute_engagement_score(None)
        assert score == 0.0


# ═══════════════════════════════════════════════════════════════════════════
# TestStrategySelection (6 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestStrategySelection:
    def test_high_engagement_deeper(self):
        assert select_strategy(0.8) == "deeper"

    def test_moderate_engagement_branch(self):
        assert select_strategy(0.5) == "branch"

    def test_low_engagement_pivot(self):
        assert select_strategy(0.2) == "pivot"

    def test_boundary_065(self):
        assert select_strategy(0.65) == "deeper"

    def test_boundary_035(self):
        assert select_strategy(0.35) == "branch"

    def test_zero(self):
        assert select_strategy(0.0) == "pivot"


# ═══════════════════════════════════════════════════════════════════════════
# TestContentGeneration (15 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestContentGeneration:
    def test_known_topic_returns_blocks(self):
        blocks, next_nodes = generate_content_blocks("black-holes", "deeper")
        assert len(blocks) > 0

    def test_unknown_topic_uses_generic(self):
        blocks, next_nodes = generate_content_blocks("alien-technology", "deeper")
        assert len(blocks) > 0

    def test_blocks_have_text_and_media(self):
        blocks, _ = generate_content_blocks("quantum-mechanics", "deeper")
        text_blocks = [b for b in blocks if b["type"] == "text"]
        media_blocks = [b for b in blocks if b["type"] != "text"]
        assert len(text_blocks) > 0
        assert len(media_blocks) > 0

    def test_blocks_have_unique_ids(self):
        blocks, _ = generate_content_blocks("black-holes", "deeper")
        ids = [b["id"] for b in blocks]
        assert len(ids) == len(set(ids))

    def test_blocks_have_group_ids(self):
        blocks, _ = generate_content_blocks("dark-matter", "branch")
        for block in blocks:
            assert "group_id" in block
            assert block["group_id"].startswith("grp-")

    def test_paired_blocks_share_group_id(self):
        blocks, _ = generate_content_blocks("neural-networks", "deeper")
        groups = {}
        for b in blocks:
            gid = b["group_id"]
            groups.setdefault(gid, []).append(b)
        # Each group should have a text + media pair
        for gid, group_blocks in groups.items():
            types = {b["type"] for b in group_blocks}
            assert "text" in types

    def test_schema_valid(self):
        blocks, _ = generate_content_blocks("climate-science", "deeper")
        for block in blocks:
            errors = validate_content_block(block)
            assert errors == [], f"Block validation failed: {errors}"

    def test_deeper_strategy_content(self):
        blocks, _ = generate_content_blocks("black-holes", "deeper")
        assert len(blocks) >= 4

    def test_branch_strategy_content(self):
        blocks, _ = generate_content_blocks("black-holes", "branch")
        assert len(blocks) >= 4

    def test_pivot_strategy_content(self):
        blocks, _ = generate_content_blocks("black-holes", "pivot")
        assert len(blocks) >= 4

    def test_visited_filtering(self):
        _, next_nodes = generate_content_blocks("black-holes", "deeper", visited_nodes=["hawking-radiation", "event-horizon", "singularity"])
        next_ids = {n["id"] for n in next_nodes}
        assert "hawking-radiation" not in next_ids
        assert "event-horizon" not in next_ids
        assert "singularity" not in next_ids

    def test_next_nodes_limited_to_3(self):
        _, next_nodes = generate_content_blocks("black-holes", "deeper")
        assert len(next_nodes) <= 3

    def test_next_nodes_have_id_and_label(self):
        _, next_nodes = generate_content_blocks("quantum-mechanics", "deeper")
        for node in next_nodes:
            assert "id" in node
            assert "label" in node

    def test_media_blocks_have_media_dict(self):
        blocks, _ = generate_content_blocks("crispr-gene-editing", "deeper")
        media_blocks = [b for b in blocks if b["type"] != "text"]
        for mb in media_blocks:
            assert "media" in mb
            assert isinstance(mb["media"], dict)
            assert "url" in mb["media"]
            assert "source" in mb["media"]

    def test_template_substitution_generic(self):
        blocks, _ = generate_content_blocks("unknown-topic-xyz", "deeper")
        text_blocks = [b for b in blocks if b["type"] == "text"]
        # Generic pool uses {label} templates — should be substituted
        for tb in text_blocks:
            assert "{label}" not in tb["content"]
            assert "{slug}" not in tb["content"]


# ═══════════════════════════════════════════════════════════════════════════
# TestMediaVariety (8 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestMediaVariety:
    def test_cycles_through_types(self):
        tracker = MediaVarietyTracker()
        seen = set()
        for _ in range(len(MEDIA_TYPES) * 2):
            seen.add(tracker.next_type())
        assert seen == set(MEDIA_TYPES)

    def test_no_consecutive_duplicates(self):
        tracker = MediaVarietyTracker()
        prev = None
        for _ in range(50):
            current = tracker.next_type()
            assert current != prev, f"Consecutive duplicate: {current}"
            prev = current

    def test_all_types_covered(self):
        tracker = MediaVarietyTracker()
        seen = set()
        for _ in range(len(MEDIA_TYPES)):
            seen.add(tracker.next_type())
        assert len(seen) == len(MEDIA_TYPES)

    def test_mock_media_structure(self):
        for media_type in MEDIA_TYPES:
            media = generate_mock_media(media_type, "Black Holes")
            assert "url" in media
            assert "source" in media
            assert "attribution" in media

    def test_mock_media_all_types(self):
        for media_type in MEDIA_TYPES:
            media = generate_mock_media(media_type, "Test Topic")
            assert media is not None

    def test_tracker_last_property(self):
        tracker = MediaVarietyTracker()
        assert tracker.last is None
        t = tracker.next_type()
        assert tracker.last == t

    def test_custom_media_types(self):
        tracker = MediaVarietyTracker(["a", "b", "c"])
        seen = set()
        for _ in range(6):
            seen.add(tracker.next_type())
        assert seen == {"a", "b", "c"}

    def test_single_type_no_infinite_loop(self):
        tracker = MediaVarietyTracker(["only"])
        for _ in range(5):
            assert tracker.next_type() == "only"


# ═══════════════════════════════════════════════════════════════════════════
# TestValidation (10 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestValidation:
    def test_valid_text_block(self):
        block = {
            "id": "text-abc123",
            "type": "text",
            "content": "Hello world",
            "group_id": "grp-xyz",
            "group_role": "explanation",
        }
        assert validate_content_block(block) == []

    def test_valid_media_block(self):
        block = {
            "id": "unsplash-abc123",
            "type": "unsplash",
            "content": "A photo",
            "group_id": "grp-xyz",
            "group_role": "visual",
            "media": {"url": "https://example.com/photo.jpg", "source": "Unsplash", "attribution": "Test"},
        }
        assert validate_content_block(block) == []

    def test_missing_required_key(self):
        block = {"id": "text-abc", "type": "text"}
        errors = validate_content_block(block)
        assert len(errors) > 0

    def test_invalid_text_role(self):
        block = {
            "id": "text-abc",
            "type": "text",
            "content": "Hello",
            "group_id": "grp-xyz",
            "group_role": "INVALID",
        }
        errors = validate_content_block(block)
        assert any("group_role" in e for e in errors)

    def test_media_missing_media_key(self):
        block = {
            "id": "unsplash-abc",
            "type": "unsplash",
            "content": "A photo",
            "group_id": "grp-xyz",
            "group_role": "visual",
        }
        errors = validate_content_block(block)
        assert any("media" in e.lower() for e in errors)

    def test_media_missing_url(self):
        block = {
            "id": "unsplash-abc",
            "type": "unsplash",
            "content": "A photo",
            "group_id": "grp-xyz",
            "group_role": "visual",
            "media": {"source": "Unsplash"},
        }
        errors = validate_content_block(block)
        assert any("url" in e for e in errors)

    def test_validate_response_valid(self):
        resp = {
            "content_blocks": [],
            "next_nodes": [],
            "strategy_used": "deeper",
            "engagement_score": 0.75,
        }
        assert validate_response(resp) == []

    def test_validate_response_missing_key(self):
        resp = {"content_blocks": [], "next_nodes": []}
        errors = validate_response(resp)
        assert len(errors) > 0

    def test_validate_response_invalid_strategy(self):
        resp = {
            "content_blocks": [],
            "next_nodes": [],
            "strategy_used": "invalid",
            "engagement_score": 0.5,
        }
        errors = validate_response(resp)
        assert any("strategy" in e.lower() for e in errors)

    def test_validate_initial_response(self):
        result = generate_initial_content("Black Holes")
        errors = validate_initial_response(result)
        assert errors == [], f"Initial validation failed: {errors}"


# ═══════════════════════════════════════════════════════════════════════════
# TestInitialContent (6 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestInitialContent:
    def test_all_keys_present(self):
        result = generate_initial_content("Black Holes")
        assert "content_blocks" in result
        assert "graph" in result
        assert "next_nodes" in result
        assert "strategy_used" in result

    def test_strategy_is_deeper(self):
        result = generate_initial_content("Quantum Mechanics")
        assert result["strategy_used"] == "deeper"

    def test_graph_has_root_node(self):
        result = generate_initial_content("Black Holes")
        graph = result["graph"]
        assert len(graph["nodes"]) >= 1
        assert graph["nodes"][0]["id"] == "black-holes"

    def test_graph_has_edges(self):
        result = generate_initial_content("Neural Networks")
        graph = result["graph"]
        assert len(graph["edges"]) > 0
        for edge in graph["edges"]:
            assert "source" in edge
            assert "target" in edge

    def test_known_topic(self):
        result = generate_initial_content("CRISPR Gene Editing")
        assert len(result["content_blocks"]) > 0
        assert len(result["next_nodes"]) > 0

    def test_unknown_topic(self):
        result = generate_initial_content("Quantum Teleportation Paradox")
        assert len(result["content_blocks"]) > 0
        assert result["strategy_used"] == "deeper"


# ═══════════════════════════════════════════════════════════════════════════
# TestEdgeCases (7 tests)
# ═══════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    def test_empty_visited_nodes(self):
        blocks, next_nodes = generate_content_blocks("black-holes", "deeper", visited_nodes=[])
        assert len(blocks) > 0

    def test_all_nodes_visited(self):
        """When all subtopics are visited, should still return content."""
        all_subtopics = []
        for strategy_nodes in ["deeper", "branch", "pivot"]:
            all_subtopics.extend(get_subtopics("black-holes", strategy_nodes))
        blocks, next_nodes = generate_content_blocks("black-holes", "deeper", visited_nodes=all_subtopics)
        assert len(blocks) > 0

    def test_long_topic_name(self):
        long_name = "A" * 300
        result = generate_initial_content(long_name)
        assert result is not None
        assert "content_blocks" in result

    def test_special_characters_in_topic(self):
        result = generate_initial_content("DNA & RNA: The Code of Life!")
        assert result is not None

    def test_unicode_topic(self):
        result = generate_initial_content("Schrödinger Equation")
        assert result is not None
        assert len(result["content_blocks"]) > 0

    def test_numeric_topic(self):
        result = generate_initial_content("42")
        assert result is not None

    def test_topic_graph_lookup(self):
        """All main topics should be findable in the graph."""
        for topic_id in MAIN_TOPICS:
            node = get_node(topic_id)
            assert node is not None, f"Main topic {topic_id} not found"
            assert "label" in node
            assert "description" in node
