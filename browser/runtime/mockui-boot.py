# Browser entry for the Playground repositories' own MockUI firmware scenario.
import sys
sys.path.insert(0, '/browser')
try:
    sys.setrecursionlimit(256)
except AttributeError:
    pass
import main
