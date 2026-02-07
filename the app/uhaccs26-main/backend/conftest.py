"""Shared pytest fixtures for SciScroll tests."""

import os
import sys
import pytest

# Ensure backend directory is on the path
sys.path.insert(0, os.path.dirname(__file__))

from server import create_app


@pytest.fixture
def app():
    """Create a test Flask app in mock mode."""
    os.environ.pop("ANTHROPIC_API_KEY", None)
    test_app = create_app(testing=True)
    test_app.config["TESTING"] = True
    return test_app


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()


# ── Time data fixtures ────────────────────────────────────────────────────

@pytest.fixture
def high_engagement_time_data():
    """Simulates a highly engaged user: long time, many scrolls, clicks."""
    return {
        "current_node_id": "black-holes",
        "total_time_on_node_ms": 60000,
        "scroll_events": 12,
        "go_deeper_clicks": 2,
        "sections_in_current_node": 4,
        "time_per_section_ms": 15000,
    }


@pytest.fixture
def moderate_engagement_time_data():
    """Simulates moderate engagement: some time, some scrolling."""
    return {
        "current_node_id": "quantum-mechanics",
        "total_time_on_node_ms": 20000,
        "scroll_events": 5,
        "go_deeper_clicks": 0,
        "sections_in_current_node": 4,
        "time_per_section_ms": 5000,
    }


@pytest.fixture
def low_engagement_time_data():
    """Simulates a disengaged user: quick bounce, minimal interaction."""
    return {
        "current_node_id": "climate-science",
        "total_time_on_node_ms": 5000,
        "scroll_events": 1,
        "go_deeper_clicks": 0,
        "sections_in_current_node": 4,
        "time_per_section_ms": 1250,
    }


@pytest.fixture
def zero_engagement_time_data():
    """Simulates zero engagement: all zeros."""
    return {
        "current_node_id": "dark-matter",
        "total_time_on_node_ms": 0,
        "scroll_events": 0,
        "go_deeper_clicks": 0,
        "sections_in_current_node": 1,
        "time_per_section_ms": 0,
    }
