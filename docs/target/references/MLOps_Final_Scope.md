# Codex Task — Chỉnh sửa đề cương NCKH lần cuối theo định hướng Q3 → Q2 → Q1

## Mục tiêu

Chỉnh sửa bản đề cương hiện tại để đạt ba yêu cầu:

1. **Q3:** có một baseline nghiên cứu hoàn chỉnh, khả thi, có thể thực nghiệm và viết paper độc lập.
2. **Q2:** có đường mở rộng rõ ràng từ Q3 mà không phải thay đổi toàn bộ kiến trúc.
3. **Q1:** chỉ là hướng stretch/high-risk nếu kết quả Q2 đủ mạnh, không làm phình scope bắt buộc của đề tài.

Giữ nguyên framing trung tâm:

> **Degradation-Aware Adaptive Model Maintenance**

và nguyên lý:

```text
Data Drift ≠ Model Degradation ≠ Retraining Trigger
```

Core research pipeline:

```text
Production
    ↓
Multi-Signal Evidence
    ↓
Evidence Representation
    ↓
Degradation Diagnosis
    ↓
Cause + Severity + Confidence
    ↓
Risk-Aware Strategy Selection
    ↓
NO_OP / INCREMENTAL_CT / FULL_CT / HITL
    ↓
Candidate Evaluation
    ↓
Promote / Reject
```

Repo MLOps PaaS tiếp tục được xem là **Experimental Platform**, không phải scientific contribution chính.

---

# 1. Bắt buộc chỉnh lại scientific core của Diagnosis Engine

## 1.1. Không để Algorithm 1 hiện tại là proposed method duy nhất

Algorithm hiện tại đang gần với:

```text
IF data quality bad
    → DATA_QUALITY
IF drift + performance drop
    → DATA_DRIFT
IF performance drop + no drift
    → CONCEPT_DRIFT
...
```

Giữ logic này làm:

> **D2 — Rule-Based Multi-Signal Diagnosis baseline**

Không gọi đây là toàn bộ proposed algorithm.

## 1.2. Định nghĩa Proposed Multi-Evidence Diagnosis

Phải bổ sung một mô hình ở mức khái quát:

```text
Evidence E
    ↓
Feature / Evidence Transformation
    ↓
Weighted or Probabilistic Diagnosis
    ↓
P(Cause | E)
    ↓
Primary Cause
+ Secondary Causes
+ Confidence
```

Có thể formalize:

\[
Score(C_i)=\sum_j w_{ij}\phi_j(E_j)
\]

và nếu phù hợp:

\[
P(C_i|E)=\operatorname{softmax}(Score(C_i))
\]

Hoặc một mô hình calibrated classifier/probabilistic model.

Không bắt buộc dùng deep learning hay LLM.

Mục tiêu là phương pháp:

- giải thích được;
- tái lập được;
- so sánh được với single-signal và heuristic baseline.

## 1.3. Phải mô tả rõ vai trò của ba phương pháp

```text
D1 — Single-Signal
D2 — Rule-Based Multi-Signal
D3 — Proposed Multi-Evidence Diagnosis
```

D1/D2 là baselines.

D3 là proposed method.

---

# 2. Thu hẹp core taxonomy

## 2.1. Core Q3 chỉ gồm 5 classes

Chốt:

```text
C0 — BENIGN / NO_ACTION
C1 — DATA_DRIFT
C2 — DATA_QUALITY
C3 — CONCEPT_DRIFT
C4 — DATA_STALENESS
```

## 2.2. C5–C6 chuyển sang extended / stress scenarios

Không xóa nội dung hiện tại, nhưng re-label:

```text
C5 — CONFIG_SUBOPTIMAL
C6 — ENGINEERING_ISSUE
```

thành:

> Extended / Stress / Future-work-oriented scenarios.

Không sử dụng C5–C6 để làm trung tâm của Q3 diagnosis benchmark.

Mục đích:

- kiểm tra robustness;
- cho thấy framework có khả năng mở rộng;
- không làm loãng core contribution.

## 2.3. Architecture limitation

Giữ nguyên việc loại Architecture limitation khỏi core.

Không biến architecture search thành một nhánh bắt buộc của research.

---

# 3. Sửa Severity Model

## 3.1. Không định nghĩa Severity chỉ bằng Δperformance

Hiện đề cương có:

```text
S2 = 3–8%
S3 > 8%
```

Giữ các ngưỡng này nếu cần làm operating thresholds, nhưng không dùng chúng làm toàn bộ định nghĩa scientific Severity.

## 3.2. Severity phải dựa trên 4 yếu tố

\[
Severity=f(Impact,Scope,Persistence,Risk)
\]

Trong đó:

- `Impact`: mức giảm chất lượng mô hình.
- `Scope`: tỷ lệ traffic/population bị ảnh hưởng.
- `Persistence`: số window liên tiếp hoặc thời gian kéo dài.
- `Risk`: mức độ nguy hiểm về business/operational/safety.

Taxonomy:

```text
S0 — None
S1 — Early Warning / Low
S2 — Moderate
S3 — High
S4 — Critical
```

## 3.3. Ground truth severity

Scenario Injector phải lưu:

```json
{
  "severity": "S3",
  "severity_factors": {
    "performance_impact": 0.12,
    "scope": 0.65,
    "persistence": "6h",
    "risk": "high"
  }
}
```

Mục tiêu:

> Severity có thể giải thích và đánh giá được, không phải một nhãn tùy ý.

---

# 4. Làm rõ RQ thành 3 RQ core

Thay 5 RQ hiện tại bằng 3 RQ chính.

## RQ1 — Diagnosis

> **Can multi-evidence monitoring accurately distinguish different causes of model degradation compared with single-signal approaches?**

Metrics:

- Diagnosis Accuracy
- Macro-F1
- Confusion Matrix
- ECE
- Brier Score
- Primary-cause accuracy
- Multi-label metrics cho mixed causes

## RQ2 — Adaptive Strategy

> **Can degradation-aware strategy selection reduce unnecessary retraining while maintaining appropriate model recovery compared with generic retraining policies?**

Metrics:

- Strategy Accuracy
- Macro-F1
- Unnecessary Retraining Rate
- Missed Degradation Rate
- Unsafe Action Rate
- Human Intervention Count

## RQ3 — Robustness / Outcome

> **How robust is the proposed diagnosis and strategy selection under different degradation severities, mixed degradation, delayed labels, and noisy or incomplete evidence?**

Metrics:

- Recovery
- Time-to-Recovery
- Cost
- Performance under delay
- Performance under noise
- Performance under mixed causes
- Calibration robustness

Cost và recovery được xem là metrics phục vụ RQ2/RQ3, không tạo RQ riêng.

---

# 5. Sửa Action Space cho Q3

## Core actions

Chỉ coi 4 action sau là core:

```text
A0 — NO_OP / OBSERVE
A1 — INCREMENTAL_CT
A2 — FULL_CT
A3 — HITL
```

## Extended actions

```text
DATA_ENGINEERING
HPO_CT
```

được giữ như:

- extension;
- specialized strategy;
- supporting implementation.

Không để HPO trở thành scientific contribution chính.

Không để Data Engineering làm paper biến thành nghiên cứu data pipeline.

---

# 6. Dual Ground Truth phải trở thành trung tâm benchmark

Mỗi scenario phải có:

```text
ground_truth_cause
ground_truth_best_action
ground_truth_severity
```

Ví dụ:

```json
{
  "scenario_id": "S02",
  "ground_truth": {
    "primary_cause": "DATA_DRIFT",
    "secondary_causes": [],
    "severity": "S2",
    "harmful": true,
    "best_action": "INCREMENTAL_CT",
    "auto_action_allowed": true
  }
}
```

Phân biệt rõ:

```text
Cause
≠
Severity
≠
Best Action
```

Ví dụ:

```text
Data Drift + Performance Stable
→ NO_OP
```

và:

```text
Harmful Data Drift + Severe Performance Drop + Sufficient Labels
→ INCREMENTAL_CT / FULL_CT
```

---

# 7. Mixed Cause / Multi-Label Diagnosis

Giữ scenario mixed.

Output Diagnosis phải hỗ trợ:

```text
Primary Cause
Secondary Cause(s)
Confidence
```

Ví dụ:

```json
{
  "cause_distribution": {
    "DATA_DRIFT": 0.72,
    "DATA_QUALITY": 0.21,
    "CONCEPT_DRIFT": 0.07
  },
  "primary_cause": "DATA_DRIFT",
  "secondary_causes": ["DATA_QUALITY"],
  "confidence": 0.72
}
```

Benchmark phải có:

- single-cause;
- multi-cause;
- ambiguous;
- missing evidence;
- false-positive evidence.

---

# 8. Điều chỉnh Baselines

## End-to-End baselines

Giữ:

```text
B0 — Static / No Retraining
B1 — Periodic Retraining
B2 — Single-Signal Drift-Triggered CT
B3 — Performance-Triggered CT
B4 — Always Retrain
B5 — Proposed Degradation-Aware Adaptive CT
```

Không thêm quá nhiều end-to-end baselines.

## Diagnosis-level baselines

Giữ:

```text
D1 — Single-Signal Detector
D2 — Rule-Based Multi-Signal Diagnosis
D3 — Proposed Multi-Evidence Diagnosis
```

Mục tiêu:

```text
D3 > D2 > D1
```

nếu dữ liệu chứng minh được.

---

# 9. Điều chỉnh Ablation

Ablation Q3 chỉ nên giữ core chain:

```text
A0 — Single-Signal
A1 — Multi-Signal Evidence
A2 — + Diagnosis
A3 — + Severity
A4 — + Strategy Selector
```

Không bắt buộc biến:

```text
HITL
Evaluation Gate
Shadow
Canary
```

thành các ablation chính.

Có thể đánh giá chúng ở system-level nếu còn thời gian.

Mục tiêu:

> chứng minh contribution đến từ diagnosis + severity + strategy, chứ không phải chỉ từ thêm nhiều module.

---

# 10. Không để Literature Gap Matrix tuyên bố “đã giải quyết” trước khi có evidence

Trong bảng gap analysis, không dùng:

```text
Proposed = ✓
```

nếu phương pháp chưa được implement và validate.

Dùng:

```text
Existing
Proposed / Target
Validated
```

Ví dụ:

| Criterion | Existing Platform | Proposed |
|---|---|---|
| Multi-signal evidence | ∼ | Target |
| Diagnosis | × | Target |
| Adaptive strategy | × | Target |
| Evaluation gate | ∼ | Target |

Sau khi hoàn thành experiments mới đổi “Target” → “Validated”.

Điều này phải được áp dụng nhất quán trong toàn bộ báo cáo.

---

# 11. Progressive Research Ladder: Q3 → Q2 → Q1

Đây là phần mới bắt buộc phải có.

## Level 0 — Existing MLOps Platform

Mục tiêu:

> Platform capability.

Bao gồm:

- monitoring;
- inference;
- lineage;
- training;
- registry;
- deployment;
- logging.

Không coi là scientific contribution chính.

---

## Level 1 — Q3: Publishable Baseline

### Scope

```text
5 core degradation classes
+
4 core actions
+
Multi-Evidence Diagnosis
+
Severity
+
Confidence
+
Dual Ground Truth Benchmark
+
B0–B5
+
D1–D3
+
Ablation
+
2–3 datasets/tasks
```

### Scientific claim

> Multi-evidence degradation diagnosis combined with adaptive strategy selection can reduce unnecessary retraining while maintaining model recovery compared with generic retraining strategies.

### Minimum Q3 exit criteria

Phải chứng minh:

1. D3 tốt hơn D1/D2 về diagnosis.
2. B5 giảm unnecessary retraining so với B2/B4.
3. Recovery không kém đáng kể so với Always Retrain.
4. Compute cost giảm.
5. Kết quả lặp lại được trên ít nhất 2 task/dataset.
6. Có statistical testing.
7. Có failure analysis.

Nếu đạt các điều kiện này:

> **Đóng scope Q3 và có thể chuẩn bị paper.**

---

## Level 2 — Q2: Deepen Scientific Contribution

Không mở rộng tất cả mọi thứ. Chọn tối đa 2–3 hướng:

### Q2-A — Uncertainty / calibrated diagnosis

Từ:

```text
Cause score
```

sang:

```text
calibrated P(Cause|Evidence)
+
confidence
+
selective prediction
```

Nghiên cứu automation boundary theo confidence.

### Q2-B — Cost/Risk-aware policy

Formalize:

\[
U(a|E)=Benefit(a)-Cost(a)-Risk(a)-HumanEffort(a)
\]

và đánh giá:

- Pareto frontier;
- recovery vs cost;
- recovery vs risk;
- automation vs human effort.

### Q2-C — More realistic degradation

Bổ sung:

- gradual drift;
- sudden drift;
- recurring drift;
- mixed causes;
- delayed labels;
- noisy evidence;
- missing evidence.

### Q2-D — Cross-domain validation

Ít nhất:

```text
classification
+
regression
```

hoặc 2–3 task families.

### Q2 exit criteria

Phải chứng minh:

- kết quả Q3 vẫn giữ;
- framework tổng quát hơn;
- robust hơn;
- trade-off được định lượng;
- không chỉ phụ thuộc một dataset/model.

---

# Level 3 — Q1 Stretch / High-Risk

Không phải deliverable bắt buộc.

Chỉ chọn **một** scientific leap.

## Q1 option A — Causal Diagnosis

Từ:

```text
P(Cause | Evidence)
```

sang:

```text
causal explanation / intervention
```

Ví dụ:

> Nếu data quality không suy giảm, model performance có vẫn suy giảm không?

## Q1 option B — Online Adaptive Maintenance

Từ:

```text
Evidence → Static Policy → Action
```

sang:

```text
Sequential Evidence
→ Adaptive Policy
→ Action
→ Outcome
→ Policy Update
```

Có thể nghiên cứu contextual bandit / online learning nếu thật sự cần.

## Q1 option C — Generalizable Maintenance Framework

Chứng minh abstraction chung qua:

```text
classification
regression
forecasting
```

và nhiều loại model/degradation.

Chỉ chọn một trong A/B/C.

---

# 12. Research Maturity Gates

Thêm bảng bắt buộc:

| Gate | Điều kiện | Quyết định |
|---|---|---|
| G0 | Research contract + taxonomy + GT protocol | Start |
| G1 | Benchmark + Scenario Injector ổn định | Build Diagnosis |
| G2 | D3 > D1/D2 | Diagnosis validated |
| G3 | B5 giảm unnecessary CT mà không làm giảm recovery | **Q3 ready** |
| G4 | Cross-task + robustness results | **Q2 candidate** |
| G5 | Uncertainty/cost-aware policy strong | **Q2 strong** |
| G6 | Causal OR online OR broad generalization breakthrough | **Q1 stretch** |

Nhấn mạnh:

> Q3/Q2/Q1 là **development maturity targets**, không phải lời hứa về acceptance/review outcome.

---

# 13. Roadmap 30 tuần — chỉnh dependency

Giữ 30 tuần nhưng điều chỉnh nội dung:

### Phase 0 — Research Design Freeze
Tuần 1–2

Deliverables:

- RQs
- Hypotheses
- taxonomy
- severity
- action space
- dual GT
- experimental protocol

### Phase 1 — Benchmark + Vertical Slice
Tuần 3–6

- dataset
- Scenario Injector
- GT cause + severity + best action
- one end-to-end vertical slice

### Phase 2 — Evidence Infrastructure
Tuần 7–10

- prediction_id
- feedback
- delayed labels
- EvidenceWindow
- lineage
- monitoring metrics

### Phase 3 — Multi-Evidence Diagnosis
Tuần 11–15

- D1
- D2
- D3
- severity
- confidence
- diagnosis evaluation

### Phase 4 — Strategy Selector
Tuần 16–18

- NO_OP
- INCREMENTAL_CT
- FULL_CT
- HITL
- risk constraints

### Phase 5 — Adaptive CT + Evaluation
Tuần 19–22

- candidate training
- EvaluationGate
- B0–B5
- recovery/cost measurements

### Phase 6 — Safe Rollout
Tuần 23–24

- Shadow
- Canary
- Rollback

Đây là supporting engineering layer, P1/P2.

### Phase 7 — Full Experiment + Paper
Tuần 25–30

- all benchmark scenarios
- multiple seeds
- statistical tests
- ablation
- robustness
- failure analysis
- threats to validity
- paper

---

# 14. Scope priority phải được thể hiện rõ

## P0 — MUST HAVE

```text
Scenario Injector
Dual Ground Truth
Multi-Signal Evidence
D1/D2/D3
Diagnosis
Severity
Confidence
Strategy Selector
B0–B5
Experimental evaluation
```

## P1 — SHOULD HAVE

```text
Delayed labels
HITL
Evaluation Gate
Ablation
Statistical testing
Multiple datasets
```

## P2 — CUT FIRST

```text
Shadow
Canary
Auto rollback
HPO
Engineering diagnosis
Architecture search
LLM diagnosis
```

Nếu thiếu thời gian:

> **cắt P2 trước; tuyệt đối không cắt Diagnosis/Strategy/Experiment.**

---

# 15. Q3 baseline phải đứng độc lập

Bản đề cương phải thể hiện rằng sau Q3:

```text
Existing Platform
+
Diagnosis
+
Strategy
+
Benchmark
+
Evaluation
=
Complete Q3 Research Artifact
```

Không yêu cầu Q2/Q1 để paper Q3 có ý nghĩa.

Q2/Q1 chỉ kế thừa:

```text
Q3 artifact
```

không rewrite từ đầu.

---

# 16. Q3 experiment matrix

Tối thiểu:

```text
2–3 public datasets/tasks
×
5 core causes
×
multiple severity levels
×
multiple random seeds
×
B0–B5
×
D1–D3
```

Có:

- single cause;
- mixed cause;
- benign drift;
- harmful drift;
- delayed labels;
- noisy/incomplete evidence.

Không nhất thiết mọi combination phải chạy đầy đủ nếu chi phí quá lớn. Thiết kế factorized experiments hợp lý và giải thích rõ sampling protocol.

---

# 17. Các metric cần giữ

### Detection

- Precision
- Recall
- F1
- FPR
- Detection Delay

### Diagnosis

- Accuracy
- Macro-F1
- Confusion Matrix
- ECE
- Brier Score
- Multi-label F1 nếu applicable

### Strategy

- Strategy Accuracy
- Unnecessary Retraining Rate
- Missed Degradation Rate
- Unsafe Action Rate
- Human Intervention Count

### Outcome

- Recovery
- Time-to-Recovery
- Candidate-vs-Champion improvement

### Cost

- Number of training runs
- GPU/CPU-hours
- Training frequency
- Human effort

### Safety

- Evaluation Gate failure
- Rollback
- Post-deployment regression

---

# 18. Utility/Pareto nên là secondary analysis

Giữ:

\[
U=\alpha Recovery-\beta Cost-\gamma Risk-\delta HumanEffort
\]

nhưng:

1. Không dùng một bộ trọng số duy nhất để quyết định “phương pháp thắng”.
2. Ưu tiên Pareto frontier.
3. Có sensitivity analysis với nhiều bộ trọng số.

---

# 19. Scientific contribution ladder phải xuất hiện trong đề cương

Thêm hình/bảng:

```text
                 Q1 STRETCH
                     ▲
        Causal / Online / Generalizable
             Adaptive Maintenance
                     │
                 Q2 LEVEL
                     ▲
       Uncertainty + Cost/Risk + Robustness
                     │
                 Q3 LEVEL
                     ▲
      Multi-Evidence Diagnosis + Severity
       + Confidence + Adaptive Strategy
                     │
              Existing Platform
                     │
       Monitoring / Training / Registry /
               Deployment / Lineage
```

Thông điệp:

> Mỗi level kế thừa level trước; không được mở rộng breadth mà không tăng scientific depth.

---

# 20. Publication positioning

Trong roadmap nội bộ có thể giữ:

### Q3 target
- JSS
- Automated Software Engineering
- EMSE hoặc venue tương đương phù hợp

### Q2 target
- mạnh hơn về EMSE/JSS/AES hoặc conference SE phù hợp, tùy empirical quality

### Q1 stretch
- TSE / TOSEM / ESEC/FSE / ASE hoặc venue tương đương nếu scientific contribution thực sự đạt mức đó.

Không viết trong manuscript rằng:

> “Q3 contribution”, “Q2 contribution”, “Q1 contribution”.

Trong paper dùng:

```text
Core Contribution
Advanced Extension
Stretch/Future Direction
```

Q-level chỉ là **planning classification**.

---

# 21. Checklist để Codex kiểm tra sau khi chỉnh

Sau khi sửa, tự kiểm tra:

- [ ] Algorithm 1 không còn bị trình bày như proposed method duy nhất.
- [ ] Có D1/D2/D3.
- [ ] C0–C4 là core Q3.
- [ ] C5–C6 là extended/stress.
- [ ] Severity độc lập với Cause.
- [ ] Severity dựa trên Impact + Scope + Persistence + Risk.
- [ ] Dual Ground Truth có Cause + Severity + Best Action.
- [ ] Mixed-cause diagnosis hỗ trợ primary + secondary + confidence.
- [ ] Core actions Q3 chỉ gồm NO_OP / INCREMENTAL_CT / FULL_CT / HITL.
- [ ] RQ có 3 câu hỏi chính.
- [ ] Có diagnosis-level evaluation.
- [ ] Có end-to-end baselines B0–B5.
- [ ] Có ablation core.
- [ ] Literature gap không tuyên bố “validated” trước khi có thực nghiệm.
- [ ] Có Q3 → Q2 → Q1 ladder.
- [ ] Có maturity gates.
- [ ] Có明确 scope boundary.
- [ ] Q3 có thể hoàn thiện độc lập.
- [ ] Q2/Q1 là progressive extension.
- [ ] Platform engineering không lấn át scientific contribution.

---

# 22. Kết quả mong muốn cuối cùng

Bản đề cương sau chỉnh phải truyền đạt được câu chuyện:

```text
Existing MLOps PaaS
        ↓
Generic MLOps monitoring is insufficient
        ↓
Research Problem
        ↓
Multi-Evidence Representation
        ↓
Degradation Diagnosis
        ↓
Severity + Confidence
        ↓
Adaptive Strategy Selection
        ↓
Appropriate Maintenance
        ↓
Controlled Benchmark
        ↓
Empirical Evidence
```

Và research claim trung tâm:

> **A model degradation event should not directly imply retraining. The appropriate maintenance action should be selected from heterogeneous evidence about degradation cause, severity, confidence, and operational context.**

Scientific progression:

```text
Q3:
Can this diagnosis + strategy framework work?

Q2:
Can it become uncertainty-aware, cost/risk-aware,
and generalize robustly?

Q1:
Can it become causal, online-adaptive,
or broadly generalizable?
```

Không thêm tính năng chỉ để làm “hệ thống lớn hơn”. Mỗi phần mở rộng phải trả lời một câu hỏi khoa học mới.
