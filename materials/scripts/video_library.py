#!/usr/bin/env python3
"""Copy and index selected local training videos. No deletion or network access."""
import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GIB = 1024 ** 3


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Путь выходит за пределы выбранной папки')
    return path


def write_json(path, data):
    # Replace only a complete JSON; temporary files never count as catalog entries.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                     prefix='.pending-', delete=False) as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
        tmp = Path(f.name)
    tmp.replace(path)


@contextmanager
def locked(catalog):
    catalog.mkdir(parents=True, exist_ok=True)
    with (catalog / '.lock').open('a') as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def entries(catalog):
    return [(p, json.loads(p.read_text(encoding='utf-8')))
            for p in sorted(catalog.glob('*.json'))]


def import_video(args, root):
    source = args.input.resolve(strict=True)
    if not source.is_file() or source.suffix.lower() not in {'.mov', '.mp4', '.m4v'}:
        raise ValueError('Выберите один существующий MOV, MP4 или M4V')
    if date.fromisoformat(args.date).isoformat() != args.date:
        raise ValueError('Дата должна быть YYYY-MM-DD')
    store = args.store.resolve(strict=True)
    if not store.is_dir():
        raise ValueError('Папка хранения не найдена; проверьте подключение диска')
    if store.is_relative_to(root.resolve()) and not store.is_relative_to((root / 'media').resolve()):
        raise ValueError('Внутри проекта храните медиа только в исключённой из Git папке media/')
    catalog = root / 'videos'
    original_hash = digest(source)
    with locked(catalog):
        for _, item in entries(catalog):
            if item['sha256'] == original_hash:
                saved = safe_path(store, item['original'])
                if not saved.is_file() or digest(saved) != original_hash:
                    raise ValueError('Запись уже есть, но оригинал отсутствует или изменён. '
                                     'Проверьте выбранный диск и восстановите копию отдельно.')
                if args.sidecar:
                    raise ValueError('Видео уже есть. Новые сопроводительные файлы нужно '
                                     'присоединить отдельно, сохранив существующую запись.')
                print(json.dumps({'result': 'duplicate', 'id': item['id'],
                                  'athlete': item['athlete'], 'session_date': item['session_date'],
                                  'note': 'Ничего не добавлено. Проверьте участника и дату.'},
                                 ensure_ascii=False))
                return
        files = [source] + [p.resolve(strict=True) for p in args.sidecar]
        if any(not p.is_file() for p in files) or len(set(files)) != len(files):
            raise ValueError('Сопроводительные файлы должны существовать и не повторяться')
        required = sum(p.stat().st_size for p in files)
        if shutil.disk_usage(store).free - required < 10 * GIB:
            raise ValueError('После копирования останется менее 10 ГиБ. '
                             'Выберите другое хранилище; исходники не изменены.')
        probe = json.loads(subprocess.run([
            'ffprobe', '-v', 'error', '-show_format', '-show_streams',
            '-of', 'json', str(source)], check=True, capture_output=True, text=True).stdout)
        video = next((s for s in probe.get('streams', []) if s.get('codec_type') == 'video'), None)
        if video is None:
            raise ValueError('В файле нет видеодорожки')
        clip_id = f'{args.date}-{args.athlete}-{original_hash[:12]}'
        entry_path = catalog / f'{clip_id}.json'
        if entry_path.exists():
            raise ValueError('Конфликт идентификатора; существующая запись сохранена')
        relative = Path('originals') / clip_id
        target = safe_path(store, relative)
        target.mkdir(parents=True, exist_ok=False)
        manifest = {'status': 'in_progress', 'files': [], 'ffprobe': probe}
        manifest_path = target / 'manifest.json'
        write_json(manifest_path, manifest)
        try:
            for i, src in enumerate(files):
                name = 'original' + src.suffix.lower() if i == 0 else f'sidecar-{i:02d}' + src.suffix.lower()
                dest = target / name
                before = digest(src)
                if i == 0 and before != original_hash:
                    raise ValueError('Входной файл изменился до копирования')
                with src.open('rb') as inp, dest.open('xb') as out:
                    shutil.copyfileobj(inp, out, 1024 * 1024)
                if digest(dest) != before or digest(src) != before:
                    raise ValueError('Контрольные суммы не совпали')
                manifest['files'].append({'file': name, 'source_name': src.name,
                                          'sha256': before, 'bytes': dest.stat().st_size})
                write_json(manifest_path, manifest)
            item = {
                'id': clip_id, 'athlete': args.athlete, 'session_date': args.date,
                'date_source': 'user_supplied', 'label': args.label,
                'imported_at': datetime.now(timezone.utc).isoformat(),
                'sha256': original_hash, 'bytes': required,
                'original': str(relative / manifest['files'][0]['file']),
                'manifest': str(relative / 'manifest.json'),
                'width': video.get('width'), 'height': video.get('height'),
                'file_frame_rate': video.get('avg_frame_rate'),
                'duration_seconds': probe.get('format', {}).get('duration'),
                'real_time_scale': 'unknown',
                'session': f'sessions/{args.athlete}/{args.date}.md',
                'review': None, 'keep_reason': None,
                'backup': 'not_verified',
            }
            manifest['status'] = 'complete'
            write_json(manifest_path, manifest)
            write_json(entry_path, item)
        except BaseException as exc:
            manifest['status'] = 'failed'
            manifest['error'] = str(exc)
            write_json(manifest_path, manifest)
            raise
        print(json.dumps({'result': 'imported', 'id': clip_id,
                          'entry': str(entry_path), 'source_unchanged': True}, ensure_ascii=False))


def inventory(args, root):
    store = args.store.resolve(strict=True)
    result = {'store': str(store), 'free_gib': round(shutil.disk_usage(store).free / GIB, 2),
              'videos': [], 'unindexed_folders': [], 'note': 'Ничего не удалено'}
    known = set()
    for _, item in entries(root / 'videos'):
        path = safe_path(store, item['original'])
        known.add(path.parent)
        source_state = 'present' if path.is_file() else 'unavailable_in_this_store'
        if args.verify and path.is_file():
            source_state = 'verified' if digest(path) == item['sha256'] else 'hash_mismatch'
        review = item.get('review')
        review_present = bool(review and safe_path(root, review).is_file())
        result['videos'].append({
            'id': item['id'], 'label': item['label'], 'source': source_state,
            'review': 'saved' if review_present else ('review_file_missing' if review else 'awaiting_review'),
            'backup': item.get('backup', 'not_verified'), 'bytes': item['bytes']})
    originals = store / 'originals'
    if originals.is_dir():
        result['unindexed_folders'] = [p.name for p in sorted(originals.iterdir())
                                       if p.is_dir() and p.resolve() not in known]
    print(json.dumps(result, ensure_ascii=False, indent=2))


def main(root=ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    ingest = commands.add_parser('import', help='Проверить, скопировать и записать один ролик')
    ingest.add_argument('--input', type=Path, required=True)
    ingest.add_argument('--date', required=True)
    ingest.add_argument('--athlete', choices=['athlete-a', 'athlete-b'], required=True)
    ingest.add_argument('--label', required=True)
    ingest.add_argument('--sidecar', type=Path, action='append', default=[])
    status = commands.add_parser('status', help='Показать наличие оригиналов и разборов')
    status.add_argument('--verify', action='store_true', help='Пересчитать SHA-256 оригиналов')
    for sub in (ingest, status):
        sub.add_argument('--store', type=Path, default=root / 'media',
                         help='Существующая папка медиа на ноутбуке или внешнем диске')
    args = parser.parse_args()
    try:
        (import_video if args.command == 'import' else inventory)(args, root)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'Ошибка: {exc}\n')


if __name__ == '__main__':
    main()
