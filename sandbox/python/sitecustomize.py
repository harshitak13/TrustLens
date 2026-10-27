"""TrustLens Python hook. Python imports sitecustomize automatically when it is
on PYTHONPATH, so this runs in every python process in the sandbox.

Writes the same raw event lines as the Node hook ({t, stage, type, target,
detail}) to $TL_EVENTS. Uses sys.addaudithook for files, sockets, DNS and
processes, and patches os._Environ.__getitem__ for env reads (audit hooks
don't see those).
"""
import json
import os
import sys
import time

_LOG = os.environ.get("TL_EVENTS")
_STAGE = os.environ.get("TL_STAGE", "unknown")
_ARGV0 = sys.argv[0] if sys.argv else ""
_write = os.write
_open_fd = os.open
_busy = False


def _emit(type_, target, detail):
    global _busy
    if _busy or not _LOG:
        return
    _busy = True
    try:
        ev = {"t": int(time.time() * 1000), "stage": _STAGE, "type": type_, "target": str(target),
              "detail": {"pid": os.getpid(), "argv1": _ARGV0, **detail}}
        fd = _open_fd(_LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            _write(fd, (json.dumps(ev) + "\n").encode())
        finally:
            os.close(fd)
    except Exception:
        pass
    _busy = False


def _hook(event, args):
    if _busy:
        return
    try:
        if event == "open":
            path, mode = args[0], args[1]
            if isinstance(path, (str, bytes)) and not isinstance(path, int):
                op = "write" if mode and any(c in str(mode) for c in "wax+") else "read"
                _emit("file", os.fsdecode(path), {"op": op})
        elif event == "os.listdir":
            _emit("file", os.fsdecode(args[0] or "."), {"op": "list"})
        elif event == "socket.connect":
            addr = args[1]
            if isinstance(addr, tuple) and len(addr) >= 2:
                _emit("net", f"{addr[0]}:{addr[1]}", {"op": "connect"})
            else:
                _emit("net", f"unix:{addr}", {"op": "connect"})
        elif event == "socket.bind":
            addr = args[1]
            if isinstance(addr, tuple) and len(addr) >= 2 and addr[1]:
                _emit("listen", addr[1], {"op": "bind"})
        elif event == "socket.getaddrinfo":
            _emit("dns", args[0], {"op": "getaddrinfo"})
        elif event == "socket.gethostbyname":
            _emit("dns", args[0], {"op": "gethostbyname"})
        elif event == "subprocess.Popen":
            exe, argv = args[0], args[1]
            cmd = argv if isinstance(argv, str) else [os.fsdecode(a) for a in argv]
            target = cmd if isinstance(cmd, str) else os.fsdecode(exe or cmd[0])
            _emit("proc", target, {"op": "Popen", "args": [] if isinstance(cmd, str) else cmd[1:]})
        elif event == "os.system":
            _emit("proc", os.fsdecode(args[0]), {"op": "system", "shell": True})
        elif event in ("os.exec", "os.posix_spawn", "os.spawn"):
            _emit("proc", os.fsdecode(args[0]), {"op": event})
    except Exception:
        pass


# pip itself is noise. The build backend it starts (where setup.py code runs)
# is pip's _in_process.py; there we keep only network and process events,
# since its file and env activity is the build machinery.
_IS_PIP = sys.orig_argv[1:3] == ["-m", "pip"] or os.path.basename(_ARGV0) in ("pip", "pip3")
_IS_BACKEND = "_in_process" in _ARGV0
_STDLIB = os.path.dirname(os.__file__)
_ENV_PLUMBING = (os.__file__, os.path.join(_STDLIB, "_collections_abc.py"))


def _direct_caller_is_stdlib():
    """Skip os.py / Mapping mixins, then check who actually asked for the var.
    Stdlib callers (urllib proxy lookup, sysconfig, ...) enumerate the whole
    environment and are not the package's own reads."""
    f = sys._getframe(2)
    # os and _collections_abc are frozen in 3.11+, so their frames say "<frozen ...>".
    while f and (f.f_code.co_filename in _ENV_PLUMBING or f.f_code.co_filename.startswith("<frozen")):
        f = f.f_back
    return bool(f) and f.f_code.co_filename.startswith(_STDLIB) and "site-packages" not in f.f_code.co_filename


if _LOG and not _IS_PIP:
    if _IS_BACKEND:
        sys.addaudithook(lambda e, a: _hook(e, a) if e.startswith(("socket.", "subprocess.", "os.system", "os.exec", "os.posix_spawn")) else None)
    else:
        sys.addaudithook(_hook)
        _seen = set()
        _orig_getitem = os._Environ.__getitem__

        def _getitem(self, key):
            if self is os.environ and key not in _seen and not _busy and not _direct_caller_is_stdlib():
                _seen.add(key)
                _emit("env", key, {"op": "get"})
            return _orig_getitem(self, key)

        os._Environ.__getitem__ = _getitem
