#!/usr/bin/env python3
"""Fail closed: the retired VNC allocator/restart API must not be started."""

import sys


def main():
    print("This legacy VNC service is disabled. See SETUP.md.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
