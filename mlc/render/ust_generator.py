# Melon Synth — MLC Engine
# Copyright (C) 2026 Abinaash (MilkmanAbi)
# SPDX-License-Identifier: GPL-3.0-or-later
# https://github.com/MilkmanAbi/Melon-Synth

"""
UST Generator — Melon Synth → OpenUTAU .ust
============================================
Generates proper UTAU Sequence Text (.ust) files from Melon Synth project data.

UST format reference (from OpenUTAU source OpenUtau.Core/Classic/Ust.cs + UstNote.cs):

  [#SETTING]
  Tempo=BPM
  Tracks=1
  ProjectName=name
  VoiceDir=%voice%     (OpenUTAU auto-sets this when opening)
  OutFile=%output%.wav
  CacheDir=%cache%
  Tool1=wavtool.exe
  Tool2=
  Flags=

  [#0000]
  Length=480           (in ticks; 480 = 1 quarter note at resolution 480)
  Lyric=phoneme
  NoteNum=60           (MIDI note number; 60=C4)
  PreUtterance=
  Velocity=100         (0-200; consonant velocity/pre-phoneme timing)
  Intensity=100        (0-200; volume/loudness)
  Modulation=0         (0-100; vibrato depth)
  Tempo=BPM            (optional per-note tempo override)
  Flags=gXX BXX HXX PXX   (OpenUTAU expression flags)
  PBS=-50;0            (pitch bend start: X ms;Y cents)
  PBW=100,100          (pitch bend widths in ms)
  PBY=0,0              (pitch bend Y values in cents)
  PBM=,                (pitch bend modes: ''=cubic, 's'=linear, 'r'=r-curve, 'j'=j-curve)
  VBR=length,period,depth,fadeIn,fadeOut,shift,drift

  [#TRACKEND]

Expression flags (from OpenUTAU USTx.cs AddDefaultExpressions):
  g  = gender      -100 to +100  (g0 = neutral, g-10 = more feminine, g10 = more masculine)
  B  = breathiness 0 to 100      (B0 = no breath, B50 = half breathiness)
  H  = lowpass     0 to 100      (H0 = no filter, H50 = half lowpass)
  P  = normalize   0 to 100      (P86 = default normalize level)

Credit: OpenUTAU by stakira (MIT License) — https://github.com/stakira/OpenUtau
"""

from __future__ import annotations
import math
import os
import tempfile
from pathlib import Path
from typing import Optional

# UTAU resolution: 480 ticks = 1 quarter note (standard for UTAU/OpenUTAU)
UTAU_RESOLUTION = 480


def beats_to_ticks(beats: float, resolution: int = UTAU_RESOLUTION) -> int:
    """Convert beat position (float) to UTAU ticks (int)."""
    return round(beats * resolution)


def midi_to_utau(midi: int) -> int:
    """
    Convert MIDI note number to UTAU note number.
    OpenUTAU uses the same numbering as MIDI: 60 = C4.
    """
    return midi  # They're identical


def build_flags(gender: int = 0, breathiness: int = 0,
                lowpass: int = 0, normalize: int = 86,
                extra_flags: str = '') -> str:
    """
    Build an OpenUTAU flags string from individual expression values.

    gender:      -100 to +100 → "gXX" (negative = more feminine)
    breathiness: 0 to 100     → "BXX"
    lowpass:     0 to 100     → "HXX" (0 = no filter; high = muffled)
    normalize:   0 to 100     → "PXX" (default 86)
    extra_flags: any raw flag string to append

    OpenUTAU reads these as flag name + value, e.g. "g-5B30P86"
    """
    parts = []

    # Gender: only include if non-zero
    if gender != 0:
        parts.append(f'g{int(gender):+d}'.replace('+', '').replace('-', '-'))
        # actually: g followed by the signed integer
        parts[-1] = f'g{int(gender)}'

    # Breathiness: only include if non-zero
    if breathiness > 0:
        parts.append(f'B{int(breathiness)}')

    # Lowpass: only include if non-zero
    if lowpass > 0:
        parts.append(f'H{int(lowpass)}')

    # Normalize: always include unless default (86)
    if normalize != 86:
        parts.append(f'P{int(normalize)}')

    if extra_flags:
        parts.append(extra_flags.strip())

    return ''.join(parts)


def build_pitch_bend(pitch_points: list[dict], note_start_beats: float,
                     note_dur_beats: float, bpm: float) -> dict:
    """
    Convert Melon Synth pitch points to OpenUTAU PBS/PBW/PBY/PBM format.

    pitch_points: list of {x: beats, y: semitones} relative to the note
    Returns dict with pbs, pbw, pby, pbm strings (or empty strings if no bend)

    OpenUTAU PBS format: "startX;startY" where X is in ms from note start,
    Y is in cents (100 per semitone).
    PBW: comma-separated widths in ms
    PBY: comma-separated Y values in cents at each point
    PBM: comma-separated mode chars ('', 's', 'r', 'j')
    """
    if not pitch_points:
        return {'pbs': '', 'pbw': '', 'pby': '', 'pbm': ''}

    # Convert beats to ms
    ms_per_beat = 60000.0 / bpm
    note_start_ms = note_start_beats * ms_per_beat

    # Filter points that belong to this note
    pts = sorted([p for p in pitch_points if
                  abs(p['x'] - note_start_beats) < note_dur_beats + 0.01],
                 key=lambda p: p['x'])

    if len(pts) < 2:
        return {'pbs': '', 'pbw': '', 'pby': '', 'pbm': ''}

    # First point = PBS
    p0 = pts[0]
    p0_ms = (p0['x'] - note_start_beats) * ms_per_beat
    p0_cents = p0['y'] * 100  # semitones → cents

    pbs = f'{p0_ms:.1f};{p0_cents:.1f}'

    # Subsequent points → PBW, PBY
    pbw_parts = []
    pby_parts = []
    pbm_parts = []
    prev_ms = p0_ms

    for pt in pts[1:]:
        pt_ms = (pt['x'] - note_start_beats) * ms_per_beat
        width = pt_ms - prev_ms
        pbw_parts.append(f'{width:.1f}')
        pby_parts.append(f'{pt["y"] * 100:.1f}')
        pbm_parts.append('')  # default cubic
        prev_ms = pt_ms

    return {
        'pbs': pbs,
        'pbw': ','.join(pbw_parts),
        'pby': ','.join(pby_parts),
        'pbm': ','.join(pbm_parts),
    }


def build_vibrato(vibrato: Optional[dict]) -> str:
    """
    Serialize a vibrato dict to OpenUTAU VBR format.
    VBR=length,period,depth,fadeIn,fadeOut,shift,drift

    From OpenUTAU source (UstNote.WriteVibrato):
      length:  0-100 (% of note duration covered by vibrato)
      period:  50-500 ms per cycle
      depth:   0-200 cents peak-to-peak
      fadeIn:  0-100 (% of vibrato length for fade-in)
      fadeOut: 0-100 (% of vibrato length for fade-out)
      shift:   -100 to 100 (phase shift)
      drift:   -100 to 100 (pitch drift over vibrato)
    """
    if not vibrato or not vibrato.get('length', 0):
        return ''

    v = vibrato
    return (f"{v.get('length',0)},{v.get('period',200)},{v.get('depth',30)},"
            f"{v.get('fadeIn',20)},{v.get('fadeOut',20)},"
            f"{v.get('shift',0)},{v.get('drift',0)}")


def generate_ust(
    notes:        list[dict],
    bpm:          float,
    voice_dir:    Optional[str]   = None,
    project_name: str             = 'melon_synth_render',
    track_params: Optional[dict]  = None,
    pitch_points: Optional[list]  = None,
    out_wav:      Optional[str]   = None,
) -> str:
    """
    Generate a complete .ust file content string.

    notes: list of dicts with:
      id, pitch (MIDI), start (beats), duration (beats), lyric (str),
      phoneme (optional MLC phoneme), velocity (0-200), expressions (dict),
      vibrato (dict or None), pitchBend (list of {x,y})

    track_params: dict with voice-level params:
      gender (0-100), breathiness (0-100), tension (0-100), pitch_range (0-100)

    Returns the full .ust file content as a string.
    """
    tp = track_params or {}

    # Map Melon Synth 0-100 voice params to OpenUTAU flag values
    # gender: Melon Synth 0 (feminine) to 100 (masculine) → UTAU g-50 to g50
    gender_flag = int((tp.get('gender', 30) - 50))  # 30 → g-20

    # breathiness: direct map 0-100 → B0 to B100
    breathiness_flag = int(tp.get('breathiness', 40))

    # tension mapped to lowpass filter (H flag): higher tension = less lowpass
    # tension 65 (default) → H0 (no filter)
    lowpass_flag = max(0, int((100 - tp.get('tension', 65)) * 0.3))

    lines = []

    # ── SETTING block ─────────────────────────────────────────────────────────
    lines.append('[#SETTING]')
    lines.append(f'Tempo={bpm:.2f}')
    lines.append('Tracks=1')
    lines.append(f'ProjectName={project_name}')
    if voice_dir:
        lines.append(f'VoiceDir={voice_dir}')
    else:
        lines.append('VoiceDir=%voice%')
    lines.append(f'OutFile={out_wav or "%output%.wav"}')
    lines.append('CacheDir=%cache%')
    lines.append('Tool1=wavtool.exe')
    lines.append('Tool2=')
    # Global flags from track parameters
    global_flags = build_flags(
        gender=gender_flag,
        breathiness=breathiness_flag,
        lowpass=lowpass_flag,
    )
    lines.append(f'Flags={global_flags}')
    lines.append('')

    # ── Sort notes by start time ──────────────────────────────────────────────
    sorted_notes = sorted(notes, key=lambda n: n['start'])

    # ── Note blocks ───────────────────────────────────────────────────────────
    for idx, note in enumerate(sorted_notes):
        header = f'[#{idx:04d}]'
        lines.append(header)

        # Duration in ticks
        dur_ticks = beats_to_ticks(note['duration'])
        lines.append(f'Length={dur_ticks}')

        # Lyric: prefer MLC phoneme if available, else the display lyric
        lyric = note.get('phoneme') or note.get('lyric') or 'a'
        lines.append(f'Lyric={lyric}')

        # Note number (MIDI → UTAU, same numbering)
        lines.append(f'NoteNum={midi_to_utau(note["pitch"])}')
        lines.append('PreUtterance=')

        # Per-note expressions (from NoteExpressions)
        expr = note.get('expressions', {})
        velocity  = int(expr.get('velocity',   100))
        intensity = int(expr.get('intensity',  100))
        modulation = int(expr.get('modulation', 0))

        lines.append(f'Velocity={velocity}')
        lines.append(f'Intensity={intensity}')
        if modulation != 0:
            lines.append(f'Modulation={modulation}')

        # Per-note flag overrides (breathiness/gender can differ from track defaults)
        note_breath = expr.get('breathiness', -1)  # -1 = use track default
        note_gender = expr.get('tension',     -1)

        note_flags = note.get('flags', '')
        if note_breath >= 0 or note_flags:
            per_note_flags = build_flags(
                gender=int((note.get('gender', tp.get('gender', 30)) - 50)),
                breathiness=int(note_breath if note_breath >= 0 else breathiness_flag),
                lowpass=lowpass_flag,
            )
            if per_note_flags or note_flags:
                lines.append(f'Flags={per_note_flags}{note_flags}')

        # Pitch bend
        note_pitch_points = []
        if pitch_points:
            note_pitch_points = [p for p in pitch_points
                                 if p.get('noteId') == note.get('id')]
        note_bend_data = note.get('pitchBend', [])
        # Convert note-level pitchBend to absolute beat positions
        abs_bend = [{'x': note['start'] + pb['x'] * note['duration'],
                     'y': pb['y']}
                    for pb in note_bend_data]
        all_points = note_pitch_points + abs_bend

        if all_points:
            pb = build_pitch_bend(all_points, note['start'], note['duration'], bpm)
            if pb['pbs']:
                lines.append(f'PBS={pb["pbs"]}')
                if pb['pbw']:
                    lines.append(f'PBW={pb["pbw"]}')
                    lines.append(f'PBY={pb["pby"]}')
                    lines.append(f'PBM={pb["pbm"]}')

        # Vibrato
        vbr = build_vibrato(note.get('vibrato'))
        if vbr:
            lines.append(f'VBR={vbr}')

        lines.append('')

    # ── Track end ─────────────────────────────────────────────────────────────
    lines.append('[#TRACKEND]')

    return '\n'.join(lines)


def write_ust_file(
    notes:        list[dict],
    bpm:          float,
    voice_dir:    Optional[str]  = None,
    project_name: str            = 'melon_synth_render',
    track_params: Optional[dict] = None,
    pitch_points: Optional[list] = None,
    out_wav:      Optional[str]  = None,
    ust_path:     Optional[str]  = None,
) -> str:
    """
    Write a .ust file to disk and return the path.
    If ust_path is not given, a temp file is created.
    """
    content = generate_ust(
        notes=notes, bpm=bpm, voice_dir=voice_dir,
        project_name=project_name, track_params=track_params,
        pitch_points=pitch_points, out_wav=out_wav,
    )

    if not ust_path:
        tmp = tempfile.NamedTemporaryFile(
            suffix='.ust', prefix='melonsynth_',
            delete=False, mode='w', encoding='utf-8'
        )
        tmp.write(content)
        tmp.close()
        return tmp.name

    Path(ust_path).write_text(content, encoding='utf-8')
    return ust_path
