from hashlib import sha256
from pathlib import Path
import json
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source = root / 'apps/web/src'
font_source = root / 'apps/web/node_modules/@fontsource-variable/noto-sans-sc/files'
destination = root / 'apps/web/public/fonts/ui'
destination.mkdir(parents=True, exist_ok=True)
codepoints = {ord(character) for character in '年月日星期一二三四五六七八九十〇'}
for path in source.rglob('*'):
    if path.suffix in ('.ts', '.tsx'):
        codepoints.update(ord(character) for character in path.read_text(encoding='utf-8') if 0x2000 <= ord(character) <= 0xFFFF)

declarations = []
manifest = []
for path in sorted(font_source.glob('noto-sans-sc-*-wght-normal.woff2')):
    font = TTFont(path, recalcTimestamp=False)
    covered = codepoints.intersection(font.getBestCmap())
    if not covered:
        font.close()
        continue
    options = subset.Options()
    options.flavor = 'woff2'
    options.recalc_timestamp = False
    processor = subset.Subsetter(options=options)
    processor.populate(unicodes=covered)
    processor.subset(font)
    intermediate = destination / 'subset.woff2'
    font.save(intermediate)
    font.close()
    content = intermediate.read_bytes()
    digest = sha256(content).hexdigest()[:12]
    filename = f'noto-sans-sc-ui-{path.stem.removeprefix("noto-sans-sc-").removesuffix("-wght-normal")}-{digest}.woff2'
    target = destination / filename
    intermediate.replace(target)
    unicode_range = ','.join(f'U+{codepoint:X}' for codepoint in sorted(covered))
    declarations.append(f'@font-face {{ font-family: "Noto Sans SC UI"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("/fonts/ui/{filename}") format("woff2-variations"); unicode-range: {unicode_range}; }}')
    manifest.append({'file': filename, 'bytes': len(content), 'glyphs': len(covered)})

current_files = {item['file'] for item in manifest}
for path in destination.glob('noto-sans-sc-ui-*.woff2'):
    if path.name not in current_files:
        path.unlink()

(source / 'fonts-ui.css').write_text('\n'.join(declarations) + '\n', encoding='utf-8')
report = {'fonttools': '4.60.1', 'requestedGlyphs': len(codepoints), 'totalBytes': sum(item['bytes'] for item in manifest), 'files': manifest}
(root / '.artifacts' / 'font-subsets.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'files': len(manifest), 'glyphs': len(codepoints), 'bytes': report['totalBytes']}))
