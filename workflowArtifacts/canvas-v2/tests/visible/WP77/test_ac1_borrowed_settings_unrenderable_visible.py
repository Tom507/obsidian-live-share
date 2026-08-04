# WP77 / AC1 — "the owner's `data.json` bytes are held in a value that refuses to render,
# and the refusal is a property of the TYPE rather than of any call site."
#
# The charter measured seven render vectors reaching `ports.BorrowState.original_bytes`.
# Six of them need nothing at all — no flag, no configuration — and the seventh needs
# `--showlocals`. Every one of them is asserted here, and every absence assertion is
# preceded IN THE SAME TEST by the positive control that the object really does hold the
# sentinel. An absence test over an object that never held the value passes trivially,
# which is the exact hollow-fixture class this run exists to sweep.
#
#   ├── T1  positive control + repr()
#   ├── T2  positive control + str()
#   ├── T3  positive control + format() / f-string
#   ├── T4  positive control + "%s" % (state,) — logging's lazy form
#   ├── T5  positive control + dataclasses.asdict() and every rendering of its result
#   ├── T6  positive control + a deliberately failed pytest comparison at -vv
#   ├── T7  positive control + traceback frame locals (--showlocals / capture_locals)
#   ├── T8  the refusals: __bytes__ / __iter__ / __contains__
#   ├── T9  the repair is the TYPE, not a handwritten __repr__ (structural)
#   └── T10 exactly one `Secret` class in the package, and relay's four names still resolve
#
# DATA SAFETY: every fixture is synthetic and under tmp_path. Every credential value is an
# obviously-fake sentinel literal. No file in either owner vault is read, opened, hashed or
# pointed at; no Obsidian is launched, no relay started, no socket opened.

from __future__ import annotations

import copy
import dataclasses
import json
import subprocess
import sys
import traceback
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

import _prerepair  # noqa: E402
from obsidian_e2e import constants, ports, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

# Obviously-synthetic literals. Chosen so a single leaked byte range is findable by
# substring, and so no real key name is ever paired with a real value.
SENTINELS = {
    "encryptionPassphrase": "SENTINEL-WP77-PASSPHRASE-DO-NOT-LEAK",
    "encryptionSalt": "SENTINEL-WP77-SALT-DO-NOT-LEAK",
    "jwt": "SENTINEL-WP77-JWT-DO-NOT-LEAK",
    "serverPassword": "SENTINEL-WP77-SERVERPW-DO-NOT-LEAK",
    "token": "SENTINEL-WP77-TOKEN-DO-NOT-LEAK",
}
ALL_SENTINELS = tuple(SENTINELS.values())

ORIGINAL_TEXT = "{\n" + ",\n".join(
    f'  "{key}": "{value}"' for key, value in SENTINELS.items()
) + "\n}\n"
ORIGINAL_BYTES = ORIGINAL_TEXT.encode("utf-8")


def make_vault(tmp_path: Path) -> Path:
    """A synthetic vault with a plugin directory and a settings file. Never a real one."""
    vault = tmp_path / "synthetic-vault"
    for owner in OWNER_VAULTS:
        assert owner.resolve() != vault.resolve()
        assert owner.resolve() not in vault.resolve().parents
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL_BYTES)
    return vault


@pytest.fixture()
def state(tmp_path: Path):
    """A real `BorrowState` produced by the real `capture_state` over a synthetic vault."""
    return ports.capture_state(make_vault(tmp_path))


def positive_control(borrow_state) -> None:
    """The object genuinely holds every sentinel. Asserted before EVERY absence claim.

    This is the whole difference between a test and a formality: `SENTINEL not in
    repr(state)` is also true when the field is `None`, when the fixture wrote a different
    key, and when `capture_state` silently returned the no-marker/no-original shape.
    """
    revealed = borrow_state.reveal_original_bytes()
    assert revealed is not None, "the fixture did not put any bytes in the object"
    assert revealed == ORIGINAL_BYTES
    for sentinel in ALL_SENTINELS:
        assert sentinel.encode("utf-8") in revealed
    assert borrow_state.had_original is True


def assert_no_sentinel(text: str, where: str) -> None:
    for sentinel in ALL_SENTINELS:
        assert sentinel not in text, f"{sentinel[:20]}… leaked through {where}"


# --- T1..T5: the five in-process unconditional vectors ----------------------------


def test_t1_repr_of_the_borrow_state_does_not_spell_the_settings_out(state) -> None:
    positive_control(state)
    rendered = repr(state)
    assert_no_sentinel(rendered, "repr(state)")
    # Not merely "the value is absent": the rendering says so.
    assert constants.REDACTED in rendered


def test_t2_str_of_the_borrow_state_does_not_spell_the_settings_out(state) -> None:
    positive_control(state)
    assert_no_sentinel(str(state), "str(state)")


def test_t3_format_and_f_string_do_not_spell_the_settings_out(state) -> None:
    positive_control(state)
    assert_no_sentinel(format(state), "format(state)")
    assert_no_sentinel(f"{state}", "f-string")
    assert_no_sentinel("{}".format(state), "str.format")
    assert_no_sentinel(f"{state.original_bytes}", "f-string over the field itself")
    assert_no_sentinel(f"{state.original_bytes!r}", "f-string with !r over the field")


def test_t4_percent_s_the_logging_lazy_form_does_not_spell_the_settings_out(state) -> None:
    positive_control(state)
    assert_no_sentinel("%s" % (state,), '"%s" % (state,)')
    assert_no_sentinel("%r" % (state,), '"%r" % (state,)')
    # The form a `logging` call actually takes: the record renders at emit time, long
    # after the call site was reviewed.
    import logging

    record = logging.LogRecord("wp77", logging.INFO, __file__, 0, "borrow=%s", (state,), None)
    assert_no_sentinel(record.getMessage(), "logging.LogRecord.getMessage()")


def test_t5_dataclasses_asdict_cannot_unwrap_the_value(state) -> None:
    positive_control(state)
    # `asdict` deep-copies every leaf; `Secret.__deepcopy__` hands the wrapper back, so
    # there is no unwrapped bytes object in the result at all.
    walked = dataclasses.asdict(state)
    assert walked["original_bytes"] is state.original_bytes
    assert not isinstance(walked["original_bytes"], (bytes, bytearray))
    assert_no_sentinel(repr(walked), "repr(dataclasses.asdict(state))")
    assert_no_sentinel(str(walked), "str(dataclasses.asdict(state))")
    assert_no_sentinel(json.dumps(walked, default=str), "json.dumps(asdict(state))")
    # copy.deepcopy directly, which is the primitive asdict is built on.
    assert copy.deepcopy(state.original_bytes) is state.original_bytes
    assert copy.copy(state.original_bytes) is state.original_bytes


# --- T6: the pytest assertion diff, at the verbosity that renders it in full -------

# The generated module must not contain the sentinel ANYWHERE in its own source, or the
# `-vv` output echoes the source line and the check reports its own fixture as the leak.
# So the fixture bytes are read from a file and the positive control is a sha256 over
# them — a hash, never a value. `--showlocals` is deliberately NOT passed here: a local
# holding deliberately-revealed bytes would render and would be a leak this test caused
# rather than one it found. The frame-locals vector has its own test (T7).
_FAILING_TEST = """
import hashlib
import sys

sys.path.insert(0, {tools!r})
from {package} import ports

ORIGINAL = open({fixture!r}, "rb").read()
EXPECTED_SHA = {sha!r}


def test_a_deliberately_failed_comparison_of_two_borrow_states():
    left = ports.BorrowState(
        has_marker=False, had_original=True, original_sha256="a",
        original_bytes=ORIGINAL, marker=None,
    )
    right = ports.BorrowState(
        has_marker=False, had_original=True, original_sha256="b",
        original_bytes=b"something else entirely", marker=None,
    )
    # positive control, expressed as a hash so no value is spelled in this source
    assert hashlib.sha256(
        getattr(left, "reveal_original_bytes", lambda: left.original_bytes)()
    ).hexdigest() == EXPECTED_SHA
    assert left == right
"""


def _run_failing_comparison(tmp_path: Path, tools_dir: str, package: str) -> str:
    import hashlib

    fixture = tmp_path / f"fixture_{package}.bin"
    fixture.write_bytes(ORIGINAL_BYTES)
    source = _FAILING_TEST.format(
        tools=tools_dir,
        package=package,
        fixture=str(fixture),
        sha=hashlib.sha256(ORIGINAL_BYTES).hexdigest(),
    )
    for sentinel in ALL_SENTINELS:
        assert sentinel not in source, "the generated test must not spell a sentinel"
    script = tmp_path / f"test_wp77_failing_{package}.py"
    script.write_text(source, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(script), "-vv", "-p", "no:cacheprovider",
         "--rootdir", str(tmp_path)],
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert result.returncode == 1, (
        "the comparison was supposed to FAIL and be rendered; got "
        f"exit {result.returncode}"
    )
    return result.stdout + result.stderr


def test_t6_a_failed_pytest_comparison_at_dash_vv_does_not_spell_the_settings_out(
    tmp_path: Path,
) -> None:
    # Positive control on the "before" side, in this same test: the identical harness over
    # a byte copy of the pre-repair code DOES render the sentinel, so this vector is real
    # and the assertion below is not passing because pytest never printed anything.
    before = _run_failing_comparison(
        tmp_path, _prerepair.package_root(), _prerepair.PACKAGE_NAME
    )
    assert ALL_SENTINELS[0] in before, "the pre-repair harness did not reproduce the leak"

    after = _run_failing_comparison(tmp_path, str(_TOOLS), "obsidian_e2e")
    assert "BorrowState(" in after, "the assertion diff did not render the record at all"
    assert constants.REDACTED in after
    assert_no_sentinel(after, "pytest assertion diff at -vv")


# --- T7: the one conditional vector -----------------------------------------------


def test_t7_traceback_frame_locals_do_not_spell_the_settings_out(state) -> None:
    positive_control(state)

    def raises_with_the_state_in_its_frame(borrow_state):
        marker = borrow_state  # noqa: F841 — the point is that it is a frame local
        raise RuntimeError("a failure inside a frame that holds the borrow state")

    try:
        raises_with_the_state_in_its_frame(state)
    except RuntimeError as err:
        rendered = "".join(
            traceback.TracebackException(
                type(err), err, err.__traceback__, capture_locals=True
            ).format()
        )
    assert "raises_with_the_state_in_its_frame" in rendered  # the frame really was captured
    assert "marker" in rendered  # and its locals really were rendered
    assert_no_sentinel(rendered, "traceback frame locals (capture_locals=True)")


# --- T8: nothing can spell the value out one piece at a time -----------------------


def test_t8_the_wrapper_refuses_to_be_encoded_iterated_or_membership_tested(state) -> None:
    positive_control(state)
    held = state.original_bytes
    with pytest.raises(TypeError):
        bytes(held)
    with pytest.raises(TypeError):
        list(held)
    with pytest.raises(TypeError):
        b"x" in held  # noqa: B015
    with pytest.raises(TypeError):
        b"".join(held)


# --- T9: the repair is the type, and demonstrably not a handwritten repr ----------


def test_t9_the_generated_dataclass_repr_is_still_in_place_and_is_safe_anyway(
    state,
) -> None:
    """AC1's central claim, made structural.

    `provisioning._CommunityState` is the counter-example: `repr=False` plus a handwritten
    `__repr__` closes `repr()` and `dataclasses.asdict` walks straight past it. So this
    asserts that `BorrowState` did NOT take that route — the dataclass still synthesises
    its own repr, and that synthesised repr is safe because of what the FIELD is.
    """
    positive_control(state)
    assert ports.BorrowState.__dataclass_params__.repr is True
    # The generated repr is `reprlib.recursive_repr`-wrapped and its code object comes out
    # of the stdlib's `dataclasses` module. A handwritten one has neither property — as
    # `provisioning._CommunityState.__repr__` demonstrates, right here, for contrast.
    assert hasattr(ports.BorrowState.__repr__, "__wrapped__")
    assert ports.BorrowState.__repr__.__code__.co_filename.endswith("dataclasses.py")
    from obsidian_e2e import provisioning as _prov

    assert not hasattr(_prov._CommunityState.__repr__, "__wrapped__")
    assert isinstance(state.original_bytes, constants.Secret)
    field_types = {f.name: f.type for f in dataclasses.fields(ports.BorrowState)}
    assert "Secret" in str(field_types["original_bytes"])
    # And the accessor is the only way out, so the legitimate uses stay greppable.
    assert state.reveal_original_bytes() == ORIGINAL_BYTES


# --- T10: one Secret class in the package; relay's names still resolve ------------


def test_t10_there_is_exactly_one_secret_class_and_relay_still_re_exports_it() -> None:
    sources = sorted((_TOOLS / "obsidian_e2e").glob("*.py"))
    definitions = [
        path.name
        for path in sources
        if any(
            line.startswith("class Secret") or line.startswith("class RedactedMapping")
            for line in path.read_text(encoding="utf-8").splitlines()
        )
    ]
    assert definitions == ["constants.py"], definitions

    assert relay.Secret is constants.Secret
    assert relay.RedactedMapping is constants.RedactedMapping
    assert relay.REDACTED is constants.REDACTED
    assert relay.SECRET_BEARING_KEYS is constants.SECRET_SETTINGS_KEYS
    assert constants.RedactedMapping.SECRET_KEYS is constants.SECRET_SETTINGS_KEYS
    assert [name for name in relay.__all__ if not hasattr(relay, name)] == []

    # The relocation did not move the drift guard's teeth: it still fails at import.
    assert constants.SETTINGS_TOKEN_KEY in constants.PROVISIONED_SETTINGS_KEYS
    assert not set(constants.CREDENTIAL_SETTINGS_KEYS) & set(
        constants.PROVISIONED_SETTINGS_KEYS
    )


def test_t10b_ports_does_not_import_relay_and_gains_no_runtime_dependency() -> None:
    source = (_TOOLS / "obsidian_e2e" / "ports.py").read_text(encoding="utf-8")
    assert "import relay" not in source
    assert "from .relay" not in source
    # The module docstring's structural claim, checked over the CODE rather than the
    # text: the docstring itself says the words "os.environ", so a substring search
    # would report a leak that is a sentence about not having one.
    import ast

    tree = ast.parse(source)
    environ_reads = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and node.attr == "environ"
        and isinstance(node.value, ast.Name)
        and node.value.id == "os"
    ]
    assert environ_reads == []
    imports = [
        line.strip()
        for line in source.splitlines()
        if line.startswith("import ") or line.startswith("from ")
    ]
    assert imports == [
        "from __future__ import annotations",
        "import hashlib",
        "import json",
        "import os",
        "import secrets",
        "from dataclasses import dataclass",
        "from datetime import datetime, timezone",
        "from pathlib import Path",
        "from typing import Mapping, Optional, Union",
        "from . import constants",
        "from .constants import RedactedMapping, Secret",
    ], imports
