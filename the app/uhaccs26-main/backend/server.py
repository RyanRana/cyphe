"""
Flask REST API for SciScroll backend.

3 endpoints:
- POST /api/initial  — Start exploring a topic
- POST /api/generate — Get next content based on engagement
- GET  /api/health   — Status check
"""

import os
import logging

from flask import Flask, jsonify, request
from flask_cors import CORS

from api_clients import create_api_clients, detect_mock_mode, get_available_apis
from content_engine import (
    compute_engagement_score,
    sanitize_time_data,
    select_strategy,
    generate_initial_content,
    generate_initial_content_live,
    generate_content_blocks,
    generate_content_blocks_live,
    validate_response,
    validate_initial_response,
)
from topic_graph import slugify, get_node, NODES

logger = logging.getLogger(__name__)


def create_app(testing=False):
    """Flask application factory."""
    app = Flask(__name__)
    CORS(app)

    if not testing:
        from dotenv import load_dotenv
        load_dotenv(override=True)

    # Create API clients
    api_clients = create_api_clients()
    mock_mode = detect_mock_mode(api_clients)

    if mock_mode:
        logger.info("Running in MOCK mode (no Anthropic API key)")
    else:
        logger.info("Running in LIVE mode (Claude orchestration active)")

    # Store on app for access in routes and tests
    app.api_clients = api_clients
    app.mock_mode = mock_mode

    # ── Input validation helpers ──────────────────────────────────────

    def validate_json_body():
        """Ensure request has a JSON body. Returns (data, error_response)."""
        if not request.is_json:
            return None, (jsonify({"error": "Request must be JSON"}), 400)
        data = request.get_json(silent=True)
        if data is None:
            return None, (jsonify({"error": "Invalid JSON body"}), 400)
        return data, None

    def validate_topic(data):
        """Validate 'topic' field. Returns (topic, error_response)."""
        topic = data.get("topic")
        if not topic or not isinstance(topic, str):
            return None, (jsonify({"error": "'topic' is required and must be a non-empty string"}), 400)
        topic = topic.strip()
        if len(topic) > 200:
            return None, (jsonify({"error": "'topic' must be 200 characters or fewer"}), 400)
        if not topic:
            return None, (jsonify({"error": "'topic' cannot be only whitespace"}), 400)
        return topic, None

    # ── Routes ────────────────────────────────────────────────────────

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({
            "status": "ok",
            "mock_mode": app.mock_mode,
            "available_apis": get_available_apis(app.api_clients),
        })

    @app.route("/api/initial", methods=["POST"])
    def initial():
        data, err = validate_json_body()
        if err:
            return err

        topic, err = validate_topic(data)
        if err:
            return err

        try:
            if app.mock_mode:
                result = generate_initial_content(topic)
            else:
                result = generate_initial_content_live(topic, app.api_clients)

            errors = validate_initial_response(result)
            if errors:
                logger.error("Initial response validation failed: %s", errors)
                # Still return the result but log the issues
        except Exception as e:
            logger.exception("Error generating initial content")
            return jsonify({"error": f"Content generation failed: {str(e)}"}), 500

        return jsonify(result)

    @app.route("/api/generate", methods=["POST"])
    def generate():
        data, err = validate_json_body()
        if err:
            return err

        # Validate required fields
        current_node = data.get("current_node")
        if not current_node or not isinstance(current_node, str):
            return jsonify({"error": "'current_node' is required and must be a non-empty string"}), 400

        time_data = data.get("time_data")
        if time_data is not None and not isinstance(time_data, dict):
            return jsonify({"error": "'time_data' must be an object if provided"}), 400

        visited_nodes = data.get("visited_nodes", [])
        if not isinstance(visited_nodes, list):
            return jsonify({"error": "'visited_nodes' must be a list"}), 400

        last_paragraph = data.get("last_paragraph", "")
        if not isinstance(last_paragraph, str):
            last_paragraph = str(last_paragraph) if last_paragraph is not None else ""

        # Optional fields
        topic_path = data.get("topic_path", [])
        graph = data.get("graph")

        try:
            # Compute engagement and strategy
            clean_time_data = sanitize_time_data(time_data)
            engagement_score = compute_engagement_score(clean_time_data)
            strategy = select_strategy(engagement_score)

            # Resolve topic ID
            topic_id = slugify(current_node)

            # Generate content
            if app.mock_mode:
                content_blocks, next_nodes = generate_content_blocks(
                    topic_id, strategy, visited_nodes
                )
            else:
                content_blocks, next_nodes = generate_content_blocks_live(
                    topic_id=topic_id,
                    strategy=strategy,
                    visited_nodes=visited_nodes,
                    last_paragraph=last_paragraph,
                    engagement_score=engagement_score,
                    api_clients=app.api_clients,
                )

            result = {
                "content_blocks": content_blocks,
                "next_nodes": [{"id": n["id"], "label": n["label"]} for n in next_nodes] if next_nodes and isinstance(next_nodes[0], dict) and "label" in next_nodes[0] else next_nodes,
                "strategy_used": strategy,
                "engagement_score": engagement_score,
            }

            errors = validate_response(result)
            if errors:
                logger.error("Generate response validation failed: %s", errors)

        except Exception as e:
            logger.exception("Error generating content")
            return jsonify({"error": f"Content generation failed: {str(e)}"}), 500

        return jsonify(result)

    # ── Error handlers ────────────────────────────────────────────────

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": str(e)}), 400

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(500)
    def internal_error(e):
        return jsonify({"error": "Internal server error"}), 500

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app = create_app()
    app.run(debug=True, port=5000)
