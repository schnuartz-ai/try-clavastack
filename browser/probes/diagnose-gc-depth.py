import sys, gc, micropython, display
sys.path.insert(0, '/browser')
import lvgl as lv
import utime as time
display.init(False)
print('PROBE_INITIALIZED')
def descend(n):
    if n:
        return descend(n - 1)
    print('GC_LEAF')
    micropython.mem_info()
    gc.collect()
    print('GC_RETURNED')
for depth in (0, 5, 10, 15, 20):
    print('TEST_DEPTH', depth)
    try:
        descend(depth)
    except Exception as e:
        print('PYTHON_CAUGHT', repr(e))
    display.update(30)
    time.sleep_ms(30)
print('PROBE_DONE')
