"""Convert the newest recorded .webm in out/ to demo/TrustLens-demo.mp4 (H.264, plays everywhere).

Uses imageio-ffmpeg's bundled ffmpeg: pip install imageio-ffmpeg
"""
import subprocess
from pathlib import Path

import imageio_ffmpeg

here = Path(__file__).resolve().parent
src = max((here / "out").glob("*.webm"), key=lambda p: p.stat().st_mtime)
dst = here.parent / "TrustLens-demo.mp4"
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(src), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-crf", "20", "-preset", "medium", "-movflags", "+faststart", str(dst)], check=True)
print(dst)
