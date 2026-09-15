import sys
sys.path.insert(0, '/browser')
import gc
import display
import lvgl as lv
import utime as time
display.init(False)
screen = lv.obj()
button = lv.button(screen)
button.set_pos(0, 0)
button.set_size(120, 120)

def pressed(event):
    print('PROBE_CALLBACK_BEFORE_GC')
    gc.collect()
    print('PROBE_CALLBACK_AFTER_GC')

button.add_event_cb(pressed, lv.EVENT.PRESSED, None)
lv.screen_load(screen)
print('MOCKUI_READY')
for i in range(100):
    display.update(30)
    time.sleep_ms(30)
print('PROBE_DONE')
