# { "Depends": "py-genlayer:latest" }
"""
GrantOS — Decentralised Grant Management & Milestone Verification
GenLayer Intelligent Contract (Bradbury testnet)

Implements:
  - Escrowed grant creation with milestone amounts that must sum to total_amount
  - Sequential milestone completion (no skipping ahead)
  - AI milestone verification via the Equivalence Principle (leader + independent validator)
  - "partial" NEVER auto-releases funds -> always routed to pending_review
  - "completed" verdicts below QUALITY_AUTO_APPROVE_THRESHOLD are downgraded to
    partial/pending review, even though the LLM called them "completed"
  - A stable get_grant_progress() schema for dashboard integrations

Storage note: ordered/list-like data (milestone order, completed-milestone list,
criteria arrays) is kept as JSON-encoded `str` fields rather than `DynArray[...]`.
Nested `DynArray` fields inside custom dataclasses cannot currently be built with
`gl.storage.inmem_allocate` on the pinned SDK build this contract targets
(py-genlayer / genvm v0.2.12) — `TreeMap[...]` allocates fine, JSON strings are
simplest and calldata-safe, so both are used instead. Re-check this on newer SDK
releases before switching back to DynArray.
"""

from genlayer import *
from dataclasses import dataclass
import json

# ---------------------------------------------------------------------------
# Named constants (session rule #5: no magic numbers)
# ---------------------------------------------------------------------------
QUALITY_AUTO_APPROVE_THRESHOLD = 70          # 0-100. Below this -> forced partial review.
QUALITY_SCORE_TOLERANCE = 10                 # +/- tolerance validators allow between two LLM runs
CRITERIA_OVERLAP_THRESHOLD = 0.75            # 75% overlap required on criteria_met (session spec)
MAX_EVIDENCE_URLS = 5
MAX_EVIDENCE_CHARS_PER_URL = 2000

STATUS_ACTIVE = "active"
STATUS_COMPLETED = "completed"

MSTATUS_COMPLETED = "completed"
MSTATUS_PARTIAL = "partial"
MSTATUS_NOT_COMPLETED = "not_completed"

# Deterministic-error tag (see GenLayer docs on run_nondet_unsafe error handling)
ERR_EXPECTED = "[EXPECTED]"


# ---------------------------------------------------------------------------
# Storage dataclasses (@allow_storage required to live inside TreeMap values).
# Every field below is a primitive (str / u256) -- no nested generics -- so
# these can be constructed directly with normal Python syntax.
# ---------------------------------------------------------------------------
@allow_storage
@dataclass
class Milestone:
    title: str
    criteria: str
    amount: u256


@allow_storage
@dataclass
class MilestoneResult:
    grant_id: str
    milestone_id: str
    llm_status: str            # raw LLM verdict: completed / partial / not_completed
    final_status: str          # what actually happened after our gating rules
    quality_score: u256
    confidence: str
    criteria_met_json: str      # JSON-encoded list[str]
    criteria_not_met_json: str  # JSON-encoded list[str]
    feedback: str
    evaluation_seq: u256        # contract-tracked monotonic counter, NOT a block number:
                                 # GenVM's gl.message exposes no block-height field, so a
                                 # real "evaluated_at_block" isn't available to an IC.


@allow_storage
@dataclass
class Grant:
    funder: Address
    grantee: Address
    project_description: str
    milestones: TreeMap[str, Milestone]   # milestone_id -> Milestone
    milestone_order_json: str             # JSON-encoded list[str], defines the sequence
    total_amount: u256
    released: u256
    status: str
    completed_milestones_json: str        # JSON-encoded list[str]
    pending_review: str                   # milestone_id under human review, "" if none


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------
class GrantOS(gl.Contract):
    grants: TreeMap[str, Grant]
    milestone_results: TreeMap[str, MilestoneResult]
    next_eval_seq: u256

    def __init__(self):
        self.next_eval_seq = u256(0)

    # -------------------------------------------------------------------
    # Funder: create a grant and escrow the GEN for it
    # -------------------------------------------------------------------
    @gl.public.write.payable
    def create_grant(
        self,
        grant_id: str,
        grantee: str,
        project_description: str,
        milestone_ids: list[str],
        milestone_titles: list[str],
        milestone_criteria: list[str],
        milestone_amounts: list[int],
        total_amount: int,
    ) -> None:
        if grant_id in self.grants:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant_id already exists")

        # Storage keys for milestone results are built as f"{grant_id}:{milestone_id}".
        # If either half were allowed to contain ':', two different (grant, milestone)
        # pairs could collide on the same key -- e.g. grant_id="foo:bar" milestone "baz"
        # produces the same key as grant_id="foo" milestone "bar:baz". Reject ':' in
        # both to make that collision structurally impossible rather than just unlikely.
        if ":" in grant_id:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant_id must not contain ':'")
        for mid in milestone_ids:
            if ":" in mid:
                raise gl.vm.UserError(f"{ERR_EXPECTED} milestone id '{mid}' must not contain ':'")

        n = len(milestone_ids)
        if not (len(milestone_titles) == n and len(milestone_criteria) == n and len(milestone_amounts) == n):
            raise gl.vm.UserError(f"{ERR_EXPECTED} milestone arrays must be the same length")
        if n == 0:
            raise gl.vm.UserError(f"{ERR_EXPECTED} at least one milestone is required")
        if len(set(milestone_ids)) != n:
            raise gl.vm.UserError(f"{ERR_EXPECTED} milestone_ids must be unique")

        # Without this, a negative amount slips past every check above and only
        # fails deep inside u256(...) with a raw, untagged, unfriendly error
        # ("can't convert negative int to unsigned") -- confirmed directly.
        # Reject clearly and consistently with every other validation here.
        if int(total_amount) <= 0:
            raise gl.vm.UserError(f"{ERR_EXPECTED} total_amount must be positive")
        for amt in milestone_amounts:
            if int(amt) < 0:
                raise gl.vm.UserError(f"{ERR_EXPECTED} milestone amounts must not be negative")

        # Rule #2: amounts must sum to total_amount exactly, or the transaction reverts.
        computed_total = sum(int(a) for a in milestone_amounts)
        if computed_total != int(total_amount):
            raise gl.vm.UserError(
                f"{ERR_EXPECTED} milestone amounts sum to {computed_total}, expected {total_amount}"
            )

        # Escrow check: funder must send exactly total_amount in GEN. Not ">=" --
        # this contract has no refund/withdraw path, so any overpayment would be
        # permanently stuck. Requiring an exact match fails the transaction
        # loudly instead of silently locking the funder's extra GEN.
        if gl.message.value != u256(total_amount):
            raise gl.vm.UserError(
                f"{ERR_EXPECTED} escrow must equal total_amount exactly: sent {gl.message.value}, need {total_amount}"
            )

        try:
            grantee_address = Address(grantee)
        except Exception:
            raise gl.vm.UserError(f"{ERR_EXPECTED} '{grantee}' is not a valid address")

        milestones = gl.storage.inmem_allocate(TreeMap[str, Milestone])
        for i in range(n):
            milestones[milestone_ids[i]] = Milestone(
                title=milestone_titles[i],
                criteria=milestone_criteria[i],
                amount=u256(milestone_amounts[i]),
            )

        self.grants[grant_id] = Grant(
            funder=gl.message.sender_address,
            grantee=grantee_address,
            project_description=project_description,
            milestones=milestones,
            milestone_order_json=json.dumps(list(milestone_ids)),
            total_amount=u256(total_amount),
            released=u256(0),
            status=STATUS_ACTIVE,
            completed_milestones_json=json.dumps([]),
            pending_review="",
        )

    # -------------------------------------------------------------------
    # Grantee: submit evidence for a milestone -> AI verification
    # -------------------------------------------------------------------
    @gl.public.write
    def submit_milestone(
        self,
        grant_id: str,
        milestone_id: str,
        report_text: str,
        evidence_urls: list[str],
    ) -> None:
        if grant_id not in self.grants:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant not found")

        grant = self.grants[grant_id]
        caller = gl.message.sender_address

        if caller != grant.grantee:
            raise gl.vm.UserError(f"{ERR_EXPECTED} only the grantee can submit milestones")
        if grant.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant is not active")

        completed = json.loads(grant.completed_milestones_json)
        if milestone_id in completed:
            raise gl.vm.UserError(f"{ERR_EXPECTED} milestone already completed")

        if milestone_id not in grant.milestones:
            raise gl.vm.UserError(f"{ERR_EXPECTED} milestone '{milestone_id}' not found on this grant")
        milestone = grant.milestones[milestone_id]

        # Rule #3: sequential completion. Cannot submit milestone N until N-1 is completed.
        order = json.loads(grant.milestone_order_json)
        idx = order.index(milestone_id)
        if idx > 0:
            prev_id = order[idx - 1]
            if prev_id not in completed:
                raise gl.vm.UserError(
                    f"{ERR_EXPECTED} must complete milestone '{prev_id}' before '{milestone_id}'"
                )

        # Copy everything the non-deterministic block needs into plain memory values
        # (storage objects cannot be touched inside leader_fn/validator_fn).
        project_description = str(grant.project_description)
        m_title = str(milestone.title)
        m_criteria = str(milestone.criteria)
        urls = list(evidence_urls)[:MAX_EVIDENCE_URLS]
        report = str(report_text)

        def leader_fn():
            return _evaluate_milestone(project_description, m_title, m_criteria, report, urls)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            try:
                validator_data = leader_fn()
            except Exception:
                return False
            return _milestones_equivalent(leader_data, validator_data)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        llm_status = result["status"]
        quality_score = int(result["quality_score"])
        confidence = result["confidence"]

        # Rule #4 + #5: gating logic. "partial" NEVER auto-releases. A "completed"
        # verdict below the quality threshold is downgraded to a pending review,
        # regardless of what the LLM said.
        if llm_status == MSTATUS_COMPLETED and confidence in ("high", "medium") and quality_score >= QUALITY_AUTO_APPROVE_THRESHOLD:
            final_status = MSTATUS_COMPLETED
        elif llm_status == MSTATUS_NOT_COMPLETED:
            final_status = MSTATUS_NOT_COMPLETED
        else:
            # covers: llm partial, low/absent confidence, or completed-but-low-quality
            final_status = MSTATUS_PARTIAL

        result_key = f"{grant_id}:{milestone_id}"
        self.next_eval_seq = self.next_eval_seq + u256(1)
        self.milestone_results[result_key] = MilestoneResult(
            grant_id=grant_id,
            milestone_id=milestone_id,
            llm_status=llm_status,
            final_status=final_status,
            quality_score=u256(max(0, min(100, quality_score))),
            confidence=confidence,
            criteria_met_json=json.dumps(result.get("criteria_met", [])),
            criteria_not_met_json=json.dumps(result.get("criteria_not_met", [])),
            feedback=str(result.get("feedback", "")),
            evaluation_seq=self.next_eval_seq,
        )

        if final_status == MSTATUS_COMPLETED:
            completed.append(milestone_id)
            grant.completed_milestones_json = json.dumps(completed)
            grant.released = grant.released + milestone.amount
            grant.pending_review = ""

            if set(completed) == set(order):
                grant.status = STATUS_COMPLETED

            _pay_grantee(grant.grantee, milestone.amount)

        elif final_status == MSTATUS_PARTIAL:
            # Flag for human/funder review. No funds move. No hard rejection either.
            grant.pending_review = milestone_id

        else:  # not_completed
            grant.pending_review = ""

        self.grants[grant_id] = grant

    # -------------------------------------------------------------------
    # Funder: after inspecting a "partial" verdict, manually approve or reject
    # -------------------------------------------------------------------
    @gl.public.write
    def resolve_pending_review(self, grant_id: str, milestone_id: str, approve: bool) -> None:
        if grant_id not in self.grants:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant not found")
        grant = self.grants[grant_id]

        if gl.message.sender_address != grant.funder:
            raise gl.vm.UserError(f"{ERR_EXPECTED} only the funder can resolve a pending review")
        if grant.pending_review != milestone_id:
            raise gl.vm.UserError(f"{ERR_EXPECTED} milestone '{milestone_id}' is not pending review")
        if milestone_id not in grant.milestones:
            raise gl.vm.UserError(f"{ERR_EXPECTED} milestone not found")

        milestone = grant.milestones[milestone_id]
        grant.pending_review = ""

        if approve:
            completed = json.loads(grant.completed_milestones_json)
            completed.append(milestone_id)
            grant.completed_milestones_json = json.dumps(completed)
            grant.released = grant.released + milestone.amount

            order = json.loads(grant.milestone_order_json)
            if set(completed) == set(order):
                grant.status = STATUS_COMPLETED

            _pay_grantee(grant.grantee, milestone.amount)

        result_key = f"{grant_id}:{milestone_id}"
        if result_key in self.milestone_results:
            r = self.milestone_results[result_key]
            r.final_status = MSTATUS_COMPLETED if approve else MSTATUS_NOT_COMPLETED
            self.milestone_results[result_key] = r

        self.grants[grant_id] = grant

    # -------------------------------------------------------------------
    # Views
    # -------------------------------------------------------------------
    @gl.public.view
    def get_grant(self, grant_id: str) -> dict:
        if grant_id not in self.grants:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant not found")
        grant = self.grants[grant_id]
        order = json.loads(grant.milestone_order_json)
        return {
            "funder": str(grant.funder),
            "grantee": str(grant.grantee),
            "project_description": grant.project_description,
            "milestones": [
                {
                    "id": mid,
                    "title": grant.milestones[mid].title,
                    "criteria": grant.milestones[mid].criteria,
                    "amount": int(grant.milestones[mid].amount),
                }
                for mid in order
            ],
            "total_amount": int(grant.total_amount),
            "released": int(grant.released),
            "status": grant.status,
            "completed_milestones": json.loads(grant.completed_milestones_json),
            "pending_review": grant.pending_review,
        }

    @gl.public.view
    def get_milestone_result(self, grant_id: str, milestone_id: str) -> dict:
        key = f"{grant_id}:{milestone_id}"
        if key not in self.milestone_results:
            return {}
        r = self.milestone_results[key]
        return {
            "grant_id": r.grant_id,
            "milestone_id": r.milestone_id,
            "llm_status": r.llm_status,
            "final_status": r.final_status,
            "quality_score": int(r.quality_score),
            "confidence": r.confidence,
            "criteria_met": json.loads(r.criteria_met_json),
            "criteria_not_met": json.loads(r.criteria_not_met_json),
            "feedback": r.feedback,
            "evaluation_seq": int(r.evaluation_seq),
        }

    @gl.public.view
    def get_grant_progress(self, grant_id: str) -> dict:
        """Stable schema for dashboard integrations (session rule #6)."""
        if grant_id not in self.grants:
            raise gl.vm.UserError(f"{ERR_EXPECTED} grant not found")
        grant = self.grants[grant_id]
        order = json.loads(grant.milestone_order_json)
        completed = json.loads(grant.completed_milestones_json)
        total_milestones = len(order)
        n_completed = len(completed)
        return {
            "completed_milestones": n_completed,
            "total_milestones": total_milestones,
            "progress_pct": (n_completed * 100) // total_milestones if total_milestones else 0,
            "amount_released": int(grant.released),
            "amount_remaining": int(grant.total_amount) - int(grant.released),
            "status": grant.status,
            "pending_review": grant.pending_review,
        }


# ---------------------------------------------------------------------------
# Non-deterministic helpers (run inside leader_fn / validator_fn — pure functions,
# no storage access)
# ---------------------------------------------------------------------------
def _evaluate_milestone(project_description: str, milestone_title: str, milestone_criteria: str,
                         report_text: str, evidence_urls: list) -> dict:
    evidence = ""
    for url in evidence_urls:
        try:
            page = gl.nondet.web.get(url)
            body = page.body
            if isinstance(body, (bytes, bytearray)):
                body = body.decode("utf-8", errors="ignore")
            evidence += f"\n\n--- Evidence from {url} ---\n{str(body)[:MAX_EVIDENCE_CHARS_PER_URL]}"
        except Exception as e:
            evidence += f"\n\n--- {url}: could not fetch ({e}) ---"

    prompt = f"""You are a grant milestone reviewer for a blockchain development grant program.

PROJECT DESCRIPTION:
"{project_description}"

MILESTONE BEING EVALUATED:
Title: "{milestone_title}"
Success Criteria: "{milestone_criteria}"

GRANTEE'S REPORT:
"{report_text}"

EVIDENCE FROM SUBMITTED LINKS:{evidence}

Evaluate whether this milestone has been genuinely completed.

Be honest and thorough. Check:
1. Does the evidence actually demonstrate the milestone criteria are met?
2. Is the work substantive (not just scaffolding or a placeholder)?
3. Is the quality sufficient for a funded grant milestone?

Respond ONLY with JSON, no other text:
{{
  "status": "completed" | "partial" | "not_completed",
  "quality_score": 0-100,
  "criteria_met": ["list of criteria that are demonstrably met"],
  "criteria_not_met": ["list of criteria NOT yet met"],
  "feedback": "3-4 sentences of specific, actionable feedback",
  "confidence": "high" | "medium" | "low"
}}"""

    raw = gl.nondet.exec_prompt(prompt, response_format="json")
    data = raw if isinstance(raw, dict) else json.loads(_extract_json(raw))

    status = data.get("status", "not_completed")
    if status not in (MSTATUS_COMPLETED, MSTATUS_PARTIAL, MSTATUS_NOT_COMPLETED):
        status = MSTATUS_NOT_COMPLETED

    confidence = data.get("confidence", "low")
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    try:
        quality_score = int(data.get("quality_score", 0))
    except (TypeError, ValueError):
        quality_score = 0
    quality_score = max(0, min(100, quality_score))

    return {
        "status": status,
        "quality_score": quality_score,
        "criteria_met": [str(x) for x in data.get("criteria_met", [])],
        "criteria_not_met": [str(x) for x in data.get("criteria_not_met", [])],
        "feedback": str(data.get("feedback", ""))[:1000],
        "confidence": confidence,
    }


def _extract_json(raw: str) -> str:
    """LLMs sometimes wrap JSON in prose or code fences; pull out the object."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end < start:
        return raw
    return raw[start:end + 1]


def _milestones_equivalent(leader_data: dict, validator_data: dict) -> bool:
    """Equivalence Principle validator: independent re-derivation, not a schema check.

    - status must match exactly
    - confidence must match exactly
    - quality_score within +/- QUALITY_SCORE_TOLERANCE
    - >= CRITERIA_OVERLAP_THRESHOLD overlap between criteria_met sets
    """
    if leader_data["status"] != validator_data["status"]:
        return False
    if leader_data["confidence"] != validator_data["confidence"]:
        return False
    if abs(leader_data["quality_score"] - validator_data["quality_score"]) > QUALITY_SCORE_TOLERANCE:
        return False

    lm = set(x.strip().lower() for x in leader_data["criteria_met"] if x.strip())
    vm_ = set(x.strip().lower() for x in validator_data["criteria_met"] if x.strip())
    union = lm | vm_
    if union:
        overlap = len(lm & vm_) / len(union)
        if overlap < CRITERIA_OVERLAP_THRESHOLD:
            return False

    return True


@gl.evm.contract_interface
class _ExternalRecipient:
    """Used to send GEN to a grantee's wallet (EOA) — an external message,
    per GenLayer's value-transfer docs for sending to addresses outside this IC."""
    class View:
        pass
    class Write:
        pass


def _pay_grantee(grantee: Address, amount: u256) -> None:
    _ExternalRecipient(grantee).emit_transfer(value=amount)
