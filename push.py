#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""push.py ["自定义提交信息"]
===========================
提交本地改动 -> 变基到远程最新 -> 推送到 origin/main。

用法：
  双击运行；或命令行传入提交信息：push.py "自定义提交信息"

特性：
  - 若当前目录还不是 git 仓库，会自动 git init 并添加 origin（取自 .env 的 GITHUB_REPO_URL）
  - 远程为空（首次推送）时自动跳过变基，直接推送
  - 本地与远程无共同历史时，自动用 --allow-unrelated-histories 兜底
  - 版本号来源：server/fnos/crldesk/manifest（version=），回退 server/package.json
  - 凭据来源：.env 的 GITHUB_TOKEN（以 extraheader 方式使用，不写入仓库地址）

注意：git rebase 要求工作区干净，故必须「先提交、再变基、后推送」。
"""
import base64
import io
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BRANCH = "main"


def load_env(path):
    data = {}
    if not os.path.exists(path):
        return data
    with io.open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, v = s.split("=", 1)
                data[k.strip()] = v.strip().strip("'").strip('"')
    return data


ENV = load_env(os.path.join(ROOT, ".env"))


def git_auth_args():
    tok = ENV.get("GITHUB_TOKEN", "")
    if tok:
        b64 = base64.b64encode(("x-access-token:" + tok).encode("utf-8")).decode("ascii")
        return ["-c", "http.https://github.com/.extraheader=AUTHORIZATION: basic " + b64], True
    return [], False


def repo_url():
    return ENV.get("GITHUB_REPO_URL", "").strip()


def get_version():
    # 1) fpk manifest（version=1.0.0）
    p = os.path.join(ROOT, "server", "fnos", "crldesk", "manifest")
    if os.path.exists(p):
        with io.open(p, encoding="utf-8", errors="ignore") as f:
            for line in f:
                s = line.strip()
                if s.startswith("version="):
                    return s.split("=", 1)[1].strip()
    # 2) server/package.json（"version": "1.0.0"）
    p = os.path.join(ROOT, "server", "package.json")
    if os.path.exists(p):
        with io.open(p, encoding="utf-8", errors="ignore") as f:
            m = re.search(r'"version"\s*:\s*"([^"]+)"', f.read())
            if m:
                return m.group(1)
    return ""


def run(cmd):
    print("> " + " ".join(cmd))
    return subprocess.run(cmd).returncode


def out(cmd):
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return (r.stdout or b"").decode("utf-8", "ignore").strip()
    except Exception:
        return ""


def ensure_repo(auth):
    """确保是 git 仓库、分支为 main、origin 指向 .env 的仓库地址。"""
    url = repo_url()
    if subprocess.run(["git", "rev-parse", "--is-inside-work-tree"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
        print("[信息] 当前目录不是 git 仓库，执行 git init")
        if run(["git", "init"]) != 0:
            return False
        cur = out(["git", "branch", "--show-current"])
        if cur != BRANCH:
            run(["git", "branch", "-M", BRANCH])

    if not url:
        print("[错误] .env 中未设置 GITHUB_REPO_URL，无法配置远程仓库")
        return False

    origin = out(["git", "remote", "get-url", "origin"])
    if not origin:
        print("[信息] 添加远程仓库 origin")
        if run(["git", "remote", "add", "origin", url]) != 0:
            return False
    elif origin != url:
        print("[信息] 更新远程仓库 origin 地址")
        if run(["git", "remote", "set-url", "origin", url]) != 0:
            return False

    cur = out(["git", "branch", "--show-current"])
    if cur != BRANCH:
        print("[信息] 切换分支到 %s" % BRANCH)
        if run(["git", "branch", "-M", BRANCH]) != 0:
            return False
    return True


def remote_has_branch(auth):
    """远程是否已有 main 分支（远程为空仓库时返回 False）。"""
    r = subprocess.run(["git"] + auth + ["ls-remote", "--heads", "origin", BRANCH],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return bool((r.stdout or b"").strip())


def main():
    os.chdir(ROOT)
    auth, has_tok = git_auth_args()
    print("[凭据] %s" % ("使用 .env 中的 GITHUB_TOKEN" if has_tok else ".env 中无 GITHUB_TOKEN，使用系统凭据"))

    try:
        subprocess.run(["git", "--version"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("[错误] 未找到 git，请先安装 Git for Windows 并确认已加入 PATH。")
        return 1

    if not ensure_repo(auth):
        return 1

    # 提交信息：优先用命令行参数，否则自动生成（带版本号）
    msg = sys.argv[1] if len(sys.argv) > 1 else ""
    if not msg:
        ver = get_version() or "unknown"
        msg = "crldesk v%s: 服务端/客户端分离 + 服务端管理面板 + FN Connect 解析" % ver

    print("")
    print("=== 1/4 暂存并提交本地改动 ===")
    if run(["git", "add", "-A"]) != 0:
        print("[错误] git add 失败")
        return 1

    have_commit = False
    if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
        print("[信息] 提交信息：%s" % msg)
        if run(["git", "commit", "-m", msg]) != 0:
            print("[错误] git commit 失败")
            return 1
        have_commit = True
    else:
        print("[提示] 无本地改动，仅同步远程")

    print("")
    print("=== 2/4 变基到远程最新（pull --rebase）===")
    if remote_has_branch(auth):
        if run(["git"] + auth + ["pull", "--rebase", "origin", BRANCH]) != 0:
            print("[提示] 常规变基失败，尝试 --allow-unrelated-histories")
            run(["git", "rebase", "--abort"])
            if run(["git"] + auth + ["pull", "--rebase", "origin", BRANCH,
                                     "--allow-unrelated-histories"]) != 0:
                print("[错误] 拉取/变基失败。若有冲突请手动处理：")
                print("        查看：  git status")
                print("        解决后：git add -A && git rebase --continue")
                print("        放弃：  git rebase --abort")
                return 1
    else:
        print("[提示] 远程仓库为空（首次推送），跳过变基")

    print("")
    print("=== 3/4 推送到 origin/%s ===" % BRANCH)
    if run(["git"] + auth + ["push", "-u", "origin", BRANCH]) != 0:
        print("[错误] git push 失败")
        return 1

    print("")
    print("=== 4/4 完成 ===")
    print("[完成] 已推送到 origin/%s" % BRANCH)
    return 0


def pause_close(prompt):
    try:
        import msvcrt
        sys.stdout.write("\n" + prompt)
        sys.stdout.flush()
        msvcrt.getch()
    except Exception:
        try:
            input(prompt)
        except Exception:
            time.sleep(5)


def countdown_close(seconds=5):
    sys.stdout.write("\n窗口将在 %d 秒后自动关闭：" % seconds)
    sys.stdout.flush()
    for i in range(seconds, 0, -1):
        sys.stdout.write(" %d" % i)
        sys.stdout.flush()
        time.sleep(1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    rc = 1
    try:
        rc = main()
    except KeyboardInterrupt:
        rc = 0
    except Exception:
        import traceback
        rc = 1
        print("")
        print("[异常] push.py 运行出错，详情如下：")
        traceback.print_exc()
        pause_close("按任意键关闭窗口...")
        sys.exit(rc)
    countdown_close()
    sys.exit(rc)
