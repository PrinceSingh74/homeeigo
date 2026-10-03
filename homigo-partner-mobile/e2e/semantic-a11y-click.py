"""
Section 04 cert helper — Java UiObject.click() via selector (ACTION_CLICK).

Do not use Device.click(x, y): that is a coordinate tap and hits LogBox overlays.
"""
from __future__ import annotations

import sys

try:
    import uiautomator2 as u2
except ImportError:
    print("MISSING_U2")
    sys.exit(3)


def a11y_click(obj) -> None:
    obj.must_wait(timeout=5.0)
    # jsonrpc.click(Selector) maps to Android UiObject.click() → ACTION_CLICK
    obj.jsonrpc.click(obj.selector)


def dismiss_logbox(d) -> None:
    for sel in (
        d(description="Dismiss"),
        d(text="Dismiss"),
        d(textContains="Open debugger"),
    ):
        if sel.exists:
            try:
                a11y_click(sel)
            except Exception:
                pass
            break


def resolve(d, kind: str, value: str):
    if kind == "id":
        obj = d(resourceId=value)
        if not obj.exists:
            obj = d(resourceIdMatches=rf".*:id/{value}$")
        return obj
    if kind == "desc":
        obj = d(description=value)
        if not obj.exists:
            obj = d(descriptionContains=value)
        return obj
    if kind == "text":
        obj = d(text=value)
        if not obj.exists:
            obj = d(textContains=value)
        return obj
    return None


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: semantic-a11y-click.py <serial> <id|desc|text> <value>")
        return 2
    serial, kind, value = sys.argv[1], sys.argv[2], sys.argv[3]
    d = u2.connect(serial if serial != "default" else None)
    d.implicitly_wait(5.0)
    dismiss_logbox(d)
    obj = resolve(d, kind, value)
    if obj is None:
        print("BAD_KIND")
        return 2
    if not obj.exists:
        print("NOT_FOUND")
        return 2
    info = obj.info
    print(
        "TARGET",
        info.get("className"),
        info.get("resourceName") or info.get("resourceId"),
        info.get("contentDescription"),
        info.get("clickable"),
    )
    try:
        a11y_click(obj)
    except TypeError:
        # Older atx-agent: click only accepts coordinates — refuse rather than fake.
        print("NO_SELECTOR_CLICK")
        return 4
    print("CLICKED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
