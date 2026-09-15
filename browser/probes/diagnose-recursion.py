import sys, gc, micropython
print('HAS_SETRECURSIONLIMIT', hasattr(sys, 'setrecursionlimit'))
print('IMPLEMENTATION', sys.implementation)
micropython.mem_info()
depth = 0
def recurse(n):
    global depth
    depth = n
    if n % 100 == 0:
        print('DEPTH', n)
    return recurse(n + 1)
try:
    recurse(0)
except Exception as e:
    print('PYTHON_CAUGHT', depth, repr(e))
print('PROBE_DONE')
