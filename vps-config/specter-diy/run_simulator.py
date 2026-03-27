import sys
sys.path.append('./src')
sys.path.append('./f469-disco/libs/common')
sys.path.append('./f469-disco/libs/unix')
sys.path.append('./f469-disco/usermods/udisplay_f469/display_unixport')

# Pre-import ALL deep modules to avoid recursion depth issues
# Import from leaves to roots
import hashlib
import microur.util.xoshiro256
import microur.util.random_sampler
import microur.util.fountain
import microur.util.ur
import microur.util.bytewords
import microur.encoder
import microur.decoder

import main
main.main()
