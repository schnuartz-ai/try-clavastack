#!/usr/bin/env python3
"""Optional companion-demo QR bridge; never needed for A/B firmware builds."""
import ast
from pathlib import Path
import sys


def _shape(statement):
    return ast.dump(ast.parse(statement).body[0], include_attributes=False)


def _one(nodes, description):
    nodes = list(nodes)
    if len(nodes) != 1:
        raise RuntimeError("Unsupported companion QR bridge: %s (%d matches)"
                           % (description, len(nodes)))
    return nodes[0]


def _statement(nodes, expression, description):
    shape = _shape(expression)
    return _one((node for node in nodes
                 if ast.dump(node, include_attributes=False) == shape), description)


def instrument_qr(data):
    """Insert the bridge at semantic statements, preserving surrounding guards.

    Unknown layouts fail closed in companion-demo builds, not in A/B builds.
    Do not scan arbitrary print calls or forward a sensitive QR payload.
    """
    markers = ("SIMULATOR_QR_OUTPUT:", "SIMULATOR_QR_CLEAR:")
    if any(marker in data for marker in markers):
        if all(data.count(marker) == 1 for marker in markers) and \
                "self._simulator_qr_token = " in data:
            return data
        raise RuntimeError("Partially instrumented companion QR bridge")
    tree = ast.parse(data)
    cls = _one((n for n in tree.body
                if isinstance(n, ast.ClassDef) and n.name == "QRCode"), "QRCode class")
    methods = {n.name: n for n in cls.body if isinstance(n, ast.FunctionDef)}
    init = methods.get("__init__")
    callback = methods.get("cb")
    if init is None or callback is None:
        raise RuntimeError("Unsupported companion QR lifecycle")
    init_stmt = _statement(init.body, "super().__init__(*args, **kwargs)", "QR constructor")
    delete = _one((n for n in callback.body if isinstance(n, ast.If)
                   and ast.dump(n.test) == ast.dump(ast.parse("event == lv.EVENT.DELETE", mode="eval").body)),
                  "QR deletion branch")
    cancel = _statement(delete.body, "self.task.cancel()", "QR deletion")
    # The original renderer prints directly; newer versions may guard the
    # print or delegate public reporting to a separate helper.
    reporting = [methods[name] for name in ("_set_text", "_report_public_text")
                 if name in methods]
    report = _statement((n for method in reporting for n in ast.walk(method)
                         if isinstance(n, ast.Expr)),
                        "print(text)", "QR reporting")
    lines = data.splitlines(keepends=True)
    edits = []
    def before(node, code):
        indent = " " * node.col_offset
        edits.append((node.lineno - 1, node.lineno - 1,
                      "".join(indent + line + "\n" for line in code)))
    def after(node, code):
        indent = " " * node.col_offset
        edits.append((node.end_lineno, node.end_lineno,
                      "".join(indent + line + "\n" for line in code)))
    after(init_stmt, ['self._simulator_qr_token = str(id(self)) if platform.simulator else ""'])
    before(cancel, ['if platform.simulator:',
                    '    print("SIMULATOR_QR_CLEAR:" + self._simulator_qr_token)'])
    indent = " " * report.col_offset
    # Reject inline statements: the line replacement must not remove other code.
    if report.lineno != report.end_lineno or lines[report.lineno - 1].strip() != "print(text)":
        raise RuntimeError("Unsupported inline QR reporting statement")
    edits.append((report.lineno - 1, report.end_lineno, "".join(
        indent + line + "\n" for line in (
            'if not getattr(self, "sensitive", False):',
            '    if platform.simulator:',
            '        if text != "Text":',
            '            print("SIMULATOR_QR_OUTPUT:" + self._simulator_qr_token + ":" + str(text))',
            '    else:',
            '        print(text)',
        ))))
    for start, end, replacement in sorted(edits, reverse=True):
        lines[start:end] = [replacement]
    result = "".join(lines)
    ast.parse(result)
    return result


if __name__ == "__main__":
    target = Path(sys.argv[1]).resolve() / "src/gui/components/qrcode.py"
    data = target.read_text()
    updated = instrument_qr(data)
    if updated != data:
        target.write_text(updated)
