"""
End-to-end tests for GrantOS, run against the real GenVM direct-mode engine
(gltest.direct) — not a mock re-implementation of the contract.

Run with:  python3 test_grantos.py
"""
import json
import os
import time
import traceback
from pathlib import Path

from gltest.direct import VMContext, deploy_contract, create_address

CONTRACT_PATH = Path(__file__).parent / "grantos.py"
SDK_VERSION = "v0.2.12"  # pinned: 'latest' resolves to a pre-release with no artifacts

PASSED = []
FAILED = []


def check(name, cond, detail=""):
    if cond:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL  {name}  {detail}")


def new_vm():
    vm = VMContext()
    return vm


def addr_str(addr_bytes: bytes) -> str:
    """create_address() returns raw 20-byte addresses; Address(str) wants 0x-hex."""
    return "0x" + addr_bytes.hex()


def llm_response(status, quality_score, criteria_met=None, criteria_not_met=None,
                  feedback="Looks good.", confidence="high"):
    return json.dumps({
        "status": status,
        "quality_score": quality_score,
        "criteria_met": criteria_met or ["deployed contract", "verified on explorer"],
        "criteria_not_met": criteria_not_met or [],
        "feedback": feedback,
        "confidence": confidence,
    })


# ---------------------------------------------------------------------------
def test_amount_mismatch_reverts():
    print("\n[1] create_grant reverts when milestone amounts don't sum to total_amount")
    vm = new_vm()
    funder = create_address("funder")
    grantee = create_address("grantee")
    vm.sender = funder
    vm.deal(funder, 10_000)

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        reverted = False
        try:
            vm.value = 1000
            contract.create_grant(
                "g1", addr_str(grantee), "Build a thing",
                ["M1", "M2"], ["Deploy", "Frontend"], ["deploy criteria", "frontend criteria"],
                [200, 300],  # sums to 500, not 1000
                1000,
            )
        except Exception as e:
            reverted = True
            msg = str(e)
        check("amount mismatch raises", reverted)
        check("error message mentions sum", reverted and "sum" in msg.lower(), msg if reverted else "")
        vm.value = 0


def test_happy_path_auto_release():
    print("\n[2] Happy path: funder creates grant -> grantee submits M1 -> AI verifies -> tranche released")
    vm = new_vm()
    funder = create_address("funder2")
    grantee = create_address("grantee2")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)

        vm.sender = funder
        vm.value = 1000
        contract.create_grant(
            "g2", addr_str(grantee), "Build GrantOS",
            ["M1", "M2"], ["Deploy contract", "Frontend live"],
            ["Contract deployed on Bradbury", "Frontend deployed and demoable"],
            [400, 600], 1000,
        )
        vm.value = 0

        grant = contract.get_grant("g2")
        check("grant created with correct total", grant["total_amount"] == 1000)
        check("nothing released yet", grant["released"] == 0)

        vm.sender = grantee
        vm.mock_web(r"github\.com/example/grantos", {"status": 200, "body": "GrantOS repo. Deployed to Bradbury testnet. Tx: 0xabc123."})
        vm.mock_llm(r".*", llm_response("completed", 85))

        contract.submit_milestone(
            "g2", "M1", "Deployed the GrantOS contract to Bradbury.",
            ["https://github.com/example/grantos"],
        )

        grant = contract.get_grant("g2")
        result = contract.get_milestone_result("g2", "M1")
        check("M1 marked completed", "M1" in grant["completed_milestones"])
        check("M1 tranche released (400)", grant["released"] == 400, f"released={grant['released']}")
        check("milestone result stored with final_status completed", result["final_status"] == "completed")
        check("quality score stored", result["quality_score"] == 85)

        progress = contract.get_grant_progress("g2")
        check("progress schema has all keys", set(progress.keys()) == {
            "completed_milestones", "total_milestones", "progress_pct",
            "amount_released", "amount_remaining", "status", "pending_review",
        })
        check("progress_pct is 50", progress["progress_pct"] == 50)


def test_sequential_enforcement():
    print("\n[3] Cannot submit M2 before M1 is completed")
    vm = new_vm()
    funder = create_address("funder3")
    grantee = create_address("grantee3")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant(
            "g3", addr_str(grantee), "desc", ["M1", "M2"], ["t1", "t2"], ["c1", "c2"], [50, 50], 100
        )
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("completed", 90))
        blocked = False
        try:
            contract.submit_milestone("g3", "M2", "skipping ahead", [])
        except Exception as e:
            blocked = True
            msg = str(e)
        check("submitting M2 before M1 is blocked", blocked)
        check("error explains ordering", blocked and "before" in msg.lower(), msg if blocked else "")


def test_quality_below_threshold_forces_partial():
    print("\n[4] A 'completed' LLM verdict below the quality threshold is downgraded to partial (no funds move)")
    vm = new_vm()
    funder = create_address("funder4")
    grantee = create_address("grantee4")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g4", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = grantee
        # LLM says "completed" but quality is only 55 -- below QUALITY_AUTO_APPROVE_THRESHOLD (70)
        vm.mock_llm(r".*", llm_response("completed", 55))
        contract.submit_milestone("g4", "M1", "barely done", [])

        grant = contract.get_grant("g4")
        result = contract.get_milestone_result("g4", "M1")
        check("milestone NOT marked completed despite LLM saying so", "M1" not in grant["completed_milestones"])
        check("no funds released", grant["released"] == 0)
        check("routed to pending_review", grant["pending_review"] == "M1")
        check("stored final_status is partial (not completed)", result["final_status"] == "partial")
        check("raw llm_status preserved for audit", result["llm_status"] == "completed")


def test_partial_never_autoreleases_and_funder_can_resolve():
    print("\n[5] A genuine 'partial' verdict never auto-releases; funder can manually approve afterward")
    vm = new_vm()
    funder = create_address("funder5")
    grantee = create_address("grantee5")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g5", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("partial", 60, criteria_not_met=["needs tests"]))
        contract.submit_milestone("g5", "M1", "mostly done", [])

        grant = contract.get_grant("g5")
        check("partial verdict releases nothing", grant["released"] == 0)
        check("flagged pending_review", grant["pending_review"] == "M1")

        # Funder inspects the evidence off-chain, then approves manually.
        vm.sender = funder
        contract.resolve_pending_review("g5", "M1", True)

        grant = contract.get_grant("g5")
        check("funder approval releases funds", grant["released"] == 100)
        check("milestone now completed", "M1" in grant["completed_milestones"])
        check("pending_review cleared", grant["pending_review"] == "")


def test_not_completed_rejects_with_feedback():
    print("\n[6] not_completed verdict rejects cleanly with feedback, no funds move")
    vm = new_vm()
    funder = create_address("funder6")
    grantee = create_address("grantee6")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g6", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("not_completed", 10, criteria_met=[],
                                         criteria_not_met=["nothing deployed"],
                                         feedback="No deployment evidence found."))
        contract.submit_milestone("g6", "M1", "I'll do it later", [])

        grant = contract.get_grant("g6")
        result = contract.get_milestone_result("g6", "M1")
        check("nothing released", grant["released"] == 0)
        check("not marked completed", "M1" not in grant["completed_milestones"])
        check("no pending_review (clean rejection)", grant["pending_review"] == "")
        check("feedback stored for grantee", "deployment" in result["feedback"].lower())


def test_only_grantee_can_submit():
    print("\n[7] Only the designated grantee can submit milestones")
    vm = new_vm()
    funder = create_address("funder7")
    grantee = create_address("grantee7")
    imposter = create_address("imposter7")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g7", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = imposter
        vm.mock_llm(r".*", llm_response("completed", 95))
        blocked = False
        try:
            contract.submit_milestone("g7", "M1", "not mine to submit", [])
        except Exception:
            blocked = True
        check("imposter submission blocked", blocked)


def test_validator_disagreement_forces_undetermined():
    print("\n[8] Equivalence Principle: validator independently re-runs and must agree with leader")
    vm = new_vm()
    funder = create_address("funder8")
    grantee = create_address("grantee8")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g8", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("completed", 90))
        contract.submit_milestone("g8", "M1", "done", [])

        # Force the captured validator to see a wildly different leader result
        # (simulating a malicious/erroneous leader) and confirm it disagrees.
        disagreeing_leader_result = {
            "status": "not_completed", "quality_score": 5,
            "criteria_met": [], "criteria_not_met": ["nothing"],
            "feedback": "bad", "confidence": "high",
        }
        agrees = vm.run_validator(leader_result=disagreeing_leader_result)
        check("validator rejects a leader result that disagrees with its own evaluation", agrees is False)


def test_duplicate_grant_id_rejected():
    print("\n[9] create_grant reverts if grant_id already exists")
    vm = new_vm()
    funder = create_address("funder9")
    grantee = create_address("grantee9")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g9", addr_str(grantee), "d", ["M1"], ["t1"], ["c1"], [100], 100)
        blocked = False
        try:
            contract.create_grant("g9", addr_str(grantee), "d2", ["M1"], ["t1"], ["c1"], [50], 50)
        except Exception:
            blocked = True
        check("duplicate grant_id is rejected", blocked)
        vm.value = 0


def test_full_multi_milestone_completion():
    print("\n[10] Completing every milestone flips grant.status to 'completed' and releases 100%")
    vm = new_vm()
    funder = create_address("funder10")
    grantee = create_address("grantee10")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 1000
        contract.create_grant(
            "g10", addr_str(grantee), "d", ["M1", "M2"], ["t1", "t2"], ["c1", "c2"], [400, 600], 1000
        )
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("completed", 90))
        contract.submit_milestone("g10", "M1", "done 1", [])
        contract.submit_milestone("g10", "M2", "done 2", [])

        grant = contract.get_grant("g10")
        progress = contract.get_grant_progress("g10")
        check("both milestones completed", set(grant["completed_milestones"]) == {"M1", "M2"})
        check("full amount released", grant["released"] == 1000)
        check("grant status flips to completed", grant["status"] == "completed")
        check("progress_pct is 100", progress["progress_pct"] == 100)
        check("amount_remaining is 0", progress["amount_remaining"] == 0)


def test_resubmit_after_rejection_can_succeed():
    print("\n[11] A grantee can resubmit after a not_completed rejection, and it can then succeed")
    vm = new_vm()
    funder = create_address("funder11")
    grantee = create_address("grantee11")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g11", addr_str(grantee), "d", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("not_completed", 5, criteria_met=[]))
        contract.submit_milestone("g11", "M1", "weak attempt", [])
        grant = contract.get_grant("g11")
        check("first attempt not completed", "M1" not in grant["completed_milestones"])

        vm.clear_mocks()  # mock_llm matches the FIRST registered pattern, not the latest
        vm.mock_llm(r".*", llm_response("completed", 95))
        contract.submit_milestone("g11", "M1", "much better now", [])
        grant = contract.get_grant("g11")
        check("resubmission can succeed", "M1" in grant["completed_milestones"])
        check("funds released on resubmission", grant["released"] == 100)


def test_resolve_pending_review_guards():
    print("\n[12] resolve_pending_review rejects non-funders and no-op calls with no review pending")
    vm = new_vm()
    funder = create_address("funder12")
    grantee = create_address("grantee12")
    imposter = create_address("imposter12")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g12", addr_str(grantee), "d", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        # Nothing pending yet -> should be rejected
        blocked = False
        try:
            contract.resolve_pending_review("g12", "M1", True)
        except Exception:
            blocked = True
        check("resolving with nothing pending is rejected", blocked)

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("partial", 60))
        contract.submit_milestone("g12", "M1", "mostly done", [])

        vm.sender = imposter
        blocked = False
        try:
            contract.resolve_pending_review("g12", "M1", True)
        except Exception:
            blocked = True
        check("non-funder cannot resolve a pending review", blocked)

        # funds must still be untouched
        grant = contract.get_grant("g12")
        check("funds still locked after blocked attempts", grant["released"] == 0)


def test_unknown_grant_lookups_raise_clear_errors():
    print("\n[13] get_grant / get_grant_progress raise a clear error for an unknown grant_id (not a raw KeyError)")
    vm = new_vm()
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        for fn, args in [(contract.get_grant, ("nope",)), (contract.get_grant_progress, ("nope",))]:
            blocked = False
            msg = ""
            try:
                fn(*args)
            except Exception as e:
                blocked = True
                msg = str(e)
            check(f"{fn.__name__} raises for unknown grant", blocked)
            check(f"{fn.__name__} error is clear, not a raw KeyError", "not found" in msg.lower(), msg)

        # get_milestone_result intentionally returns {} instead of raising -- confirm that contract too
        result = contract.get_milestone_result("nope", "M1")
        check("get_milestone_result returns {} for unknown grant (documented behavior)", result == {})


def test_escrow_must_match_exactly():
    print("\n[14] create_grant reverts on both under- and over-payment (no refund path exists, so overpay must revert too)")
    vm = new_vm()
    funder = create_address("funder14")
    grantee = create_address("grantee14")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder

        vm.value = 50  # underpay
        blocked = False
        try:
            contract.create_grant("g14a", addr_str(grantee), "d", ["M1"], ["t1"], ["c1"], [100], 100)
        except Exception:
            blocked = True
        check("underpaying the escrow reverts", blocked)

        vm.value = 150  # overpay
        blocked = False
        try:
            contract.create_grant("g14b", addr_str(grantee), "d", ["M1"], ["t1"], ["c1"], [100], 100)
        except Exception:
            blocked = True
        check("overpaying the escrow reverts (prevents permanently stuck GEN)", blocked)
        vm.value = 0


def test_invalid_grantee_address_rejected():
    print("\n[15] create_grant rejects a malformed grantee address with a clear error")
    vm = new_vm()
    funder = create_address("funder15")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        blocked = False
        msg = ""
        try:
            contract.create_grant("g15", "not-an-address", "d", ["M1"], ["t1"], ["c1"], [100], 100)
        except Exception as e:
            blocked = True
            msg = str(e)
        check("malformed grantee address is rejected", blocked)
        check("error message is clear", "not a valid address" in msg.lower(), msg)
        vm.value = 0


def test_evaluation_seq_is_real_and_monotonic():
    print("\n[16] evaluation_seq (replacing the nonexistent gl.block.number) is real and increases across submissions")
    vm = new_vm()
    funder = create_address("funder16")
    grantee = create_address("grantee16")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 200
        contract.create_grant("g16", addr_str(grantee), "d", ["M1", "M2"], ["t1", "t2"], ["c1", "c2"], [100, 100], 200)
        vm.value = 0

        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("completed", 90))
        contract.submit_milestone("g16", "M1", "done", [])
        r1 = contract.get_milestone_result("g16", "M1")
        contract.submit_milestone("g16", "M2", "done", [])
        r2 = contract.get_milestone_result("g16", "M2")

        check("evaluation_seq is nonzero (not the old always-0 fake block number)", r1["evaluation_seq"] > 0)
        check("evaluation_seq increases across submissions", r2["evaluation_seq"] > r1["evaluation_seq"])


def test_colon_in_ids_rejected_to_prevent_key_collisions():
    print("\n[17] grant_id/milestone_id containing ':' are rejected (prevents storage-key collisions across grants)")
    vm = new_vm()
    funder = create_address("funder17")
    grantee = create_address("grantee17")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder

        vm.value = 100
        blocked = False
        try:
            contract.create_grant("foo:bar", addr_str(grantee), "d", ["baz"], ["t"], ["c"], [100], 100)
        except Exception:
            blocked = True
        check("':' in grant_id is rejected", blocked)
        vm.value = 0

        vm.value = 100
        blocked = False
        try:
            contract.create_grant("g17", addr_str(grantee), "d", ["bar:baz"], ["t"], ["c"], [100], 100)
        except Exception:
            blocked = True
        check("':' in a milestone id is rejected", blocked)
        vm.value = 0

        # Confirm the two previously-colliding grants can now coexist safely.
        vm.value = 100
        contract.create_grant("foo", addr_str(grantee), "d1", ["bar"], ["t1"], ["c1"], [100], 100)
        vm.value = 0
        vm.sender = grantee
        vm.mock_llm(r".*", llm_response("completed", 90))
        contract.submit_milestone("foo", "bar", "evidence", [])
        result = contract.get_milestone_result("foo", "bar")
        check("legitimate grant/milestone ids without ':' still work normally", result["final_status"] == "completed")


def test_negative_and_zero_amounts_rejected_with_clear_errors():
    print("\n[18] Negative milestone amounts and non-positive total_amount are rejected with clear errors, not a raw u256 conversion error")
    vm = new_vm()
    funder = create_address("funder18")
    grantee = create_address("grantee18")
    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder

        vm.value = 1000
        blocked = False
        msg = ""
        try:
            contract.create_grant("g18a", addr_str(grantee), "d", ["M1", "M2"], ["t1", "t2"], ["c1", "c2"], [-100, 1100], 1000)
        except Exception as e:
            blocked = True
            msg = str(e)
        check("negative milestone amount is rejected", blocked)
        check("error message is clear, not a raw u256 conversion error", "negative" in msg.lower(), msg)
        vm.value = 0

        vm.value = 0
        blocked = False
        try:
            contract.create_grant("g18b", addr_str(grantee), "d", ["M1"], ["t1"], ["c1"], [0], 0)
        except Exception:
            blocked = True
        check("zero total_amount is rejected", blocked)


def test_slow_single_request_halts_fetch_phase_within_budget():
    print("\n[19] A single evidence request that runs past its per-request time budget halts the fetch phase -- one slow request can neither be followed by more fetches nor push the evaluation past the leader time budget")
    vm = new_vm()
    funder = create_address("funder19")
    grantee = create_address("grantee19")

    # The reviewer's case: the old loop only checked the deadline *before* each
    # request, so a request that was under the aggregate deadline was always
    # followed by another fetch -- N moderately-slow pages compounded into N*delay
    # of leader work. gl.nondet.web.get has no socket timeout, so each ran to
    # completion serially inside leader_fn.
    #
    # The fix enforces a *per-request* ceiling (budget / MAX_EVIDENCE_URLS),
    # checked the moment each call returns: the first request that overruns its own
    # slice ends the phase immediately. Below, the budget is 0.9s so the per-request
    # ceiling is 0.9/3 = 0.3s, and each server takes 0.4s, so:
    #   * old behaviour   -> all 3 fetched (~1.2s): each 0.4s fetch was < the 0.9s
    #                        aggregate, so the before-each-request check never tripped
    #   * fixed behaviour -> exactly 1 fetch (~0.4s): the first overrun stops the phase
    # This is what makes the test discriminate the fix from the regression instead
    # of passing on both.
    PER_REQUEST_DELAY = 0.4          # each evidence server responds this slowly (> the 0.3s per-request ceiling)
    SUPPORTED_EXECUTION_LIMIT = 0.8  # the whole evaluation must finish within this wall-clock budget

    # Shrink the contract's evidence-fetch budget (on-chain default is
    # MAX_EVIDENCE_FETCH_SECONDS). The contract reads this env var defensively and
    # derives the per-request ceiling from it, so this only affects the test.
    os.environ["GRANTOS_EVIDENCE_FETCH_BUDGET_SECONDS"] = "0.9"  # -> per-request ceiling 0.3s

    fetch_calls = {"n": 0}

    def slow_web(data):
        fetch_calls["n"] += 1
        time.sleep(PER_REQUEST_DELAY)
        body = b"Milestone evidence: contract deployed to Bradbury and verified on the explorer."
        return {"ok": {"response": {"status": 200, "headers": {}, "body": body}}}

    try:
        with vm.activate():
            contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
            vm.sender = funder
            vm.value = 100
            contract.create_grant("g19", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
            vm.value = 0

            vm.sender = grantee
            # No web mock is registered for these URLs, so the live handler above is
            # what answers them -- that is where the slowness is injected.
            vm._live_web_handler = slow_web
            vm.mock_llm(r".*", llm_response("completed", 85))

            # Three slow URLs. The old before-each-request loop drained all three
            # (~1.2s); the per-request bound must stop after the first overrun.
            evidence_urls = [
                "https://slow.example/evidence-1",
                "https://slow.example/evidence-2",
                "https://slow.example/evidence-3",
            ]

            started = time.monotonic()
            contract.submit_milestone("g19", "M1", "Deployed and verified.", evidence_urls)
            elapsed = time.monotonic() - started

            # 1. The evaluation actually completed and produced a stored verdict.
            result = contract.get_milestone_result("g19", "M1")
            check("evaluation completes and stores a verdict despite a slow request",
                  result.get("final_status") in ("completed", "partial", "not_completed"),
                  f"result={result}")

            # 2. A single request that overran its per-request slice halted the phase:
            #    exactly one fetch was made, not all three. The old before-each-request
            #    loop would have made all three (each was under the aggregate budget),
            #    so this assertion fails on the pre-fix contract and passes on the fix.
            check("a single over-budget request halts the fetch phase (one fetch, not all)",
                  fetch_calls["n"] == 1,
                  f"fetched {fetch_calls['n']} of {len(evidence_urls)} URLs (expected 1)")

            # 3. The whole evaluation stayed within the supported execution limit.
            #    Old behaviour (~1.2s of serial slow fetches) blows it; the per-request
            #    bound (~0.4s) stays well under.
            check("full evaluation finishes within the supported execution limit",
                  elapsed < SUPPORTED_EXECUTION_LIMIT,
                  f"elapsed={elapsed:.2f}s, limit={SUPPORTED_EXECUTION_LIMIT}s")
    finally:
        os.environ.pop("GRANTOS_EVIDENCE_FETCH_BUDGET_SECONDS", None)


def test_single_hung_request_is_contained_not_fatal():
    print("\n[20] A single evidence request the node aborts (its host-side web-module timeout on a hung socket) is contained to that URL; the evaluation still reaches the LLM step and stores a verdict")
    vm = new_vm()
    funder = create_address("funder20")
    grantee = create_address("grantee20")

    # Model the node's host-side behaviour for a socket that never responds:
    # gl.nondet.web.get has no in-contract timeout, so a hung request is cut off by
    # the node's web module and surfaces to the contract as a *catchable* error
    # (genvm-web-default.lua reraises it non-fatal). The contract must contain that
    # to the single URL rather than let it abort the whole evaluation.
    def aborted_by_node_timeout(data):
        raise RuntimeError("web request aborted by node web-module timeout")

    with vm.activate():
        contract = deploy_contract(CONTRACT_PATH, vm, sdk_version=SDK_VERSION)
        vm.sender = funder
        vm.value = 100
        contract.create_grant("g20", addr_str(grantee), "desc", ["M1"], ["t1"], ["c1"], [100], 100)
        vm.value = 0

        vm.sender = grantee
        vm._live_web_handler = aborted_by_node_timeout
        vm.mock_llm(r".*", llm_response("partial", 60))

        # A single evidence URL whose fetch is aborted host-side. If the abort were
        # not contained, submit_milestone would raise and no verdict would be stored.
        contract.submit_milestone(
            "g20", "M1", "Deployed; evidence link provided.",
            ["https://hung.example/evidence"],
        )

        result = contract.get_milestone_result("g20", "M1")
        check("a single aborted/hung request does not abort the whole evaluation",
              result != {}, f"result={result}")
        check("the evaluation still reaches the LLM step and stores a verdict",
              result.get("llm_status") == "partial",
              f"llm_status={result.get('llm_status')}")


if __name__ == "__main__":
    tests = [
        test_amount_mismatch_reverts,
        test_happy_path_auto_release,
        test_sequential_enforcement,
        test_quality_below_threshold_forces_partial,
        test_partial_never_autoreleases_and_funder_can_resolve,
        test_not_completed_rejects_with_feedback,
        test_only_grantee_can_submit,
        test_validator_disagreement_forces_undetermined,
        test_duplicate_grant_id_rejected,
        test_full_multi_milestone_completion,
        test_resubmit_after_rejection_can_succeed,
        test_resolve_pending_review_guards,
        test_unknown_grant_lookups_raise_clear_errors,
        test_escrow_must_match_exactly,
        test_invalid_grantee_address_rejected,
        test_evaluation_seq_is_real_and_monotonic,
        test_colon_in_ids_rejected_to_prevent_key_collisions,
        test_negative_and_zero_amounts_rejected_with_clear_errors,
        test_slow_single_request_halts_fetch_phase_within_budget,
        test_single_hung_request_is_contained_not_fatal,
    ]
    for t in tests:
        try:
            t()
        except Exception:
            FAILED.append(t.__name__)
            print(f"  ERROR in {t.__name__}:")
            traceback.print_exc()

    print(f"\n{'='*60}\n{len(PASSED)} passed, {len(FAILED)} failed\n{'='*60}")
    if FAILED:
        print("Failed checks:", FAILED)
        raise SystemExit(1)
