from concurrent.futures import ProcessPoolExecutor
from hashlib import sha256
from importlib.metadata import version
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
import json
import os
import time

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / 'scripts/noto-sans-sc.json'
MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
CACHE = ROOT / '.cache/font-sources'
DESTINATION = ROOT / 'apps/web/public/fonts/noto-sans-sc'
REPORT_DIRECTORY = ROOT / '.artifacts/noto-sans-sc-fonts'
LICENSE_DIRECTORY = ROOT / 'apps/web/public/licenses'


def checked_path(path):
    resolved = path.resolve()
    if resolved.drive.upper() != 'D:' or not resolved.is_relative_to(ROOT):
        raise ValueError(f'FONT_PATH_OUTSIDE_WORKSPACE: {path}')
    return resolved


def verified_download(entry):
    path = checked_path(CACHE / entry['filename'])
    if not path.exists() or sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        request = Request(entry['url'], headers={'User-Agent': 'Yijintool-Font-Builder'})
        with urlopen(request, timeout=120) as response:
            content = response.read()
        if sha256(content).hexdigest() != entry['sha256']:
            raise ValueError(f"FONT_CHECKSUM_MISMATCH: {entry['filename']}")
        path.write_bytes(content)
    return path


def unicode_ranges(codepoints):
    ranges = []
    values = sorted(codepoints)
    first = previous = values[0]
    for value in values[1:]:
        if value == previous + 1:
            previous = value
            continue
        ranges.append(f'U+{first:X}' if first == previous else f'U+{first:X}-{previous:X}')
        first = previous = value
    ranges.append(f'U+{first:X}' if first == previous else f'U+{first:X}-{previous:X}')
    return ','.join(ranges)


def variation_sequences(font, codepoints):
    return {(selector, codepoint) for table in font['cmap'].tables if table.format == 14
            for selector, values in table.uvsDict.items()
            for codepoint, _ in values if codepoint in codepoints}


def generate_subset(task):
    label, codepoints, font_path = task
    font = TTFont(font_path, recalcTimestamp=False)
    expected_sequences = variation_sequences(font, codepoints)
    variation_selectors = {selector for selector, _ in expected_sequences}
    options = subset.Options()
    options.flavor = 'woff2'
    options.recalc_timestamp = False
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.name_legacy = True
    options.layout_features = ['*']
    options.notdef_glyph = True
    options.notdef_outline = True
    processor = subset.Subsetter(options=options)
    processor.populate(unicodes=set(codepoints) | variation_selectors)
    processor.subset(font)
    for table in font['cmap'].tables:
        if table.isUnicode() and table.format != 14:
            table.cmap = {codepoint: glyph for codepoint, glyph in table.cmap.items() if codepoint in codepoints}
    output = BytesIO()
    font.flavor = 'woff2'
    font.save(output)
    font.close()
    content = output.getvalue()
    digest = sha256(content).hexdigest()
    filename = f'noto-sans-sc-{label}-{digest[:12]}.woff2'
    checked_path(DESTINATION / filename).write_bytes(content)
    verified = TTFont(BytesIO(content))
    coverage = set(verified.getBestCmap())
    if coverage != set(codepoints):
        raise ValueError(f'FONT_COVERAGE_MISMATCH: {filename}')
    axes = {axis.axisTag: [axis.minValue, axis.maxValue] for axis in verified['fvar'].axes}
    if axes != MANIFEST['axes']:
        raise ValueError(f'FONT_AXIS_MISMATCH: {filename}')
    if variation_sequences(verified, coverage) != expected_sequences:
        raise ValueError(f'FONT_VARIATION_SEQUENCE_MISMATCH: {filename}')
    if verified['name'].getDebugName(1) != MANIFEST['family']:
        raise ValueError(f'FONT_FAMILY_MISMATCH: {filename}')
    verified.close()
    css_coverage = {value for value in codepoints if value >= MANIFEST['cssMinimumCodepoint']}
    return {'label': label, 'file': filename, 'bytes': len(content), 'sha256': digest,
            'codepoints': len(codepoints), 'cssCodepoints': len(css_coverage),
            'variationSequences': len(expected_sequences),
            'unicodeRange': unicode_ranges(css_coverage) if css_coverage else None}


def main():
    started = time.monotonic()
    if ROOT.drive.upper() != 'D:':
        raise ValueError('D_DRIVE_REQUIRED')
    for path in (CACHE, DESTINATION, REPORT_DIRECTORY, ROOT / 'apps/web/src', LICENSE_DIRECTORY):
        checked_path(path)
    for name, expected in MANIFEST['buildDependencies'].items():
        if version(name) != expected:
            raise ValueError(f'FONT_BUILD_DEPENDENCY_MISMATCH: {name}')
    for directory in (CACHE, DESTINATION, REPORT_DIRECTORY, LICENSE_DIRECTORY):
        directory.mkdir(parents=True, exist_ok=True)
    font_path = verified_download(MANIFEST['font'])
    license_path = verified_download(MANIFEST['license'])
    original = TTFont(font_path, recalcTimestamp=False)
    original_coverage = set(original.getBestCmap())
    copyright_notice = original['name'].getDebugName(0)
    if original['name'].getDebugName(1) != MANIFEST['family']:
        raise ValueError('FONT_SOURCE_FAMILY_MISMATCH')
    original.close()
    common = set(range(0x20, 0x100)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
    common.update(ord(character) for character in '年月日星期一二三四五六七八九十〇')
    source_files = []
    for folder in MANIFEST['commonTextDirectories']:
        for path in sorted(checked_path(ROOT / folder).rglob('*')):
            if path.suffix not in ('.ts', '.tsx', '.sql'):
                continue
            checked_path(path)
            source_files.append(path.relative_to(ROOT).as_posix())
            common.update(ord(character) for character in path.read_text(encoding='utf-8') if ord(character) >= MANIFEST['cssMinimumCodepoint'])
    common &= original_coverage
    remaining = sorted(original_coverage - common)
    chunk_size = MANIFEST['chunkSize']
    tasks = [('common', sorted(common), str(font_path))]
    tasks.extend((f'{offset // chunk_size:03d}', remaining[offset:offset + chunk_size], str(font_path))
                 for offset in range(0, len(remaining), chunk_size))
    print(json.dumps({'event': 'start', 'codepoints': len(original_coverage), 'commonCodepoints': len(common), 'subsets': len(tasks)}), flush=True)
    files = []
    with ProcessPoolExecutor(max_workers=min(4, os.cpu_count() or 1)) as executor:
        for result in executor.map(generate_subset, tasks):
            files.append(result)
            print(json.dumps({'event': 'subset', 'file': result['file'], 'bytes': result['bytes'], 'completed': len(files), 'total': len(tasks)}), flush=True)
    expected_files = {item['file'] for item in files}
    for path in DESTINATION.glob('noto-sans-sc-*.woff2'):
        if path.name not in expected_files:
            checked_path(path).unlink()
    declarations = []
    for item in files:
        if item['unicodeRange'] is not None:
            declarations.append(f'@font-face {{ font-family: "{MANIFEST["family"]}"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("/fonts/noto-sans-sc/{item["file"]}") format("woff2"); unicode-range: {item["unicodeRange"]}; }}')
    checked_path(ROOT / 'apps/web/src/fonts-ui.css').write_text('\n'.join(declarations) + '\n', encoding='utf-8')
    checked_path(LICENSE_DIRECTORY / 'Noto-Sans-SC-OFL.txt').write_text(copyright_notice + '\n\n' + license_path.read_text(encoding='utf-8'), encoding='utf-8')
    report = {'family': MANIFEST['family'], 'source': MANIFEST['font'], 'axes': MANIFEST['axes'],
              'copyright': copyright_notice, 'codepoints': len(original_coverage),
              'commonCodepoints': len(common), 'cssCodepoints': sum(item['cssCodepoints'] for item in files),
              'variationSequences': sum(item['variationSequences'] for item in files),
              'totalBytes': sum(item['bytes'] for item in files), 'files': files,
              'commonTextFiles': source_files, 'durationSeconds': round(time.monotonic() - started, 2)}
    checked_path(REPORT_DIRECTORY / 'generation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'event': 'complete', 'files': len(files), 'codepoints': len(original_coverage), 'bytes': report['totalBytes'], 'durationSeconds': report['durationSeconds']}), flush=True)


if __name__ == '__main__':
    main()
