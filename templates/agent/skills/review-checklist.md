---
name: review-checklist
description: What to check before approving a change
---

# Review checklist

Before you call a change ready, check each point and say what you found.

1. **Correctness.** Does the code do what the description says? Name one input that would break it.
2. **Tests.** Is the new behaviour covered? Would a test fail if the change were reverted?
3. **Errors.** What happens when the network, the disk or the input fails?
4. **Security.** Any secret in the code, unchecked input, or new permission?
5. **Readability.** Could a teammate change this in six months without asking?

Report findings ordered by severity. Give file and line. Do not rewrite code that is fine.
