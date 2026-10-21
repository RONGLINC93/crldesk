#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pull.py - 从 origin/main 拉取最新代码（rebase 方式）

凭据：若 .env 中有 GITHUB_TOKEN 则用它认证（不落盘、不写进 remote URL）；
      否则回退到系统凭据管理器。

特性：
  - 自动确保 origin 指向 .env 的 GITHUB_REPO_URL（缺失则添加、不一致则更新）
  - 远程为空仓库时提示并跳过，不报错
  - 本地有未提交改动时先 stash，拉取完成后自动 stash pop
  - 本地与远程无共同历史时，自动用 --allow-unrelated-histories 兜底
"""
import base64
import io
import os
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


def run(cmd):
    print("> " + " ".join(cmd))
    return subprocess.run(cmd).returncode


def out(cmd):
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return (r.stdout or b"").decode("utf-8", "ignore").strip()
    except Exception:
        return ""


def quiet(cmd):
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def ensure_repo():
    """确保是 git 仓库、分支为 main、origin 指向 .env 的仓库地址。"""
    url = repo_url()
    if quiet(["git", "rev-parse", "--is-inside-work-tree"]) != 0:
        if not url:
            print("[错误] 当前目录不是 git 仓库，且 .env 中未设置 GITHUB_REPO_URL")
            print("       请先克隆仓库，或先运行 push.py 初始化并推送")
            return False
        print("[信息] 当前目录不是 git 仓库，执行 git init")
        if run(["git", "init"]) != 0:
            return False

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
    if cur and cur != BRANCH:
        print("[信息] 当前分支为 %s，切换到 %s" % (cur, BRANCH))
        if run(["git", "branch", "-M", BRANCH]) != 0:
            return False
    return True


def remote_has_branch(auth):
    r = subprocess.run(["git"] + auth + ["ls-remote", "--heads", "origin", BRANCH],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return bool((r.stdout or b"").strip())


def working_dirty():
    """工作区是否有未提交改动（含未跟踪文件）。"""
    if quiet(["git", "diff", "--quiet"]) != 0:
        return True
    if quiet(["git", "diff", "--cached", "--quiet"]) != 0:
        return True
    return bool(out(["git", "ls-files", "--others", "--exclude-standard"]))


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

    if not ensure_repo():
        return 1

    if not remote_has_branch(auth):
        print("[提示] 远程仓库尚无 %s 分支（空仓库），无需拉取" % BRANCH)
        return 0

    # 工作区脏 -> 先 stash，拉取完再 pop
    stashed = False
    if working_dirty():
        print("[信息] 检测到未提交改动，先暂存（stash）以保证 rebase 顺利执行")
        if run(["git", "stash", "push", "-u", "-m", "pull.py auto stash"]) == 0:
            stashed = True
        else:
            print("[警告] stash 失败，若 rebase 报错请先手动提交或暂存改动")

    print("")
    print("=== 从 origin/%s 拉取并变基 ===" % BRANCH)
    rc = run(["git"] + auth + ["pull", "--rebase", "origin", BRANCH])
    if rc != 0:
        print("[提示] 常规变基失败，尝试 --allow-unrelated-histories")
        run(["git", "rebase", "--abort"])
        rc = run(["git"] + auth + ["pull", "--rebase", "origin", BRANCH, "--allow-unrelated-histories"])
        if rc != 0:
            print("")
            print("[错误] 拉取失败。若存在冲突，请手动处理：")
            print("        查看冲突：git status")
            print("        解决后：  git add -A && git rebase --continue")
            print("        放弃：    git rebase --abort")
            if stashed:
                print("        注意：已 stash 的改动需手动恢复：git stash pop")
            return 1

    if stashed:
        print("")
        print("[信息] 恢复之前暂存的改动")
        if run(["git", "stash", "pop"]) != 0:
            print("[警告] stash pop 有冲突，请手动处理：git status / git stash pop")

    print("")
    print("=== 当前状态 ===")
    subprocess.run(["git", "--no-pager", "log", "--oneline", "-5"])
    print("")
    print("[完成] 已同步到远程最新")
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
        print("[异常] pull.py 运行出错，详情如下：")
        traceback.print_exc()
        pause_close("按任意键关闭窗口...")
        sys.exit(rc)
    countdown_close()
    sys.exit(rc)
