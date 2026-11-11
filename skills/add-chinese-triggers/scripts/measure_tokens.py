#!/usr/bin/env python3
"""量 description 的 token 成本（改动前后对比）。

用法:
    python measure_tokens.py --skills-dir DIR [--baseline DIR] [--encoding o200k_base,cl100k_base]

需要 tiktoken（pip install tiktoken）。没装时只报字符数，并明确标注"不是 token"。
"""
import argparse
import os
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("需要 PyYAML：pip install pyyaml")

try:
    import tiktoken
except ImportError:
    tiktoken = None


def description(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None
    meta = yaml.safe_load("\n".join(lines[1:end])) or {}
    if not isinstance(meta, dict) or not meta.get("description"):
        return None
    return re.sub(r"\s+", " ", str(meta["description"])).strip()


def main():
    ap = argparse.ArgumentParser(description="量 SKILL.md description 的 token 成本")
    ap.add_argument("--skills-dir", required=True)
    ap.add_argument("--baseline", default=None, help="改动前的目录快照")
    ap.add_argument("--encoding", default="o200k_base,cl100k_base")
    a = ap.parse_args()

    encs = {}
    if tiktoken:
        for name in [e.strip() for e in a.encoding.split(",") if e.strip()]:
            try:
                encs[name] = tiktoken.get_encoding(name)
            except Exception as e:
                print(f"跳过编码 {name}: {e}", file=sys.stderr)
    else:
        print("警告：没有 tiktoken，下面只报字符数（不是 token）。pip install tiktoken", file=sys.stderr)

    rows = []
    for d in sorted(os.listdir(a.skills_dir)):
        p = os.path.join(a.skills_dir, d, "SKILL.md")
        if not os.path.isfile(p):
            continue
        now = description(p)
        if now is None:
            continue
        base = None
        if a.baseline:
            bp = os.path.join(a.baseline, d, "SKILL.md")
            base = description(bp) if os.path.isfile(bp) else None
        rows.append((d, base, now))

    if not encs:
        paired = [(x, y) for _, x, y in rows if x is not None]
        tot_b = sum(len(x) for x, _ in paired)
        tot_n = sum(len(y) for _, y in paired)
        print(f"字符数（仅 {len(paired)} 个有基线）：{tot_b} -> {tot_n}（{tot_n - tot_b:+d}）")
        if len(paired) < len(rows):
            print(f"注：{len(rows) - len(paired)} 个 skill 没有基线，未计入合计")
        return 0

    for name, enc in encs.items():
        tb = tn = cnt = miss = 0
        print(f"\n== {name} ==")
        print(f"{'skill':32} {'改前':>6} {'改后':>6} {'增量':>6}")
        for d, base, now in rows:
            n = len(enc.encode(now))
            b = len(enc.encode(base)) if base is not None else None
            if b is None:
                miss += 1
            else:
                tb += b
                tn += n
                cnt += 1
            delta = f"{n - b:+d}" if b is not None else "-"
            print(f"{d:32} {b if b is not None else '-':>6} {n:>6} {delta:>6}")
        print(f"{'合计':32} {tb:>6} {tn:>6} {tn - tb:>+6d}  (仅 {cnt} 个有基线)")
        if miss:
            print(f"注：{miss} 个 skill 没有基线，未计入合计")
    return 0


if __name__ == "__main__":
    sys.exit(main())
