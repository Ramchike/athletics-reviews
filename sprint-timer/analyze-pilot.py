"""Compare paired Stvor exports with independently measured sprint attempts."""

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median


def read_rows(filename, fields):
    with filename.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = set(fields) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{filename}: missing columns {', '.join(sorted(missing))}")
        for number, row in enumerate(reader, 2):
            if None in row or None in row.values():
                raise ValueError(f"{filename}:{number}: unexpected number of columns")
            yield {key: value.strip() for key, value in row.items()}


def numeric(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Invalid measurement: {value}")
    return number


def exports(filename, role):
    by_id = {}
    for row in read_rows(filename, ("id", "role", "distance", "duration", "resultArrivalMs")):
        if row["role"] != role:
            continue
        attempt = row["id"]
        if not attempt or attempt in by_id:
            raise ValueError(f"{filename}: missing or repeated attempt id: {attempt}")
        by_id[attempt] = row
    return by_id


def p95(values):
    return round(sorted(values)[math.ceil(0.95 * len(values)) - 1], 2) if values else None


def summarize(rows, start, finish):
    groups = defaultdict(list)
    linked = set()
    for row in rows:
        attempt, distance, network = (row[key] for key in ("id", "distance", "network"))
        if not network or distance not in {"60", "100"}:
            raise ValueError("Reference rows require distance 60/100 and a network label")
        if attempt:
            if attempt in linked or (attempt not in start and attempt not in finish):
                raise ValueError(f"Reference id is repeated or absent from both exports: {attempt}")
            linked.add(attempt)
        for device in (start, finish):
            if attempt in device and device[attempt]["distance"] != distance:
                raise ValueError(f"Reference and export distances disagree for {attempt}")
        groups[(int(distance), network, row.get("configuration", ""))].append(row)

    report = []
    for (distance, network, configuration), entries in sorted(groups.items()):
        errors = []
        sources = Counter()
        arrivals = {role: [] for role in ("start", "finish")}
        expected = caught = unpaired = disagreement = empty = false_stops = 0
        for row in entries:
            attempt, reference = row["id"], row["referenceMs"]
            if not reference:  # An empty-lane trial has no reference crossing.
                empty += 1
                false_stops += bool(attempt)
                continue
            reference = numeric(reference)
            if reference <= 0:
                raise ValueError("referenceMs must be positive for a real crossing")
            expected += 1
            a, b = start.get(attempt), finish.get(attempt)
            if not a and not b:
                continue
            caught += 1
            if not a or not b:
                unpaired += 1
                continue
            duration = numeric(a["duration"])
            if abs(duration - numeric(b["duration"])) > 0.01:
                disagreement += 1
                continue
            errors.append(duration - reference)
            source = a.get("startCamera") or a.get("audio") or "unknown"
            sources[f"{source}/{a.get('camera') or 'unknown'}"] += 1
            for role, export in (("start", a), ("finish", b)):
                if export["resultArrivalMs"]:
                    arrivals[role].append(numeric(export["resultArrivalMs"]))
        report.append({
            "distance": distance, "network": network, "configuration": configuration,
            "expected": expected, "caught": caught,
            "missed": expected - caught, "unpaired": unpaired, "disagreement": disagreement,
            "empty_lane_trials": empty, "false_stops": false_stops, "compared": len(errors),
            "median_bias_ms": round(median(errors), 2) if errors else None,
            "absolute_error_p95_ms": p95([abs(error) for error in errors]),
            "timestamp_sources": dict(sorted(sources.items())),
            "arrival": {role: {"samples": len(values), "p95_ms": p95(values)}
                        for role, values in arrivals.items()},
        })
    return {"groups": report, "export_ids_without_reference": sorted((start.keys() | finish.keys()) - linked)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("start", "finish", "reference"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    try:
        report = summarize(
            read_rows(args.reference, ("id", "distance", "network", "referenceMs")),
            exports(args.start, "start"), exports(args.finish, "finish"),
        )
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
