---
name: Node runtime stream typings
description: TypeScript compatibility constraints for the Node runtime used by the API relay.
---

When spawning a process with `stdin: "ignore"` and configuring upgraded HTTP sockets, use the precise `ChildProcessByStdio`/`Readable` and `net.Socket` types rather than broad child-process or duplex types.

**Why:** The workspace uses newer Node type definitions whose overloads no longer accept the older `ChildProcessWithoutNullStreams` and generic upgrade-socket method assumptions.

**How to apply:** Preserve the runtime behavior, but type the process according to its actual stdio tuple and cast the upgrade socket only at the point where TCP keepalive methods are used.