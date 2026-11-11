#!/usr/bin/env python3
"""校验 SKILL.md 的 description 改动没有破坏其它内容。

用法:
    python verify_descriptions.py --skills-dir DIR [--baseline DIR] [--require-suffix] [--json]

不带 --baseline：只做结构校验（YAML、BOM、行尾、可选后缀）。
带 --baseline：逐字节比对——name / 正文 / 其它 frontmatter 键必须一致，差异只能落在 description 区域，
且英文原文必须仍是前缀。这才是"没改坏"的证据。
"""
import argparse
import json
import os
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("需要 PyYAML：pip install pyyaml")

CJK = re.compile(r"[\u3400-\u9fff]")


def split(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[1:i], lines[i + 1:]
    return None


def desc_span(fm):
    ds = next((i for i, l in enumerate(fm) if re.match(r"^description\s*:", l)), None)
    if ds is None:
        return None
    de = ds
    for j in range(ds + 1, len(fm)):
        if re.match(r"^[A-Za-z0-9_.-]+\s*:", fm[j]):
            break
        de = j
    return ds, de


def others(fm, span):
    return fm if span is None else fm[: span[0]] + fm[span[1] + 1:]


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def check(path, baseline, require_suffix):
    issues = []
    raw = open(path, "rb").read()
    has_bom = raw[:3] == b"\xef\xbb\xbf"
    text = raw.decode("utf-8", "replace")
    if text.startswith("\ufeff"):
        text = text[1:]
    parts = split(text)
    if parts is None:
        return issues + ["frontmatter 缺失或未闭合"], None, None
    fm, body = parts
    try:
        meta = yaml.safe_load("\n".join(fm)) or {}
    except Exception as e:
        return ["YAML 解析失败: %s" % e], None, None
    if not isinstance(meta, dict):
        return ["frontmatter 不是映射"], None, None
    desc = meta.get("description")
    d = norm(desc)
    starts_english = bool(d) and not CJK.match(d[:1])
    if require_suffix and starts_english and CJK.search(d) and not d.endswith("时使用。"):
        issues.append("中文段未以「时使用。」结尾")

    if baseline and os.path.isfile(baseline):
        braw = open(baseline, "rb").read()
        baseline_has_bom = braw[:3] == b"\xef\xbb\xbf"
        btext = braw.decode("utf-8", "replace")
        if btext.startswith("\ufeff"):
            btext = btext[1:]
        bparts = split(btext)
        if bparts is None:
            issues.append("基线 frontmatter 缺失")
        else:
            bfm, bbody = bparts
            if body != bbody:
                issues.append("正文被改动")
            if text.split("\n")[0] != btext.split("\n")[0]:
                issues.append("首行被改动")
            if others(fm, desc_span(fm)) != others(bfm, desc_span(bfm)):
                issues.append("description 以外的 frontmatter 键被改动")
            def eol_style(t):
                crlf = t.count("\r\n")
                bare = t.count("\n") - crlf
                if crlf and bare:
                    return "mixed"
                return "crlf" if crlf else "lf"
            if eol_style(text) != eol_style(btext):
                issues.append("行尾风格变化")
            if braw == raw:
                issues.append("未改动")
            else:
                bmeta = yaml.safe_load("\n".join(bfm)) or {}
                if meta.get("name") != bmeta.get("name"):
                    issues.append("name 被改动")
                od, nd = norm(bmeta.get("description")), d
                # 基线里可能已经有中文尾段（例如 --force-chinese 换格式），只比对英文前缀
                m0 = CJK.search(od) if od else None
                od_en = (od[: m0.start()] if m0 else od).strip() if od else ""
                if od_en and nd and not nd.startswith(od_en):
                    issues.append("英文原文不再是前缀（疑似被翻译或删改）")
    elif baseline:
        issues.append("基线缺失，无法验证（路径写错了？）")
    if has_bom and not (baseline and os.path.isfile(baseline) and baseline_has_bom):
        issues.append("出现 BOM")
    return issues, body, desc


def main():
    ap = argparse.ArgumentParser(description="校验 SKILL.md 的 description 改动")
    ap.add_argument("--skills-dir", required=True)
    ap.add_argument("--baseline", default=None, help="改动前的目录快照")
    ap.add_argument("--require-suffix", action="store_true",
                    help="要求含中文的 description 以「时使用。」结尾")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    results = []
    for d in sorted(os.listdir(a.skills_dir)):
        p = os.path.join(a.skills_dir, d, "SKILL.md")
        if not os.path.isfile(p):
            continue
        bp = os.path.join(a.baseline, d, "SKILL.md") if a.baseline else None
        issues, _, _ = check(p, bp, a.require_suffix)
        changed = "未改动" not in issues
        real = [i for i in issues if i != "未改动"]
        results.append({"skill": d, "ok": not real, "issues": real, "changed": changed})

    if a.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for r in results:
            if r["ok"]:
                print("OK    %-30s %s" % (r["skill"], "已改" if r["changed"] else "未改动"))
            else:
                print("FAIL  %-30s %s" % (r["skill"], "; ".join(r["issues"])))
    bad = [r for r in results if not r["ok"]]
    print("---\nchecked=%d ok=%d fail=%d" % (len(results), len(results) - len(bad), len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
