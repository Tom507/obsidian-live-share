# WP44 / AC2 (blind 2) — byte-exactness as a property, over random bytes.
#
# Angle: the previous sets use JSON that a human wrote. Here the originals are
# generated from a seeded PRNG: random key order, random indentation, random line
# endings, random unicode, random whitespace runs. No hand-picked shape can be
# special-cased, and the seed makes every failure reproducible. No Math.random /
# unseeded randomness anywhere.

from __future__ import annotations

import hashlib
import json
import random
import sys
from pathlib import Path

import pytest

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

ALPHABET = "abcdefghijklmnopqrstuvwxyzÄÖÜäöüß—✓日本語"


def generated_original(seed: int) -> bytes:
    rng = random.Random(seed)
    keys = [
        "serverUrl",
        "serverPassword",
        "roomId",
        "clientId",
        "role",
        "debug",
        "reconnectDelay",
    ]
    rng.shuffle(keys)
    values = {
        "serverUrl": "wss://example.invalid/ws-mux/",
        "serverPassword": "FAKE-PW-BLIND2-" + str(seed),
        "roomId": "".join(rng.choice(ALPHABET) for _ in range(rng.randint(3, 12))),
        "clientId": "".join(rng.choice(ALPHABET) for _ in range(rng.randint(3, 12))),
        "role": rng.choice(["host", "guest"]),
        "debug": rng.choice([True, False]),
        "reconnectDelay": rng.choice([500, 1000, 2500]),
    }
    indent = rng.choice(["\t", " ", "  ", "   ", "    "])
    lines = ["{"]
    for i, key in enumerate(keys):
        comma = "," if i < len(keys) - 1 else ""
        padding = " " * rng.randint(0, 3)
        lines.append(f"{indent}{json.dumps(key)}{padding}: {json.dumps(values[key])}{comma}")
    lines.append("}")
    newline = rng.choice(["\n", "\r\n"])
    blob = newline.join(lines).encode("utf-8")
    if rng.random() < 0.5:
        blob += newline.encode("utf-8")
    return blob


SEEDS = [0xC0FFEE, 0xBADF00D, 0x1A2B3C, 7, 13, 99991, 0xFEEDFACE, 424242]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.mark.parametrize("seed", SEEDS)
def test_a_generated_original_survives_the_cycle_byte_for_byte(
    tmp_path: Path, seed: int
) -> None:
    original = generated_original(seed)
    vault = tmp_path / f"v-{seed:x}"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    settings_path = vault / constants.PLUGIN_DATA_REL
    settings_path.write_bytes(original)

    ports.provision_port(vault, constants.ROLE_B)
    assert settings_path.read_bytes() != original  # the borrow really happened

    ports.restore_port(vault)

    restored = settings_path.read_bytes()
    assert len(restored) == len(original), f"seed {seed:#x}: length"
    assert sha(restored) == sha(original), f"seed {seed:#x}: sha256"
    assert restored == original, f"seed {seed:#x}: bytes"


@pytest.mark.parametrize("seed", SEEDS)
def test_the_generator_is_deterministic_and_parses(seed: int) -> None:
    # A property test is only useful if the corpus is reproducible and legal.
    assert generated_original(seed) == generated_original(seed)
    parsed = json.loads(generated_original(seed).decode("utf-8"))
    assert isinstance(parsed, dict)
    assert constants.SETTINGS_PORT_KEY not in parsed


def test_no_two_seeds_produce_the_same_file() -> None:
    blobs = {sha(generated_original(seed)) for seed in SEEDS}
    assert len(blobs) == len(SEEDS)


def test_the_whole_corpus_in_one_vault_sequence(tmp_path: Path) -> None:
    # The same vault, its settings file replaced between runs: each run must
    # restore the file that was there when THAT run started.
    vault = tmp_path / "v-sequence"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    settings_path = vault / constants.PLUGIN_DATA_REL

    for seed in SEEDS:
        original = generated_original(seed)
        settings_path.write_bytes(original)
        ports.provision_port(vault, constants.ROLE_A)
        ports.restore_port(vault)
        assert settings_path.read_bytes() == original, f"seed {seed:#x}"
