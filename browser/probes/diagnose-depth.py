import sys, micropython
print('HAS_SETRECURSIONLIMIT', hasattr(sys, 'setrecursionlimit'))
def recurse(n):
    print('DEPTH', n)
    micropython.mem_info()
    if n == 150:
        return n
    return recurse(n + 1)
try:
    print('RETURN', recurse(0))
except Exception as e:
    print('PYTHON_CAUGHT', repr(e))
print('PROBE_DONE')
