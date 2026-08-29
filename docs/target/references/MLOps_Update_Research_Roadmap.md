# Hướng dẫn cho Codex: Cập nhật bảng báo cáo và roadmap nghiên cứu MLOps

## 1. Mục tiêu

Chỉnh sửa **Bản báo cáo Đánh giá kiến trúc MLOps và lộ trình Degradation-Aware CT** theo hướng:

> **Degradation-Aware Adaptive Model Maintenance / Retraining**

Không biến tài liệu thành một kế hoạch xây thêm MLOps platform đơn thuần. Repo MLOps hiện tại được xem là **experimental platform**, còn scientific core là:

```text
Production Monitoring
        ↓
Degradation Detection
        ↓
Multi-Signal Evidence
        ↓
Degradation Diagnosis
        ↓
Severity + Confidence
        ↓
Strategy / Risk Policy
        ↓
NO_OP / DATA_ENGINEERING / INCREMENTAL_CT / FULL_CT / HITL
        ↓
Candidate Evaluation
        ↓
Promotion / Reject / Rollback
```

---

## 2. Những thay đổi bắt buộc

### 2.1. Thêm Phase 0 — Research Design Freeze

Đặt trước toàn bộ implementation roadmap.

### Phase 0 — Research Design Freeze
**Thời lượng:** Tuần 1–2

Chốt trước khi code:

- Research problem
- Research Questions
- Hypotheses
- Degradation taxonomy
- Severity taxonomy
- Action space
- Scenario protocol
- Ground-truth protocol
- Diagnosis output schema
- Strategy/action ground truth

Đặc biệt phải phân biệt:

```text
Ground-truth Cause
        ≠
Ground-truth Best Action
```

Ví dụ:

```text
Cause = DATA_DRIFT
```

không đồng nghĩa với:

```text
Action = FULL_CT
```

Có thể:

```text
Data drift + performance stable
        → NO_OP
```

hoặc:

```text
Harmful data drift + sufficient labels
        → FULL_CT
```

**Exit criterion:** Có bảng mapping:

| Scenario | Ground-truth Cause | Severity | Evidence Pattern | Ground-truth Best Action |
|---|---|---|---|---|

---

## 3. Giới hạn taxonomy cho phiên bản nghiên cứu đầu tiên

Không mở rộng quá nhiều loại nguyên nhân ngay từ đầu.

Nên chốt 7 nhóm core:

| Code | Cause |
|---|---|
| C0 | BENIGN / NO_ACTION |
| C1 | DATA_DRIFT_HARMFUL |
| C2 | DATA_QUALITY_ISSUE |
| C3 | CONCEPT_DRIFT |
| C4 | TRAINING_DATA_STALENESS |
| C5 | CONFIGURATION_SUBOPTIMAL |
| C6 | ENGINEERING_ISSUE |

Trong `ENGINEERING_ISSUE` có thể bao gồm:

- training code / pipeline
- feature pipeline
- schema
- dependency/environment
- serving/runtime

**Architecture limitation không đưa vào core diagnosis của phiên bản đầu.** Để dành cho Phase 2 / future work vì khó định nghĩa ground truth khách quan và dễ làm scope quá rộng.

---

## 4. Thêm Action Ground Truth vào Scenario Injector

Scenario Injector không chỉ tạo:

```text
ground_truth_cause
```

mà phải tạo tối thiểu:

```json
{
  "scenario_id": "S03",
  "ground_truth": {
    "primary_cause": "DATA_QUALITY",
    "secondary_causes": [],
    "severity": "S3",
    "harmful": true,
    "best_action": "DATA_ENGINEERING",
    "auto_action_allowed": false
  }
}
```

Nếu có nhiều nguyên nhân đồng thời, hỗ trợ:

- primary cause
- secondary cause(s)
- confidence / ambiguity

Không ép mọi tình huống thành một causal explanation tuyệt đối.

Trong paper nên ưu tiên terminology:

> **Degradation Cause Diagnosis**  
> hoặc  
> **Likely Cause Diagnosis**

thay cho việc khẳng định quá mạnh là “Root Cause Analysis” nếu chưa có causal inference.

---

## 5. Cập nhật Evidence / Monitoring Matrix

Tạo bảng riêng trong báo cáo:

| Degradation Cause | Primary Evidence | Secondary Evidence | Ground Truth Needed? | Candidate Strategy |
|---|---|---|---|---|
| Data drift | PSI, KS, JS, Wasserstein | Prediction drift, performance | No | Refresh data + CT nếu harmful |
| Data quality | Missing/null, schema, range, freshness, duplicate | Performance | No | DATA_ENGINEERING |
| Concept drift | \(P(Y\|X)\) change, slice error, error distribution | Performance, calibration | Usually yes | New labels + CT / HITL |
| Training data staleness | Data age, label coverage, temporal coverage | Training-vs-production drift | No/optional | Update dataset + CT |
| Configuration suboptimal | Historical runs, HPO improvement, hyperparameter sensitivity | Stable data/code | No direct label | HPO + CT |
| Engineering issue | Git commit, pipeline version, feature version, dependency/environment | Reproducibility, performance | No | Engineering intervention |
| Benign/no action | No meaningful harmful evidence | Stable performance | No | NO_OP / OBSERVE |

Lưu ý:

> Không được gọi tất cả các signal là “drift”.

Phải phân biệt:

- data drift
- performance degradation
- data quality
- prediction drift
- concept drift
- training-data aging
- lineage/configuration/engineering evidence

---

## 6. Cập nhật kiến trúc nghiên cứu

Sử dụng kiến trúc:

```text
                    MODEL DEGRADATION
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   DATA EVIDENCE      MODEL EVIDENCE     SYSTEM EVIDENCE
        │                  │                  │
        ├─ Data drift      ├─ Performance     ├─ Code version
        ├─ Quality         ├─ Prediction      ├─ Feature version
        ├─ Volume          ├─ Confidence      ├─ Dependency
        ├─ Freshness       ├─ Calibration     ├─ Pipeline version
        └─ Label           └─ Slice error     └─ Runtime
                           │
                           ▼
                     TRAINING EVIDENCE
                           │
                           ├─ Dataset age
                           ├─ Dataset coverage
                           ├─ HPO results
                           ├─ Hyperparameters
                           └─ Historical runs
                           │
                           ▼
                  MULTI-EVIDENCE DIAGNOSIS
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
             Cause + Severity   Confidence
                  │
                  ▼
             RISK / POLICY
                  │
      ┌───────────┼────────────┬───────────┐
      ▼           ▼            ▼           ▼
    NO_OP     DATA_ENGINEERING  CT       HITL
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                  INCREMENTAL     FULL / HPO CT
                       │             │
                       └──────┬──────┘
                              ▼
                       EVALUATION GATE
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                    REJECT        PROMOTE
```

---

## 7. Tách Diagnosis khỏi Strategy Selector

Trong tài liệu phải thể hiện rõ:

```text
Evidence
   ↓
Diagnosis Engine
   ↓
Cause + Severity + Confidence
   ↓
Strategy Selector / Risk Policy
   ↓
Action
```

Không gộp diagnosis và action thành một module duy nhất.

Lý do:

- Diagnosis trả lời: **“Có khả năng chuyện gì đang xảy ra?”**
- Strategy trả lời: **“Nên làm gì trong bối cảnh đó?”**

Ví dụ:

```text
DATA_DRIFT
+
Performance stable
+
Low severity
        ↓
NO_OP
```

Trong khi:

```text
DATA_DRIFT
+
Performance degradation
+
Enough new labels
+
High severity
        ↓
FULL_CT
```

---

## 8. Điều chỉnh roadmap implementation

Thay roadmap cũ thành:

### Phase 0 — Research Design Freeze
**Tuần 1–2**

- Taxonomy
- RQs
- Hypotheses
- Ground truth
- Severity
- Action space
- Experimental protocol

### Phase 1 — Benchmark & Vertical Slice
**Tuần 3–6**

- Dataset chuẩn
- Scenario Injector
- Ground-truth cause
- Ground-truth best action
- Evidence schema
- Một vertical slice hoàn chỉnh:

```text
Harmful Data Drift
→ Detect
→ Evidence
→ Simple Policy
→ CT
→ Evaluation
```

Không cần hoàn thiện toàn bộ 6 baselines ngay trong Phase 1.

### Phase 2 — Evidence & Feedback Infrastructure
**Tuần 7–10**

Xây:

- prediction_id
- feature snapshot
- prediction
- confidence
- latency
- model version
- feedback / label
- watermark
- evidence window
- lineage

Output chính:

```text
EvidenceWindow(t)
```

bao gồm:

- data drift
- data quality
- prediction drift
- performance
- label coverage
- lineage
- training context

### Phase 3 — Multi-Signal Diagnosis
**Tuần 11–15**

Đây là **core research implementation**.

Output:

```json
{
  "cause_distribution": {
    "data_drift": 0.72,
    "concept_drift": 0.11,
    "data_quality": 0.12,
    "unknown": 0.05
  },
  "primary_cause": "data_drift",
  "severity": "S3",
  "confidence": 0.72
}
```

Ưu tiên implementation theo thứ tự:

1. Rule-based / evidence scoring
2. Sau đó mới cân nhắc ML-based diagnosis
3. Nếu có thời gian: so sánh Rule-based vs ML-based vs Hybrid

### Phase 4 — Strategy & Risk Policy
**Tuần 16–18**

```text
Diagnosis
   ↓
Cause + Severity + Confidence
   ↓
Risk Policy
   ↓
Action
```

Action space:

- NO_OP / OBSERVE
- DATA_ENGINEERING
- INCREMENTAL_CT
- FULL_CT
- HPO + CT
- HITL

Policy phải độc lập với Diagnosis Engine.

### Phase 5 — Adaptive CT & Evaluation Gate
**Tuần 19–22**

- Incremental CT
- Full CT
- HPO + CT
- Candidate evaluation
- Champion comparison
- Model promotion gate

Đây là giai đoạn chạy đầy đủ các baseline B0–B5.

### Phase 6 — Safe Rollout
**Tuần 23–24**

- Offline Gate
- Shadow
- Canary
- Rollback

Nhấn mạnh trong tài liệu:

> Shadow/Canary/Rollback là system validation và deployment safety layer, không phải scientific core contribution.

Nếu thiếu thời gian, ưu tiên Diagnosis + Strategy + Experiments trước.

### Phase 7 — Experiment, Analysis & Paper
**Tuần 25–30**

- Full experiment runs
- Statistical tests
- Ablation studies
- Failure analysis
- Threats to validity
- Paper writing

Khuyến nghị mở rộng roadmap từ 26 tuần lên khoảng 30 tuần vì experiment và paper writing thường cần nhiều thời gian hơn dự kiến.

---

## 9. Giữ và bổ sung Baselines

Giữ 6 baseline hiện tại:

| Baseline | Description |
|---|---|
| B0 | Static / No Retraining |
| B1 | Periodic Retraining |
| B2 | Single-Signal Drift-Triggered CT |
| B3 | Performance-Triggered CT |
| B4 | Always Retrain |
| B5 | Proposed Degradation-Aware Adaptive CT |

B5:

```text
Detection
→ Diagnosis
→ Severity
→ Risk Policy
→ Conditional CT / HITL
→ Evaluation Gate
```

### Bổ sung diagnosis-level baselines

Nếu tài nguyên cho phép:

- D1 — Single-signal diagnosis
- D2 — Simple/multi-signal heuristic
- D3 — Proposed weighted/evidence diagnosis

Mục tiêu là chứng minh:

> Multi-signal diagnosis có thực sự tốt hơn single-signal diagnosis hay không?

---

## 10. Evaluation Framework

Không chỉ đánh giá model performance.

### A. Detection

- Precision
- Recall
- F1
- False Positive Rate
- Detection Delay

### B. Diagnosis

- Diagnosis Accuracy
- Macro-F1
- Confusion Matrix
- ECE
- Brier Score

### C. Strategy Selection

Thêm:

- Strategy Accuracy
- Macro-F1 cho action classes
- Invalid/unsafe action rate
- Unnecessary retraining rate
- Missed-retraining rate

### D. Model Recovery

- Performance recovery
- Time-to-recovery
- Champion-vs-candidate improvement

### E. Cost

- Number of training runs
- GPU/CPU hours
- Training time
- Retraining frequency
- Human intervention count

### F. Safety

- Failed promotion rate
- Rollback rate
- Performance regression after deployment

---

## 11. Experimental Scenarios

Scenario Injector phải tạo các scenario có ground truth:

1. Benign/no degradation
2. Harmful data drift
3. Data quality degradation
4. Concept drift
5. Training data staleness
6. Configuration suboptimal
7. Engineering/pipeline issue

Có thể biến đổi theo severity:

```text
S0 = none
S1 = low
S2 = moderate
S3 = high
S4 = critical
```

Mỗi scenario nên có:

```text
scenario_id
cause
secondary_causes
severity
evidence_pattern
harmful
best_action
auto_action_allowed
```

Nếu có thể, tạo:

- sudden drift
- gradual drift
- recurring drift
- simultaneous causes
- delayed labels
- noisy signals
- false-positive signals

---

## 12. Research Questions

Giữ các RQ chính nhưng chỉnh framing:

### RQ1 — Diagnosis
> Can multi-signal production evidence accurately distinguish the likely causes of model degradation?

### RQ2 — Strategy Selection
> Can degradation-aware strategy selection reduce unnecessary retraining compared with generic retraining policies?

### RQ3 — Recovery
> Does cause-aware adaptive maintenance improve model recovery after degradation?

### RQ4 — Cost
> Can the approach reduce computational and human intervention cost while maintaining recovery quality?

### RQ5 — Robustness
> How robust is the diagnosis and strategy selection under different degradation types, severities, and delayed/noisy evidence?

---

## 13. Hypotheses

Có thể giữ:

### H1
Degradation-aware strategy selection reduces unnecessary retraining compared with Always Retrain / Drift-triggered CT.

### H2
Multi-signal diagnosis improves cause identification compared with single-signal diagnosis.

### H3
Adaptive strategy selection improves recovery-cost trade-off.

### H4
HITL for high-risk/low-confidence cases reduces unsafe automated actions.

Nếu muốn formalize utility:

\[
U =
\alpha Recovery
-
\beta Cost
-
\gamma Risk
-
\delta HumanEffort
\]

Hoặc dùng Pareto analysis thay vì ép thành một score duy nhất.

---

## 14. Central Research Claim

Đưa luận điểm này lên đầu phần motivation:

> **Data drift does not necessarily imply model degradation, and model degradation does not necessarily imply that retraining with the same data and training code is the appropriate response.**

Sau đó dẫn tới:

```text
Degradation
   ↓
Diagnosis
   ↓
Strategy selection
```

Đây phải là central idea của toàn bộ báo cáo.

---

## 15. Định vị scientific contribution

Không mô tả contribution chính là:

> “Xây dựng một MLOps PaaS có Auto Retraining.”

Thay bằng:

> **A degradation-aware adaptive model maintenance framework that combines heterogeneous production evidence, degradation-cause diagnosis, severity/confidence assessment, and risk-aware strategy selection instead of uniformly triggering retraining.**

Các contribution nên trình bày:

1. **Multi-evidence degradation representation**
2. **Degradation cause diagnosis mechanism**
3. **Risk-aware adaptive maintenance/retraining policy**
4. **Human-in-the-loop boundary for uncertain/high-risk cases**
5. **Controlled benchmark with ground-truth degradation scenarios**
6. **Empirical comparison against generic retraining policies**

MLOps PaaS hiện tại là **experimental infrastructure/platform** hỗ trợ kiểm chứng các contribution trên.

---

## 16. Publication positioning

Trình bày theo hướng:

### Ambitious
- ICSE
- ESEC/FSE
- ASE
- IEEE TSE
- ACM TOSEM

### Strong / realistic
- ICSME
- MSR (nếu framing mạnh về software repositories/lineage)
- EMSE
- JSS
- Automated Software Engineering

Không tuyên bố chắc chắn Q1/top venue. Phải nhấn mạnh acceptance phụ thuộc novelty, rigor, empirical evidence và related-work positioning.

---

## 17. Quy tắc ưu tiên khi scope quá lớn

Đánh dấu:

### P0 — MUST HAVE

- Scenario Injector + Ground Truth
- Multi-signal Evidence
- Diagnosis Engine
- Strategy Selector
- Baseline comparison
- Experimental evaluation

### P1 — SHOULD HAVE

- Delayed labels
- Evaluation Gate
- HITL workflow
- Statistical testing
- Ablation

### P2 — NICE TO HAVE

- Shadow
- Canary
- Auto rollback
- Architecture search
- ML-based diagnosis nếu rule/evidence scoring đã đủ

**Không được hy sinh core research để hoàn thiện các tính năng deployment safety phụ.**

---

## 18. Tiêu chí hoàn thành research prototype

Cuối roadmap phải đạt:

```text
Scenario Injector
        ↓
Ground Truth
        ↓
Monitoring / Evidence
        ↓
Diagnosis Engine
        ↓
Cause + Severity + Confidence
        ↓
Strategy Selector
        ↓
Action
        ↓
Training / Engineering / HITL
        ↓
Evaluation Gate
        ↓
Final Model Decision
```

Và có thể trả lời bằng số liệu:

```text
1. Diagnosis accuracy?
2. Strategy accuracy?
3. Unnecessary retraining reduction?
4. Recovery improvement?
5. Training cost reduction?
6. Human intervention reduction?
7. Unsafe action rate?
8. Robustness under severity / delayed labels / multiple causes?
```

---

## 19. Yêu cầu khi chỉnh sửa báo cáo

- Giữ lại các nội dung implementation hiện tại nếu còn phù hợp.
- Không xóa các bảng đánh giá repo hiện tại; chỉ **tái cấu trúc để phân biệt rõ “Existing MLOps Platform” và “Research Extension”**.
- Tất cả các module mới phải được đánh dấu rõ là **research extension**, không mô tả như đã hoàn thiện nếu chưa code.
- Roadmap phải thể hiện **dependency order**, đặc biệt:
  `Research Design → Benchmark/Ground Truth → Evidence → Diagnosis → Strategy → CT → Evaluation`.
- Không mở rộng scope sang architecture search ở phiên bản đầu.
- Không dùng “Root Cause” như một tuyên bố causal tuyệt đối nếu phương pháp chỉ suy luận từ evidence.
- Làm nổi bật `Always Retrain` và `Single-Signal Drift Trigger` như các baseline quan trọng.
- Làm nổi bật `Ground-truth Best Action`, không chỉ `Ground-truth Cause`.
- Phân biệt rõ:
  - Detection
  - Diagnosis
  - Severity
  - Risk
  - Strategy
  - Execution
  - Evaluation
- Cuối báo cáo phải có một **Research Roadmap Summary Table** với cột:
  `Phase | Weeks | Objective | Main Deliverables | Research Importance | Exit Criteria | Priority`.

## 20. Kết quả mong muốn

Sau khi chỉnh sửa, tài liệu phải thể hiện được một câu chuyện nghiên cứu liền mạch:

```text
Existing MLOps PaaS
        ↓
Research Problem:
generic retraining is insufficient
        ↓
Research Design
        ↓
Controlled degradation benchmark
        ↓
Multi-signal evidence
        ↓
Degradation diagnosis
        ↓
Severity + confidence
        ↓
Adaptive strategy selection
        ↓
Auto CT / HPO / Data Engineering / HITL / No-op
        ↓
Evaluation
        ↓
Empirical comparison
        ↓
Scientific conclusions
```

Mục tiêu cuối cùng không phải là “có thêm nhiều tính năng cho MLOps platform”, mà là **chứng minh bằng thực nghiệm rằng degradation-aware adaptive maintenance có thể đưa ra quyết định bảo trì mô hình phù hợp hơn các chính sách retraining chung chung**.
