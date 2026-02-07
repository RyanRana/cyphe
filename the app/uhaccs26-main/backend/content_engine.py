"""
Core content engine for SciScroll.

Handles engagement scoring, strategy selection, content block generation
(both mock and live via Claude orchestration), and response validation.
"""

import json
import logging
import random
import re
import uuid
from collections import deque

from topic_graph import (
    NODES,
    TOPIC_GRAPH,
    MAIN_TOPICS,
    get_node,
    get_subtopics,
    get_subtopic_nodes,
    find_topic_for_node,
    slugify,
)

logger = logging.getLogger(__name__)

# ── Media types ───────────────────────────────────────────────────────────
MEDIA_TYPES = ["unsplash", "wikipedia_image", "wikimedia", "reddit", "xkcd", "meme", "tweet"]

VALID_GROUP_ROLES_TEXT = {"explanation", "caption", "context", "funfact"}
VALID_GROUP_ROLES_MEDIA = {"visual", "diagram", "discussion", "humor", "social"}
VALID_STRATEGIES = {"deeper", "branch", "pivot"}


# ── Utility ───────────────────────────────────────────────────────────────

def _uid(prefix=""):
    """Generate a short unique ID with an optional prefix."""
    short = uuid.uuid4().hex[:8]
    return f"{prefix}-{short}" if prefix else short


def sanitize_time_data(time_data):
    """Sanitize and fill defaults for time_data from the frontend.

    Returns a clean dict with all required keys, safe types, and non-negative values.
    """
    defaults = {
        "current_node_id": "",
        "total_time_on_node_ms": 0,
        "scroll_events": 0,
        "go_deeper_clicks": 0,
        "sections_in_current_node": 1,
        "time_per_section_ms": 0,
    }
    if not isinstance(time_data, dict):
        return dict(defaults)

    result = {}
    for key, default_val in defaults.items():
        val = time_data.get(key, default_val)
        if key == "current_node_id":
            result[key] = str(val) if val is not None else ""
        else:
            try:
                val = int(val) if val is not None else default_val
            except (ValueError, TypeError):
                val = default_val
            result[key] = max(0, val)

    # sections must be at least 1 to avoid division by zero
    if result["sections_in_current_node"] < 1:
        result["sections_in_current_node"] = 1

    return result


# ── Engagement scoring ────────────────────────────────────────────────────

def compute_engagement_score(time_data):
    """Compute an engagement score from 0.0 to 1.0 based on time_data.

    Weighted formula:
    - 0.30 × time factor (30s = 0.5, 60s+ = 1.0)
    - 0.20 × scroll factor (capped at 10)
    - 0.30 × click factor (each click adds 0.5, capped at 1.0)
    - 0.20 × section-variance factor (time_per_section / total * sections)
    """
    td = sanitize_time_data(time_data)

    # Time factor: 0-60s maps to 0-1
    time_ms = td["total_time_on_node_ms"]
    time_factor = min(1.0, time_ms / 60000.0)

    # Scroll factor: 0-10 scrolls maps to 0-1
    scroll_factor = min(1.0, td["scroll_events"] / 10.0)

    # Click factor: each go_deeper_click adds 0.5, capped at 1.0
    click_factor = min(1.0, td["go_deeper_clicks"] * 0.5)

    # Section variance: how evenly time is distributed across sections
    sections = td["sections_in_current_node"]
    total_time = td["total_time_on_node_ms"]
    time_per_section = td["time_per_section_ms"]
    if total_time > 0 and sections > 0:
        expected_per_section = total_time / sections
        if expected_per_section > 0:
            variance_factor = min(1.0, time_per_section / expected_per_section)
        else:
            variance_factor = 0.0
    else:
        variance_factor = 0.0

    score = (
        0.30 * time_factor
        + 0.20 * scroll_factor
        + 0.30 * click_factor
        + 0.20 * variance_factor
    )

    return round(max(0.0, min(1.0, score)), 4)


def select_strategy(engagement_score):
    """Select a content strategy based on engagement score.

    >= 0.65 → "deeper"  (user is very engaged, go deeper into topic)
    0.35–0.65 → "branch" (moderate, show related topics)
    < 0.35 → "pivot"   (low engagement, switch to different topic)
    """
    if engagement_score >= 0.65:
        return "deeper"
    elif engagement_score >= 0.35:
        return "branch"
    else:
        return "pivot"


# ── Media variety tracking ────────────────────────────────────────────────

class MediaVarietyTracker:
    """Cycles through media types to ensure variety. No consecutive duplicates."""

    def __init__(self, media_types=None):
        self._types = list(media_types or MEDIA_TYPES)
        self._queue = deque(self._types)
        self._last = None

    def next_type(self):
        """Get the next media type, avoiding consecutive duplicates."""
        if not self._queue:
            shuffled = list(self._types)
            random.shuffle(shuffled)
            self._queue = deque(shuffled)

        media_type = self._queue.popleft()

        # Avoid consecutive duplicates
        attempts = 0
        while media_type == self._last and len(self._types) > 1 and attempts < len(self._types):
            self._queue.append(media_type)
            media_type = self._queue.popleft()
            attempts += 1

        self._last = media_type
        return media_type

    @property
    def last(self):
        return self._last


# ── Mock content pools ────────────────────────────────────────────────────

TOPIC_POOLS = {
    "black-holes": {
        "deeper": [
            "Black holes form when massive stars collapse at the end of their lifecycle. The core implodes under its own gravity, creating a region so dense that not even light can escape.",
            "At the center of a black hole lies the singularity — a point of theoretically infinite density where the known laws of physics break down completely.",
            "Hawking radiation, proposed by Stephen Hawking in 1974, suggests that black holes slowly evaporate by emitting thermal radiation due to quantum effects near the event horizon.",
            "The event horizon is not a physical barrier but a mathematical boundary. Once crossed, the escape velocity exceeds the speed of light, making return impossible.",
        ],
        "branch": [
            "Neutron stars are the ultra-dense remnants of supernova explosions. A teaspoon of neutron star material would weigh about a billion tons on Earth.",
            "Gravitational waves, first detected by LIGO in 2015, are ripples in spacetime produced when massive objects like black holes merge.",
            "Einstein's general relativity describes gravity not as a force, but as the curvature of spacetime caused by mass and energy.",
        ],
        "pivot": [
            "While black holes operate at the largest scales, quantum mechanics governs the smallest. The quest to unify these two frameworks is one of physics' greatest challenges.",
            "Just as black holes represent extreme physics, CRISPR represents extreme biology — the ability to edit the fundamental code of life with unprecedented precision.",
        ],
    },
    "quantum-mechanics": {
        "deeper": [
            "Wave-particle duality is one of quantum mechanics' most counterintuitive concepts. Photons and electrons exhibit both wave-like interference and particle-like detection.",
            "Quantum entanglement connects particles across any distance instantaneously. Measuring one particle instantly determines the state of its entangled partner.",
            "Heisenberg's uncertainty principle states that the more precisely you know a particle's position, the less precisely you can know its momentum, and vice versa.",
            "Quantum tunneling allows particles to pass through energy barriers they classically shouldn't be able to surmount, enabling processes like nuclear fusion in stars.",
        ],
        "branch": [
            "Quantum computers harness superposition and entanglement to solve certain problems exponentially faster than classical computers.",
            "The Standard Model of particle physics categorizes all known fundamental particles and describes three of the four fundamental forces of nature.",
        ],
        "pivot": [
            "From the quantum world to the cosmic: dark matter makes up about 27% of the universe, yet we can't see or directly detect it.",
            "Neural networks, inspired by biological brains, learn patterns from data — a computational approach that mirrors quantum systems' statistical nature.",
        ],
    },
    "crispr-gene-editing": {
        "deeper": [
            "CRISPR-Cas9 works like molecular scissors. The guide RNA directs the Cas9 protein to a specific DNA sequence, where it makes a precise cut.",
            "Off-target effects remain one of CRISPR's biggest challenges. The system can sometimes cut at unintended genomic locations with similar sequences.",
            "Prime editing, developed in 2019, is a more precise version that can directly write new genetic information into DNA without making double-strand breaks.",
            "Gene drives using CRISPR could spread modified genes through wild populations, potentially eliminating disease-carrying mosquitoes.",
        ],
        "branch": [
            "Synthetic biology goes beyond editing genes — it designs entirely new biological systems and organisms from scratch.",
            "Epigenetics shows that gene expression can be heritably changed without altering the DNA sequence itself, challenging our understanding of inheritance.",
        ],
        "pivot": [
            "While CRISPR edits the code of life, neural networks learn to read and interpret it, with AI models now predicting protein structures from genetic sequences.",
        ],
    },
    "dark-matter": {
        "deeper": [
            "WIMPs (Weakly Interacting Massive Particles) are the leading dark matter candidates. Despite decades of searching, none have been directly detected.",
            "Galaxy rotation curves provided the first strong evidence for dark matter. Stars at the edges of galaxies orbit faster than visible matter alone can explain.",
            "The Bullet Cluster, a collision of two galaxy clusters, provided direct observational evidence that dark matter exists separately from normal matter.",
            "Axions are hypothetical ultralight particles that could account for dark matter. Several experiments worldwide are searching for them.",
        ],
        "branch": [
            "The Cosmic Microwave Background is the afterglow of the Big Bang, carrying a precise map of the universe when it was only 380,000 years old.",
            "The Hubble Tension refers to the discrepancy between different measurements of the universe's expansion rate, potentially pointing to new physics.",
        ],
        "pivot": [
            "From the unseen universe to the unseen genome: like dark matter, much of our DNA was once considered 'junk' until its regulatory roles were discovered.",
        ],
    },
    "climate-science": {
        "deeper": [
            "The greenhouse effect is essential for life — without it, Earth's average temperature would be about -18°C. Human activities have intensified this natural process.",
            "Ice cores from Antarctica contain air bubbles that record atmospheric conditions going back 800,000 years, showing a clear correlation between CO2 and temperature.",
            "Climate models divide Earth's atmosphere into grid cells and simulate physical processes. Modern models can reproduce historical climate changes with remarkable accuracy.",
            "Thermohaline circulation, the global ocean conveyor belt, distributes heat around the planet. Its potential disruption is one of climate change's most concerning tipping points.",
        ],
        "branch": [
            "Ocean acidification, sometimes called 'the other CO2 problem', threatens marine ecosystems as absorbed carbon dioxide lowers seawater pH.",
            "Geoengineering proposals range from injecting aerosols into the stratosphere to reflect sunlight, to capturing carbon dioxide directly from the air.",
        ],
        "pivot": [
            "Climate models and neural networks share surprising similarities — both use complex mathematical systems to find patterns in massive datasets.",
        ],
    },
    "neural-networks": {
        "deeper": [
            "Backpropagation is the algorithm that makes deep learning possible. It efficiently computes how much each connection contributes to the network's errors.",
            "Transformers revolutionized AI by introducing the attention mechanism, allowing models to weigh the importance of different parts of the input simultaneously.",
            "The attention mechanism lets a model focus on relevant parts of an input sequence. In language, this means understanding that 'it' in a sentence refers to a specific noun.",
            "Gradient descent optimizes neural networks by iteratively adjusting weights in the direction that most reduces the error, like a ball rolling downhill.",
        ],
        "branch": [
            "Reinforcement learning trains agents through trial and error, using rewards and penalties. It's behind game-playing AIs and robotic control systems.",
            "Generative AI creates new content — text, images, music, code — by learning statistical patterns from massive training datasets.",
        ],
        "pivot": [
            "Both neural networks and quantum computers process information in fundamentally non-classical ways, leading researchers to explore quantum machine learning.",
        ],
    },
}

# Generic fallback pool for unknown topics
GENERIC_POOL = {
    "deeper": [
        "{label} is a fascinating field that continues to evolve. Researchers are uncovering new insights that challenge our previous understanding.",
        "The deeper you look into {label}, the more complexity emerges. What seems simple on the surface reveals layers of interconnected phenomena.",
        "Recent advances in {label} have opened new avenues for research and practical applications that were previously considered impossible.",
    ],
    "branch": [
        "{label} connects to many neighboring fields. These interdisciplinary connections often lead to the most surprising discoveries.",
        "Related fields offer fresh perspectives on {label}, revealing unexpected parallels and shared underlying principles.",
    ],
    "pivot": [
        "Stepping back from {label}, entirely different scientific domains offer striking analogies and cross-pollination of ideas.",
        "Science's greatest breakthroughs often come from connecting seemingly unrelated fields. Moving from {label} to a new domain can spark unexpected insights.",
    ],
}


# ── Mock media generation ─────────────────────────────────────────────────

def generate_mock_media(media_type, topic_label):
    """Generate a mock media block with placeholder data for a given type."""
    topic_slug = slugify(topic_label)

    templates = {
        "unsplash": {
            "url": f"https://images.unsplash.com/placeholder-{topic_slug}?w=1080&h=720",
            "source": "Unsplash",
            "attribution": f"Photo related to {topic_label} on Unsplash",
            "width": 1080,
            "height": 720,
        },
        "wikipedia_image": {
            "url": f"https://upload.wikimedia.org/placeholder-{topic_slug}.jpg",
            "source": "Wikipedia",
            "attribution": f"Image from Wikipedia article: {topic_label}",
            "width": 800,
            "height": 600,
        },
        "wikimedia": {
            "url": f"https://upload.wikimedia.org/commons/placeholder-{topic_slug}-diagram.svg",
            "source": "Wikimedia Commons",
            "attribution": f"Diagram from Wikimedia Commons: {topic_label}",
            "width": 1200,
            "height": 900,
            "description": f"Scientific diagram illustrating {topic_label}",
        },
        "reddit": {
            "url": f"https://reddit.com/r/science/placeholder-{topic_slug}",
            "source": "r/science",
            "attribution": f"Discussion about {topic_label} on r/science",
            "width": None,
            "height": None,
            "title": f"Fascinating new research on {topic_label}",
            "score": 1542,
        },
        "xkcd": {
            "url": f"https://imgs.xkcd.com/comics/placeholder-{topic_slug}.png",
            "source": "xkcd",
            "attribution": f"xkcd comic related to {topic_label}",
            "width": 740,
            "height": 420,
            "alt_text": f"A humorous take on {topic_label}",
            "title": f"xkcd: {topic_label}",
        },
        "meme": {
            "url": f"https://i.imgflip.com/placeholder-{topic_slug}.jpg",
            "source": "Imgflip",
            "attribution": f"Science meme about {topic_label}",
            "width": 500,
            "height": 500,
        },
        "tweet": {
            "url": f"https://twitter.com/sciencemagazine/status/placeholder-{topic_slug}",
            "source": "Twitter/X",
            "attribution": f"@sciencemagazine",
            "width": None,
            "height": None,
            "text": f"Exciting developments in {topic_label} research! New findings suggest...",
            "likes": 234,
            "retweets": 87,
        },
    }
    return templates.get(media_type, templates["unsplash"])


# ── Content block assembly ────────────────────────────────────────────────

def _pick_text(topic_id, strategy, used_texts=None):
    """Pick a text paragraph for the topic and strategy, avoiding repeats."""
    used_texts = used_texts or set()
    pool = TOPIC_POOLS.get(topic_id, {}).get(strategy, [])

    if not pool:
        # Use generic pool with label substitution
        node = get_node(topic_id)
        label = node["label"] if node else topic_id.replace("-", " ").title()
        pool = [t.format(label=label, slug=topic_id) for t in GENERIC_POOL.get(strategy, GENERIC_POOL["deeper"])]

    available = [t for t in pool if t not in used_texts]
    if not available:
        available = pool  # Reset if all used

    return random.choice(available) if available else f"Exploring {topic_id.replace('-', ' ')}."


def _media_role_for_type(media_type):
    """Map media type to a default group role."""
    mapping = {
        "unsplash": "visual",
        "wikipedia_image": "visual",
        "wikimedia": "diagram",
        "reddit": "discussion",
        "xkcd": "humor",
        "meme": "humor",
        "tweet": "social",
    }
    return mapping.get(media_type, "visual")


def _text_role_for_media(media_type):
    """Pick an appropriate text role to pair with a media type."""
    mapping = {
        "unsplash": "explanation",
        "wikipedia_image": "explanation",
        "wikimedia": "caption",
        "reddit": "context",
        "xkcd": "funfact",
        "meme": "funfact",
        "tweet": "context",
    }
    return mapping.get(media_type, "explanation")


def generate_content_blocks(topic_id, strategy, visited_nodes=None, num_groups=4):
    """Generate content blocks in mock mode.

    Returns:
        (content_blocks, next_nodes) tuple.
        content_blocks is a list of text and media block dicts.
        next_nodes is a list of suggested next node dicts.
    """
    visited_nodes = set(visited_nodes or [])
    tracker = MediaVarietyTracker()
    blocks = []
    used_texts = set()

    # Resolve which main topic this node belongs to for graph lookups
    main_topic = topic_id if topic_id in TOPIC_GRAPH else find_topic_for_node(topic_id)
    if main_topic is None:
        main_topic = topic_id  # Unknown topic, will use generic pool

    for _ in range(num_groups):
        group_id = _uid("grp")
        media_type = tracker.next_type()

        # Text block
        text_content = _pick_text(main_topic, strategy, used_texts)
        used_texts.add(text_content)

        text_block = {
            "id": _uid("text"),
            "type": "text",
            "content": text_content,
            "group_id": group_id,
            "group_role": _text_role_for_media(media_type),
        }
        blocks.append(text_block)

        # Media block
        node = get_node(topic_id)
        label = node["label"] if node else topic_id.replace("-", " ").title()
        media_data = generate_mock_media(media_type, label)

        media_block = {
            "id": _uid(media_type),
            "type": media_type,
            "content": f"{label} — {media_type} content",
            "group_id": group_id,
            "group_role": _media_role_for_type(media_type),
            "media": media_data,
        }
        blocks.append(media_block)

    # Next nodes: subtopics for the strategy, filtering visited
    next_node_list = get_subtopic_nodes(main_topic, strategy, exclude=visited_nodes)
    if not next_node_list:
        # If all subtopics visited, try other strategies
        for fallback_strategy in ["deeper", "branch", "pivot"]:
            next_node_list = get_subtopic_nodes(main_topic, fallback_strategy, exclude=visited_nodes)
            if next_node_list:
                break

    # Limit to 3 suggestions
    if len(next_node_list) > 3:
        next_node_list = random.sample(next_node_list, 3)

    return blocks, next_node_list


def generate_initial_content(topic_label):
    """Generate initial content when a user starts exploring a topic.

    Seeds engagement at ~0.7 (forces "deeper" strategy) and builds the initial graph.
    """
    topic_id = slugify(topic_label)
    node = get_node(topic_id)

    if not node:
        # Unknown topic — create a temporary node
        node = {"id": topic_id, "label": topic_label, "description": f"Exploring {topic_label}"}

    strategy = "deeper"
    blocks, next_nodes = generate_content_blocks(topic_id, strategy)

    # Build initial graph
    graph = {
        "nodes": [{"id": node["id"], "label": node["label"]}],
        "edges": [],
    }
    for nn in next_nodes:
        graph["nodes"].append({"id": nn["id"], "label": nn["label"]})
        graph["edges"].append({"source": node["id"], "target": nn["id"]})

    return {
        "content_blocks": blocks,
        "graph": graph,
        "next_nodes": [{"id": n["id"], "label": n["label"]} for n in next_nodes],
        "strategy_used": strategy,
    }


# ── Live mode (Claude orchestration) ─────────────────────────────────────

CLAUDE_SYSTEM_PROMPT = """You are the content orchestrator for SciScroll, an infinite scientific knowledge graph explorer.

Your job is to decide what content to show the user next. You will receive:
- The current topic and subtopic
- The user's engagement level (0-1 score) and selected strategy (deeper/branch/pivot)
- Which external APIs are available
- The last paragraph the user read
- Which nodes the user has already visited

You must return a JSON object with this exact structure:
{
    "groups": [
        {
            "text": "A paragraph of educational content about the topic...",
            "media_request": {"type": "wikipedia_image", "query": "Black hole"},
            "group_role_text": "explanation",
            "group_role_media": "visual"
        }
    ],
    "next_nodes": ["node-slug-1", "node-slug-2"]
}

CONTENT DEPTH & FLOW:
- Generate 5-8 content groups per response
- When the strategy is "deeper", build on what the user has already read. Go into specific subtopics, mechanisms, and details — do NOT repeat introductory overviews. Reference the last_paragraph to create continuity.
- Create natural transitions between groups. The first group should connect to the last_paragraph, and each subsequent group should flow logically into the next.
- Each text paragraph should be 2-4 sentences, educational, engaging, and scientifically accurate.
- Progress through the topic: start with a transition from previous content, build through details, and end with a hook leading to the next nodes.

MEDIA QUERY FORMATS (critical for API success):
- "wikipedia_image": query MUST be a short Wikipedia article title (e.g. "Black hole", "CRISPR", "Neutron star"). NOT a sentence or description.
- "wikimedia": query should be 2-3 word science terms (e.g. "DNA structure", "galaxy diagram", "neural network").
- "xkcd": only request if the topic genuinely relates to a well-known xkcd theme (physics, math, CS, biology). Query should contain the core keyword (e.g. "gravity", "quantum", "evolution").
- "meme": include "top_text" and "bottom_text" fields in the media_request that are funny and specific to the current subtopic. Example: {"type": "meme", "query": "science meme", "top_text": "When you finally understand quantum tunneling", "bottom_text": "But then forget it immediately"}
- "tweet": query should be a specific scientific term or concept (e.g. "CRISPR gene editing", "black hole photo").
- "unsplash": descriptive search query for a relevant photo.

STRUCTURAL RULES:
- Each group has a text (can be null) and a media_request (can be null), but at least one must be non-null
- media_request.type must be one of: unsplash, wikipedia_image, wikimedia, reddit, xkcd, meme, tweet
- Only request media types that are marked as available
- group_role_text must be one of: explanation, caption, context, funfact
- group_role_media must be one of: visual, diagram, discussion, humor, social
- next_nodes should be 2-3 valid node slugs from the topic graph that haven't been visited
- Mix media types for variety — don't use the same media type twice in a row

STRATEGY BEHAVIOR:
- "deeper": detailed explanations, diagrams, Wikipedia images, charts. Go into mechanisms, equations, experiments. Build on visited nodes — don't rehash basics.
- "branch": connections to related topics, broader context. Show how the current topic relates to adjacent fields. Use varied media to illustrate connections.
- "pivot": fun, surprising, lighter content — use memes (with good captions!), comics, tweets. Still educational but with humor and novelty.

Return ONLY valid JSON, no markdown formatting."""


def generate_content_with_claude(
    topic_label,
    strategy,
    visited_nodes,
    last_paragraph,
    engagement_score,
    available_apis,
    claude_client,
    topic_graph_context=None,
):
    """Use Claude to decide the content mix and generate text.

    Returns a dict with "groups" and "next_nodes", or None on failure.
    """
    if not claude_client or not claude_client.is_available:
        return None

    topic_id = slugify(topic_label)
    node = get_node(topic_id)
    node_desc = node["description"] if node else "Unknown topic"

    # Get available subtopics for context
    main_topic = topic_id if topic_id in TOPIC_GRAPH else find_topic_for_node(topic_id)
    available_next = []
    if main_topic:
        for strat in ["deeper", "branch", "pivot"]:
            nodes = get_subtopic_nodes(main_topic, strat, exclude=visited_nodes)
            available_next.extend([{"id": n["id"], "label": n["label"], "strategy": strat} for n in nodes])

    # Filter available_apis to only ones that are True
    apis_available = [name for name, avail in available_apis.items() if avail and name != "claude"]

    # Map API names to media types
    api_to_media = {
        "unsplash": "unsplash",
        "wikipedia": "wikipedia_image",
        "wikimedia": "wikimedia",
        "reddit": "reddit",
        "xkcd": "xkcd",
        "imgflip": "meme",
        "twitter": "tweet",
    }
    available_media_types = [api_to_media[api] for api in apis_available if api in api_to_media]

    user_prompt = f"""Topic: {topic_label}
Description: {node_desc}
Strategy: {strategy}
Engagement Score: {engagement_score}
Visited Nodes: {json.dumps(list(visited_nodes or []))}
Last Paragraph: {last_paragraph or "None (first content)"}

Available media types: {json.dumps(available_media_types)}

Available next nodes:
{json.dumps(available_next, indent=2)}

Generate content following the {strategy} strategy."""

    result = claude_client.generate_json(CLAUDE_SYSTEM_PROMPT, user_prompt)
    if result and isinstance(result, dict) and "groups" in result:
        return result
    return None


def _clean_query_for_wikipedia(query, topic_label):
    """Try to resolve a free-form Claude query to a canonical Wikipedia title.

    Checks if the query contains a known node label from the topic graph,
    and returns that label. Otherwise falls back to the raw query.
    """
    query_lower = query.lower()

    # Check if any known node label is contained in the query
    for node_id, node_data in NODES.items():
        label = node_data.get("label", "")
        if label.lower() in query_lower and len(label) > 2:
            return label

    # Check if the topic label itself works better (shorter = better for Wikipedia)
    if len(query.split()) > 3:
        return topic_label

    return query


def _resolve_media(media_request, topic_label, api_clients):
    """Execute a media request from Claude's plan using real API clients.

    Returns a media dict or falls back to mock.
    """
    if not media_request or not isinstance(media_request, dict):
        return None

    media_type = media_request.get("type", "unsplash")
    query = media_request.get("query", topic_label)
    result = None

    try:
        if media_type == "unsplash" and api_clients.get("unsplash"):
            result = api_clients["unsplash"].search_photos(query)
        elif media_type == "wikipedia_image" and api_clients.get("wikipedia"):
            # Clean the query to match Wikipedia article titles
            clean_query = _clean_query_for_wikipedia(query, topic_label)
            result = api_clients["wikipedia"].get_page_image(clean_query)
        elif media_type == "wikimedia" and api_clients.get("wikimedia"):
            result = api_clients["wikimedia"].search_diagrams(query)
        elif media_type == "reddit" and api_clients.get("reddit"):
            result = api_clients["reddit"].search_posts(query)
        elif media_type == "xkcd" and api_clients.get("xkcd"):
            result = api_clients["xkcd"].search_comics(query)
        elif media_type == "meme" and api_clients.get("imgflip"):
            # Pass Claude's generated captions to Imgflip
            top_text = media_request.get("top_text")
            bottom_text = media_request.get("bottom_text")
            result = api_clients["imgflip"].get_meme(query, top_text=top_text, bottom_text=bottom_text)
        elif media_type == "tweet" and api_clients.get("twitter"):
            result = api_clients["twitter"].search_tweets(query)
    except Exception as e:
        logger.warning("API call failed for %s: %s", media_type, e)

    # Fall back to mock if real API failed
    if result is None:
        result = generate_mock_media(media_type, topic_label)

    return result


def generate_content_blocks_live(
    topic_id,
    strategy,
    visited_nodes,
    last_paragraph,
    engagement_score,
    api_clients,
):
    """Generate content blocks using Claude orchestration + real APIs.

    Falls back to mock mode if Claude is unavailable or fails.
    Returns (content_blocks, next_nodes) tuple.
    """
    from api_clients import get_available_apis

    claude_client = api_clients.get("claude")
    available_apis = get_available_apis(api_clients)

    node = get_node(topic_id)
    topic_label = node["label"] if node else topic_id.replace("-", " ").title()

    # Try Claude orchestration
    claude_plan = generate_content_with_claude(
        topic_label=topic_label,
        strategy=strategy,
        visited_nodes=visited_nodes,
        last_paragraph=last_paragraph,
        engagement_score=engagement_score,
        available_apis=available_apis,
        claude_client=claude_client,
    )

    if claude_plan is None:
        # Fall back to mock mode
        return generate_content_blocks(topic_id, strategy, visited_nodes)

    # Execute Claude's plan
    blocks = []
    groups = claude_plan.get("groups", [])

    for group_data in groups:
        group_id = _uid("grp")

        # Text block
        text = group_data.get("text")
        if text:
            text_block = {
                "id": _uid("text"),
                "type": "text",
                "content": text,
                "group_id": group_id,
                "group_role": group_data.get("group_role_text", "explanation"),
            }
            blocks.append(text_block)

        # Media block
        media_request = group_data.get("media_request")
        if media_request:
            media_type = media_request.get("type", "unsplash")
            media_data = _resolve_media(media_request, topic_label, api_clients)

            media_block = {
                "id": _uid(media_type),
                "type": media_type,
                "content": f"{topic_label} — {media_type} content",
                "group_id": group_id,
                "group_role": group_data.get("group_role_media", "visual"),
                "media": media_data,
            }
            blocks.append(media_block)

    # Next nodes from Claude's plan
    visited_set = set(visited_nodes or [])
    claude_next = claude_plan.get("next_nodes", [])
    next_nodes = []
    for nid in claude_next:
        if nid not in visited_set:
            node = get_node(nid)
            if node:
                next_nodes.append({"id": node["id"], "label": node["label"]})

    # If Claude didn't provide valid next nodes, fall back to graph
    if not next_nodes:
        main_topic = topic_id if topic_id in TOPIC_GRAPH else find_topic_for_node(topic_id)
        if main_topic:
            fallback_nodes = get_subtopic_nodes(main_topic, strategy, exclude=visited_set)
            next_nodes = [{"id": n["id"], "label": n["label"]} for n in fallback_nodes[:3]]

    return blocks, next_nodes


def generate_initial_content_live(topic_label, api_clients):
    """Generate initial content using Claude orchestration.

    Falls back to mock if Claude unavailable.
    """
    topic_id = slugify(topic_label)
    node = get_node(topic_id)

    if not node:
        node = {"id": topic_id, "label": topic_label, "description": f"Exploring {topic_label}"}

    strategy = "deeper"
    blocks, next_nodes = generate_content_blocks_live(
        topic_id=topic_id,
        strategy=strategy,
        visited_nodes=[],
        last_paragraph=None,
        engagement_score=0.7,
        api_clients=api_clients,
    )

    # Build initial graph
    graph = {
        "nodes": [{"id": node["id"], "label": node["label"]}],
        "edges": [],
    }
    for nn in next_nodes:
        if nn["id"] != node["id"]:
            graph["nodes"].append(nn)
            graph["edges"].append({"source": node["id"], "target": nn["id"]})

    return {
        "content_blocks": blocks,
        "graph": graph,
        "next_nodes": next_nodes,
        "strategy_used": strategy,
    }


# ── Validation ────────────────────────────────────────────────────────────

def validate_content_block(block):
    """Validate a single content block. Returns list of error strings."""
    errors = []
    if not isinstance(block, dict):
        return ["Block is not a dict"]

    required = ["id", "type", "content", "group_id", "group_role"]
    for key in required:
        if key not in block:
            errors.append(f"Missing key: {key}")

    if "type" in block:
        block_type = block["type"]
        if block_type == "text":
            if block.get("group_role") and block["group_role"] not in VALID_GROUP_ROLES_TEXT:
                errors.append(f"Invalid text group_role: {block['group_role']}")
        elif block_type in MEDIA_TYPES:
            if block.get("group_role") and block["group_role"] not in VALID_GROUP_ROLES_MEDIA:
                errors.append(f"Invalid media group_role: {block['group_role']}")
            if "media" not in block:
                errors.append("Media block missing 'media' key")
            elif not isinstance(block["media"], dict):
                errors.append("Media block 'media' is not a dict")
            else:
                if "url" not in block["media"]:
                    errors.append("Media block missing 'url'")
                if "source" not in block["media"]:
                    errors.append("Media block missing 'source'")
        else:
            errors.append(f"Unknown block type: {block_type}")

    return errors


def validate_response(response):
    """Validate a /api/generate response. Returns list of error strings."""
    errors = []
    if not isinstance(response, dict):
        return ["Response is not a dict"]

    required = ["content_blocks", "next_nodes", "strategy_used", "engagement_score"]
    for key in required:
        if key not in response:
            errors.append(f"Missing key: {key}")

    if "strategy_used" in response and response["strategy_used"] not in VALID_STRATEGIES:
        errors.append(f"Invalid strategy: {response['strategy_used']}")

    if "engagement_score" in response:
        score = response["engagement_score"]
        if not isinstance(score, (int, float)):
            errors.append("engagement_score is not a number")
        elif score < 0 or score > 1:
            errors.append(f"engagement_score out of range: {score}")

    if "content_blocks" in response:
        if not isinstance(response["content_blocks"], list):
            errors.append("content_blocks is not a list")
        else:
            for i, block in enumerate(response["content_blocks"]):
                block_errors = validate_content_block(block)
                for err in block_errors:
                    errors.append(f"content_blocks[{i}]: {err}")

    if "next_nodes" in response:
        if not isinstance(response["next_nodes"], list):
            errors.append("next_nodes is not a list")

    return errors


def validate_initial_response(response):
    """Validate a /api/initial response. Returns list of error strings."""
    errors = []
    if not isinstance(response, dict):
        return ["Response is not a dict"]

    required = ["content_blocks", "graph", "next_nodes", "strategy_used"]
    for key in required:
        if key not in response:
            errors.append(f"Missing key: {key}")

    if "strategy_used" in response and response["strategy_used"] != "deeper":
        errors.append(f"Initial strategy should be 'deeper', got: {response['strategy_used']}")

    if "graph" in response:
        graph = response["graph"]
        if not isinstance(graph, dict):
            errors.append("graph is not a dict")
        else:
            if "nodes" not in graph:
                errors.append("graph missing 'nodes'")
            elif not isinstance(graph["nodes"], list) or len(graph["nodes"]) == 0:
                errors.append("graph 'nodes' must be a non-empty list")
            if "edges" not in graph:
                errors.append("graph missing 'edges'")

    if "content_blocks" in response:
        if not isinstance(response["content_blocks"], list):
            errors.append("content_blocks is not a list")
        else:
            for i, block in enumerate(response["content_blocks"]):
                block_errors = validate_content_block(block)
                for err in block_errors:
                    errors.append(f"content_blocks[{i}]: {err}")

    if "next_nodes" in response:
        if not isinstance(response["next_nodes"], list):
            errors.append("next_nodes is not a list")

    return errors
