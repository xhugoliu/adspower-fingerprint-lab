"""Compare two run labels in a JSONL file from serve.py."""

import argparse
import json
from collections import Counter
from pathlib import Path


def load(path, labels):
    groups = {label: [] for label in labels}
    duplicates = Counter()
    seen = set()
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                if (row["schema"] != 1 or not isinstance(row["run"], str)
                        or not isinstance(row["batch"], str) or type(row["index"]) is not int
                        or not isinstance(row["readings"], dict)):
                    raise ValueError
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"Invalid probe record at line {line_number}") from error
            label = row["run"]
            if label not in groups:
                continue
            key = label, row["batch"], row["index"]
            if key in seen:
                duplicates[label] += 1
                continue
            seen.add(key)
            groups[label].append(row)
    for label, rows in groups.items():
        if not rows:
            raise ValueError(f"No samples for {label!r}")
    return groups, duplicates


def flatten(value, path=""):
    if isinstance(value, dict) and value:
        for key, item in value.items():
            yield from flatten(item, f"{path}.{key}" if path else key)
    else:
        yield path, json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def summarize(rows):
    samples = []
    for row in rows:
        settings = {key: row[key] for key in ("drawing", "locate", "storage")}
        if row.get("followup"):
            settings["followup"] = True
        record = {"settings": settings, **row["readings"]}
        samples.append(dict(flatten(record)))
    fields = set().union(*(sample.keys() for sample in samples))
    return {
        field: frozenset(sample.get(field, "<missing>") for sample in samples)
        for field in fields
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("samples", type=Path)
    parser.add_argument("baseline")
    parser.add_argument("candidate")
    parser.add_argument("--field", action="append", default=[], help="optional dotted field prefix")
    args = parser.parse_args()
    if args.baseline == args.candidate:
        parser.error("choose two different run labels")
    try:
        groups, duplicates = load(args.samples, (args.baseline, args.candidate))
        before, after = (summarize(rows) for rows in groups.values())
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    for label, rows in groups.items():
        print(f"{label}: {len(rows)} samples, {duplicates[label]} duplicates skipped")

    def selected(field):
        return not args.field or any(field == prefix or field.startswith(prefix + ".") for prefix in args.field)

    def formatted(values):
        return " | ".join(sorted(values))

    changed = 0
    unstable = 0
    fields = sorted(field for field in before.keys() | after.keys() if selected(field))
    for field in fields:
        lhs = before.get(field, {"<missing>"})
        rhs = after.get(field, {"<missing>"})
        if lhs != rhs:
            changed += 1
            print(f"{field}\n  {args.baseline}: {formatted(lhs)}\n  {args.candidate}: {formatted(rhs)}")
        if len(lhs) > 1 or len(rhs) > 1:
            unstable += 1
            if lhs == rhs:
                print(f"{field}\n  varies within both runs: {formatted(lhs)}")
    print(f"{len(fields)} fields compared, {changed} changed, {unstable} vary within a run")


if __name__ == "__main__":
    main()
