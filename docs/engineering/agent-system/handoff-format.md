# Standard Handoff Format

**Version:** 1.0 · **Status:** Active
**Governing Playbook sections:** §3.5 (step 8 — structured result), §3.6 (information flow)
**Purpose:** The single response format every specialist uses to return work to the Orchestrator. The Orchestrator **rejects incomplete handoffs** and returns them to the specialist.
**Owner:** Orchestrator · **Consumers:** all specialists
**Update conditions:** Playbook §3.5/§3.6 changes.

---

Every specialist ends every task with all ten sections, in this order. Write "None" rather than omitting a section.

```markdown
## Handoff — <agent name> · <task title> · <date>

### 1. Task understood
<restatement of the task in the agent's own words>

### 2. Scope and owned files
<what was in bounds; files actually touched or inspected>

### 3. Evidence inspected
<files/tests/live state checked, with paths. Claims labelled: Verified fact / Assumption / Hypothesis>

### 4. Invariants applied
<which owned invariants were relevant and how they were honored>

### 5. Changes made or proposed
<diff summary, or "findings only — no changes">

### 6. Gates run
<which of the seven gates ran, with results; or "not applicable — <reason>">

### 7. Risks
<what could break; residual uncertainty>

### 8. Open decisions
<anything above `AI decides`, classified per spine §4>

### 9. Escalation required
<Yes/No + what and to whom>

### 10. Recommended next agent
<who should act next, or "none — ready for synthesis">
```

## Orchestrator acceptance check

Reject the handoff if: any section is missing · claims in §3 are unlabelled · §5 reports changes outside §2's scope · §6 omits a gate the change class requires · an item in §8 was resolved unilaterally instead of escalated.
