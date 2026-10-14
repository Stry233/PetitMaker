# Video container fixtures

Each file holds a few frames of ffmpeg's synthetic `testsrc2` pattern at 64×64 and 30 frames per second, encoded so the planet-scan demuxer meets the container layouts that screen and phone recordings use. `expected.json` records, for every file, the ffmpeg command that produced it, the codec and sample-entry tag, the frame size, and each video packet's byte offset, size, presentation time in microseconds and key flag in decode order, as ffprobe reads them. The tests compare the demuxer against that record, so the files and `expected.json` change together.

- `avc-bframes.mp4`: 20 frames of H.264 with two B-frames and the movie header after the media data, as desktop recorders write it.
- `avc-faststart.mov`: 12 frames of H.264 without B-frames in a QuickTime file with the movie header first, as phones write it.
- `avc-fragmented.mp4`: 16 frames of H.264 with B-frames in a fragmented MP4 with an empty initial movie header.
- `hevc.mp4`: 8 frames of HEVC with the `hvc1` sample entry and two B-frames.
- `av1.mp4`: 6 frames of AV1.
- `vp9.mp4`: 6 frames of VP9.
