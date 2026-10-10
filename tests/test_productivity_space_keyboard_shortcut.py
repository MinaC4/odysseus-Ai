import json
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_space_shortcut_resolves_editors_inside_shadow_dom():
    if not shutil.which("node"):
        pytest.skip("node binary not on PATH")
    module = (ROOT / "static/js/composed-event.js").as_uri()
    script = textwrap.dedent(
        f"""
        import {{ composedContains, composedTarget }} from {json.dumps(module)};
        const host = {{ getRootNode: () => ({{}}) }};
        const editor = {{ getRootNode: () => ({{ host }}) }};
        const surface = {{ contains: node => node === host }};
        const event = {{ target: host, composedPath: () => [editor, host] }};
        console.log(JSON.stringify({{
          deepTarget: composedTarget(event) === editor,
          insideHoveredWindow: composedContains(surface, editor),
        }}));
        """
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
        timeout=15,
    )
    assert json.loads(result.stdout) == {
        "deepTarget": True,
        "insideHoveredWindow": True,
    }

    ui = (ROOT / "static/js/ui.js").read_text()
    blocked = ui.split("function _spaceIsBlocked(e, surface) {", 1)[1].split("\n}", 1)[0]
    assert "composedTarget(e)" in blocked
    assert "composedContains(surface, target)" in blocked
