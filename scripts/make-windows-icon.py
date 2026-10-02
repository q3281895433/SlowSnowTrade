"""Package the existing PNG into a multi-resolution Windows ICO (macOS sips)."""
from pathlib import Path
import struct
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
source = root / 'SlowSnowTrade/Web/assets/app-icon.png'
target = root / 'packaging/AppIcon.ico'
sizes = [16, 24, 32, 48, 64, 128, 256]
images = []
with tempfile.TemporaryDirectory() as folder:
    for size in sizes:
        png = Path(folder) / f'{size}.png'
        subprocess.run(['sips', '-z', str(size), str(size), str(source), '--out', str(png)], check=True, stdout=subprocess.DEVNULL)
        images.append(png.read_bytes())
offset = 6 + 16 * len(images)
entries = []
for size, data in zip(sizes, images):
    entries.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(struct.pack('<HHH', 0, 1, len(images)) + b''.join(entries) + b''.join(images))
print(target)
