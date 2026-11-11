#!/usr/bin/env python3
"""把中文触发写进 SKILL.md 的 description 尾部（幂等、不改英文、不改结构、不改行尾）。

用法:
    python apply_cn_triggers.py --skills-dir DIR --map intents.yaml [--dry-run] [--force-chinese]

intents.yaml（键 = skill 目录名，值 = 中文意图，不要带结尾的"时使用"）:
    pr: 写/改 PR 正文

行为:
  - 只替换 description 里的中文尾段；英文原文逐字保留，被丢弃的尾段若仍含英文句子则拒改
  - 支持无引号单行 / 单引号 / 双引号 / `>` `|` 块标量；引号风格与行尾（LF/CRLF/BOM）原样保留
  - description 已含中文时默认跳过，--force-chinese 才覆盖
  - 幂等：重复执行不产生二次变化
  - 任一条失败都会计入失败数并以 exit 1 结束；单个文件出错不影响其余文件
"""
import argparse
import os
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("需要 PyYAML：pip install pyyaml")

CJK = re.compile(r"[\u3400-\u9fff]")
KEY_RE = re.compile(r"^description\s*:")
NEXT_KEY_RE = re.compile(r"^[A-Za-z0-9_.-]+\s*:")
SUFFIX = "时使用。"
# 4 个及以上连续英文单词，视为"被丢弃的英文句子"，拒改（避免误删）
ENGLISH_RUN = re.compile(r"[A-Za-z]{2,}(?:[\s,'\-]+[A-Za-z]{2,}){3,}")


def read_text(path):
    raw = open(path, "rb").read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    if bom:
        raw = raw[3:]
    text = raw.decode("utf-8")           # UnicodeDecodeError 交给调用方
    crlf = text.count("\r\n")
    lf_only = text.count("\n") - crlf
    eol = "\r\n" if crlf > lf_only else "\n"
    mixed = crlf > 0 and lf_only > 0
    return text.replace("\r\n", "\n"), eol, bom, mixed


def write_text(path, text, eol, bom):
    data = text.replace("\r\n", "\n").replace("\n", eol).encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    with open(path, "wb") as f:
        f.write(data)


def norm_desc(text):
    """返回 (description 或 None, 错误信息或 None)；错误信息非空表示文件本身有问题"""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, "frontmatter 缺失"
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None, "frontmatter 未闭合"
    try:
        meta = yaml.safe_load("\n".join(lines[1:end]))
    except Exception as e:
        return None, "YAML 解析失败: %s" % e
    if not isinstance(meta, dict):
        return None, "frontmatter 不是映射"
    if meta.get("description") is None:
        return None, None
    return re.sub(r"\s+", " ", str(meta["description"])).strip(), None


def desc_bounds(lines):
    ds = next((i for i, l in enumerate(lines) if KEY_RE.match(l)), None)
    if ds is None:
        return None
    de = len(lines)
    for j in range(ds + 1, len(lines)):
        if NEXT_KEY_RE.match(lines[j]) or lines[j].strip() == "---":
            de = j
            break
    return ds, de


def clean_intent(value):
    s = str(value).strip()
    s = re.sub(r"\s*时使用。?\s*$", "", s)
    s = s.rstrip("。").strip()
    return s


def rewrite(text, intent):
    """返回 (新全文, 说明, 错误)"""
    lines = text.split("\n")
    bounds = desc_bounds(lines)
    if bounds is None:
        return None, None, "没有 description 字段（不要凭空新建）"
    ds, de = bounds
    head = KEY_RE.match(lines[ds])
    value_part = lines[ds][head.end():]
    trailing_ws = value_part[len(value_part.rstrip()):]
    lead = value_part[: len(value_part) - len(value_part.lstrip())] or " "

    if value_part.strip()[:1] in (">", "|"):
        indent = 2
        for l in lines[ds + 1: de]:
            if l.strip():
                indent = len(l) - len(l.lstrip())
                break
        body = lines[ds + 1: de]
        keep, dropped = [], []
        seen_cjk = False
        for l in body:
            if not seen_cjk and CJK.search(l):
                seen_cjk = True
            (dropped if seen_cjk else keep).append(l)
        while keep and not keep[-1].strip():
            keep.pop()
        tail = "\n".join(dropped)
        if ENGLISH_RUN.search(tail):
            return None, None, "中文尾段里仍有英文内容，会被删掉，拒改"
        new = lines[: ds + 1] + keep + [" " * indent + intent + suffix_space(intent)] + lines[de:]
        note = "块标量" + (("，替换原尾段「%s」" % tail.strip()[:30].replace("\n", " ")) if tail.strip() else "")
        return "\n".join(new), note, None

    if de != ds + 1:
        return None, None, "多行普通标量不支持（请改成单行或块标量）"

    rest = value_part.strip()
    quote = ""
    if rest[:1] in ('"', "'") and rest.endswith(rest[:1]) and len(rest) > 1:
        quote, inner = rest[0], rest[1:-1]
    else:
        inner = rest
        if re.search(r"\s#", rest):
            return None, None, "description 行尾有 YAML 行内注释，拒改（请手工处理）"

    m = CJK.search(inner)
    tail = inner[m.start():] if m else ""
    if ENGLISH_RUN.search(tail):
        return None, None, "中文尾段里仍有英文内容，会被删掉，拒改"
    english = (inner[: m.start()] if m else inner).rstrip()
    if not english:
        return None, None, "description 全是中文，没有英文可保留"
    lines[ds] = (lines[ds][: head.end()] + lead + quote + english + " " + intent +
                 suffix_space(intent) + quote + trailing_ws)
    note = "单行" + (("，替换原尾段「%s」" % tail.strip()[:30]) if tail.strip() else "")
    return "\n".join(lines), note, None


def suffix_space(intent):
    return (" " if re.search(r"[A-Za-z0-9]$", intent) else "") + SUFFIX


def main():
    ap = argparse.ArgumentParser(description="给 SKILL.md 的 description 追加中文触发")
    ap.add_argument("--skills-dir", required=True)
    ap.add_argument("--map", required=True, help="YAML: {skill目录名: 中文意图}")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force-chinese", action="store_true", help="description 已含中文也强制覆盖")
    args = ap.parse_args()

    with open(args.map, encoding="utf-8") as f:
        intents = yaml.safe_load(f) or {}
    if not isinstance(intents, dict):
        sys.exit("map 必须是 {skill目录名: 中文意图} 的映射")

    ok = same = skipped = failed = 0
    for skill, raw_intent in intents.items():
        try:
            if not isinstance(skill, str) or re.search(r"[\\/]|^\.\.?$", skill):
                print(f"FAIL   {skill!r}: 键只能是目录名，不能含路径分隔符")
                failed += 1
                continue
            intent = clean_intent(raw_intent)
            if not intent or intent == "None":
                print(f"FAIL   {skill}: 中文意图为空")
                failed += 1
                continue
            p = os.path.join(args.skills_dir, skill, "SKILL.md")
            if not os.path.isfile(p):
                print(f"FAIL   {skill}: 找不到 {p}")
                failed += 1
                continue

            text, eol, bom, mixed = read_text(p)
            before, parse_err = norm_desc(text)
            if parse_err:
                print(f"FAIL   {skill}: {parse_err}")
                failed += 1
                continue
            if before is None:
                print(f"SKIP   {skill}: 没有 description 字段（不要凭空新建）")
                skipped += 1
                continue
            if CJK.search(before) and not args.force_chinese:
                print(f"SKIP   {skill}: description 已含中文（要覆盖加 --force-chinese）")
                skipped += 1
                continue

            new_text, note, err = rewrite(text, intent)
            if err:
                print(f"FAIL   {skill}: {err}")
                failed += 1
                continue
            after, after_err = norm_desc(new_text)
            if after is None:
                print(f"FAIL   {skill}: 改写后无法解析（{after_err}），已放弃")
                failed += 1
                continue
            # 英文原文必须整段保留（不是只看前 40 字符）
            before_en = before[: CJK.search(before).start()] if CJK.search(before) else before
            if not after.startswith(before_en.rstrip()):
                print(f"FAIL   {skill}: 英文原文被改动，已放弃")
                failed += 1
                continue
            if new_text == text:
                print(f"SAME   {skill}: 已是目标形态")
                same += 1
                continue
            if args.dry_run:
                print(f"DRY    {skill}: {note} -> {intent}{suffix_space(intent)}")
            else:
                write_text(p, new_text, eol, bom)
                back, _, _, _ = read_text(p)
                if back != new_text:
                    print(f"FAIL   {skill}: 写回校验失败（行尾或内容不符）")
                    failed += 1
                    continue
                print(f"OK     {skill}: {intent}{suffix_space(intent)}  [{note}]" +
                      ("  [CRLF]" if eol == "\r\n" else "") + ("  [混合行尾已统一为%s]" % ("CRLF" if eol == "\r\n" else "LF") if mixed else ""))
            ok += 1
        except UnicodeDecodeError:
            print(f"FAIL   {skill}: 文件不是 UTF-8，跳过")
            failed += 1
        except Exception as e:
            print(f"FAIL   {skill}: {type(e).__name__}: {e}")
            failed += 1

    print(f"\n合计：改写 {ok} / 无变化 {same} / 跳过 {skipped} / 失败 {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
